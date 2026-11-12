// Seeds a DEV monitor stack with synthetic data only, for the first fixture-only
// AWS test (docs/AWS_C1.md, "First deployment: fixture-only dev test").
//
// Everything written is fictional: one source (`alpha`, "Fictional Alpha"), a
// short recurring authorization, an eligibility projection built from a synthetic
// profile, and a fixture snapshot. No user-layer file is read, so no profile,
// résumé, application history or email can reach the cloud through this script.
//
//   node scripts/seed-dev-fixture.mjs seed    [--hours 2]    # source + authorization + projection + fixture step 1
//   node scripts/seed-dev-fixture.mjs fixture --step 2       # one new posting
//   node scripts/seed-dev-fixture.mjs revoke                 # remove the authorization
//   node scripts/seed-dev-fixture.mjs status                 # read-only counts and states
//   node scripts/seed-dev-fixture.mjs probe                  # real S3/DynamoDB conditional semantics
//
// Without --apply it prints the plan and contacts nothing. With --apply it needs
// --bucket, --table and --region naming a dev stack (names must contain
// "monitor-dev", as the CDK-generated names do) and uses the caller's AWS
// credentials (the approved short-lived dev profile).
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createCloudMonitorStore} from '../../lib/career-central/cloud-monitor-store.mjs';
import {s3ObjectClient, dynamoTableClient} from '../../lib/career-central/aws-clients.mjs';
import {configureSources} from '../../lib/career-central/job-monitor.mjs';
import {authorizeRecurring, revokeRecurring} from '../../lib/career-central/monitor-scheduler.mjs';
import {buildEligibilityProjection} from '../../lib/career-central/eligibility-projection.mjs';

// 5 minutes is the monitor's minimum interval, so the manual test waits ~6 minutes between invocations.
export const FIXTURE_SOURCE = Object.freeze({id: 'alpha', company: 'Fictional Alpha', provider: 'greenhouse', board: 'cc-fixture-alpha', intervalMinutes: 5});
export const PROJECTION_KEY = 'projection/eligibility-v1.json', FIXTURE_KEY = `fixtures/${FIXTURE_SOURCE.id}.json`;
const MAX_TEST_HOURS = 24;
const fail = code => Object.assign(Error(code), {code});

// Synthetic profile and policy: the same shape the bundle smoke test uses.
const syntheticContext = () => ({portals: {}, history: [], blacklist: new Map(),
  policy: {discovery: {graduationYear: 2027, searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}}},
  profile: {education: [{graduation_month: {value: '2027-05', verified: true}}], technicalSkills: {verified: true, value: {c: ['AWS']}},
    authorization: {us_work_authorized: {verified: true, value: true}}, standardAnswers: {}, resumeVersions: []}});
const posting = id => ({externalId: `fixture-${id}`, title: `Software Engineer I, New Grad 2027 (fixture ${id})`, location: 'Dallas, Texas, United States',
  url: `https://example.invalid/career-central-fixture/jobs/${id}`, description: 'Synthetic fixture posting. Required: graduating in 2027. AWS.'});

export function fixtureSnapshot(step) {
  if (![1, 2].includes(step)) throw fail('SEED_STEP_INVALID');
  return JSON.stringify({jobs: (step === 1 ? ['1'] : ['1', '2']).map(posting), complete: true});
}
export const syntheticProjection = (now = Date.now()) => JSON.stringify(buildEligibilityProjection(syntheticContext(), {}, {now}));

export async function runSeed({command, step = 1, hours = 2, now = Date.now(), store, assets}) {
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_TEST_HOURS) throw fail('SEED_HOURS_INVALID');
  if (command === 'seed') {
    await configureSources(store, [FIXTURE_SOURCE]);
    await authorizeRecurring(store, {sourceIds: [FIXTURE_SOURCE.id], hours, maxPollsPerTick: 1, now});
    await assets.put(PROJECTION_KEY, syntheticProjection(now));
    await assets.put(FIXTURE_KEY, fixtureSnapshot(1));
    return {seeded: [FIXTURE_SOURCE.id], authorizationHours: hours, objects: [PROJECTION_KEY, FIXTURE_KEY]};
  }
  if (command === 'fixture') {await assets.put(FIXTURE_KEY, fixtureSnapshot(step)); return {fixtureStep: step, objects: [FIXTURE_KEY]};}
  if (command === 'revoke') {await revokeRecurring(store, {now}); return {revoked: true};}
  if (command === 'status') {
    // Read-only: counts and states, never posting titles or URLs.
    const state = await store.load();
    return {alertCount: Object.keys(state.alerts ?? {}).length, authorizationExpiresAt: state.scheduler?.authorization?.expiresAt ?? null,
      sources: Object.fromEntries(Object.entries(state.sources).map(([id, s]) => [id, {status: s.status, failures: s.failures, errorCategory: s.errorCategory ?? null,
        provenance: s.checkpoint?.provenance ?? null, owner: s.owner ?? null, nextDueAt: s.nextDueAt}]))};
  }
  throw fail('SEED_COMMAND_INVALID');
}

