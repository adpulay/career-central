import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {failureCategory, configureSources, pollSource, readMonitor, monitorView, setMonitorDecision, evaluateMonitoredJob, sourceFeed, seedCachedShortlist, setMonitorInterval, graduationWindow, reevaluatePostings, START_UNCONFIRMED} from '../lib/career-central/job-monitor.mjs';
import {createFeedReader, MONITOR_MAX_FEED_BYTES} from '../lib/career-central/monitor-feed.mjs';
import {updateLedger} from '../lib/applications/store.mjs';
import {updateMonitor, monitorBackend, migrateMonitorStore} from '../lib/career-central/monitor-store.mjs';
const now = Date.parse('2026-11-10T12:00:00Z'), step = 360000;
const source = {id: 'fictional', company: 'Fictional Cloud', provider: 'greenhouse', board: 'fictional', intervalMinutes: 5};
const profile = {education: [{graduation_month: {value: '2027-05', verified: true}}],
  employerApplicationHistory: {'fictional cloud': {verified: true, neverApplied: true}},
  technicalSkills: {verified: true, value: {cloud: ['AWS', 'Docker', 'Python', 'Linux', 'SQL']}},
  authorization: {us_work_authorized: {verified: true, value: true}}, standardAnswers: {full_time_start: {value: '2027-06', verified: true}},
  resumeVersions: [{id: 'approved', approved: true, sha256: 'a'.repeat(64)}]};
const policy = {discovery: {graduationYear: 2027, resumeSkills: ['INVENTED'], searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}, monitorHighPriorityScore: 60}};
const context = {profile, policy, portals: {}, history: []};
const job = (id = '101', extra = {}) => ({externalId: id, requisitionId: 'REQ-' + id, title: 'Software Engineer I, New Grad 2027',
  location: 'Dallas, Texas, United States', company: source.company, url: `https://job-boards.greenhouse.io/fictional/jobs/${id}`,
  description: 'Required: graduating in 2027. Starting in June 2027. Build AWS Docker Python Linux SQL applications. No professional experience required.', ...extra});
const fixture = async fn => {const root = fs.mkdtempSync(path.join(os.tmpdir(), 'job-monitor-')); try {await fn(root);} finally {fs.rmSync(root, {recursive: true, force: true});}};
const poll = (root, jobs, time = now, extra = {}) => pollSource({root, sourceId: source.id, context, now: time, random: () => 0,
  fetchSnapshot: async () => ({jobs, complete: true}), ...extra});
