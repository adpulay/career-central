import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configureSources, pollSource, readMonitor, setMonitorDecision} from '../lib/career-central/job-monitor.mjs';
import {fileMonitorStore} from '../lib/career-central/monitor-store.mjs';
import {createCloudMonitorStore, memoryObjectStore, memoryTable} from '../lib/career-central/cloud-monitor-store.mjs';
import {exportMonitorBundle, importMonitorBundle, verifyMonitorBundle, setSourceOwner} from '../lib/career-central/monitor-transfer.mjs';
import {authorizeRecurring, runMonitorTick} from '../lib/career-central/monitor-scheduler.mjs';

const now = Date.parse('2026-11-12T12:00:00Z'), hour = 3600000;
const context = {portals: {}, history: [], blacklist: new Map(),
  policy: {discovery: {graduationYear: 2027, searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}, monitorHighPriorityScore: 40}},
  profile: {personal: {name: 'SENTINEL_NAME_T4'}, education: [{graduation_month: {value: '2027-05', verified: true}}], technicalSkills: {verified: true, value: {c: ['AWS', 'Python']}},
    authorization: {us_work_authorized: {verified: true, value: true}}, standardAnswers: {full_time_start: {value: '2027-06', verified: true}}, resumeVersions: []}};
const job = (board, id) => ({externalId: id, title: 'Software Engineer I, New Grad 2027', location: 'Dallas, Texas, United States',
  url: `https://job-boards.greenhouse.io/${board}/jobs/${id}`, description: 'Required: graduating in 2027. Starting in June 2027. AWS Python.'});
const src = id => ({id, company: `Fictional ${id}`, provider: 'greenhouse', board: id, intervalMinutes: 30});
const poll = (store, id, jobs, time) => pollSource({root: store, sourceId: id, context, now: time, random: () => 0, fetchSnapshot: async () => ({jobs, complete: true})});
const withRoot = async fn => {const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-')); try {await fn(root);} finally {fs.rmSync(root, {recursive: true, force: true});}};
const cloud = () => createCloudMonitorStore({objects: memoryObjectStore(), table: memoryTable()});

test('local -> cloud transfer is lossless, digest-verified, dry-run by default and carries no private data', () => withRoot(async root => {
  const local = fileMonitorStore(root);
  await configureSources(local, [src('alpha'), src('bravo')]);
  await poll(local, 'alpha', [job('alpha', '1')], now); await poll(local, 'alpha', [job('alpha', '1'), job('alpha', '2')], now + hour);
  await setMonitorDecision(local, {postingId: Object.keys(readMonitor(local).postings)[0], decision: 'interested'});
  await authorizeRecurring(local, {sourceIds: ['alpha'], hours: 24, now});
  const bundle = await exportMonitorBundle(local, {sourceIds: ['alpha'], now: now + 2 * hour});
  assert.equal(verifyMonitorBundle(bundle), true);
  const text = JSON.stringify(bundle);
  assert.ok(!text.includes('SENTINEL_NAME_T4'), 'no profile data');
  assert.ok(!text.includes('"scheduler"') && !text.includes('"expiresAt"') && !text.includes('"sourceIds"'), 'no recurring authorization record');
  assert.deepEqual(Object.keys(bundle.sources), ['alpha'], 'only the selected source');
  const target = cloud();
  const dry = await importMonitorBundle(target, bundle);
  assert.deepEqual({imported: dry.imported, create: dry.create}, {imported: false, create: ['alpha']});
  await assert.rejects(target.load().then(m => {if (!m.sources.alpha) throw Object.assign(Error('absent'), {code: 'ABSENT'});}), {code: 'ABSENT'}, 'dry run wrote nothing');
  assert.equal((await importMonitorBundle(target, bundle, {dryRun: false, owner: 'cloud'})).imported, true);
  const after = await target.load(), before = readMonitor(local);
  assert.deepEqual(after.postings, Object.fromEntries(Object.entries(before.postings).filter(([, p]) => p.sourceId === 'alpha')));
  assert.deepEqual(after.alerts, before.alerts); assert.equal(after.sources.alpha.owner, 'cloud'); assert.equal(after.scheduler, undefined, 'no authorization transferred');
  assert.equal((await importMonitorBundle(target, bundle, {dryRun: false})).identical.length, 1, 'idempotent re-import');
}));

test('tampered or conflicting bundles are refused', () => withRoot(async root => {
  const local = fileMonitorStore(root); await configureSources(local, [src('alpha')]); await poll(local, 'alpha', [job('alpha', '1')], now);
  const bundle = await exportMonitorBundle(local, {sourceIds: ['alpha'], now});
  const tampered = structuredClone(bundle); Object.values(tampered.sources.alpha.partition.postings)[0].title = 'Changed';
  assert.throws(() => verifyMonitorBundle(tampered), {code: 'MONITOR_TRANSFER_DIGEST_MISMATCH'});
  const target = cloud(); await configureSources(target, [src('alpha')]);
  await assert.rejects(importMonitorBundle(target, bundle, {dryRun: false}), {code: 'MONITOR_TRANSFER_CONFLICT'});
  await assert.rejects(exportMonitorBundle(local, {sourceIds: ['missing']}), {code: 'MONITOR_SOURCE_UNKNOWN'});
}));

test('ownership handover: exactly one side polls a source; handing back restores local polling', () => withRoot(async root => {
  const local = fileMonitorStore(root); await configureSources(local, [src('alpha')]); await poll(local, 'alpha', [job('alpha', '1')], now);
  const target = cloud();
  await importMonitorBundle(target, await exportMonitorBundle(local, {sourceIds: ['alpha'], now}), {dryRun: false, owner: 'cloud'});
  await setSourceOwner(local, ['alpha'], 'cloud');
  assert.equal((await poll(local, 'alpha', [job('alpha', '1')], now + hour)).skipped, 'not_owner');
  assert.equal((await poll(target, 'alpha', [job('alpha', '1'), job('alpha', '2')], now + hour)).alerts, 1);
  await authorizeRecurring(local, {sourceIds: ['alpha'], hours: 24, now});
  const tick = await runMonitorTick({root: local, context, authorizeLiveRead: true, now: now + 2 * hour, fetchSnapshot: async () => assert.fail('local must not poll a cloud-owned source')});
  assert.equal(tick.results.alpha.skipped, 'not_owner'); assert.equal(tick.polled, 0);
  await setSourceOwner(local, ['alpha'], 'local');
  const back = await poll(local, 'alpha', [job('alpha', '1')], now + 3 * hour);
  assert.equal(back.state, 'healthy'); assert.equal(back.alerts, 0);
}));
