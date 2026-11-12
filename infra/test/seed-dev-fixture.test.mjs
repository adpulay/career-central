// The dev seeding script used by the first fixture-only AWS test: synthetic data
// only, dry run by default, dev targets only, and the seeded state drives the real
// Lambda handler through quiet baseline -> one alert -> no duplicate -> revoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {GetObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3';
import {GetItemCommand, PutItemCommand, DeleteItemCommand} from '@aws-sdk/client-dynamodb';
import {awsEmulator} from './helpers/aws-emulator.mjs';
import {createCloudMonitorStore} from '../../lib/career-central/cloud-monitor-store.mjs';
import {s3ObjectClient, dynamoTableClient} from '../../lib/career-central/aws-clients.mjs';
import {createLambdaHandler} from '../lambda/monitor-tick.mjs';
import {runSeed, runProbe, parseArgs, syntheticProjection, fixtureSnapshot, FIXTURE_KEY, PROJECTION_KEY} from '../scripts/seed-dev-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '../scripts/seed-dev-fixture.mjs');
const BUCKET = 'careercentralmonitor-dev-monitorbucket-x', TABLE = 'CareerCentralMonitor-dev-MonitorTable-X';
const T = Date.parse('2026-11-12T12:00:00Z'), minute = 60000;

test('dry run is the default, contacts nothing and writes nothing', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-dry-'));
  try {
    for (const args of [['seed'], ['fixture', '--step', '2'], ['revoke'], ['status'], ['probe'], ['authorize', '--source', 'alpha', '--hours', '2']]) {
      const run = spawnSync(process.execPath, ['--import', path.join(here, 'helpers/side-effect-guard.mjs'), script, ...args],
        {cwd, encoding: 'utf8', env: {PATH: process.env.PATH, HOME: cwd}, timeout: 60000});
      assert.equal(run.status, 0, run.stderr);
      const out = JSON.parse(run.stdout.trim().split('\n').at(-1));
      assert.equal(out.dryRun, true); assert.equal(out.command, args[0]); assert.ok(out.writes.length > 0);
    }
    assert.deepEqual(fs.readdirSync(cwd), []);
  } finally {fs.rmSync(cwd, {recursive: true, force: true});}
});

test('--apply requires an explicit dev bucket, table and region', () => {
  assert.throws(() => parseArgs(['seed', '--apply']), {code: 'SEED_TARGET_REQUIRED'});
  assert.throws(() => parseArgs(['seed', '--apply', '--bucket', 'careercentralmonitor-prod-b', '--table', 'CareerCentralMonitor-prod-T', '--region', 'us-east-1']), {code: 'SEED_TARGET_NOT_DEV'});
  assert.throws(() => parseArgs(['seed', '--apply', '--bucket', BUCKET, '--table', 'other-table', '--region', 'us-east-1']), {code: 'SEED_TARGET_NOT_DEV'});
  assert.throws(() => parseArgs(['wipe']), {code: 'SEED_COMMAND_INVALID'});
  assert.throws(() => parseArgs(['seed', '--force']), {code: 'SEED_ARGS_INVALID'});
  assert.equal(parseArgs(['seed', '--apply', '--bucket', BUCKET, '--table', TABLE, '--region', 'us-east-1']).apply, true);
});