test('full feed → matching → shortlist → alert → local preparation proposal; baseline is quiet', () => fixture(async root => {
  await configureSources(root, [source]);
  assert.equal((await poll(root, [])).baseline, true);
  const result = await poll(root, [job()], now + step);
  assert.equal(result.alerts, 1); assert.equal(result.preparationTasks, 1);
  const view = monitorView(root); assert.equal(view.jobs.length, 1); assert.equal(view.jobs[0].match.status, 'qualified');
  assert.equal(view.tasks[0].resume.id, 'approved'); assert.match(view.tasks[0].requiredQuestions, /Not inspected/);
  assert.equal(view.jobs[0].employerPublishedAt, null); assert.equal(view.jobs[0].event, 'newly_discovered');
  assert.equal(view.submittedApplications, 0); assert.equal(view.recurringEnabled, false);
}));
test('first nonempty snapshot is a baseline, never a flood of new alerts', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, [job()]); const view = monitorView(root);
  assert.equal(view.jobs.length, 1); assert.equal(view.alerts.length, 0); assert.equal(view.tasks.length, 0); assert.equal(view.jobs[0].event, 'baseline');
}));
test('repeated and duplicate postings preserve first seen and emit no duplicate alert or task', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, []); await poll(root, [job(), job()], now + step);
  const before = readMonitor(root), result = await poll(root, [job()], now + step * 2), after = readMonitor(root);
  assert.equal(result.alerts, 0); assert.equal(result.preparationTasks, 0);
  assert.equal(Object.values(after.postings)[0].firstSeenAt, Object.values(before.postings)[0].firstSeenAt);
  assert.equal(Object.keys(after.alerts).length, 1); assert.equal(Object.keys(after.preparationTasks).length, 1);
}));
test('meaningful updates create one versioned alert, not repeated preparation tasks', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, []); await poll(root, [job()], now + step);
  const result = await poll(root, [job('101', {description: job().description + ' Also work on REST services.'})], now + step * 2);
  assert.equal(result.updated, 1); assert.equal(result.alerts, 1); assert.equal(result.preparationTasks, 0);
}));
test('publication provenance is separate from first seen, and future dates remain unknown', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, []);
  await poll(root, [job('101', {postedAt: now + 1000}), job('102', {postedAt: now + step * 4})], now + step);
  const rows = monitorView(root).jobs;
  assert.equal(rows.find(row => row.postingId === '101').event, 'newly_published');
  assert.equal(rows.find(row => row.postingId === '102').employerPublishedAt, null);
}));
test('two complete omissions expire a posting; reappearance is a repost event without identity loss', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, [job()]); await poll(root, [], now + step);
  assert.equal(monitorView(root).jobs.length, 1); await poll(root, [], now + step * 2); assert.equal(monitorView(root).jobs.length, 0);
  await poll(root, [job()], now + step * 3); assert.equal(monitorView(root).jobs[0].event, 'reappeared');
  assert.match(monitorView(root).jobs[0].relationship, /possible repost, not independently verified/);
}));
test('same-title new requisition is separate, explicitly related and not silently merged', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, [job()]); await poll(root, [job(), job('102')], now + step);
  const view = monitorView(root); assert.equal(view.jobs.length, 2); assert.match(view.jobs.find(row => row.postingId === '102').relationship, /possible_repost_or_distinct/);
}));
test('ineligible, missing-description, foreign, senior and wrong-cohort positions cannot create ready tasks', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, []);
  const result = await poll(root, [job('1', {title: 'Senior Software Engineer'}), job('2', {location: 'Toronto, Canada'}),
    job('3', {description: 'Graduating in 2026.'}), job('4', {description: ''}), job('5', {location: 'Remote'})], now + step);
  assert.equal(result.preparationTasks, 0); assert.ok(monitorView(root).counts.excluded >= 3);
}));
test('existing canonical applications or uncertain dispatches prevent preparation without changing history', () => fixture(async root => {
  await updateLedger(root, ledger => {ledger.jobs.existing = {...job(), status: 'Needs Information', lastSubmission: {mayHaveBeenAccepted: true}}; ledger.events.push({type: 'ExistingEvent'});});
  const file = path.join(root, 'data/application-automation/ledger.json'), original = JSON.parse(fs.readFileSync(file));
  await configureSources(root, [source]); await poll(root, []); await poll(root, [job()], now + step);
  assert.equal(monitorView(root).tasks.length, 0); const after = JSON.parse(fs.readFileSync(file));
  assert.deepEqual(after.jobs, original.jobs); assert.deepEqual(after.events, original.events);
}));
test('unknown authorization, experience minimum and absent verified skills block readiness', () => {
  assert.equal(evaluateMonitoredJob(job(), {...context, profile: {...profile, authorization: {}}}).status, 'needs_review');
  assert.equal(evaluateMonitoredJob(job('1', {description: 'Graduating in 2027. Requires 2 years of professional experience.'}), context).status, 'needs_review');
  assert.equal(evaluateMonitoredJob(job(), {...context, profile: {...profile, technicalSkills: {verified: false}}}).status, 'needs_review');
});
test('review decisions survive reopening and never represent an application transition', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, [job()]); const id = monitorView(root).jobs[0].id;
  for (const decision of ['interested', 'dismissed', 'awaiting_application']) {
    await setMonitorDecision(root, {postingId: id, decision}); assert.equal(monitorView(root).jobs[0].decision, decision);
  }
  await assert.rejects(setMonitorDecision(root, {postingId: id, decision: 'Submitted'}));
}));
test('source outage, partial and malformed responses preserve checkpoint and postings', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, [job()]); const before = readMonitor(root);
  for (const fetchSnapshot of [async () => {throw Error('PRIVATE_PROVIDER_TEXT');}, async () => ({jobs: [], complete: false}), async () => ({jobs: [job('2', {url: 'javascript:secret'})], complete: true})]) {
    await poll(root, [], now + step * 10, {fetchSnapshot}); const after = readMonitor(root);
    assert.deepEqual(after.sources.fictional.checkpoint, before.sources.fictional.checkpoint); assert.deepEqual(after.postings, before.postings);
    assert.equal(JSON.stringify(after).includes('PRIVATE_PROVIDER_TEXT'), false);
  }
}));
test('rate limits honor Retry-After, backoff and no hidden extra request', () => fixture(async root => {
  await configureSources(root, [source]); let calls = 0;
  const result = await poll(root, [], now, {fetchSnapshot: async () => {calls++; throw Object.assign(Error('PRIVATE'), {status: 429, retryAfter: '3600'});}});
  assert.equal(result.errorCategory, 'rate_limit'); assert.equal(calls, 1);
  assert.equal(Date.parse(readMonitor(root).sources.fictional.nextDueAt), now + 3600000);
  assert.equal((await poll(root, [], now + step)).skipped, 'not_due');
}));
test('conditional unchanged response updates health only and cannot initialize a baseline', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, [job()]); const before = readMonitor(root).postings;
  assert.equal((await poll(root, [], now + step, {fetchSnapshot: async () => ({notModified: true})})).state, 'unchanged');
  assert.deepEqual(readMonitor(root).postings, before);
}));
test('crash before atomic checkpoint leaves no posting/alert/task; retry restores exactly once', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, []);
  await poll(root, [job()], now + step, {phaseHook: phase => {if (phase === 'before_checkpoint') throw Error('crash');}});
  assert.equal(monitorView(root).jobs.length, 0); assert.equal(monitorView(root).alerts.length, 0);
  await poll(root, [job()], now + step * 4); assert.equal(monitorView(root).alerts.length, 1);
}));
test('abandoned worker lease recovers after expiry and fences concurrent workers', () => fixture(async root => {
  await configureSources(root, [source]); await updateMonitor(root, monitor => {monitor.sources.fictional.lease = {token: 'dead-worker', until: now + 90000};});
  assert.equal((await poll(root, [])).skipped, 'busy');
  let release; const pending = new Promise(resolve => {release = resolve;});
  const first = poll(root, [], now + step, {fetchSnapshot: async () => {await pending; return {jobs: [], complete: true};}});
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal((await poll(root, [], now + step)).skipped, 'busy'); release(); await first;
}));
test('pause and abort stop polling without executing an external action', () => fixture(async root => {
  await configureSources(root, [source]); await setMonitorDecision(root, {pausedSource: source.id, paused: true});
  assert.equal((await poll(root, [], now, {fetchSnapshot: () => assert.fail()})).skipped, 'paused');
  const controller = new AbortController(); controller.abort(); await assert.rejects(poll(root, [], now, {signal: controller.signal}));
}));
test('live reads require explicit authorization and invalid source definitions are refused', () => fixture(async root => {
  await assert.rejects(poll(root, [], now, {mode: 'live', fetchSnapshot: () => assert.fail()}), {code: 'MONITOR_LIVE_NOT_AUTHORIZED'});
  for (const changed of [{board: '../private'}, {provider: 'other'}, {intervalMinutes: 1}]) await assert.rejects(configureSources(root, [{...source, ...changed}]));
  assert.match(sourceFeed(source), /^https:\/\/boards-api.greenhouse.io/);
}));
test('existing ATS provider parses a bounded GET with conditional validators; 304 never parses JSON', async () => {
  let count = 0;
  const reader = createFeedReader({request: async (url, options) => {
    count++; assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    if (count === 2) {assert.equal(options.headers['If-None-Match'], 'fixture-etag'); return new Response(null, {status: 304});}
    return Response.json({jobs: [{id: 101, title: job().title, absolute_url: job().url, content: job().description, location: {name: job().location}}]}, {headers: {etag: 'fixture-etag'}});
  }});
  const first = await reader(source, null); assert.equal(first.jobs[0].externalId, '101');
  assert.equal(first.etag, 'fixture-etag'); assert.equal((await reader(source, {etag: first.etag})).notModified, true); assert.equal(count, 2);
});
test('malformed feed is an error rather than complete empty success', async () => {
  const reader = createFeedReader({request: async () => Response.json({unexpected: []})});
  await assert.rejects(reader(source, null), {code: 'MONITOR_FEED_SHAPE_INVALID'});
});
test('status/unauthorized CLI are offline and do not initialize a missing data root', () => fixture(async root => {
  const env = {...process.env, CAREER_OPS_ROOT: root};
  const status = spawnSync(process.execPath, ['scripts/job-monitor.mjs', 'status'], {encoding: 'utf8', env});
  assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).sources.length, 0);
  const denied = spawnSync(process.execPath, ['scripts/job-monitor.mjs', 'poll-once', '--source', 'fictional'], {encoding: 'utf8', env});
  assert.equal(denied.status, 1); assert.match(denied.stderr, /MONITOR_LIVE_NOT_AUTHORIZED/); assert.equal(fs.existsSync(path.join(root, 'data')), false);
}));
test('unknown external history or employer start blocks readiness; graduation ranges do not falsely exclude', () => {
  assert.equal(evaluateMonitoredJob(job(), {...context, profile: {...profile, employerApplicationHistory: {}}}).status, 'needs_review');
  const noStart = evaluateMonitoredJob(job('1', {description: 'Graduating in 2027. AWS Docker'}), context);
  assert.equal(noStart.status, 'potentially_eligible'); assert.equal(noStart.submissionReady, false);
  assert.ok(noStart.submissionBlockers.includes(START_UNCONFIRMED));
  const result = evaluateMonitoredJob(job('1', {description: 'Graduating between December 2026 and May 2027. Starting in June 2027. AWS Docker Python Linux SQL.'}), context);
  assert.notEqual(result.status, 'excluded');
});
test('reserved object keys and ambiguous mutation commands are rejected without prototype writes', () => fixture(async root => {
  await configureSources(root, [source]);
  await assert.rejects(setMonitorDecision(root, {pausedSource: '__proto__', paused: true}));
  await assert.rejects(setMonitorDecision(root, {postingId: 'constructor', decision: 'interested'}));
  await assert.rejects(setMonitorDecision(root, {postingId: 'x', decision: 'interested', pausedSource: source.id, paused: true}));
  assert.equal(Object.prototype.paused, undefined);
}));
test('a reclaimed lease fences a late worker from overwriting a newer checkpoint', () => fixture(async root => {
  await configureSources(root, [source]); let release;
  const waiting = new Promise(resolve => {release = resolve;});
  const first = poll(root, [], now, {fetchSnapshot: async () => {await waiting; return {jobs: [], complete: true};}});
  await new Promise(resolve => setTimeout(resolve, 30)); await poll(root, [job()], now + step);
  const before = readMonitor(root); release(); await first; assert.deepEqual(readMonitor(root), before);
}));
test('malformed persisted state fails closed instead of being reset', () => fixture(async root => {
  await updateLedger(root, ledger => {ledger.jobMonitor = {schemaVersion: 999};});
  assert.throws(() => monitorView(root), {code: 'MONITOR_STATE_INVALID'});
  await assert.rejects(configureSources(root, [source]), {code: 'MONITOR_STATE_INVALID'});
}));
test('cached shortlist seeding is offline, marked cached, and cannot overwrite a checkpoint', () => fixture(async root => {
  const put = (relative, value) => {const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));};
  put('data/application-automation/profile.json', profile); put('data/application-automation/policy.json', policy); put('portals.yml', 'tracked_companies: []\n');
  put('data/discovery/raw-latest.json', {generatedAt: new Date(now).toISOString(), jobs: [{...job(), listingIdentity: {ats_provider: source.provider, board_slug: source.board, posting_id: '101'}}]});
  await configureSources(root, [source]); assert.equal((await seedCachedShortlist({root, sourceId: source.id})).state, 'cached_baseline');
  const monitor = readMonitor(root); assert.equal(monitor.sources.fictional.lastSuccessAt, null); assert.equal(monitor.sources.fictional.checkpoint.provenance, 'existing_discovery_cache');
  assert.equal(monitorView(root).alerts.length, 0); await assert.rejects(seedCachedShortlist({root, sourceId: source.id}), {code: 'MONITOR_CACHE_BASELINE_ONLY'});
}));
test('canonical URL aliases cannot consume duplicate shortlist slots', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, [job(), job('102', {url: job().url})]); assert.equal(monitorView(root).jobs.length, 1);
}));
test('actual process exit after claim leaves a recoverable lease and no partial downstream records', () => fixture(async root => {
  await configureSources(root, [source]);
  const moduleUrl = new URL('../lib/career-central/job-monitor.mjs', import.meta.url).href;
  const child = `import {pollSource} from ${JSON.stringify(moduleUrl)};await pollSource({root:process.argv[1],sourceId:'fictional',now:${now},context:{},fetchSnapshot:async()=>({jobs:[],complete:true}),phaseHook:phase=>{if(phase==='claimed')process.exit(9)}});`;
  const exit = spawnSync(process.execPath, ['--input-type=module', '-e', child, root], {encoding: 'utf8'});
  assert.equal(exit.status, 9, exit.stderr); const crashed = readMonitor(root);
  assert.equal(crashed.sources.fictional.status, 'polling'); assert.equal(Object.keys(crashed.postings).length, 0);
  assert.equal((await poll(root, [], now)).skipped, 'busy');
  assert.equal((await poll(root, [job()], now + step)).state, 'healthy'); assert.equal(monitorView(root).jobs.length, 1);
}));
test('provider HTTP 429 exposes Retry-After without retries or response text disclosure', async () => {
  let calls = 0; const reader = createFeedReader({request: async () => {calls++; return new Response('PRIVATE_PROVIDER_TEXT', {status: 429, headers: {'retry-after': '60'}});}});
  await assert.rejects(reader(source, null), error => error.status === 429 && error.retryAfter === '60' && !error.message.includes('PRIVATE'));
  assert.equal(calls, 1);
});
test('unchanged-source adaptive cadence and local schedule changes never activate polling', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, []);
  for (let cycle = 1; cycle <= 4; cycle++) await poll(root, [], now + cycle * 3600000);
  assert.equal(readMonitor(root).sources.fictional.adaptiveMinutes, 10);
  await setMonitorInterval(root, source.id, 15); assert.equal(readMonitor(root).sources.fictional.definition.intervalMinutes, 15);
  await assert.rejects(setMonitorInterval(root, source.id, 1)); assert.equal(monitorView(root).recurringEnabled, false);
}));
test('verified technical skills suppress stale legacy gap claims; missing native ID fails closed', () => fixture(async root => {
  const skilled = {...profile, technicalSkills: {verified: true, value: {skills: ['AWS', 'Terraform']}}};
  const result = evaluateMonitoredJob(job('1', {description: 'Graduating in 2027. Starting in June 2027. Required: Terraform and AWS.'}), {...context, profile: skilled});
  assert.equal(result.gaps.some(value => /not established.*Terraform/.test(value)), false);
  await configureSources(root, [source]); const missing = job(); delete missing.externalId; delete missing.requisitionId;
  assert.equal((await poll(root, [missing])).state, 'failed'); assert.equal(readMonitor(root).sources.fictional.checkpoint, null);
}));
test('Ashby internal retry is deferred to the durable monitor backoff', async () => {
  let calls = 0;
  const reader = createFeedReader({request: async () => {calls++; return new Response('private', {status: 429, headers: {'retry-after': '60'}});}});
  await assert.rejects(reader({...source, provider: 'ashby'}, null), error => error.status === 429);
  assert.equal(calls, 1);
});
test('incomplete feed metadata cannot masquerade as a complete checkpoint', async () => {
  const reader = createFeedReader({request: async () => Response.json({jobs: [], meta: {total: 10}})});
  await assert.rejects(reader(source, null), {code: 'MONITOR_FEED_INCOMPLETE'});
});
test('truncated description cannot yield a ready preparation proposal', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, []);
  await poll(root, [job('1', {description: job().description + ' x'.repeat(25000)})], now + step);
  assert.equal(monitorView(root).tasks.length, 0); assert.equal(monitorView(root).jobs[0].match.status, 'needs_review');
}));
test('first live response after cached seeding is a fresh quiet baseline, then changes alert exactly once', () => fixture(async root => {
  await configureSources(root, [source]);
  await poll(root, [job()], now, {mode: 'cache'});
  const firstId = monitorView(root).jobs[0].id;
  await setMonitorDecision(root, {postingId: firstId, decision: 'interested'});
  const baseline = await poll(root, [], now + step, {mode: 'live', authorizeLiveRead: true, fetchSnapshot: async (_, checkpoint) => {
    assert.equal(checkpoint, null); return {jobs: [job('101', {description: job().description + ' Changed since cache.'}), job('102')], complete: true};
  }});
  assert.equal(baseline.baseline, true); assert.equal(baseline.alerts, 0); assert.equal(baseline.preparationTasks, 0);
  assert.equal(monitorView(root).jobs.find(row => row.id === firstId).decision, 'interested');
  assert.equal(readMonitor(root).sources.fictional.checkpoint.provenance, 'live_feed');
  const next = [job('101', {description: job().description + ' Changed again.'}), job('102'), job('103')];
  const changed = await poll(root, next, now + step * 2, {mode: 'live', authorizeLiveRead: true});
  assert.equal(changed.baseline, false); assert.equal(changed.alerts, 2);
  assert.equal((await poll(root, next, now + step * 3, {mode: 'live', authorizeLiveRead: true})).alerts, 0);
}));
test('failed first live request or invalid 304 cannot promote cache to a live baseline', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, [job()], now, {mode: 'cache'});
  const before = readMonitor(root).sources.fictional.checkpoint;
  assert.equal((await poll(root, [], now + step, {mode: 'live', authorizeLiveRead: true, fetchSnapshot: async () => ({notModified: true})})).state, 'failed');
  assert.deepEqual(readMonitor(root).sources.fictional.checkpoint, before);
  const retry = await poll(root, [job(), job('102')], now + step * 10, {mode: 'live', authorizeLiveRead: true});
  assert.equal(retry.baseline, true); assert.equal(retry.alerts, 0);
}));
test('cached postings absent from the first complete live baseline are not shown as currently listed', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, [job()], now, {mode: 'cache'});
  await poll(root, [], now + step, {mode: 'live', authorizeLiveRead: true});
  assert.equal(monitorView(root).jobs.length, 0); assert.equal(Object.values(readMonitor(root).postings)[0].availability, 'not_seen_in_live_baseline');
}));
test('pausing a source during an in-flight read prevents publication and new claims', () => fixture(async root => {
  await configureSources(root, [source]);
  await poll(root, [], now, {fetchSnapshot: async () => {await setMonitorDecision(root, {pausedSource: source.id, paused: true}); return {jobs: [job()], complete: true};}});
  assert.equal(readMonitor(root).sources.fictional.checkpoint, null); assert.equal(monitorView(root).jobs.length, 0);
  assert.equal((await poll(root, [], now + step)).skipped, 'paused');
}));
test('first-poll guard prevents accidental second live requests under the owner lock', () => fixture(async root => {
  await configureSources(root, [source]);
  await poll(root, [job()], now, {mode: 'live', authorizeLiveRead: true, requireFirstLiveBaseline: true});
  const before = readMonitor(root);
  const again = await poll(root, [], now + step, {mode: 'live', authorizeLiveRead: true, requireFirstLiveBaseline: true, fetchSnapshot: () => assert.fail('must not poll twice')});
  assert.equal(again.skipped, 'live_baseline_exists'); assert.deepEqual(readMonitor(root), before);
}));
test('CLI pause/resume are local controls and first-poll requires explicit consent', () => fixture(async root => {
  await configureSources(root, [source]); const env = {...process.env, CAREER_OPS_ROOT: root};
  for (const command of ['pause', 'resume']) {
    const result = spawnSync(process.execPath, ['scripts/job-monitor.mjs', command, '--source', source.id], {env, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr); assert.equal(readMonitor(root).sources.fictional.paused, command === 'pause');
  }
  const denied = spawnSync(process.execPath, ['scripts/job-monitor.mjs', 'first-poll', '--source', source.id], {env, encoding: 'utf8'});
  assert.equal(denied.status, 1); assert.match(denied.stderr, /MONITOR_LIVE_NOT_AUTHORIZED/);
}));

// ---- Eligibility classification regressions (fictional postings) ----
const evaluate = (extra = {}, ctx = context) => evaluateMonitoredJob({...normalizedJob(), ...extra}, ctx, {}, now);
const normalizedJob = () => ({id: 'x', company: source.company, title: job().title, location: job().location, url: job().url, requisitionId: 'REQ-1', description: job().description});
const withProfile = overrides => ({...context, profile: {...profile, ...overrides}});
test('issue 1: a skill stated as not required is not classified as mandatory', () => {
  const optional = evaluate({description: job().description + " Required: systems programming. We use Rust extensively, and while experience with the language isn't required a willingness to learn it is."});
  assert.ok(!optional.match?.unknowns && !optional.unknowns.includes('Required technical skill evidence needs review'));
  assert.ok(optional.gaps.some(gap => /not established in verified skills: .*Rust/.test(gap)));
  assert.ok(!optional.gaps.some(gap => /Stated as required/.test(gap)));
  for (const phrase of ['Rust experience is not required.', 'No prior Rust experience required.', 'Rust is preferred but not required.', 'Rust experience isn’t required.'])
    assert.ok(!evaluate({description: job().description + ' ' + phrase}).unknowns.includes('Required technical skill evidence needs review'), phrase);
  const mandatory = evaluate({description: job().description + ' Rust experience is required.'});
  assert.ok(mandatory.unknowns.includes('Required technical skill evidence needs review'));
  assert.ok(mandatory.gaps.includes('Stated as required: Rust'));
  // "Go" is matched as a word, not inside "good".
  assert.ok(!evaluate({description: job().description + ' We also use Go. Required: good communication.'}).unknowns.includes('Required technical skill evidence needs review'));
});
test('issue 2: verified U.S. citizenship in the saved profile satisfies a stated citizenship requirement', () => {
  const description = job().description + ' This role is fully remote for a candidate based in the United States with US citizenship.';
  const verified = evaluate({description}, withProfile({authorization: {...profile.authorization, citizenship: {verified: true, value: 'United States citizen'}}}));
  assert.ok(!verified.unknowns.includes('Citizenship requirement requires verified answer')); assert.equal(verified.evidence.citizenship, 'verified_profile');
  assert.equal(verified.status, 'qualified');
  assert.ok(evaluate({description, }).unknowns.includes('Citizenship requirement requires verified answer'), 'work authorization alone is not citizenship');
  for (const citizenship of [{verified: false, value: 'United States citizen'}, {verified: true, value: 'Not a United States citizen'}, {verified: true, value: 'Canadian citizen'}])
    assert.ok(evaluate({description}, withProfile({authorization: {...profile.authorization, citizenship}})).unknowns.includes('Citizenship requirement requires verified answer'), citizenship.value);
  assert.ok(!evaluate({description}, withProfile({authorization: {...profile.authorization, us_citizen: {verified: true, value: true}}})).unknowns.includes('Citizenship requirement requires verified answer'), 'legacy field still honored');
});
test('issue 3: vice-president and executive titles fail technical-role filtering', () => {
  for (const title of ['Vice President, Cloudflare One GTM', 'VP, Platform Engineering', 'SVP Infrastructure', 'Chief Cloud Officer']) {
    const result = evaluate({title}); assert.equal(result.status, 'excluded', title);
  }
  const vp = evaluate({title: 'Vice President, Cloudflare One GTM'});
  assert.ok(vp.exclusions.includes('Title indicates substantial seniority'));
  assert.ok(vp.exclusions.includes('Title outside configured technical role families'), 'an employer name containing "cloud" is not a role family');
  assert.equal(evaluate({title: 'Software Engineer I, Cloudflare Workers'}).status, 'qualified');
});
test('issue 4: cloud-finance and other business-function titles fail technical-role filtering', () => {
  for (const title of ['FP&A Analyst, Cloud Finance', 'Cloud Sales Associate', 'Cloud Marketing Associate', 'Cloud Infrastructure Recruiter', 'Go-to-Market Associate, Cloud']) {
    const result = evaluate({title}); assert.equal(result.status, 'excluded', title); assert.ok(result.exclusions.includes('Title indicates non-technical business function'), title);
  }
  for (const title of ['Cloud Engineer I, New Grad 2027', 'Associate Sales Engineer, Cloud Platform'])
    assert.ok(!evaluate({title}).exclusions.includes('Title indicates non-technical business function'), title);
});
test('issue 5: a posting graduation window that starts after the saved graduation is a conflict', () => {
  const description = 'Required: graduation date in Fall 2027, Spring 2028, Summer 2028, Fall 2028, Spring 2029 or Summer 2029. Python. Must be authorized to work in the United States.';
  const intern = evaluate({title: '2027 - Software Engineering Intern, AMER', description});
  assert.equal(intern.status, 'excluded');
  assert.ok(intern.exclusions.some(value => /graduation window \(Fall 2027, .*\) excludes saved graduation 2027-05/.test(value)), intern.exclusions.join('; '));
  const later = evaluate({title: '2027 - Software Engineering Intern, AMER', description}, withProfile({education: [{graduation_month: {value: '2028-05', verified: true}}]}));
  assert.ok(!later.exclusions.some(value => /graduation window/.test(value))); assert.match(later.evidence.graduation, /^posting_window\+verified_profile/);
  assert.equal(graduationWindow('Graduating in Fall 2027 or later.', '2027-05').inside, false);
  assert.equal(graduationWindow('Graduating in Fall 2027 or later.', '2029-05').inside, true);
  assert.equal(graduationWindow('Graduating between December 2026 and May 2027.', '2027-05').inside, true);
  assert.equal(graduationWindow('Must graduate before Fall 2027.', '2027-05'), null, 'upper bounds are not parsed as a window');
  assert.equal(graduationWindow('Graduating in 2027.', '2027-05'), null, 'year-only statements keep the existing year logic');
  assert.equal(graduationWindow('Graduation date in Fall 2027.', null), null, 'unverified graduation cannot decide');
});
test('issue 6: unspecified, month-less or internship employer start dates remain unresolved', () => {
  const start = START_UNCONFIRMED, base = 'Required: graduating in 2027. Build AWS Docker Python Linux SQL applications.';
  for (const description of [base, base + ' Start date: Summer 2027.', base + ' Starting in 2027.', base + ' Start date: flexible.', base + ' Starting in May or June 2027.']) {
    const result = evaluate({description}); assert.ok(result.unknowns.includes(start), description); assert.ok(!result.exclusions.includes('Explicit start precedes verified availability'), description);
  }
  const intern = evaluate({title: 'Software Engineering Intern 2027', description: base + ' Starting in May 2027.'});
  assert.ok(intern.unknowns.includes(start)); assert.ok(!intern.exclusions.includes('Explicit start precedes verified availability'), 'full-time availability does not govern an internship');
  assert.ok(!evaluate({description: base + ' Starting in June 2027.'}).unknowns.includes(start));
  assert.ok(evaluate({description: base + ' Starting in May 2027.'}).exclusions.includes('Explicit start precedes verified availability'));
  const provisional = evaluate({description: base + ' Starting in June 2027.'}, withProfile({standardAnswers: {full_time_start: {value: '2027-06', verified: true, provisional: true}}}));
  assert.ok(provisional.unknowns.includes('Verified availability unavailable or provisional')); assert.equal(provisional.status, 'needs_review', 'a candidate-side gap is not start-only');
});
test('issue 6: same-month start equals availability in every timezone', () => {
  const script = `import {evaluateMonitoredJob} from './lib/career-central/job-monitor.mjs';
    const r = evaluateMonitoredJob({id: 'x', company: 'Fictional', title: 'Software Engineer I', location: 'Dallas, TX', url: 'https://example.invalid/j/1', description: 'Starting in June 2027.'},
      {policy: {discovery: {}}, profile: {education: [], standardAnswers: {full_time_start: {value: '2027-06', verified: true}}}, portals: {}, history: []}, {}, ${now});
    console.log(JSON.stringify(r.exclusions));`;
  for (const TZ of ['Pacific/Kiritimati', 'UTC', 'Pacific/Pago_Pago']) {
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {env: {...process.env, TZ}, encoding: 'utf8'});
    assert.equal(out.status, 0, out.stderr); assert.ok(!JSON.parse(out.stdout).includes('Explicit start precedes verified availability'), TZ);
  }
});
test('issue 7: cached descriptions are labeled and never resolve current eligibility', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, [job()], now, {mode: 'cache'});
  const cached = Object.values(readMonitor(root).postings)[0];
  assert.equal(cached.match.status, 'needs_review'); assert.equal(cached.match.evidence.description, 'cached_snapshot');
  assert.ok(cached.match.unknowns.includes('Cached job description is not current eligibility evidence; verify the live posting'));
  await poll(root, [job()], now + step, {mode: 'live', authorizeLiveRead: true});
  const live = Object.values(readMonitor(root).postings)[0];
  assert.equal(live.match.status, 'qualified'); assert.equal(live.match.evidence.description, 'live_feed');
}));
test('issue 7: offline re-evaluation uses only hash-verified text and ages live content into a stale snapshot', () => fixture(async root => {
  await configureSources(root, [source]); await poll(root, []);
  const long = job().description + ' Details.'.repeat(200);
  await poll(root, [job('101', {description: long}), job('102', {description: long}), job('103', {title: 'Vice President, Cloud GTM'})], now + step, {mode: 'live', authorizeLiveRead: true});
  await setMonitorDecision(root, {postingId: monitorView(root).jobs[0].id, decision: 'interested'});
  const before = readMonitor(root), ledgerFile = path.join(root, 'data/application-automation/ledger.json');
  const ledgerBytes = () => fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile) : null, beforeLedger = ledgerBytes();
  const descriptions = new Map([['greenhouse:fictional:101', long], ['greenhouse:fictional:102', long + ' Edited later.'], ['greenhouse:fictional:103', job().description]]);
  const fresh = await reevaluatePostings({root, context, descriptions, now: now + step * 2});
  assert.deepEqual(fresh.evidence, {live_feed: 2, stored_excerpt: 1}); assert.equal(fresh.unavailable, 0);
  const byPosting = id => Object.values(readMonitor(root).postings).find(row => row.postingId === id);
  assert.equal(byPosting('101').match.status, 'qualified');
  assert.ok(byPosting('102').match.unknowns.includes('Only a stored description excerpt is available; full current requirements need review'), 'unverified cache text is not used');
  assert.equal(byPosting('103').match.status, 'excluded');
  const stale = await reevaluatePostings({root, context, descriptions, now: now + step + 86400001});
  assert.deepEqual(stale.evidence, {cached_snapshot: 2, stored_excerpt: 1});
  assert.ok(byPosting('101').match.unknowns.includes('Cached job description is not current eligibility evidence; verify the live posting'));
  const after = readMonitor(root), afterLedger = ledgerBytes();
  assert.deepEqual(after.alerts, before.alerts); assert.deepEqual(after.preparationTasks, before.preparationTasks); assert.deepEqual(after.sources, before.sources);
  assert.deepEqual(Object.values(after.postings).map(row => [row.id, row.decision, row.contentHash, row.firstSeenAt, row.availability]), Object.values(before.postings).map(row => [row.id, row.decision, row.contentHash, row.firstSeenAt, row.availability]));
  assert.deepEqual(afterLedger, beforeLedger, 'application ledger untouched'); assert.equal(monitorBackend(root), 'split');
}));
test('issue 1: negation is scoped to the skill mention, not a long run-on requirement block', () => {
  const block = 'Required: Experience working with Go, Python, Java, or equivalent programming languages Knowledge of SQL and common relational database systems such as PostgreSQL and MySQL Experience with dashboards and reporting tools is preferred';
  assert.ok(evaluate({description: job().description + ' ' + block}).unknowns.includes('Required technical skill evidence needs review'));
  assert.ok(!evaluate({description: job().description + ' Required: production-quality code in Go (or other languages with a willingness to learn Go).'}).unknowns.includes('Required technical skill evidence needs review'));
});

