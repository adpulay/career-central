import test from 'node:test';
import assert from 'node:assert/strict';
import {configureSources, readMonitor} from '../lib/career-central/job-monitor.mjs';
import {memoryMonitorStore} from '../lib/career-central/monitor-memory-store.mjs';
import {authorizeRecurring} from '../lib/career-central/monitor-scheduler.mjs';
import {buildEligibilityProjection, contextFromProjection} from '../lib/career-central/eligibility-projection.mjs';
import {createMonitorHandler} from '../lib/career-central/monitor-handler.mjs';
import {logLine, tickMetrics, METRIC_NAMESPACE} from '../lib/career-central/monitor-telemetry.mjs';

const now = Date.parse('2026-11-10T12:00:00Z');
const SENTINELS = ['SENTINEL_DESC_Z9', 'SENTINEL_TITLE_Z9', 'token=SENTINEL_QUERY_Z9', 'SENTINEL_NAME_Z9', 'SENTINEL_PROVIDER_MESSAGE_Z9'];
const fullContext = {portals: {}, history: [], blacklist: new Map(),
  policy: {discovery: {graduationYear: 2027, searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}, monitorHighPriorityScore: 40}},
  profile: {personal: {name: 'SENTINEL_NAME_Z9'}, education: [{graduation_month: {value: '2027-05', verified: true}}], technicalSkills: {verified: true, value: {c: ['AWS', 'Python']}},
    authorization: {us_work_authorized: {verified: true, value: true}}, standardAnswers: {full_time_start: {value: '2027-06', verified: true}}, resumeVersions: []}};
const job = (board, id, extra = {}) => ({externalId: id, title: `Software Engineer I, New Grad 2027 SENTINEL_TITLE_Z9 ${id}`, location: 'Dallas, Texas, United States',
  url: `https://job-boards.greenhouse.io/${board}/jobs/${id}?token=SENTINEL_QUERY_Z9`, description: 'Required: graduating in 2027. Starting in June 2027. AWS Python. SENTINEL_DESC_Z9', ...extra});
const src = id => ({id, company: `Fictional ${id}`, provider: 'greenhouse', board: id, intervalMinutes: 30});

async function setup({authorize = true} = {}) {
  const projection = buildEligibilityProjection(fullContext, {}, {now});
  const store = memoryMonitorStore({ledgerJobs: contextFromProjection(projection).ledgerJobs});
  await configureSources(store, [src('alpha'), src('bravo'), src('charlie')]);
  if (authorize) await authorizeRecurring(store, {sourceIds: ['alpha', 'bravo', 'charlie'], hours: 24, now});
  return {store, projection};
}
const feed = map => async definition => {const value = map[definition.id]; if (value instanceof Error) throw value; return {jobs: value ?? [], complete: true};};

test('handler runs one authorized tick and emits only redacted logs and aggregate EMF metrics', async () => {
  const {store, projection} = await setup(), lines = [];
  const handler = createMonitorHandler({store, loadProjection: async () => projection, authorizeLiveRead: true, environment: 'dev', clock: () => now,
    fetchSnapshot: feed({alpha: [job('alpha', '1')], bravo: Object.assign(Error('SENTINEL_PROVIDER_MESSAGE_Z9'), {status: 503}), charlie: []}), log: line => lines.push(line)});
  const result = await handler({}, {getRemainingTimeInMillis: () => 600000});
  assert.equal(result.ok, true); assert.equal(result.polled, 3); assert.equal(result.failed, 1);
  assert.deepEqual(Object.keys(result).sort(), ['correlationId', 'deferred', 'failed', 'ok', 'polled']);
  const output = lines.join('\n');
  for (const sentinel of SENTINELS) assert.ok(!output.includes(sentinel), `leaked ${sentinel}`);
  const records = lines.map(line => JSON.parse(line)), metrics = records.find(record => record._aws);
  assert.equal(metrics._aws.CloudWatchMetrics[0].Namespace, METRIC_NAMESPACE);
  assert.ok(metrics._aws.CloudWatchMetrics[0].Metrics.length <= 10, 'stays inside the free custom-metric allowance');
  assert.deepEqual(metrics._aws.CloudWatchMetrics[0].Dimensions, [['Environment']], 'no per-source metric dimensions');
  assert.equal(metrics.PollFailed, 1); assert.equal(metrics.PollSucceeded, 2); assert.equal(metrics.AuthorizationHoursRemaining, 24);
  const bravo = records.find(record => record.sourceId === 'bravo');
  assert.equal(bravo.state, 'failed'); assert.equal(bravo.errorCategory, 'http_503'); assert.equal(bravo.level, 'warn');
  assert.ok(records.every(record => record._aws || record.correlationId === result.correlationId));
  assert.equal(Object.keys(readMonitor(store).alerts).length, 0, 'baseline stayed quiet');
});

