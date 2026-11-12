// CC-017 C0 store-port contract: identical scenarios against every store
// implementation (local file store and the in-memory reference store).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {configureSources, pollSource, readMonitor, monitorView} from '../lib/career-central/job-monitor.mjs';
import {fileMonitorStore} from '../lib/career-central/monitor-store.mjs';
import {memoryMonitorStore} from '../lib/career-central/monitor-memory-store.mjs';
import {createCloudMonitorStore, memoryObjectStore, memoryTable} from '../lib/career-central/cloud-monitor-store.mjs';

const now = Date.parse('2026-11-10T12:00:00Z'), hour = 3600000;
const src = id => ({id, company: `Fictional ${id}`, provider: 'greenhouse', board: id, intervalMinutes: 5});
const context = {portals: {}, history: [], policy: {discovery: {graduationYear: 2027, searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}, monitorHighPriorityScore: 40}},
  profile: {education: [{graduation_month: {value: '2027-05', verified: true}}], technicalSkills: {verified: true, value: {cloud: ['AWS', 'Python']}},
    authorization: {us_work_authorized: {verified: true, value: true}}, standardAnswers: {full_time_start: {value: '2027-06', verified: true}}, resumeVersions: []}};
const job = (board, id, extra = {}) => ({externalId: id, title: 'Software Engineer I, New Grad 2027', location: 'Dallas, Texas, United States',
  url: `https://job-boards.greenhouse.io/${board}/jobs/${id}`, description: 'Required: graduating in 2027. Starting in June 2027. AWS Python.', ...extra});
const fail = code => Object.assign(Error(code), {code});