test('role classification: business-operations titles fail; engineering titles in business domains pass', () => {
  for (const title of ['Infrastructure Business Operations Associate', 'Business Operations Analyst, Cloud', 'Strategy & Operations Associate, Platform', 'Cloud Procurement Associate', 'Cloud Sales Associate'])
    assert.ok(evaluate({title}).exclusions.includes('Title indicates non-technical business function'), title);
  for (const title of ['Cloud Infrastructure Engineer I', 'Platform Engineer I', 'DevOps Engineer I', 'Backend Software Engineer I', 'Site Reliability Engineer I',
    'Software Engineer I, Finance Platform', 'Infrastructure Engineer I, Business Systems', 'Software Engineer I, Supply Chain Platform', 'Associate Sales Engineer, Cloud Platform']) {
    const result = evaluate({title});
    assert.ok(!result.exclusions.includes('Title indicates non-technical business function'), title);
    assert.ok(!result.exclusions.includes('Title outside configured technical role families'), title);
  }
});
test('start-date-only gap is potentially eligible, ranks above review, alerts and proposes preparation, but never submission-ready', () => fixture(async root => {
  const startOnly = evaluate({description: 'Required: graduating in 2027. Build AWS Docker Python Linux SQL applications.'});
  assert.equal(startOnly.status, 'potentially_eligible'); assert.equal(startOnly.startDate, 'employer_unspecified');
  assert.deepEqual(startOnly.unknowns, [START_UNCONFIRMED]); assert.deepEqual(startOnly.submissionBlockers, [START_UNCONFIRMED]);
  assert.equal(startOnly.submissionReady, false); assert.equal(startOnly.highPriority, true);
  // Distinct from explicit ineligibility and from other open items.
  assert.equal(evaluate({description: 'Required: graduating in 2027. Starting in May 2027. AWS Docker Python Linux SQL.'}).status, 'excluded');
  assert.equal(evaluate({title: 'Software Engineer', description: 'Required: graduating in 2027. AWS Docker Python Linux SQL.'}).status, 'needs_review');
  const full = evaluate(); assert.equal(full.status, 'qualified'); assert.equal(full.startDate, 'compatible'); assert.equal(full.submissionReady, false, 'monitor never grants submission readiness');
  await configureSources(root, [source]); await poll(root, []);
  const noStart = {description: 'Required: graduating in 2027. Build AWS Docker Python Linux SQL applications. No professional experience required.'};
  const result = await poll(root, [job('201', noStart), job('202', {title: 'Software Engineer', ...noStart})], now + step);
  assert.equal(result.alerts, 2); assert.equal(result.preparationTasks, 1);
  const view = monitorView(root);
  assert.deepEqual(view.jobs.map(row => row.match.status), ['potentially_eligible', 'needs_review']);
  assert.equal(view.counts.potentiallyEligible, 1);
  assert.ok(view.tasks[0].missing.includes(START_UNCONFIRMED)); assert.ok(view.tasks[0].approvals.includes('Final submission approval'));
  assert.equal(view.submittedApplications, 0);
  // Duplicate alert prevention holds for the new state.
  assert.equal((await poll(root, [job('201', noStart), job('202', {title: 'Software Engineer', ...noStart})], now + step * 2)).alerts, 0);
}));

