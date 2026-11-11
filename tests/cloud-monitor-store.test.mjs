// Cloud-shaped store under concurrency: several adapter instances (one per
// simulated Lambda container) share only the backing object store and table.
import test from 'node:test';
import assert from 'node:assert/strict';
import {configureSources, pollSource, readMonitor, setMonitorDecision} from '../lib/career-central/job-monitor.mjs';
import {createCloudMonitorStore, memoryObjectStore, memoryTable} from '../lib/career-central/cloud-monitor-store.mjs';
import {authorizeRecurring, revokeRecurring, runMonitorTick} from '../lib/career-central/monitor-scheduler.mjs';
import {buildEligibilityProjection, contextFromProjection} from '../lib/career-central/eligibility-projection.mjs';
import {createMonitorHandler} from '../lib/career-central/monitor-handler.mjs';

const now = Date.parse('2026-11-10T12:00:00Z'), hour = 3600000;
const context = {portals: {}, history: [], blacklist: new Map(),
  policy: {discovery: {graduationYear: 2027, searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}, monitorHighPriorityScore: 40}},
  profile: {education: [{graduation_month: {value: '2027-05', verified: true}}], technicalSkills: {verified: true, value: {c: ['AWS', 'Python']}},
    authorization: {us_work_authorized: {verified: true, value: true}}, standardAnswers: {full_time_start: {value: '2027-06', verified: true}}, resumeVersions: []}};
const projection = buildEligibilityProjection(context, {}, {now});
const job = (id, extra = {}) => ({externalId: id, title: 'Software Engineer I, New Grad 2027', location: 'Dallas, Texas, United States',
  url: `https://job-boards.greenhouse.io/alpha/jobs/${id}`, description: 'Required: graduating in 2027. Starting in June 2027. AWS Python.', ...extra});
const src = id => ({id, company: `Fictional ${id}`, provider: 'greenhouse', board: id, intervalMinutes: 30});
const fail = code => Object.assign(Error(code), {code});
function backing({objectFault, tableFault} = {}) {
  const objects = memoryObjectStore({afterPut: key => objectFault?.(key)}), table = memoryTable({afterPut: (pk, sk) => tableFault?.(pk, sk)});
  return {objects, table, instance: (extra = {}) => createCloudMonitorStore({objects, table, ...extra})};
}
const poll = (store, jobs, time, extra = {}) => pollSource({root: store, sourceId: 'alpha', context, now: time, random: () => 0, fetchSnapshot: async () => ({jobs, complete: true}), ...extra});
const alerts = async store => {await store.refresh(); return Object.keys(readMonitor(store).alerts).length;};

test('a stale instance cannot overwrite newer control or partition state (DynamoDB version and S3 If-Match)', async () => {
  const {instance} = backing(), a = instance(), b = instance();
  await configureSources(a, [src('alpha')]); await a.refresh(); await b.refresh();
  await poll(a, [job('1')], now);
  // Control item: A reads, B commits, A's conditional update is rejected.
  let resume; const gate = new Promise(resolve => {resume = resolve;});
  const stale = a.updateSource('alpha', async scoped => {await gate; scoped.sources.alpha.paused = true;});
  await new Promise(resolve => setTimeout(resolve, 10));
  await b.updateSource('alpha', scoped => {scoped.sources.alpha.definition.intervalMinutes = 60;});
  resume(); await assert.rejects(stale, {code: 'MONITOR_STORE_CONFLICT'});
  await a.refresh();
  assert.equal(readMonitor(a).sources.alpha.definition.intervalMinutes, 60, 'newer state kept'); assert.equal(readMonitor(a).sources.alpha.paused ?? false, false);
  // Partition object: same race on postings.
  let resume2; const gate2 = new Promise(resolve => {resume2 = resolve;});
  const stalePartition = a.updateSource('alpha', async scoped => {await gate2; Object.values(scoped.postings)[0].decision = 'dismissed';});
  await new Promise(resolve => setTimeout(resolve, 10));
  await b.updateSource('alpha', scoped => {Object.values(scoped.postings)[0].decision = 'interested';});
  resume2(); await assert.rejects(stalePartition, {code: 'MONITOR_STORE_CONFLICT'});
  await a.refresh(); assert.equal(Object.values(readMonitor(a).postings)[0].decision, 'interested');
});

