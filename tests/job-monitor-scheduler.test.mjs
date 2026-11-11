import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {configureSources, pollSource, readMonitor, monitorView, setMonitorDecision} from '../lib/career-central/job-monitor.mjs';
import {monitorBackend, migrateMonitorStore, updateMonitor} from '../lib/career-central/monitor-store.mjs';
import {authorizeRecurring, revokeRecurring, runMonitorTick, monitorHealth} from '../lib/career-central/monitor-scheduler.mjs';
import {updateLedger} from '../lib/applications/store.mjs';

const now = Date.parse('2026-11-10T12:00:00Z'), minute = 60000;
const src = (id, extra = {}) => ({id, company: `Fictional ${id}`, provider: 'greenhouse', board: id, intervalMinutes: 15, ...extra});
const profile = {education: [{graduation_month: {value: '2027-05', verified: true}}], technicalSkills: {verified: true, value: {cloud: ['AWS', 'Python']}},
  authorization: {us_work_authorized: {verified: true, value: true}}, standardAnswers: {full_time_start: {value: '2027-06', verified: true}}, resumeVersions: []};
const context = {profile, policy: {discovery: {graduationYear: 2027, searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}, monitorHighPriorityScore: 40}}, portals: {}, history: []};
const job = (board, id, extra = {}) => ({externalId: id, title: 'Software Engineer I, New Grad 2027', location: 'Dallas, Texas, United States',
  url: `https://job-boards.greenhouse.io/${board}/jobs/${id}`, description: 'Required: graduating in 2027. Starting in June 2027. AWS Python.', ...extra});