const STORES = {
  file: () => {const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-contract-')); return {store: fileMonitorStore(root), cleanup: () => fs.rmSync(root, {recursive: true, force: true}), root};},
  memory: () => ({store: memoryMonitorStore(), cleanup: () => {}}),
  // S3/DynamoDB semantics over in-memory fakes: no SDK, no credentials, no resources.
  cloud: () => ({store: createCloudMonitorStore({objects: memoryObjectStore(), table: memoryTable()}), cleanup: () => {}}),
};
// Simulates a process crash right after the Nth updateSource commit: the call
// committed, then nothing else in that "process" can write until restart().
const crashAfterCommit = (store, shouldCrash) => {
  let down = false, calls = 0;
  const guard = () => {if (down) throw fail('SIMULATED_CRASH');};
  return {...store, stats: store.stats, testHooks: store.testHooks,
    readAll: () => store.readAll(), backend: () => store.backend(), acquireTickLock: () => store.acquireTickLock(), refresh: () => store.refresh?.(),
    updateAll: async (...args) => {guard(); return store.updateAll(...args);},
    updateSource: async (...args) => {guard(); const result = await store.updateSource(...args); if (shouldCrash(++calls)) {down = true; throw fail('SIMULATED_CRASH');} return result;},
    restart() {down = false;}};
};
const poll = (store, id, jobs, time, extra = {}) => pollSource({root: store, sourceId: id, context, now: time, random: () => 0,
  fetchSnapshot: async () => ({jobs, complete: true}), ...extra});

for (const [kind, make] of Object.entries(STORES)) {
  const contract = (name, fn) => test(`[${kind} store] ${name}`, async () => {const env = make(); try {await fn(env);} finally {env.cleanup();}});

  contract('quiet baseline, one alert per posting version, per-source isolation', async ({store}) => {
    await configureSources(store, [src('alpha'), src('bravo')]);
    await poll(store, 'alpha', [job('alpha', '1')], now); await poll(store, 'bravo', [job('bravo', '1')], now);
    assert.equal(Object.keys(readMonitor(store).alerts).length, 0);
    const bravoBefore = readMonitor(store).sources.bravo;
    assert.equal((await poll(store, 'alpha', [job('alpha', '1'), job('alpha', '2')], now + hour)).alerts, 1);
    assert.equal((await poll(store, 'alpha', [job('alpha', '1'), job('alpha', '2')], now + 2 * hour)).alerts, 0);
    assert.deepEqual(readMonitor(store).sources.bravo, bravoBefore, 'polling alpha never touches bravo');
  });

  contract('unchanged snapshots (including 304) write no partition content; the view stays identical', async ({store}) => {
    await configureSources(store, [src('alpha')]);
    const jobs = [job('alpha', '1'), job('alpha', '2')];
    await poll(store, 'alpha', jobs, now); await poll(store, 'alpha', jobs, now + hour); // baseline, then the one-time baseline→unchanged transition
    const strip = view => view.jobs.map(({lastSeenAt, ...row}) => row);
    const viewBefore = strip(monitorView(store, {now})), writes = store.stats.partitionWrites, skips = store.stats.unchangedPartitionSkips;
    for (let n = 2; n < 102; n++) await poll(store, 'alpha', n % 10 === 0 ? [] : jobs, now + n * hour, n % 10 === 0 ? {fetchSnapshot: async () => ({notModified: true})} : {});
    assert.equal(store.stats.partitionWrites - writes, 0, '100 unchanged polls: zero partition writes');
    assert.ok(store.stats.unchangedPartitionSkips - skips >= 100);
    assert.deepEqual(strip(monitorView(store, {now})), viewBefore);
    assert.equal(monitorView(store, {now}).jobs[0].lastSeenAt, readMonitor(store).sources.alpha.lastObservedAt, 'listed postings report the latest observation');
    assert.equal(readMonitor(store).sources.alpha.cycles, 102);
  });

  contract('a stale writer is rejected with MONITOR_STORE_CONFLICT and nothing is half-written', async ({store}) => {
    await configureSources(store, [src('alpha')]); await poll(store, 'alpha', [job('alpha', '1')], now);
    const before = readMonitor(store);
    await assert.rejects(store.updateSource('alpha', async scoped => {await store.testHooks.externalWrite('alpha'); scoped.sources.alpha.paused = true;}), {code: 'MONITOR_STORE_CONFLICT'});
    await store.refresh?.();
    assert.equal(readMonitor(store).sources.alpha.paused ?? false, before.sources.alpha.paused ?? false);
    assert.deepEqual(readMonitor(store).postings, before.postings);
  });

  contract('lease fencing: a worker whose lease was reclaimed cannot publish', async ({store}) => {
    await configureSources(store, [src('alpha')]); await poll(store, 'alpha', [], now);
    let release; const pending = new Promise(resolve => {release = resolve;});
    const slow = poll(store, 'alpha', [job('alpha', '9')], now + hour, {fetchSnapshot: async () => {await pending; return {jobs: [job('alpha', '9')], complete: true};}});
    await new Promise(resolve => setTimeout(resolve, 20));
    await poll(store, 'alpha', [job('alpha', '1')], now + hour + 120000); // lease (90 s) expired: reclaimed
    release();
    assert.equal((await slow).state, 'failed');
    assert.ok(!Object.values(readMonitor(store).postings).some(row => row.postingId === '9'), 'stale result never published');
  });

  contract('crash right after the publish commit replays without duplicate alerts', async ({store}) => {
    await configureSources(store, [src('alpha')]); await poll(store, 'alpha', [], now);
    // updateSource calls per poll: claim (1), publish (2). Crash after the publish commit.
    const crashing = crashAfterCommit(store, call => call === 2);
    await assert.rejects(poll(crashing, 'alpha', [job('alpha', '1')], now + hour), {code: 'SIMULATED_CRASH'});
    assert.equal(Object.keys(readMonitor(store).alerts).length, 1, 'the committed cycle kept its single alert');
    crashing.restart();
    const replay = await poll(crashing, 'alpha', [job('alpha', '1')], now + 2 * hour);
    assert.equal(replay.alerts, 0); assert.equal(Object.keys(readMonitor(store).alerts).length, 1);
    assert.equal(readMonitor(store).sources.alpha.lease, null);
  });

  contract('crash after claiming leaves an expiring lease that the next worker reclaims', async ({store}) => {
    await configureSources(store, [src('alpha')]); await poll(store, 'alpha', [], now);
    const crashing = crashAfterCommit(store, call => call === 1);
    await assert.rejects(poll(crashing, 'alpha', [job('alpha', '1')], now + hour), {code: 'SIMULATED_CRASH'});
    crashing.restart();
    assert.equal((await poll(crashing, 'alpha', [job('alpha', '1')], now + hour + 30000)).skipped, 'busy');
    const recovered = await poll(crashing, 'alpha', [job('alpha', '1')], now + hour + 120000);
    assert.equal(recovered.alerts, 1); assert.equal(Object.keys(readMonitor(store).alerts).length, 1);
  });

  contract('unknown schema versions fail closed instead of being reset', async ({store, root}) => {
    await configureSources(store, [src('alpha')]);
    if (kind === 'file') {
      const file = path.join(root, 'data/job-monitor/sources/alpha.json'), part = JSON.parse(fs.readFileSync(file));
      fs.writeFileSync(file, JSON.stringify({...part, schemaVersion: 999}), {mode: 0o600});
    } else await store.testHooks.corrupt('alpha');
    if (store.refresh) await assert.rejects(store.refresh(), {code: 'MONITOR_STATE_INVALID'});
    else assert.throws(() => readMonitor(store), {code: 'MONITOR_STATE_INVALID'});
    await assert.rejects(store.updateSource('alpha', () => {}), {code: 'MONITOR_STATE_INVALID'});
  });
}

test('[memory store] crash between partition write and control release (split-store window) is replay-safe', async () => {
  let crashOnce = false;
  const store = memoryMonitorStore({faults: {afterPartitionWrite: () => {if (crashOnce) {crashOnce = false; throw fail('SIMULATED_CRASH');}}}});
  await configureSources(store, [src('alpha')]);
  await poll(store, 'alpha', [], now); crashOnce = true;
  const crashed = await poll(store, 'alpha', [job('alpha', '1')], now + hour);
  // Partition (posting + alert) committed; the control record still holds the old lease and checkpoint.
  assert.equal(crashed.state, 'failed'); assert.equal(Object.keys(readMonitor(store).alerts).length, 1);
  const replay = await poll(store, 'alpha', [job('alpha', '1')], now + 3 * hour);
  assert.equal(replay.alerts, 0, 'replay finds the posting already published'); assert.equal(Object.keys(readMonitor(store).alerts).length, 1);
});

test('[cloud store] crash between partition PUT and control update (S3 then DynamoDB window) is replay-safe', async () => {
  let crashOnce = false;
  const objects = memoryObjectStore({afterPut: () => {if (crashOnce) {crashOnce = false; throw fail('SIMULATED_CRASH');}}});
  const store = createCloudMonitorStore({objects, table: memoryTable()});
  await configureSources(store, [src('alpha')]);
  await poll(store, 'alpha', [], now); crashOnce = true;
  assert.equal((await poll(store, 'alpha', [job('alpha', '1')], now + hour)).state, 'failed');
  await store.refresh();
  assert.equal(Object.keys(readMonitor(store).alerts).length, 1, 'partition (posting + alert) committed before the crash');
  assert.equal((await poll(store, 'alpha', [job('alpha', '1')], now + 3 * hour)).alerts, 0);
  assert.equal(Object.keys(readMonitor(store).alerts).length, 1);
});
test('[cloud store] unchanged snapshots make zero object PUTs (S3 cost model)', async () => {
  let puts = 0;
  const store = createCloudMonitorStore({objects: memoryObjectStore({afterPut: () => {puts++;}}), table: memoryTable()});
  await configureSources(store, [src('alpha')]);
  const jobs = [job('alpha', '1')];
  await poll(store, 'alpha', jobs, now); await poll(store, 'alpha', jobs, now + hour);
  const before = puts;
  for (let n = 2; n < 52; n++) await poll(store, 'alpha', jobs, now + n * hour);
  assert.equal(puts - before, 0, '50 unchanged polls: no partition PUT');
});