test('handler defers remaining sources before the invocation deadline; they stay due', async () => {
  const {store, projection} = await setup();
  let remaining = 200000; const calls = [];
  const handler = createMonitorHandler({store, loadProjection: async () => projection, authorizeLiveRead: true, clock: () => now, log: () => {},
    fetchSnapshot: async definition => {calls.push(definition.id); remaining -= 130000; return {jobs: [], complete: true};}});
  const result = await handler({}, {getRemainingTimeInMillis: () => remaining});
  assert.equal(result.polled, 1); assert.equal(result.deferred.length, 2);
  for (const id of result.deferred) assert.equal(readMonitor(store).sources[id].nextDueAt, null, `${id} still due`);
});

test('handler refuses without a recurring authorization and never fetches', async () => {
  const {store, projection} = await setup({authorize: false}), lines = []; let fetched = 0;
  const handler = createMonitorHandler({store, loadProjection: async () => projection, authorizeLiveRead: true, clock: () => now, log: line => lines.push(line),
    fetchSnapshot: async () => {fetched++; return {jobs: [], complete: true};}});
  const result = await handler();
  assert.deepEqual({ok: result.ok, errorCode: result.errorCode}, {ok: false, errorCode: 'MONITOR_RECURRING_NOT_AUTHORIZED'});
  assert.equal(fetched, 0); assert.equal(JSON.parse(lines.at(-1)).level, 'warn');
});

test('overlapping invocations skip; live reads need explicit opt-in; bad config fails fast', async () => {
  const {store, projection} = await setup();
  let release; const pending = new Promise(resolve => {release = resolve;});
  const handler = createMonitorHandler({store, loadProjection: async () => projection, authorizeLiveRead: true, clock: () => now, log: () => {},
    fetchSnapshot: async () => {await pending; return {jobs: [], complete: true};}});
  const first = handler();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await handler()).skipped, 'tick_in_progress');
  release(); assert.equal((await first).ok, true);
  const noConsent = createMonitorHandler({store, loadProjection: async () => projection, fetchSnapshot: async () => ({jobs: [], complete: true}), clock: () => now + 7200000, log: () => {}});
  assert.equal((await noConsent()).errorCode, 'MONITOR_LIVE_NOT_AUTHORIZED');
  assert.throws(() => createMonitorHandler({store}), {code: 'MONITOR_HANDLER_CONFIG_INVALID'});
  const badProjection = createMonitorHandler({store, loadProjection: async () => ({schema: 'wrong'}), authorizeLiveRead: true, fetchSnapshot: async () => ({jobs: []}), log: () => {}});
  assert.equal((await badProjection()).errorCode, 'ELIGIBILITY_PROJECTION_INVALID');
});

test('logLine keeps only allowlisted, validated fields', () => {
  const record = JSON.parse(logLine({level: 'debug', event: 'nope', correlationId: 'tick-1', sourceId: 'Bad Id!', state: 'healthy', errorCategory: 'Message: SENTINEL_PROVIDER_MESSAGE_Z9',
    counts: {new: 2, alerts: -1, extra: 5}, durationMs: 12.6, url: 'https://x.invalid/?token=SENTINEL_QUERY_Z9', description: 'SENTINEL_DESC_Z9', health: 'ok_changes'}));
  assert.deepEqual(record, {level: 'info', event: 'source_cycle', correlationId: 'tick-1', state: 'healthy', health: 'ok_changes', counts: {new: 2}, durationMs: 13});
  const metrics = tickMetrics({results: {a: {state: 'healthy', new: 1, updated: 2, alerts: 1}, b: {state: 'failed', errorCategory: 'rate_limit'}}, durationMs: 5});
  assert.equal(metrics.NewOrChangedPostings, 3); assert.equal(metrics.RateLimited, 1); assert.equal(metrics.AlertsCreated, 1);
});