const fixture = async fn => {const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-sched-')); try {await fn(root);} finally {fs.rmSync(root, {recursive: true, force: true});}};
const feeds = (map, calls = []) => async definition => {calls.push(definition.id); const value = map[definition.id]; if (value instanceof Error) throw value; return {jobs: value ?? [], complete: true};};
const tick = (root, fetchSnapshot, time, extra = {}) => runMonitorTick({root, context, fetchSnapshot, mode: 'fixture', now: time, random: () => 0, ...extra});
const ledgerFile = root => path.join(root, 'data/application-automation/ledger.json');
const seedLedger = root => updateLedger(root, ledger => {
  ledger.jobs.k1 = {key: 'k1', company: 'Fictional', title: 'Applied role', status: 'Submitted'}; ledger.events.push({id: 'e1', jobKey: 'k1', to: 'Submitted'});
  ledger.reviewedMailSends = {s1: {status: 'sent'}}; ledger.emailInbox = {m1: {subject: 'fictional'}};
});

test('fresh roots use the split store; polls never create or rewrite the application ledger', () => fixture(async root => {
  await seedLedger(root); const before = fs.readFileSync(ledgerFile(root));
  await configureSources(root, [src('alpha')]);
  await pollSource({root, sourceId: 'alpha', context, now, random: () => 0, fetchSnapshot: feeds({alpha: [job('alpha', '1')]})});
  assert.equal(monitorBackend(root), 'split'); assert.deepEqual(fs.readFileSync(ledgerFile(root)), before);
  assert.ok(fs.existsSync(path.join(root, 'data/job-monitor/sources/alpha.json')));
  assert.equal(monitorView(root).storage, 'split');
}));

test('per-source partitions lift the global 3 MiB cliff that blocked a fourth employer', () => fixture(async root => {
  const ids = ['alpha', 'bravo', 'charlie', 'delta'];
  await configureSources(root, ids.map(id => src(id)));
  const big = id => Array.from({length: 450}, (_, n) => job(id, String(n), {title: `Systems Engineer ${n}`, description: 'Required experience. '.repeat(120)}));
  for (const id of ids) {
    const result = await pollSource({root, sourceId: id, context, now, random: () => 0, fetchSnapshot: feeds({[id]: big(id)})});
    assert.notEqual(result.state, 'failed', `${id}: ${result.errorCategory}`);
  }
  const total = ids.reduce((sum, id) => sum + fs.statSync(path.join(root, `data/job-monitor/sources/${id}.json`)).size, 0);
  assert.ok(total > 3 * 1024 * 1024, `fixture exceeds the old global budget (${total})`);
  assert.equal(Object.keys(readMonitor(root).postings).length, 1800);
}));

test('legacy in-ledger state keeps working until migrated; dry run writes nothing', () => fixture(async root => {
  await seedLedger(root);
  await updateLedger(root, ledger => {ledger.jobMonitor = {schemaVersion: 1, sources: {}, postings: {}, alerts: {}, preparationTasks: {}, revision: 0};});
  assert.equal(monitorBackend(root), 'legacy');
  await configureSources(root, [src('alpha')]);
  await pollSource({root, sourceId: 'alpha', context, now, random: () => 0, fetchSnapshot: feeds({alpha: []})});
  await pollSource({root, sourceId: 'alpha', context, now: now + 20 * minute, random: () => 0, fetchSnapshot: feeds({alpha: [job('alpha', '1')]})});
  assert.equal(monitorView(root).alerts.length, 1);
  const before = fs.readFileSync(ledgerFile(root));
  const dry = await migrateMonitorStore(root);
  assert.equal(dry.dryRun, true); assert.equal(dry.sources, 1); assert.equal(dry.alerts, 1);
  assert.deepEqual(fs.readFileSync(ledgerFile(root)), before); assert.equal(fs.existsSync(path.join(root, 'data/job-monitor')), false);
  await assert.rejects(authorizeRecurring(root, {sourceIds: ['alpha'], hours: 24}), {code: 'MONITOR_STORE_MIGRATION_REQUIRED'});
  await assert.rejects(tick(root, feeds({}), now), {code: 'MONITOR_STORE_MIGRATION_REQUIRED'});
}));

test('migration is lossless, touches only the monitor section, and keeps alert deduplication', () => fixture(async root => {
  await seedLedger(root);
  await updateLedger(root, ledger => {ledger.jobMonitor = {schemaVersion: 1, sources: {}, postings: {}, alerts: {}, preparationTasks: {}, revision: 0};});
  await configureSources(root, [src('alpha'), src('bravo')]);
  for (const id of ['alpha', 'bravo']) {
    await pollSource({root, sourceId: id, context, now, random: () => 0, fetchSnapshot: feeds({[id]: []})});
    await pollSource({root, sourceId: id, context, now: now + 20 * minute, random: () => 0, fetchSnapshot: feeds({[id]: [job(id, '1')]})});
  }
  // Interleave postings across sources, as real legacy sections are.
  await pollSource({root, sourceId: 'alpha', context, now: now + 40 * minute, random: () => 0, fetchSnapshot: feeds({alpha: [job('alpha', '1'), job('alpha', '2')]})});
  assert.deepEqual(Object.values(readMonitor(root).postings).map(row => row.sourceId), ['alpha', 'bravo', 'alpha']);
  await setMonitorDecision(root, {postingId: monitorView(root).jobs[0].id, decision: 'interested'});
  const legacy = readMonitor(root), ledgerBefore = JSON.parse(fs.readFileSync(ledgerFile(root)));
  const result = await migrateMonitorStore(root, {dryRun: false});
  assert.equal(result.migrated, true); assert.equal(monitorBackend(root), 'split');
  const {migration, ...migrated} = readMonitor(root);
  assert.deepEqual(migrated, legacy, 'deepEqual ignores key order; content must match exactly'); assert.match(migration.legacyHash, /^[a-f0-9]{64}$/);
  const {jobMonitor, ...rest} = ledgerBefore; assert.deepEqual(JSON.parse(fs.readFileSync(ledgerFile(root))), rest, 'jobs, events and email state unchanged');
  const again = await pollSource({root, sourceId: 'alpha', context, now: now + 80 * minute, random: () => 0, fetchSnapshot: feeds({alpha: [job('alpha', '1'), job('alpha', '2')]})});
  assert.equal(again.alerts, 0); assert.equal(Object.keys(readMonitor(root).alerts).length, 3);
  assert.equal(monitorView(root).jobs.find(row => row.decision === 'interested') !== undefined, true);
  assert.deepEqual(await migrateMonitorStore(root, {dryRun: false}), {migrated: false, reason: 'already_migrated'});
}));

test('a migration interrupted before the ledger write is detected and resumed, and conflicts fail closed', () => fixture(async root => {
  await updateLedger(root, ledger => {ledger.jobMonitor = {schemaVersion: 1, sources: {}, postings: {}, alerts: {}, preparationTasks: {}, revision: 0};});
  await configureSources(root, [src('alpha')]);
  const legacy = readMonitor(root);
  await migrateMonitorStore(root, {dryRun: false});
  await updateLedger(root, ledger => {ledger.jobMonitor = legacy;}); // simulate crash before the ledger removal
  assert.throws(() => monitorBackend(root), {code: 'MONITOR_STORE_MIGRATION_INCOMPLETE'});
  assert.equal((await migrateMonitorStore(root, {dryRun: false})).resumed, true); assert.equal(monitorBackend(root), 'split');
  await updateLedger(root, ledger => {ledger.jobMonitor = {...legacy, revision: 99};});
  await assert.rejects(migrateMonitorStore(root, {dryRun: false}), {code: 'MONITOR_STORE_MIGRATION_CONFLICT'});
}));

test('tick requires an unexpired source authorization and live consent; recurring is never installed', () => fixture(async root => {
  await configureSources(root, [src('alpha')]);
  await assert.rejects(runMonitorTick({root, context, fetchSnapshot: feeds({}), now}), {code: 'MONITOR_LIVE_NOT_AUTHORIZED'});
  await assert.rejects(tick(root, feeds({}), now), {code: 'MONITOR_RECURRING_NOT_AUTHORIZED'});
  assert.equal(monitorHealth(readMonitor(root), now).scheduler, 'not_authorized');
  await assert.rejects(authorizeRecurring(root, {sourceIds: ['missing'], hours: 24, now}), {code: 'MONITOR_SOURCE_UNKNOWN'});
  await assert.rejects(authorizeRecurring(root, {sourceIds: ['alpha'], hours: 24 * 31, now}), {code: 'MONITOR_AUTHORIZATION_INVALID'});
  await authorizeRecurring(root, {sourceIds: ['alpha'], hours: 1, now});
  assert.equal(monitorView(root, {now}).recurringEnabled, true); assert.equal(monitorView(root, {now}).recurringInstalled, false);
  assert.equal((await tick(root, feeds({alpha: []}), now)).polled, 1);
  await assert.rejects(tick(root, feeds({alpha: []}), now + 61 * minute), {code: 'MONITOR_RECURRING_NOT_AUTHORIZED'});
  assert.equal(monitorHealth(readMonitor(root), now + 61 * minute).scheduler, 'authorization_expired');
  await authorizeRecurring(root, {sourceIds: ['alpha'], hours: 1, now: now + 62 * minute}); await revokeRecurring(root);
  await assert.rejects(tick(root, feeds({alpha: []}), now + 63 * minute), {code: 'MONITOR_RECURRING_NOT_AUTHORIZED'});
}));

test('ticks poll only due authorized sources within budget, honor intervals/backoff and never duplicate alerts', () => fixture(async root => {
  await configureSources(root, [src('alpha'), src('bravo'), src('charlie'), src('paused')]);
  await setMonitorDecision(root, {pausedSource: 'paused', paused: true});
  await authorizeRecurring(root, {sourceIds: ['alpha', 'bravo', 'paused'], hours: 24, maxPollsPerTick: 2, now});
  const calls = [], map = {alpha: [], bravo: [], paused: []}, fetch = feeds(map, calls);
  const first = await tick(root, fetch, now);
  assert.equal(first.polled, 2); assert.equal(first.results.paused.skipped, 'paused'); assert.equal(first.results.charlie, undefined, 'unauthorized source never polled');
  assert.equal((await tick(root, fetch, now + 5 * minute)).polled, 0, 'nothing due before the interval');
  map.alpha = [job('alpha', '1')];
  const second = await tick(root, fetch, now + 16 * minute);
  assert.equal(second.results.alpha.alerts, 1);
  const third = await tick(root, fetch, now + 32 * minute);
  assert.equal(third.results.alpha.alerts, 0); assert.equal(Object.keys(readMonitor(root).alerts).length, 1);
  assert.ok(!calls.includes('charlie') && !calls.includes('paused'));
  map.bravo = Object.assign(Error('provider down'), {status: 503});
  const failing = await tick(root, fetch, now + 48 * minute);
  assert.equal(failing.results.bravo.state, 'failed'); assert.equal(failing.failed, 1);
  const bravo = readMonitor(root).sources.bravo;
  assert.ok(Date.parse(bravo.nextDueAt) - (now + 48 * minute) >= 30 * minute, 'exponential backoff beyond the interval');
  assert.equal((await tick(root, fetch, now + 64 * minute)).results.bravo?.skipped ?? 'not_due', 'not_due');
}));

test('overlapping ticks skip instead of running twice', () => fixture(async root => {
  await configureSources(root, [src('alpha')]); await authorizeRecurring(root, {sourceIds: ['alpha'], hours: 24, now});
  let release; const pending = new Promise(resolve => {release = resolve;}), calls = [];
  const slow = async definition => {calls.push(definition.id); await pending; return {jobs: [], complete: true};};
  const first = tick(root, slow, now);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(await tick(root, slow, now), {skipped: 'tick_in_progress'});
  release(); assert.equal((await first).polled, 1); assert.deepEqual(calls, ['alpha']);
}));

test('health distinguishes no new jobs, changes, failure, rate limit, overdue, lost worker, paused, cached and stale scheduler', async () => {
  const poll = (root, id, jobs, time, extra = {}) => pollSource({root, sourceId: id, context, now: time, random: () => 0, fetchSnapshot: feeds({[id]: jobs}), ...extra});
  await fixture(async root => {
    const ids = ['quiet', 'changed', 'broken', 'limited', 'late'];
    await configureSources(root, ids.map(id => src(id))); await authorizeRecurring(root, {sourceIds: ids, hours: 24, now});
    for (const id of ids) await poll(root, id, [], now);
    await poll(root, 'changed', [job('changed', '1')], now + 16 * minute);
    await poll(root, 'quiet', [], now + 16 * minute);
    await poll(root, 'broken', Object.assign(Error('x'), {status: 500}), now + 16 * minute);
    await poll(root, 'limited', Object.assign(Error('x'), {status: 429, retryAfter: '600'}), now + 16 * minute);
    await updateMonitor(root, monitor => {monitor.scheduler = {...monitor.scheduler, lastTick: {at: new Date(now + 16 * minute).toISOString(), outcome: 'completed', polled: 1}};});
    const health = monitorHealth(readMonitor(root), now + 20 * minute);
    assert.deepEqual(Object.fromEntries(Object.entries(health.sources).map(([id, value]) => [id, value.state])),
      {quiet: 'ok_no_changes', changed: 'ok_changes', broken: 'failing', limited: 'rate_limited', late: 'ok_no_changes'});
    assert.equal(health.scheduler, 'running');
    const later = monitorHealth(readMonitor(root), now + 60 * minute);
    assert.equal(later.sources.late.state, 'overdue', 'authorized source past due plus grace'); assert.equal(later.scheduler, 'stale');
  });
  await fixture(async root => {
    await configureSources(root, ['lost', 'stopped', 'cached', 'fresh'].map(id => src(id)));
    await poll(root, 'lost', [], now);
    await updateMonitor(root, monitor => {monitor.sources.lost.lease = {token: 'gone', until: now + 17 * minute};});
    await setMonitorDecision(root, {pausedSource: 'stopped', paused: true});
    await poll(root, 'cached', [job('cached', '9')], now, {mode: 'cache'});
    const health = monitorHealth(readMonitor(root), now + 20 * minute);
    assert.deepEqual(Object.fromEntries(Object.entries(health.sources).map(([id, value]) => [id, value.state])),
      {lost: 'worker_lost', stopped: 'paused', cached: 'cached_only', fresh: 'never_polled'});
    assert.equal(health.scheduler, 'not_authorized'); assert.equal(monitorView(root, {now}).health.sources.fresh.recurring, false);
  });
});

test('CLI: tick needs live consent; migrate-store defaults to a dry run; health is read-only', () => fixture(async root => {
  const env = {...process.env, CAREER_OPS_ROOT: root}, run = (...args) => spawnSync(process.execPath, ['scripts/job-monitor.mjs', ...args], {env, encoding: 'utf8'});
  await configureSources(root, [src('alpha')]);
  const denied = run('tick'); assert.equal(denied.status, 1); assert.match(denied.stderr, /MONITOR_LIVE_NOT_AUTHORIZED/);
  const health = run('health'); assert.equal(health.status, 0, health.stderr); assert.equal(JSON.parse(health.stdout).scheduler, 'not_authorized');
  const migrate = run('migrate-store'); assert.equal(migrate.status, 0, migrate.stderr); assert.equal(JSON.parse(migrate.stdout).reason, 'already_migrated');
}));