test('concurrent workers on separate instances: the distributed per-source lease lets only one poll publish', async () => {
  const {instance} = backing(), a = instance(), b = instance();
  await configureSources(a, [src('alpha')]); await poll(a, [], now);
  let resume; const gate = new Promise(resolve => {resume = resolve;}), fetched = [];
  const first = poll(a, [job('1')], now + hour, {fetchSnapshot: async () => {fetched.push('a'); await gate; return {jobs: [job('1')], complete: true};}});
  await new Promise(resolve => setTimeout(resolve, 10));
  const second = await poll(b, [job('1')], now + hour + 1000, {fetchSnapshot: async () => {fetched.push('b'); return {jobs: [job('1')], complete: true};}});
  assert.equal(second.skipped, 'busy'); resume(); assert.equal((await first).alerts, 1);
  assert.deepEqual(fetched, ['a']); assert.equal(await alerts(b), 1);
});

test('distributed tick lease: concurrent invocations on different instances run one tick; an expired lease is reclaimed', async () => {
  const {instance, table} = backing();
  const a = instance({clock: () => now}), b = instance({clock: () => now});
  await configureSources(a, [src('alpha')]); await authorizeRecurring(a, {sourceIds: ['alpha'], hours: 24, now});
  let resume; const gate = new Promise(resolve => {resume = resolve;});
  const handlerFor = store => createMonitorHandler({store, loadProjection: async () => projection, authorizeLiveRead: true, clock: () => now, log: () => {},
    fetchSnapshot: async () => {await gate; return {jobs: [], complete: true};}});
  const running = handlerFor(a)();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await handlerFor(b)()).skipped, 'tick_in_progress', 'second container sees the shared lease');
  resume(); assert.equal((await running).polled, 1);
  assert.equal(await table.get('MONITOR', 'TICKLOCK'), null, 'released after the tick');
  // A crashed holder: lease written, never released. Blocks until it expires, then is reclaimed.
  assert.ok(await a.acquireTickLock({now: now + hour}));
  assert.equal(await b.acquireTickLock({now: now + hour + 60000}), null);
  assert.ok(await b.acquireTickLock({now: now + hour + 7 * 60000}), 'expired lease reclaimed');
});

test('warm invocations refresh: a revocation or pause by another container is honored immediately', async () => {
  const {instance} = backing(), warm = instance(), other = instance();
  await configureSources(warm, [src('alpha'), src('bravo')]); await authorizeRecurring(warm, {sourceIds: ['alpha', 'bravo'], hours: 24, now});
  let clockNow = now; const fetched = [];
  const handler = createMonitorHandler({store: warm, loadProjection: async () => projection, authorizeLiveRead: true, clock: () => clockNow, log: () => {},
    fetchSnapshot: async definition => {fetched.push(definition.id); return {jobs: [], complete: true};}});
  assert.equal((await handler()).polled, 2);
  await other.refresh(); await setMonitorDecision(other, {pausedSource: 'bravo', paused: true});
  clockNow = now + hour; fetched.length = 0;
  await handler();
  assert.deepEqual(fetched, ['alpha'], 'warm instance saw the pause made elsewhere');
  await other.refresh(); await revokeRecurring(other);
  clockNow = now + 2 * hour; fetched.length = 0;
  assert.equal((await handler()).errorCode, 'MONITOR_RECURRING_NOT_AUTHORIZED'); assert.deepEqual(fetched, []);
});

