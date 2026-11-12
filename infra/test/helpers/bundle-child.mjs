// Runs inside the side-effect guard. Imports the BUILT Lambda bundle (with its
// path as argv[1], the worst case for main-module guards) and drives the bundled
// handler with dev fixtures against the command-level AWS emulator.
import {awsEmulator} from './aws-emulator.mjs';
import {createCloudMonitorStore} from '../../../lib/career-central/cloud-monitor-store.mjs';
import {s3ObjectClient, dynamoTableClient} from '../../../lib/career-central/aws-clients.mjs';
import {configureSources} from '../../../lib/career-central/job-monitor.mjs';
import {authorizeRecurring} from '../../../lib/career-central/monitor-scheduler.mjs';
import {setSourceOwner} from '../../../lib/career-central/monitor-transfer.mjs';
import {buildEligibilityProjection} from '../../../lib/career-central/eligibility-projection.mjs';
import {GetObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3';
import {GetItemCommand, PutItemCommand, DeleteItemCommand} from '@aws-sdk/client-dynamodb';

const bundlePath = process.env.BUNDLE; process.argv[1] = bundlePath;
const bundle = await import(bundlePath);
const afterImport = [...globalThis.__sideEffects];
const emu = awsEmulator(), T = Date.parse('2026-11-12T12:00:00Z'), minute = 60000;
const seed = createCloudMonitorStore({
  objects: s3ObjectClient({client: emu.s3, commands: {GetObjectCommand, PutObjectCommand}, bucket: 'cc-dev-monitor', prefix: 'monitor/'}),
  table: dynamoTableClient({client: emu.dynamodb, commands: {GetItemCommand, PutItemCommand, DeleteItemCommand}, tableName: 'cc-dev-monitor'})});
const src = id => ({id, company: `Fictional ${id}`, provider: 'greenhouse', board: id, intervalMinutes: 30});
await configureSources(seed, [src('alpha'), src('bravo'), src('charlie')]);
await authorizeRecurring(seed, {sourceIds: ['alpha', 'bravo', 'charlie'], hours: 24, now: T});
await setSourceOwner(seed, ['charlie'], 'local');
const context = {portals: {}, history: [], blacklist: new Map(), policy: {discovery: {graduationYear: 2027, searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}}},
  profile: {education: [{graduation_month: {value: '2027-05', verified: true}}], technicalSkills: {verified: true, value: {c: ['AWS']}}, authorization: {us_work_authorized: {verified: true, value: true}}, standardAnswers: {}, resumeVersions: []}};
emu.objects.set('projection/eligibility-v1.json', JSON.stringify(buildEligibilityProjection(context, {}, {now: T})));
const posting = id => ({externalId: id, title: `Software Engineer I, New Grad 2027 FIXTURE_TITLE_SENTINEL ${id}`, location: 'Dallas, Texas, United States',
  url: `https://job-boards.greenhouse.io/alpha/jobs/${id}`, description: 'Required: graduating in 2027. AWS.'});
const setFixture = ids => emu.objects.set('fixtures/alpha.json', JSON.stringify({jobs: ids.map(posting), complete: true}));
let liveFetches = 0, clockNow = T; const logs = [];
const handler = bundle.createLambdaHandler({env: {MONITOR_BUCKET: 'cc-dev-monitor', MONITOR_TABLE: 'cc-dev-monitor', MONITOR_ENVIRONMENT: 'dev', MONITOR_FIXTURE_SOURCES: 'alpha'},
  s3: emu.s3, dynamodb: emu.dynamodb, fetchSnapshot: async () => {liveFetches++; return {jobs: [], complete: true};}, log: line => logs.push(line), clock: () => clockNow});
setFixture(['1']);
const run1 = await handler({}, {getRemainingTimeInMillis: () => 280000});
setFixture(['1', '2']); clockNow = T + 31 * minute;
const run2 = await handler({}, {getRemainingTimeInMillis: () => 280000});
clockNow = T + 62 * minute;
const run3 = await handler({}, {getRemainingTimeInMillis: () => 280000});
const state = await seed.load();
console.log(JSON.stringify({afterImport, sideEffects: globalThis.__sideEffects, exports: [typeof bundle.handler, typeof bundle.createLambdaHandler],
  run1, run2, run3, liveFetches, alerts: Object.keys(state.alerts).length, alphaCheckpoint: state.sources.alpha.checkpoint?.provenance,
  bravo: {status: state.sources.bravo.status, errorCategory: state.sources.bravo.errorCategory, checkpoint: state.sources.bravo.checkpoint},
  charlieCheckpoint: state.sources.charlie.checkpoint, logLeak: logs.some(line => line.includes('FIXTURE_TITLE_SENTINEL') || line.includes('greenhouse.io')),
  logCount: logs.length}));
