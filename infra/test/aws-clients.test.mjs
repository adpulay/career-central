// Real AWS SDK v3 clients with a fake HTTP request handler: no network, no
// credentials, no AWS account. The SDK's own serializers and error parsers run,
// so these tests check the actual wire shapes (S3 conditional headers, DynamoDB
// condition expressions, consistent reads) and the error mapping the cloud store
// depends on. They do not prove AWS server-side behavior; the dev-account
// integration test does that.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {S3Client, GetObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3';
import {DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand} from '@aws-sdk/client-dynamodb';
import {s3ObjectClient, dynamoTableClient} from '../../lib/career-central/aws-clients.mjs';

const credentials = {accessKeyId: 'AKIAFAKEFAKEFAKEFAKE', secretAccessKey: 'fake-secret-for-signing-only'};
function fakeHttp(respond) {
  const requests = [];
  return {requests, handler: {
    async handle(request) {
      const body = typeof request.body === 'string' ? request.body : request.body ? Buffer.from(request.body).toString() : '';
      requests.push({method: request.method, path: request.path, headers: request.headers, query: request.query, body});
      const {status = 200, headers = {}, text = ''} = respond(requests.at(-1));
      return {response: {statusCode: status, headers, body: Readable.from([Buffer.from(text)])}};
    },
    updateHttpClientConfig() {}, httpHandlerConfigs: () => ({}),
  }};
}
const s3For = respond => {const http = fakeHttp(respond); return {http, objects: s3ObjectClient({client: new S3Client({region: 'us-east-1', credentials, requestHandler: http.handler, forcePathStyle: true}),
  commands: {GetObjectCommand, PutObjectCommand}, bucket: 'cc-dev-monitor', prefix: 'monitor/'})};};
const ddbFor = respond => {const http = fakeHttp(respond); return {http, table: dynamoTableClient({client: new DynamoDBClient({region: 'us-east-1', credentials, requestHandler: http.handler}),
  commands: {GetItemCommand, PutItemCommand, DeleteItemCommand}, tableName: 'cc-dev-monitor'})};};
const s3Error = (code, status) => ({status, headers: {'content-type': 'application/xml'}, text: `<?xml version="1.0"?><Error><Code>${code}</Code><Message>m</Message></Error>`});
const ddbJson = (object, status = 200) => ({status, headers: {'content-type': 'application/x-amz-json-1.0'}, text: JSON.stringify(object)});

test('S3 PUT sends If-Match / If-None-Match headers and returns the ETag', async () => {
  const {http, objects} = s3For(() => ({headers: {etag: '"etag-2"'}}));
  assert.deepEqual(await objects.put('partitions/alpha.json', '{"a":1}', {ifMatch: '"etag-1"'}), {etag: '"etag-2"'});
  await objects.put('partitions/beta.json', '{}', {ifNoneMatch: '*'});
  const [first, second] = http.requests;
  assert.equal(first.method, 'PUT'); assert.match(first.path, /\/cc-dev-monitor\/monitor\/partitions\/alpha\.json$/);
  assert.equal(first.headers['if-match'], '"etag-1"'); assert.equal(first.headers['if-none-match'], undefined);
  assert.equal(second.headers['if-none-match'], '*'); assert.equal(second.headers['if-match'], undefined);
  assert.equal(first.headers['content-type'], 'application/json'); assert.ok(first.headers.authorization?.startsWith('AWS4-HMAC-SHA256'), 'request is signed');
});

test('S3 412 PreconditionFailed and 409 ConditionalRequestConflict map to a definite conflict; 500 stays ambiguous', async () => {
  for (const [code, status] of [['PreconditionFailed', 412], ['ConditionalRequestConflict', 409]]) {
    const {objects} = s3For(() => s3Error(code, status));
    await assert.rejects(objects.put('k', '{}', {ifMatch: '"x"'}), {code: 'PreconditionFailed'}, code);
  }
  const {objects} = s3For(() => s3Error('InternalError', 500));
  await assert.rejects(objects.put('k', '{}', {ifMatch: '"x"'}), error => error.code !== 'PreconditionFailed');
});

test('S3 GET returns body and ETag; NoSuchKey returns null', async () => {
  const {objects} = s3For(request => request.path.endsWith('missing.json') ? s3Error('NoSuchKey', 404) : {headers: {etag: '"e1"', 'content-type': 'application/json'}, text: '{"ok":true}'});
  assert.deepEqual(await objects.get('present.json'), {body: '{"ok":true}', etag: '"e1"'});
  assert.equal(await objects.get('missing.json'), null);
});

test('DynamoDB reads are strongly consistent and writes are version-conditional', async () => {
  const {http, table} = ddbFor(request => request.headers['x-amz-target'].endsWith('GetItem')
    ? ddbJson({Item: {pk: {S: 'SOURCE#alpha'}, sk: {S: 'CONTROL'}, version: {N: '7'}, body: {S: '{"schemaVersion":1}'}}}) : ddbJson({}));
  assert.deepEqual(await table.get('SOURCE#alpha', 'CONTROL'), {item: {schemaVersion: 1}, version: 7});
  assert.deepEqual(await table.put('SOURCE#alpha', 'CONTROL', {schemaVersion: 1, source: {}}, {expectedVersion: 7}), {version: 8});
  await table.put('MONITOR', 'INDEX', {schemaVersion: 1}, {expectedVersion: null});
  await table.delete('MONITOR', 'TICKLOCK', {expectedVersion: 3});
  const [get, put, create, del] = http.requests.map(request => ({target: request.headers['x-amz-target'], body: JSON.parse(request.body)}));
  assert.equal(get.target, 'DynamoDB_20120810.GetItem'); assert.equal(get.body.ConsistentRead, true);
  assert.equal(put.body.ConditionExpression, 'version = :expected'); assert.deepEqual(put.body.ExpressionAttributeValues, {':expected': {N: '7'}}); assert.deepEqual(put.body.Item.version, {N: '8'});
  assert.equal(create.body.ConditionExpression, 'attribute_not_exists(pk)'); assert.deepEqual(create.body.Item.version, {N: '1'});
  assert.equal(del.target, 'DynamoDB_20120810.DeleteItem'); assert.equal(del.body.ConditionExpression, 'version = :expected');
});

test('DynamoDB ConditionalCheckFailedException maps to a definite conflict; throttling stays ambiguous', async () => {
  const conditional = ddbFor(() => ddbJson({__type: 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException', message: 'The conditional request failed'}, 400));
  await assert.rejects(conditional.table.put('a', 'b', {}, {expectedVersion: 1}), {code: 'ConditionalCheckFailed'});
  const throttled = ddbFor(() => ddbJson({__type: 'com.amazonaws.dynamodb.v20120810#ProvisionedThroughputExceededException', message: 'slow down'}, 400));
  await assert.rejects(throttled.table.put('a', 'b', {}, {expectedVersion: 1}), error => error.code !== 'ConditionalCheckFailed');
});
