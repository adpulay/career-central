import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {configureSources, pollSource, readMonitor, monitorView, setMonitorDecision} from '../lib/career-central/job-monitor.mjs';
import {monitorBackend, migrateMonitorStore, rollbackMonitorStore, updateMonitor} from '../lib/career-central/monitor-store.mjs';
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

test('rollback folds the split store back into the ledger, keeping post-migration state, and is resumable', () => fixture(async root => {
  await seedLedger(root);
  await updateLedger(root, ledger => {ledger.jobMonitor = {schemaVersion: 1, sources: {}, postings: {}, alerts: {}, preparationTasks: {}, revision: 0};});
  await configureSources(root, [src('alpha')]);
  await pollSource({root, sourceId: 'alpha', context, now, random: () => 0, fetchSnapshot: feeds({alpha: []})});
  const ledgerOther = () => {const {jobMonitor, ...rest} = JSON.parse(fs.readFileSync(ledgerFile(root))); return rest;}, otherBefore = ledgerOther();
  await migrateMonitorStore(root, {dryRun: false});
  // State recorded after migration must survive rollback (a backup restore would lose it).
  await pollSource({root, sourceId: 'alpha', context, now: now + 20 * minute, random: () => 0, fetchSnapshot: feeds({alpha: [job('alpha', '1')]})});
  const {migration, ...expected} = readMonitor(root);
  const dry = await rollbackMonitorStore(root);
  assert.equal(dry.dryRun, true); assert.equal(dry.alerts, 1); assert.equal(monitorBackend(root), 'split');
  await updateMonitor(root, monitor => {monitor.sources.alpha.lease = {token: 'live', until: now + 10 ** 12};});
  await assert.rejects(rollbackMonitorStore(root, {dryRun: false}), {code: 'MONITOR_SOURCE_BUSY'});
  await updateMonitor(root, monitor => {monitor.sources.alpha.lease = null;}); expected.sources.alpha.lease = null;
  const done = await rollbackMonitorStore(root, {dryRun: false});
  assert.equal(done.rolledBack, true); assert.equal(monitorBackend(root), 'legacy'); assert.equal(fs.existsSync(path.join(root, 'data/job-monitor')), false);
  assert.deepEqual(readMonitor(root), {...expected, revision: readMonitor(root).revision});
  assert.deepEqual(ledgerOther(), otherBefore, 'application/email ledger fields unchanged through migrate + rollback');
  // Interrupted rollback: both identical copies exist; rerunning completes it.
  await migrateMonitorStore(root, {dryRun: false});
  const split = (({migration, ...rest}) => rest)(readMonitor(root));
  await updateLedger(root, ledger => {ledger.jobMonitor = split;});
  assert.throws(() => monitorBackend(root), {code: 'MONITOR_STORE_MIGRATION_INCOMPLETE'});
  assert.equal((await rollbackMonitorStore(root, {dryRun: false})).resumed, true); assert.equal(monitorBackend(root), 'legacy');
}));

