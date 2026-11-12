// AWS Lambda entry for the Career Central monitor tick (CC-017 C1). Wires the
// pinned AWS SDK clients into the existing, tested pieces: SDK wrappers ->
// cloud monitor store -> monitor handler (runMonitorTick). Construction is lazy,
// so importing this module has no side effects and makes no network calls.
//
// Environment (validated; anything missing fails closed):
//   MONITOR_BUCKET            bucket holding monitor/ partitions and projection/
//   MONITOR_TABLE             DynamoDB table for control items, index and leases
//   MONITOR_ENVIRONMENT       'dev' | 'prod'
//   MONITOR_LIVE_READS        must be exactly 'enabled' to read employer feeds
//   MONITOR_FIXTURE_SOURCES   dev only: comma list of source ids read from
//                             fixtures/{id}.json instead of the live feed
// The recurring authorization stored in the table remains the activation gate.
import {S3Client, GetObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3';
import {DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand} from '@aws-sdk/client-dynamodb';
import {s3ObjectClient, dynamoTableClient} from '../../lib/career-central/aws-clients.mjs';
import {createCloudMonitorStore} from '../../lib/career-central/cloud-monitor-store.mjs';
import {createMonitorHandler} from '../../lib/career-central/monitor-handler.mjs';
import {contextFromProjection} from '../../lib/career-central/eligibility-projection.mjs';
import {createFeedReader} from '../../lib/career-central/monitor-feed.mjs';

export const PROJECTION_KEY = 'projection/eligibility-v1.json';
const fail = code => Object.assign(Error(code), {code});

export function readConfig(env) {
  const config = {bucket: env.MONITOR_BUCKET, table: env.MONITOR_TABLE, environment: env.MONITOR_ENVIRONMENT,
    liveReads: env.MONITOR_LIVE_READS === 'enabled',
    fixtureSources: (env.MONITOR_FIXTURE_SOURCES || '').split(',').map(id => id.trim()).filter(Boolean)};
  if (!config.bucket || !config.table || !['dev', 'prod'].includes(config.environment)) throw fail('MONITOR_LAMBDA_CONFIG_INVALID');
  if (config.fixtureSources.length && config.environment !== 'dev') throw fail('MONITOR_LAMBDA_CONFIG_INVALID');
  if (config.fixtureSources.some(id => !/^[a-z0-9_-]{1,64}$/.test(id))) throw fail('MONITOR_LAMBDA_CONFIG_INVALID');
  return config;
}

export function createLambdaHandler({env = process.env, s3 = new S3Client({}), dynamodb = new DynamoDBClient({}), fetchSnapshot = createFeedReader(), log, clock} = {}) {
  const config = readConfig(env);
  const objects = s3ObjectClient({client: s3, commands: {GetObjectCommand, PutObjectCommand}, bucket: config.bucket, prefix: 'monitor/'});
  const assets = s3ObjectClient({client: s3, commands: {GetObjectCommand, PutObjectCommand}, bucket: config.bucket});
  const table = dynamoTableClient({client: dynamodb, commands: {GetItemCommand, PutItemCommand, DeleteItemCommand}, tableName: config.table});
  const readJson = async key => {const object = await assets.get(key); if (!object) throw fail('MONITOR_LAMBDA_OBJECT_MISSING'); return JSON.parse(object.body);};
  return async function handler(event, context) {
    // A fresh store per invocation: nothing cached from an earlier (warm) invocation.
    const projection = await readJson(PROJECTION_KEY);
    const store = createCloudMonitorStore({objects, table, ledgerJobs: contextFromProjection(projection).ledgerJobs});
    const fixtureSources = config.fixtureSources.length
      ? Object.fromEntries(config.fixtureSources.map(id => [id, () => readJson(`fixtures/${id}.json`)])) : null;
    // Without live reads the tick runs in fixture mode: fixture sources read their
    // S3 fixture and every other source fails closed instead of reaching an
    // employer feed. Live mode needs MONITOR_LIVE_READS=enabled plus the stored
    // recurring authorization.
    const reader = config.liveReads ? fetchSnapshot : async () => {throw fail('MONITOR_LIVE_NOT_AUTHORIZED');};
    return createMonitorHandler({store, loadProjection: async () => projection, fetchSnapshot: reader, authorizeLiveRead: config.liveReads,
      mode: config.liveReads ? 'live' : 'fixture', environment: config.environment, fixtureSources, ...(log ? {log} : {}), ...(clock ? {clock} : {})})(event, context);
  };
}

let cached;
export const handler = (event, context) => (cached ??= createLambdaHandler())(event, context);