// Real-service conditional semantics, the guarantees fakes cannot prove. Uses an
// operator-only key outside every prefix the function reads, and a PROBE# item
// that is deleted again. Returns one boolean per check.
export async function runProbe({rawObjects, table, id = randomUUID()}) {
  const key = `probe/${id}.json`, pk = `PROBE#${id}`, checks = {};
  const code = async promise => {try {await promise; return 'ok';} catch (error) {return error.code ?? error.name ?? 'error';}};
  checks.s3MissingKeyIsNull = (await rawObjects.get(key)) === null;
  const {etag} = await rawObjects.put(key, '{"v":1}', {ifNoneMatch: '*'});
  checks.s3CreateOnlyRejectsExisting = await code(rawObjects.put(key, '{"v":2}', {ifNoneMatch: '*'})) === 'PreconditionFailed';
  checks.s3StaleEtagRejected = await code(rawObjects.put(key, '{"v":2}', {ifMatch: '"00000000000000000000000000000000"'})) === 'PreconditionFailed';
  checks.s3CurrentEtagAccepted = await code(rawObjects.put(key, '{"v":2}', {ifMatch: etag})) === 'ok';
  checks.s3ReadBackLatest = (await rawObjects.get(key))?.body === '{"v":2}';
  await table.put(pk, 'PROBE', {v: 1}, {expectedVersion: null});
  checks.ddbCreateOnlyRejectsExisting = await code(table.put(pk, 'PROBE', {v: 2}, {expectedVersion: null})) === 'ConditionalCheckFailed';
  checks.ddbStaleVersionRejected = await code(table.put(pk, 'PROBE', {v: 2}, {expectedVersion: 7})) === 'ConditionalCheckFailed';
  checks.ddbCurrentVersionAccepted = await code(table.put(pk, 'PROBE', {v: 2}, {expectedVersion: 1})) === 'ok';
  checks.ddbConsistentReadLatest = (await table.get(pk, 'PROBE'))?.item?.v === 2;
  checks.ddbStaleDeleteRejected = await code(table.delete(pk, 'PROBE', {expectedVersion: 1})) === 'ConditionalCheckFailed';
  await table.delete(pk, 'PROBE', {expectedVersion: 2});
  checks.ddbProbeItemRemoved = (await table.get(pk, 'PROBE')) === null;
  return {passed: Object.values(checks).every(Boolean), checks, leftover: `s3 ${key} (operator-only prefix; removed with the bucket at teardown)`};
}

export function parseArgs(argv) {
  const [command, ...rest] = argv, options = {command, apply: false};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--apply') options.apply = true;
    else if (['--bucket', '--table', '--region', '--hours', '--step'].includes(flag) && rest[i + 1] !== undefined) options[flag.slice(2)] = rest[++i];
    else throw fail('SEED_ARGS_INVALID');
  }
  options.hours = Number(options.hours ?? 2); options.step = Number(options.step ?? 1);
  if (!['seed', 'fixture', 'revoke', 'status', 'probe'].includes(command)) throw fail('SEED_COMMAND_INVALID');
  if (options.apply) {
    if (!options.bucket || !options.table || !options.region) throw fail('SEED_TARGET_REQUIRED');
    if (![options.bucket, options.table].every(name => /monitor-dev/i.test(name))) throw fail('SEED_TARGET_NOT_DEV');
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.apply) {
    // Validate inputs exactly as --apply would, then describe the writes.
    if (options.command === 'fixture') fixtureSnapshot(options.step);
    if (!Number.isInteger(options.hours) || options.hours < 1 || options.hours > MAX_TEST_HOURS) throw fail('SEED_HOURS_INVALID');
    const writes = {seed: ['dynamodb MONITOR/INDEX (source alpha, authorization)', `dynamodb SOURCE#alpha/CONTROL`, `s3 ${PROJECTION_KEY} (synthetic)`, `s3 ${FIXTURE_KEY} (step 1)`],
      fixture: [`s3 ${FIXTURE_KEY} (step ${options.step})`], revoke: ['dynamodb MONITOR/INDEX (authorization removed)'],
      status: ['none (read-only)'], probe: ['s3 probe/{uuid}.json (conditional puts)', 'dynamodb PROBE#{uuid} (created, conditionally updated, deleted)']}[options.command];
    console.log(JSON.stringify({dryRun: true, command: options.command, writes, note: 'nothing contacted; add --apply --bucket --table --region to write'}));
    return;
  }
  const [{S3Client, GetObjectCommand, PutObjectCommand}, {DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand}] =
    await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/client-dynamodb')]);
  const s3 = new S3Client({region: options.region}), dynamodb = new DynamoDBClient({region: options.region});
  const s3Commands = {GetObjectCommand, PutObjectCommand};
  const store = createCloudMonitorStore({objects: s3ObjectClient({client: s3, commands: s3Commands, bucket: options.bucket, prefix: 'monitor/'}),
    table: dynamoTableClient({client: dynamodb, commands: {GetItemCommand, PutItemCommand, DeleteItemCommand}, tableName: options.table})});
  const assets = s3ObjectClient({client: s3, commands: s3Commands, bucket: options.bucket});
  if (options.command === 'probe') {
    const result = await runProbe({rawObjects: assets, table: dynamoTableClient({client: dynamodb, commands: {GetItemCommand, PutItemCommand, DeleteItemCommand}, tableName: options.table})});
    console.log(JSON.stringify(result)); if (!result.passed) process.exit(2); return;
  }
  console.log(JSON.stringify(await runSeed({...options, store, assets})));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {console.error(JSON.stringify({error: error.code ?? 'SEED_FAILED'})); process.exit(1);});
}
