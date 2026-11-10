import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {configureSources, pollSource, readMonitor, monitorView, setMonitorDecision, evaluateMonitoredJob, sourceFeed, seedCachedShortlist, setMonitorInterval} from '../lib/career-central/job-monitor.mjs';
import {createFeedReader} from '../lib/career-central/monitor-feed.mjs';
import {updateLedger} from '../lib/applications/store.mjs';
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
  await configureSources(root, [source]); await updateLedger(root, ledger => {ledger.jobMonitor.sources.fictional.lease = {token: 'dead-worker', until: now + 90000};});
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
  assert.equal(evaluateMonitoredJob(job('1', {description: 'Graduating in 2027. AWS Docker'}), context).status, 'needs_review');
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