test('ambiguous writes (applied, then an error) recover without duplicate alerts', async () => {
  let objectAmbiguous = false, controlWritesUntilFault = 0;
  const {instance} = backing({objectFault: () => {if (objectAmbiguous) {objectAmbiguous = false; throw fail('NetworkError');}},
    tableFault: (pk, sk) => {if (sk === 'CONTROL' && controlWritesUntilFault > 0 && --controlWritesUntilFault === 0) throw fail('NetworkError');}});
  const store = instance();
  await configureSources(store, [src('alpha')]); await poll(store, [], now);
  // 1. S3 partition PUT applied but reported failure: cycle reported failed, alert already durable, replay quiet.
  objectAmbiguous = true;
  assert.equal((await poll(store, [job('1')], now + hour)).state, 'failed');
  assert.equal(await alerts(store), 1);
  assert.equal((await poll(store, [job('1')], now + 3 * hour)).alerts, 0); assert.equal(await alerts(store), 1);
  // 2. Ambiguous lease claim (1st control write applied, then error): the poll errors, the lease
  //    blocks other workers until it expires, then a later poll proceeds normally.
  controlWritesUntilFault = 1;
  await assert.rejects(poll(store, [job('1'), job('2')], now + 5 * hour), {code: 'NetworkError'});
  assert.equal((await poll(store, [job('1'), job('2')], now + 5 * hour + 30000)).skipped, 'busy');
  assert.equal((await poll(store, [job('1'), job('2')], now + 5 * hour + 120000)).alerts, 1);
  assert.equal(await alerts(store), 2);
  // 3. Ambiguous publish/release (2nd control write applied, then error): reported as failed, but the
  //    lease is released, the checkpoint advanced and no alert is duplicated on the next poll.
  controlWritesUntilFault = 2;
  const result = await poll(store, [job('1'), job('2'), job('3')], now + 7 * hour);
  assert.equal(result.state, 'failed'); assert.equal(await alerts(store), 3);
  await store.refresh(); assert.equal(readMonitor(store).sources.alpha.lease, null);
  assert.equal(readMonitor(store).sources.alpha.lastSuccessAt, new Date(now + 7 * hour).toISOString(), 'the committed cycle stands');
  assert.equal((await poll(store, [job('1'), job('2'), job('3')], now + 9 * hour)).alerts, 0); assert.equal(await alerts(store), 3);
});

test('a worker that loses its lease before committing publishes nothing; the takeover worker\'s state stands', async () => {
  const {instance} = backing(), a = instance(), b = instance();
  await configureSources(a, [src('alpha')]); await poll(a, [], now);
  let resume; const gate = new Promise(resolve => {resume = resolve;});
  const slow = poll(a, [job('slow')], now + hour, {fetchSnapshot: async () => {await gate; return {jobs: [job('slow')], complete: true};}});
  await new Promise(resolve => setTimeout(resolve, 10));
  const takeover = await poll(b, [job('1')], now + hour + 120000); // A's 90 s lease expired
  assert.equal(takeover.alerts, 1);
  resume(); const stale = await slow;
  assert.equal(stale.state, 'failed'); assert.equal(stale.checkpointAdvanced, false); assert.equal(stale.errorCategory, 'MONITOR_LEASE_LOST');
  await b.load();
  assert.ok(!Object.values(readMonitor(b).postings).some(row => row.postingId === 'slow'));
  assert.equal(readMonitor(b).sources.alpha.checkpoint.checkedAt, new Date(now + hour + 120000).toISOString());
  assert.equal(await alerts(b), 1);
});