test('seeded content is synthetic: no user-layer values, fixture URLs on example.invalid', () => {
  const blob = syntheticProjection(T) + fixtureSnapshot(1) + fixtureSnapshot(2), projection = JSON.parse(syntheticProjection(T));
  assert.doesNotMatch(blob, /@|\/home\/|[A-Za-z]:\\Users\\/);
  assert.deepEqual(projection.profile.resumeVersions, []); assert.deepEqual(projection.profile.applicationHistory, {}); assert.deepEqual(projection.ledger, []);
  // The script cannot read user-layer files: it imports no filesystem module.
  assert.doesNotMatch(fs.readFileSync(script, 'utf8'), /from ['"](node:)?fs(\/promises)?['"]|path-resolver|getCareerOpsRoot/);
  for (const job of JSON.parse(fixtureSnapshot(2)).jobs) assert.match(job.url, /^https:\/\/example\.invalid\//);
  assert.throws(() => fixtureSnapshot(3), {code: 'SEED_STEP_INVALID'});
});

test('seed -> Lambda handler: quiet baseline, one alert, no duplicate, revoke stops polling, no live reads', async () => {
  const emu = awsEmulator(), commands = {GetObjectCommand, PutObjectCommand};
  const store = createCloudMonitorStore({objects: s3ObjectClient({client: emu.s3, commands, bucket: BUCKET, prefix: 'monitor/'}),
    table: dynamoTableClient({client: emu.dynamodb, commands: {GetItemCommand, PutItemCommand, DeleteItemCommand}, tableName: TABLE})});
  const assets = s3ObjectClient({client: emu.s3, commands, bucket: BUCKET});
  await assert.rejects(runSeed({command: 'seed', hours: 48, now: T, store, assets}), {code: 'SEED_HOURS_INVALID'});
  assert.deepEqual((await runSeed({command: 'seed', hours: 2, now: T, store, assets})).objects, [PROJECTION_KEY, FIXTURE_KEY]);

  let now = T, liveFetches = 0;
  const handler = createLambdaHandler({env: {MONITOR_BUCKET: BUCKET, MONITOR_TABLE: TABLE, MONITOR_ENVIRONMENT: 'dev', MONITOR_FIXTURE_SOURCES: 'alpha'},
    s3: emu.s3, dynamodb: emu.dynamodb, fetchSnapshot: async () => {liveFetches++; return {jobs: [], complete: true};}, log: () => {}, clock: () => now});
  const ctx = {getRemainingTimeInMillis: () => 280000};
  const alerts = async () => Object.keys((await store.load()).alerts).length;

  assert.equal((await handler({}, ctx)).ok, true); assert.equal(await alerts(), 0, 'first baseline is quiet');
  await runSeed({command: 'fixture', step: 2, now, store, assets}); now += 31 * minute;
  await handler({}, ctx); assert.equal(await alerts(), 1, 'exactly one alert for one new posting');
  now += 31 * minute; await handler({}, ctx); assert.equal(await alerts(), 1, 'no duplicate on a repeated check');
  assert.equal((await store.load()).sources.alpha.checkpoint.provenance, 'synthetic');

  await runSeed({command: 'revoke', now, store, assets}); now += 31 * minute;
  const before = (await store.load()).sources.alpha.lastAttemptAt;
  await handler({}, ctx);
  assert.equal((await store.load()).sources.alpha.lastAttemptAt, before, 'after revoke the tick polls nothing');
  assert.equal(liveFetches, 0, 'live employer reader never called');

  const status = await runSeed({command: 'status', now, store, assets});
  assert.equal(status.alertCount, 1); assert.equal(status.authorizationExpiresAt, null); assert.equal(status.sources.alpha.provenance, 'synthetic');
  assert.doesNotMatch(JSON.stringify(status), /fixture \d|example\.invalid/, 'status carries no posting titles or URLs');
});

test('probe: passes against correct conditional semantics and fails when they are broken', async () => {
  const emu = awsEmulator(), rawObjects = s3ObjectClient({client: emu.s3, commands: {GetObjectCommand, PutObjectCommand}, bucket: BUCKET});
  const table = dynamoTableClient({client: emu.dynamodb, commands: {GetItemCommand, PutItemCommand, DeleteItemCommand}, tableName: TABLE});
  const good = await runProbe({rawObjects, table, id: 'p1'});
  assert.equal(good.passed, true, JSON.stringify(good.checks));
  assert.ok([...emu.objects.keys()].every(key => key.startsWith('probe/')), 'probe writes only its own prefix');
  // A service that ignores If-Match (the failure the real test must rule out) is detected.
  const lax = {...rawObjects, put: (key, body) => rawObjects.put(key, body)};
  const bad = await runProbe({rawObjects: lax, table, id: 'p2'});
  assert.equal(bad.passed, false); assert.equal(bad.checks.s3StaleEtagRejected, false);
});

// --- authorize: renewal of an existing synthetic source without resetting anything ---
const cloudFixture = () => {
  const emu = awsEmulator(), commands = {GetObjectCommand, PutObjectCommand};
  const store = createCloudMonitorStore({objects: s3ObjectClient({client: emu.s3, commands, bucket: BUCKET, prefix: 'monitor/'}),
    table: dynamoTableClient({client: emu.dynamodb, commands: {GetItemCommand, PutItemCommand, DeleteItemCommand}, tableName: TABLE})});
  const assets = s3ObjectClient({client: emu.s3, commands, bucket: BUCKET});
  return {emu, store, assets};
};
const rawState = emu => ({objects: new Map(emu.objects), items: new Map([...emu.items].map(([k, v]) => [k, structuredClone(v)]))});
const INDEX_KEY = 'MONITOR\u0000INDEX';
function changedItems(before, after) {
  const keys = new Set([...before.items.keys(), ...after.items.keys()]);
  return [...keys].filter(k => JSON.stringify(before.items.get(k)) !== JSON.stringify(after.items.get(k))).map(k => k.replace('\u0000', '/'));
}

test('authorize after revoke renews only the authorization: alerts, checkpoint, source record, versions and S3 snapshots are untouched', async () => {
  const {emu, store, assets} = cloudFixture();
  await runSeed({command: 'seed', hours: 2, now: T, store, assets});
  let now = T;
  const handler = createLambdaHandler({env: {MONITOR_BUCKET: BUCKET, MONITOR_TABLE: TABLE, MONITOR_ENVIRONMENT: 'dev', MONITOR_FIXTURE_SOURCES: 'alpha'},
    s3: emu.s3, dynamodb: emu.dynamodb, fetchSnapshot: async () => {throw Error('live read attempted');}, log: () => {}, clock: () => now});
  const ctx = {getRemainingTimeInMillis: () => 280000};
  await handler({}, ctx);
  await runSeed({command: 'fixture', step: 2, now, store, assets}); now += 31 * minute; await handler({}, ctx);
  await runSeed({command: 'revoke', now, store, assets}); now += 31 * minute;
  assert.equal((await handler({}, ctx)).errorCode, 'MONITOR_RECURRING_NOT_AUTHORIZED');

  const beforeState = await store.load(), before = rawState(emu), callsBefore = emu.calls.length;
  const result = await runSeed({command: 'authorize', source: 'alpha', hours: 3, now, store, assets});
  const after = rawState(emu), calls = emu.calls.slice(callsBefore);

  assert.deepEqual([result.authorized, result.sourceIds, result.maxPollsPerTick, result.expiresAt], [true, ['alpha'], 1, new Date(now + 3 * 3600000).toISOString()]);
  assert.ok(result.previous.revokedAt, 'reports that it renewed a revoked authorization');
  assert.deepEqual(result.preserved, {alertCount: 1, provenance: 'synthetic'});
  // Only the authorization index item changed; every S3 object and every other item is byte-identical.
  assert.deepEqual(changedItems(before, after), ['MONITOR/INDEX']);
  assert.deepEqual([...after.objects.entries()], [...before.objects.entries()], 'S3 snapshots, projection and fixtures unchanged');
  assert.equal(Number(after.items.get(INDEX_KEY).version.N), Number(before.items.get(INDEX_KEY).version.N) + 1, 'one conditional index write');
  assert.deepEqual(calls.filter(c => /Put|Delete/.test(c)), ['ddb:PutItemCommand'], 'exactly one write: the index item; no S3 write');
  const afterState = await store.load();
  assert.deepEqual(afterState.alerts, beforeState.alerts); assert.deepEqual(afterState.postings, beforeState.postings);
  assert.deepEqual(afterState.sources.alpha, beforeState.sources.alpha, 'source record, checkpoint and schedule state preserved');

  // The next tick runs again, sees nothing new, and adds no alert.
  now += 31 * minute;
  const tick = await handler({}, ctx);
  assert.equal(tick.ok, true);
  assert.equal(Object.keys((await store.load()).alerts).length, 1, 'no new or duplicate alert after renewal');
});

test('authorize while still authorized extends the expiry and changes nothing else', async () => {
  const {emu, store, assets} = cloudFixture();
  await runSeed({command: 'seed', hours: 2, now: T, store, assets});
  const before = rawState(emu), beforeState = await store.load();
  const result = await runSeed({command: 'authorize', source: 'alpha', hours: 24, now: T + minute, store, assets});
  assert.equal(result.previous.expiresAt, new Date(T + 2 * 3600000).toISOString());
  assert.equal(result.expiresAt, new Date(T + minute + 24 * 3600000).toISOString());
  assert.deepEqual(changedItems(before, rawState(emu)), ['MONITOR/INDEX']);
  assert.deepEqual([...rawState(emu).objects.entries()], [...before.objects.entries()]);
  const afterState = await store.load();
  assert.deepEqual(afterState.sources, beforeState.sources); assert.deepEqual(afterState.alerts, beforeState.alerts);
});

test('authorize rejects missing or invalid parameters and unknown sources, writing nothing', async () => {
  for (const argv of [['authorize'], ['authorize', '--hours', '2'], ['authorize', '--source', 'alpha']])
    assert.throws(() => parseArgs(argv), {code: 'SEED_AUTHORIZE_ARGS_REQUIRED'}, argv.join(' '));
  assert.throws(() => parseArgs(['authorize', '--source', 'bravo', '--hours', '2']), {code: 'SEED_SOURCE_NOT_FIXTURE'});
  assert.throws(() => parseArgs(['status', '--source', 'alpha']), {code: 'SEED_ARGS_INVALID'}, '--source belongs to authorize only');
  assert.throws(() => parseArgs(['authorize', '--source', 'alpha', '--hours', '2', '--apply']), {code: 'SEED_TARGET_REQUIRED'});
  assert.throws(() => parseArgs(['authorize', '--source', 'alpha', '--hours', '2', '--apply', '--bucket', 'prod-bucket', '--table', 'prod-table', '--region', 'us-east-1']), {code: 'SEED_TARGET_NOT_DEV'});

  const {emu, store, assets} = cloudFixture();
  await runSeed({command: 'seed', hours: 2, now: T, store, assets});
  const before = rawState(emu);
  for (const hours of [0, 25, 1.5, Number('abc'), -1])
    await assert.rejects(runSeed({command: 'authorize', source: 'alpha', hours, now: T, store, assets}), {code: 'SEED_HOURS_INVALID'}, String(hours));
  await assert.rejects(runSeed({command: 'authorize', source: 'alpha', now: T, store, assets}), {code: 'SEED_AUTHORIZE_ARGS_REQUIRED'});
  await assert.rejects(runSeed({command: 'authorize', hours: 2, now: T, store, assets}), {code: 'SEED_AUTHORIZE_ARGS_REQUIRED'});
  await assert.rejects(runSeed({command: 'authorize', source: 'bravo', hours: 2, now: T, store, assets}), {code: 'SEED_SOURCE_NOT_FIXTURE'});
  assert.deepEqual(changedItems(before, rawState(emu)), [], 'rejected requests write nothing');

  // A synthetic source that was never seeded is refused, not created.
  const fresh = cloudFixture();
  await assert.rejects(runSeed({command: 'authorize', source: 'alpha', hours: 2, now: T, store: fresh.store, assets: fresh.assets}), {code: 'MONITOR_SOURCE_UNKNOWN'});
  assert.equal(fresh.emu.items.size, 0); assert.equal(fresh.emu.objects.size, 0);
  assert.ok(!fresh.emu.calls.some(c => /Put|Delete/.test(c)), 'no write attempted for an unknown source');
});

test('the seed script cannot change the schedule or live reads: no Lambda, Scheduler or CloudFormation client', () => {
  const source = fs.readFileSync(script, 'utf8');
  assert.doesNotMatch(source, /@aws-sdk\/client-(lambda|scheduler|cloudformation|iam)|MONITOR_LIVE_READS|scheduleEnabled/);
});