test('false exclusions found in employer coverage review: graduation ranges, benefit dates, clearance eligibility', () => {
  const graduationTitle = 'Software Engineer I, Entry-Level';
  for (const phrase of ['Graduation Date: Fall 2026-Summer 2027', 'graduating between Fall 2026 and Summer 2027', 'Graduation date: Fall 2026 to Summer 2027', 'Graduation date: Fall 2026 – Summer 2027']) {
    const window = graduationWindow(phrase + '.', '2027-05');
    assert.equal(window.inside, true, phrase);
    assert.ok(!evaluate({title: graduationTitle, description: `Required: ${phrase}. AWS Docker Python Linux SQL.`}).exclusions.some(value => /graduation window/.test(value)), phrase);
  }
  assert.equal(graduationWindow('Graduation date in Fall 2027, Spring 2028 or Summer 2028.', '2027-05').inside, false, 'lists remain discrete');
  assert.equal(graduationWindow('Graduating in Spring 2026 and Fall 2027.', '2027-05').inside, false, '"and" without "between" is a list');
  const benefit = evaluate({description: 'Required: graduating in 2027. AWS Docker Python Linux SQL. Starting January 2027, the company will match a portion of 401(k) contributions.'});
  assert.ok(!benefit.exclusions.includes('Explicit start precedes verified availability')); assert.equal(benefit.startDate, 'employer_unspecified');
  assert.ok(evaluate({description: 'Required: graduating in 2027. AWS Docker Python Linux SQL. Start date: January 2027.'}).exclusions.includes('Explicit start precedes verified availability'));
  const eligible = evaluate({description: job().description + ' Active US Security clearance, or eligibility and willingness to obtain a US Security clearance.'});
  assert.ok(!eligible.exclusions.some(value => /clearance/i.test(value))); assert.ok(eligible.unknowns.includes('Security clearance eligibility requires review'));
  for (const text of ['Active Full Scope Poly level US security clearance.', 'Must hold an active TS/SCI clearance.'])
    assert.ok(evaluate({description: job().description + ' ' + text}).exclusions.includes('Active clearance requirement; verify quoted requirement'), text);
});