test('simulated 8-hour run: per-employer intervals, rate limits, backoff, crash recovery, pause, expiry and dedup', {timeout: 240000}, () => fixture(async root => {
  // Three employers with distinct intervals; one tick per simulated minute.
  await configureSources(root, [src('alpha', {intervalMinutes: 5}), src('bravo', {intervalMinutes: 15}), src('charlie', {intervalMinutes: 60})]);
  await authorizeRecurring(root, {sourceIds: ['alpha', 'bravo', 'charlie'], hours: 6, now});
  const feed = {alpha: [job('alpha', '1'), job('alpha', '2')], bravo: [job('bravo', '1')], charlie: [job('charlie', '1')]};
  const pollsAt = {alpha: [], bravo: [], charlie: []}, failures = {};
  let clock = now;
  const fetchSnapshot = async definition => {
    pollsAt[definition.id].push(clock);
    const failure = failures[definition.id]?.(clock); if (failure) throw failure;
    return {jobs: structuredClone(feed[definition.id]), complete: true};
  };
  const at = minutes => now + minutes * minute, alertsNow = () => Object.keys(readMonitor(root).alerts).length;
  const run = async (from, to, hook = () => {}) => {for (let m = from; m < to; m++) {clock = at(m); await hook(m); await tick(root, fetchSnapshot, clock);}};

  // Baselines are quiet, including across a "restart" (a fresh tick sequence on the same store).
  await run(0, 2);
  assert.equal(alertsNow(), 0, 'baseline postings never alert');
  await run(2, 60);
  assert.equal(alertsNow(), 0, 'unchanged feeds after restart never re-alert');

  // Exactly one alert per new posting/version, despite many later ticks.
  feed.alpha.push(job('alpha', '3'));
  await run(60, 90);
  assert.equal(alertsNow(), 1);
  feed.alpha[2] = job('alpha', '3', {description: job('alpha', '3').description + ' Updated responsibilities.'});
  await run(90, 120);
  assert.equal(alertsNow(), 2, 'a content change is a new version, alerted once');

  // Worker crash: a lease left behind blocks others until it expires, then is reclaimed.
  await updateMonitor(root, monitor => {monitor.sources.bravo.lease = {token: 'crashed-worker', until: at(121) + 90000}; monitor.sources.bravo.nextDueAt = new Date(at(120)).toISOString();});
  const bravoBefore = pollsAt.bravo.length;
  await run(120, 122);
  assert.equal(pollsAt.bravo.length, bravoBefore, 'live foreign lease is respected');
  assert.equal(monitorHealth(readMonitor(root), at(123)).sources.bravo.state, 'worker_lost');
  await run(122, 125);
  assert.equal(pollsAt.bravo.length, bravoBefore + 1, 'expired lease reclaimed exactly once');
  assert.equal(readMonitor(root).sources.bravo.lease, null);

  // Provider outage: exponential backoff, then recovery resets failures.
  failures.charlie = time => time < at(200) ? Object.assign(Error('down'), {status: 503}) : null;
  await updateMonitor(root, monitor => {monitor.sources.charlie.nextDueAt = new Date(at(125)).toISOString();});
  await run(125, 200);
  const outage = pollsAt.charlie.filter(time => time >= at(125) && time < at(200));
  assert.ok(outage.length >= 1 && outage.length <= 2, `backoff limits retries during the outage (${outage.length})`);
  assert.equal(monitorHealth(readMonitor(root), at(200)).sources.charlie.state, 'failing');

  // Rate limit: Retry-After (40 minutes) is honored beyond the 5-minute interval.
  failures.alpha = time => time >= at(200) && time < at(203) ? Object.assign(Error('slow down'), {status: 429, retryAfter: '2400'}) : null;
  await updateMonitor(root, monitor => {monitor.sources.alpha.nextDueAt = new Date(at(200)).toISOString();});
  await run(200, 230);
  const limitedAt = pollsAt.alpha.find(time => time >= at(200));
  assert.equal(limitedAt, at(200), 'the 429 was actually received');
  assert.ok(pollsAt.alpha.filter(time => time > limitedAt && time < limitedAt + 40 * minute).length === 0, 'no alpha poll inside Retry-After');
  assert.equal(monitorHealth(readMonitor(root), at(230)).sources.alpha.state, 'rate_limited');

  // Pause/resume: no polls while paused; polls resume when due.
  await setMonitorDecision(root, {pausedSource: 'bravo', paused: true});
  const pausedFrom = pollsAt.bravo.length;
  await run(230, 280);
  assert.equal(pollsAt.bravo.length, pausedFrom);
  await setMonitorDecision(root, {pausedSource: 'bravo', paused: false});
  await run(280, 300);
  assert.ok(pollsAt.bravo.length > pausedFrom, 'resumed source polls again');

  // Per-employer intervals act as rate limits: no source is ever polled faster than its interval
  // (failed attempts back off further), and quiet sources stretch to at most 4x.
  for (const [id, interval] of [['alpha', 5], ['bravo', 15], ['charlie', 60]]) {
    // Ignore only gaps spanning a test-forced reschedule (crash, outage and 429 setups).
    const forced = {alpha: [at(200)], bravo: [at(120)], charlie: [at(125)]}[id];
    const times = pollsAt[id], gaps = times.slice(1).map((time, index) => ({gap: time - times[index], from: times[index], to: time}))
      .filter(({from, to}) => !forced.some(mark => from < mark && to >= mark));
    assert.ok(gaps.length >= 3, `${id} has scheduler-chosen gaps to check`);
    assert.ok(gaps.every(({gap}) => gap >= interval * minute), `${id} never polled faster than ${interval} min`);
  }
  assert.ok(pollsAt.alpha.length > pollsAt.bravo.length && pollsAt.bravo.length > pollsAt.charlie.length, 'polling frequency follows employer intervals');

  // Authorization expires at 6 hours: ticks stop, health reports it, no further polls.
  const total = Object.values(pollsAt).flat().length;
  await run(360, 370).catch(error => assert.equal(error.code, 'MONITOR_RECURRING_NOT_AUTHORIZED'));
  await assert.rejects(tick(root, fetchSnapshot, at(361)), {code: 'MONITOR_RECURRING_NOT_AUTHORIZED'});
  assert.equal(Object.values(pollsAt).flat().length, total);
  assert.equal(monitorHealth(readMonitor(root), at(370)).scheduler, 'authorization_expired');
  assert.equal(alertsNow(), 2, 'no duplicate alerts across the whole run');
  assert.equal(monitorView(root, {now: at(370)}).submittedApplications, 0);
}));

