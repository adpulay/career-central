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
    for (const args of [['seed'], ['fixture', '--step', '2'], ['revoke'], ['status'], ['probe']]) {
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
