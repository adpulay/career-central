// AWS SDK v3 wrappers implementing the object/table client interfaces used by
// cloud-monitor-store.mjs (CC-017 C1). This module imports no SDK: the caller
// injects a client and the command classes, so lib/ stays dependency-free and the
// Lambda entry (infra/lambda) wires the real SDK.
//
// Error mapping (anything else propagates unchanged and is treated as an
// ambiguous outcome by the monitor):
//   S3 412 PreconditionFailed, 409 ConditionalRequestConflict -> {code: 'PreconditionFailed'}
//      (409 means a concurrent conditional write won; ours was not applied)
//   DynamoDB ConditionalCheckFailedException -> {code: 'ConditionalCheckFailed'}
const fail = code => Object.assign(Error(code), {code});
const status = error => error?.$metadata?.httpStatusCode;

export function s3ObjectClient({client, commands, bucket, prefix = ''}) {
  if (!client || !commands?.GetObjectCommand || !commands?.PutObjectCommand || !bucket) throw fail('AWS_CLIENT_CONFIG_INVALID');
  const Key = key => `${prefix}${key}`;
  return {
    async get(key) {
      try {
        const response = await client.send(new commands.GetObjectCommand({Bucket: bucket, Key: Key(key)}));
        return {body: await response.Body.transformToString('utf-8'), etag: response.ETag};
      } catch (error) {
        if (error?.name === 'NoSuchKey' || status(error) === 404) return null;
        throw error;
      }
    },
    async put(key, body, {ifMatch, ifNoneMatch} = {}) {
      try {
        const response = await client.send(new commands.PutObjectCommand({Bucket: bucket, Key: Key(key), Body: body, ContentType: 'application/json',
          ...(ifMatch !== undefined ? {IfMatch: ifMatch} : {}), ...(ifNoneMatch !== undefined ? {IfNoneMatch: ifNoneMatch} : {})}));
        return {etag: response.ETag};
      } catch (error) {
        if (error?.name === 'PreconditionFailed' || status(error) === 412 || error?.name === 'ConditionalRequestConflict' || status(error) === 409) throw fail('PreconditionFailed');
        throw error;
      }
    },
  };
}

// Items are stored as {pk, sk, version (N), body (S: JSON)}. Every read is
// strongly consistent; every production write is conditional on `version`.
export function dynamoTableClient({client, commands, tableName}) {
  if (!client || !commands?.GetItemCommand || !commands?.PutItemCommand || !commands?.DeleteItemCommand || !tableName) throw fail('AWS_CLIENT_CONFIG_INVALID');
  const key = (pk, sk) => ({pk: {S: pk}, sk: {S: sk}});
  const conditional = async send => {
    try {return await send();} catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') throw fail('ConditionalCheckFailed');
      throw error;
    }
  };
  async function get(pk, sk) {
    const response = await client.send(new commands.GetItemCommand({TableName: tableName, Key: key(pk, sk), ConsistentRead: true}));
    if (!response.Item) return null;
    return {item: JSON.parse(response.Item.body.S), version: Number(response.Item.version.N)};
  }
  return {
    get,
    async put(pk, sk, item, {expectedVersion} = {}) {
      // expectedVersion: null = must not exist; number = must equal; undefined = unconditional (tests/tools only).
      const current = expectedVersion === undefined ? await get(pk, sk) : null;
      const version = (expectedVersion === undefined ? current?.version ?? 0 : expectedVersion ?? 0) + 1;
      const input = {TableName: tableName, Item: {...key(pk, sk), version: {N: String(version)}, body: {S: JSON.stringify(item)}}};
      if (expectedVersion === null) input.ConditionExpression = 'attribute_not_exists(pk)';
      else if (expectedVersion !== undefined) Object.assign(input, {ConditionExpression: 'version = :expected', ExpressionAttributeValues: {':expected': {N: String(expectedVersion)}}});
      await conditional(() => client.send(new commands.PutItemCommand(input)));
      return {version};
    },
    async delete(pk, sk, {expectedVersion} = {}) {
      const input = {TableName: tableName, Key: key(pk, sk)};
      if (expectedVersion !== undefined) Object.assign(input, {ConditionExpression: 'version = :expected', ExpressionAttributeValues: {':expected': {N: String(expectedVersion)}}});
      await conditional(() => client.send(new commands.DeleteItemCommand(input)));
    },
  };
}