test('a definite commit failure advances nothing and alerts nothing; the retry publishes exactly once', async () => {
  let reject = false;
  const objects = memoryObjectStore({beforePut: () => {if (reject) {reject = false; throw Object.assign(Error('PreconditionFailed'), {code: 'PreconditionFailed'});}}});
  const worker = createCloudMonitorStore({objects, table: memoryTable()});
  await configureSources(worker, [src('alpha')]); await poll(worker, [], now);
  const checkpointBefore = (await worker.load()).sources.alpha.checkpoint;
  reject = true; // the publish PUT is rejected (412) without being applied
  const result = await poll(worker, [job('1')], now + hour);
  assert.equal(result.state, 'failed'); assert.equal(result.checkpointAdvanced, false); assert.equal(result.errorCategory, 'MONITOR_STORE_CONFLICT');
  const after = await worker.load();
  assert.deepEqual(after.sources.alpha.checkpoint, checkpointBefore, 'checkpoint not advanced');
  assert.equal(Object.keys(after.alerts).length, 0, 'no alert from the failed commit');
  assert.equal(after.sources.alpha.lease, null, 'failure path released the lease');
  const retry = await poll(worker, [job('1')], Date.parse(after.sources.alpha.nextDueAt) + 1000);
  assert.equal(retry.alerts, 1); assert.equal(await alerts(worker), 1);
  assert.equal((await poll(worker, [job('1')], Date.parse((await worker.load()).sources.alpha.nextDueAt) + 1000)).alerts, 0, 'retry is idempotent');
});

test('a change committed by another container between claim and publish is preserved, not overwritten', async () => {
  const {instance} = backing(), worker = instance(), other = instance();
  await configureSources(worker, [src('alpha')]); await poll(worker, [job('1')], now);
  const firstId = Object.keys((await worker.load()).postings)[0];
  const result = await poll(worker, [job('1'), job('2')], now + hour, {fetchSnapshot: async () => {
    await setMonitorDecision(other, {postingId: firstId, decision: 'interested'});
    return {jobs: [job('1'), job('2')], complete: true};
  }});
  assert.equal(result.alerts, 1);
  assert.equal((await worker.load()).postings[firstId].decision, 'interested', 'publish re-read current state inside its conditional write');
});

test('an ambiguous publish is reported as an unknown outcome, never as a clean failure', async () => {
  let ambiguous = false;
  const {instance} = backing({objectFault: () => {if (ambiguous) {ambiguous = false; throw fail('NetworkError');}}});
  const store = instance();
  await configureSources(store, [src('alpha')]); await poll(store, [], now);
  ambiguous = true;
  const result = await poll(store, [job('1')], now + hour);
  assert.deepEqual({state: result.state, errorCategory: result.errorCategory, checkpointAdvanced: result.checkpointAdvanced}, {state: 'failed', errorCategory: 'persistence_outcome_uncertain', checkpointAdvanced: 'unknown'});
});

test('a stale snapshot never authorizes a tick: runMonitorTick loads authoritative state itself', async () => {
  const {instance} = backing(), a = instance(), b = instance();
  await configureSources(a, [src('alpha')]); await authorizeRecurring(a, {sourceIds: ['alpha'], hours: 24, now});
  await a.load(); // a's snapshot says "authorized"
  await b.load(); await revokeRecurring(b);
  let fetched = 0;
  await assert.rejects(runMonitorTick({root: a, context, authorizeLiveRead: true, now: now + 60000, fetchSnapshot: async () => {fetched++; return {jobs: [], complete: true};}}),
    {code: 'MONITOR_RECURRING_NOT_AUTHORIZED'});
  assert.equal(fetched, 0);
});

test('an unchanged poll writes exactly the control item twice (claim, release) and nothing else', async () => {
  let objectPuts = 0; const tableWrites = [];
  const {instance} = backing({objectFault: () => {objectPuts++;}, tableFault: (pk, sk) => {tableWrites.push(`${pk}/${sk}`);}});
  const store = instance();
  await configureSources(store, [src('alpha')]);
  const jobs = [job('1')];
  await poll(store, jobs, now); await poll(store, jobs, now + hour);
  objectPuts = 0; tableWrites.length = 0;
  await poll(store, jobs, now + 2 * hour);
  assert.equal(objectPuts, 0, 'no partition PUT');
  assert.deepEqual(tableWrites, ['SOURCE#alpha/CONTROL', 'SOURCE#alpha/CONTROL'], 'claim + release only; no index write');
});