test('up to eight sources can stay configured while only authorized ones are polled', () => fixture(async root => {
  const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
  await configureSources(root, ids.slice(0, 3).map(id => src(id))); await configureSources(root, ids.slice(3).map(id => src(id)));
  await configureSources(root, [src('a8')]);
  await assert.rejects(configureSources(root, [src('a9')]), {code: 'MONITOR_SOURCE_INVALID'});
  await authorizeRecurring(root, {sourceIds: ['a4', 'a5', 'a6', 'a7', 'a8'], hours: 168, now});
  const calls = [];
  const result = await tick(root, feeds({}, calls), now);
  assert.equal(result.polled, 5); assert.deepEqual(calls.sort(), ['a4', 'a5', 'a6', 'a7', 'a8']);
  const health = monitorHealth(readMonitor(root), now + 24 * 60 * minute);
  assert.equal(health.sources.a1.recurring, false); assert.equal(health.sources.a1.state, 'never_polled', 'unauthorized sources are never polled or reported overdue');
}));

test('health: a failed first poll is failing (not never_polled), and a quiet baseline is not reported as changes', () => fixture(async root => {
  await configureSources(root, [src('failedfirst'), src('limitedfirst'), src('baselined'), src('untouched')]);
  const poll = (id, jobs, time) => pollSource({root, sourceId: id, context, now: time, random: () => 0, fetchSnapshot: feeds({[id]: jobs})});
  await poll('failedfirst', Object.assign(Error('big'), {maxBytes: 1}), now);
  await poll('limitedfirst', Object.assign(Error('slow'), {status: 429, retryAfter: '600'}), now);
  await poll('baselined', [job('baselined', '1'), job('baselined', '2')], now);
  const health = monitorHealth(readMonitor(root), now + minute);
  assert.equal(health.sources.failedfirst.state, 'failing'); assert.equal(health.sources.failedfirst.errorCategory, 'response_too_large');
  assert.equal(health.sources.limitedfirst.state, 'rate_limited');
  assert.equal(health.sources.baselined.state, 'ok_no_changes');
  assert.equal(health.sources.untouched.state, 'never_polled');
  await poll('baselined', [job('baselined', '1'), job('baselined', '2'), job('baselined', '3')], now + 20 * minute);
  assert.equal(monitorHealth(readMonitor(root), now + 21 * minute).sources.baselined.state, 'ok_changes');
}));