test('early-career and university-graduate titles count as entry level, matching the shared evaluator', () => {
  for (const title of ['[2027] Software Engineer, Early Career', 'Backend Software Engineer - University Graduate 2027', 'Software Engineer, Early Career (NYC)'])
    assert.ok(!evaluate({title}).unknowns.includes('Entry-level seniority requires review'), title);
  assert.ok(evaluate({title: 'Software Engineer'}).unknowns.includes('Entry-level seniority requires review'));
});

test('feed failures record precise sanitized categories (size, timeout, enrichment, status) and fail closed', () => fixture(async root => {
  await configureSources(root, [source]);
  const tooLarge = Object.assign(Error('HTTP body exceeded maxBytes of 25165824 (content-length 30000000) PRIVATE'), {maxBytes: 25165824});
  const cases = [
    [async () => {throw tooLarge;}, 'response_too_large'],
    [async () => {throw Object.assign(Error('This operation was aborted'), {name: 'AbortError'});}, 'timeout'],
    [async () => new Response('PRIVATE', {status: 503}), 'http_503'],
  ];
  let time = now;
  for (const [request, category] of cases) {
    time += 86400000 * 2;
    const result = await poll(root, [], time, {mode: 'live', authorizeLiveRead: true, fetchSnapshot: createFeedReader({request})});
    assert.equal(result.state, 'failed'); const stored = readMonitor(root).sources.fictional;
    assert.equal(stored.errorCategory, category); assert.equal(stored.checkpoint, null, 'no baseline from a failed read');
    assert.ok(!JSON.stringify(stored).includes('PRIVATE'));
  }
  // Optional /offices enrichment failing after a successful list still fails the cycle, labeled as enrichment.
  let calls = 0;
  const offices = createFeedReader({request: async () => {
    calls++;
    if (calls === 1) return Response.json({jobs: [{id: 101, title: job().title, absolute_url: job().url, content: job().description, location: {name: 'Remote'}}]});
    throw Object.assign(Error('This operation was aborted'), {name: 'AbortError'});
  }});
  await assert.rejects(offices(source, null), error => failureCategory(error) === 'enrichment_timeout');
  assert.equal(calls, 2, 'list plus one enrichment request; no extra retries');
  assert.equal(MONITOR_MAX_FEED_BYTES, 24 * 1024 * 1024);
}));

test('pilot review leaks: lead titles are senior; additional non-US cities are excluded without touching US namesakes', () => {
  for (const title of ['Team Lead, ARC Software Engineering Team', 'Tech Lead, Platform', 'Lead Software Engineer, Infrastructure'])
    assert.ok(evaluate({title}).exclusions.includes('Title indicates substantial seniority'), title);
  for (const title of ['Software Engineer I, Lead Generation Platform', 'Platform Engineer I'])
    assert.ok(!evaluate({title}).exclusions.includes('Title indicates substantial seniority'), title);
  for (const location of ['Doha, Qatar', 'Vilnius, Lithuania', 'Belgrade, Serbia', 'Dubai, United Arab Emirates'])
    assert.ok(evaluate({location}).exclusions.includes('Listed location outside United States'), location);
  assert.ok(!evaluate({location: 'Athens, GA'}).exclusions.includes('Listed location outside United States'));
  assert.ok(!evaluate({location: 'New York, NY; Doha, Qatar'}).exclusions.includes('Listed location outside United States'), 'a US option keeps the posting');
});
