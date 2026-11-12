// Command-level S3/DynamoDB emulator for tests. Matches commands by class name
// (bundled and unbundled SDK copies have different class identities, and esbuild
// may suffix renamed classes, e.g. GetObjectCommand2) and
// enforces the same conditions the services enforce for the calls we make.
import {createHash} from 'node:crypto';
const awsError = (name, status) => Object.assign(Error(name), {name, $metadata: {httpStatusCode: status}});
export function awsEmulator() {
  const objects = new Map(), items = new Map(), calls = [];
  const etag = body => `"${createHash('md5').update(body).digest('hex')}"`;
  const s3 = {async send(command) {
    const name = command.constructor.name.replace(/\d+$/, ''), input = command.input; calls.push(`s3:${name}`);
    if (name === 'GetObjectCommand') {const body = objects.get(input.Key); if (body === undefined) throw awsError('NoSuchKey', 404); return {ETag: etag(body), Body: {transformToString: async () => body}};}
    if (name === 'PutObjectCommand') {
      const current = objects.get(input.Key);
      if (input.IfNoneMatch === '*' && current !== undefined) throw awsError('PreconditionFailed', 412);
      if (input.IfMatch !== undefined && (current === undefined || etag(current) !== input.IfMatch)) throw awsError('PreconditionFailed', 412);
      objects.set(input.Key, input.Body); return {ETag: etag(input.Body)};
    }
    throw Error(`unexpected S3 command ${name}`);
  }};
  const key = k => `${k.pk.S}\u0000${k.sk.S}`;
  const check = (input, current) => {
    if (input.ConditionExpression === 'attribute_not_exists(pk)' && current) throw awsError('ConditionalCheckFailedException', 400);
    if (input.ConditionExpression === 'version = :expected' && current?.version.N !== input.ExpressionAttributeValues[':expected'].N) throw awsError('ConditionalCheckFailedException', 400);
  };
  const dynamodb = {async send(command) {
    const name = command.constructor.name.replace(/\d+$/, ''), input = command.input; calls.push(`ddb:${name}`);
    if (name === 'GetItemCommand') {if (input.ConsistentRead !== true) throw Error('reads must be consistent'); return {Item: items.get(key(input.Key)) && structuredClone(items.get(key(input.Key)))};}
    if (name === 'PutItemCommand') {check(input, items.get(key(input.Item))); items.set(key(input.Item), structuredClone(input.Item)); return {};}
    if (name === 'DeleteItemCommand') {check(input, items.get(key(input.Key))); items.delete(key(input.Key)); return {};}
    throw Error(`unexpected DynamoDB command ${name}`);
  }};
  return {s3, dynamodb, objects, items, calls};
}
