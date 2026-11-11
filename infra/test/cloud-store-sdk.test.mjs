// The cloud monitor store end to end through the SDK wrappers: real SDK command
// objects, sent to a command-level in-memory emulator that enforces the same
// conditions S3 and DynamoDB enforce (If-Match / If-None-Match, condition
// expressions). Deterministic; no network or account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {GetObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3';
import {GetItemCommand, PutItemCommand, DeleteItemCommand} from '@aws-sdk/client-dynamodb';
import {s3ObjectClient, dynamoTableClient} from '../../lib/career-central/aws-clients.mjs';
import {createCloudMonitorStore} from '../../lib/career-central/cloud-monitor-store.mjs';
import {configureSources, pollSource, readMonitor} from '../../lib/career-central/job-monitor.mjs';

const awsError = (name, status) => Object.assign(Error(name), {name, $metadata: {httpStatusCode: status}});
function emulator() {
  const objects = new Map(), items = new Map(), counts = {s3Put: 0, ddbPut: 0};
  const etag = body => `"${createHash('md5').update(body).digest('hex')}"`;
  const s3 = {async send(command) {
    const input = command.input;
    if (command instanceof GetObjectCommand) {
      const body = objects.get(input.Key); if (body === undefined) throw awsError('NoSuchKey', 404);
      return {ETag: etag(body), Body: {transformToString: async () => body}};
    }
    if (command instanceof PutObjectCommand) {
      const current = objects.get(input.Key);
      if (input.IfNoneMatch === '*' && current !== undefined) throw awsError('PreconditionFailed', 412);
      if (input.IfMatch !== undefined && (current === undefined || etag(current) !== input.IfMatch)) throw awsError('PreconditionFailed', 412);
      objects.set(input.Key, input.Body); counts.s3Put++; return {ETag: etag(input.Body)};
    }
    throw Error('unexpected S3 command');
  }};
  const key = k => `${k.pk.S}\u0000${k.sk.S}`;
  const check = (input, current) => {
    if (input.ConditionExpression === 'attribute_not_exists(pk)' && current) throw awsError('ConditionalCheckFailedException', 400);
    if (input.ConditionExpression === 'version = :expected' && current?.version.N !== input.ExpressionAttributeValues[':expected'].N) throw awsError('ConditionalCheckFailedException', 400);
  };
  const ddb = {async send(command) {
    const input = command.input;
    if (command instanceof GetItemCommand) {assert.equal(input.ConsistentRead, true); return {Item: items.get(key(input.Key)) && structuredClone(items.get(key(input.Key)))};}
    if (command instanceof PutItemCommand) {check(input, items.get(key(input.Item))); items.set(key(input.Item), structuredClone(input.Item)); counts.ddbPut++; return {};}
    if (command instanceof DeleteItemCommand) {check(input, items.get(key(input.Key))); items.delete(key(input.Key)); return {};}
    throw Error('unexpected DynamoDB command');
  }};
  const instance = () => createCloudMonitorStore({
    objects: s3ObjectClient({client: s3, commands: {GetObjectCommand, PutObjectCommand}, bucket: 'cc-dev-monitor'}),
    table: dynamoTableClient({client: ddb, commands: {GetItemCommand, PutItemCommand, DeleteItemCommand}, tableName: 'cc-dev-monitor'})});
  return {instance, counts};
}

const now = Date.parse('2026-11-12T12:00:00Z'), hour = 3600000;
const context = {portals: {}, history: [], blacklist: new Map(),
  policy: {discovery: {graduationYear: 2027, searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}, monitorHighPriorityScore: 40}},
  profile: {education: [{graduation_month: {value: '2027-05', verified: true}}], technicalSkills: {verified: true, value: {c: ['AWS', 'Python']}},
    authorization: {us_work_authorized: {verified: true, value: true}}, standardAnswers: {full_time_start: {value: '2027-06', verified: true}}, resumeVersions: []}};
const job = id => ({externalId: id, title: 'Software Engineer I, New Grad 2027', location: 'Dallas, Texas, United States',
  url: `https://job-boards.greenhouse.io/alpha/jobs/${id}`, description: 'Required: graduating in 2027. Starting in June 2027. AWS Python.'});
const poll = (store, jobs, time) => pollSource({root: store, sourceId: 'alpha', context, now: time, random: () => 0, fetchSnapshot: async () => ({jobs, complete: true})});

test('cloud store through the SDK wrappers: quiet baseline, one alert, no partition PUT when unchanged', async () => {
  const {instance, counts} = emulator(), store = instance();
  await configureSources(store, [{id: 'alpha', company: 'Fictional', provider: 'greenhouse', board: 'alpha', intervalMinutes: 30}]);
  assert.equal((await poll(store, [job('1')], now)).alerts, 0);
  assert.equal((await poll(store, [job('1'), job('2')], now + hour)).alerts, 1);
  await poll(store, [job('1'), job('2')], now + 2 * hour); // event transition write
  const puts = counts.s3Put, ddb = counts.ddbPut;
  assert.equal((await poll(store, [job('1'), job('2')], now + 3 * hour)).alerts, 0);
  assert.equal(counts.s3Put - puts, 0, 'unchanged poll: no S3 PUT'); assert.equal(counts.ddbPut - ddb, 2, 'claim + release only');
  assert.equal(Object.keys((await store.load()).alerts).length, 1);
});

test('two instances through the SDK wrappers: the stale writer gets MONITOR_STORE_CONFLICT', async () => {
  const {instance} = emulator(), a = instance(), b = instance();
  await configureSources(a, [{id: 'alpha', company: 'Fictional', provider: 'greenhouse', board: 'alpha', intervalMinutes: 30}]);
  await poll(a, [job('1')], now);
  let resume; const gate = new Promise(resolve => {resume = resolve;});
  const stale = a.updateSource('alpha', async scoped => {await gate; Object.values(scoped.postings)[0].decision = 'dismissed';});
  await new Promise(resolve => setTimeout(resolve, 10));
  await b.updateSource('alpha', scoped => {Object.values(scoped.postings)[0].decision = 'interested';});
  resume(); await assert.rejects(stale, {code: 'MONITOR_STORE_CONFLICT'});
  assert.equal(Object.values((await a.load()).postings)[0].decision, 'interested');
  assert.equal(readMonitor(a).sources.alpha.lease, null);
});
