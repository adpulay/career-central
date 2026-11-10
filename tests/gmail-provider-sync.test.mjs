import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {GmailReadClient} from '../lib/email/gmail-client.mjs';
import {runControlledGmailSync} from '../lib/email/gmail-sync.mjs';
import {runBoundedMailboxSync} from '../lib/email/bounded-sync.mjs';
import {recordMailboxHealth} from '../lib/career-central/operational-store.mjs';
import {sanitizeGmailDiagnostic} from '../lib/email/gmail-diagnostics.mjs';

const now = Date.parse('2026-11-10T12:00:00.000Z'), at = new Date(now).toISOString();
const config = {schemaVersion: 1, provider: 'gmail', mode: 'observe', account: 'receiver@example.invalid', applicationEmail: 'candidate@msn.invalid',
  accountId: 'gmail_' + 'a'.repeat(32), clientFile: '/private/client.json', rules: [], automaticCodeUse: false, automaticStatusChanges: false};
const read = root => JSON.parse(fs.readFileSync(path.join(root, 'data/application-automation/ledger.json'))).gmailMailboxHealth;
const fixture = async use => {const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-provider-')); try {await use(root);} finally {fs.rmSync(root, {recursive: true, force: true});}};
const noLeaks = value => assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|receiver@|candidate@|Authorization|payload|oauth2callback|https:\/\//);
const args = root => ({root, config, authorizeConnection: true, hours: 1, clock: () => now,
  auth: {credentialMode: 'session', connect: async () => {}, token: async () => 'PRIVATE_TOKEN'}, onUrl: () => {}});
function metadata() {return {id: 'abc123', internalDate: String(now - 60000), payload: {headers: [
  {name: 'From', value: 'Employer <hiring@employer.invalid>'}, {name: 'To', value: 'candidate@msn.invalid'},
  {name: 'Subject', value: 'PRIVATE_SUBJECT'}, {name: 'Date', value: new Date(now - 60000).toUTCString()},
]}};}
for (const [status, expected] of [[400, 'invalid_request'], [401, 'authentication_required'], [403, 'permission_denied'], [429, 'rate_limited'], [503, 'api_request_failed']]) {
  test(`message-list HTTP ${status} remains distinguishable and never advances a checkpoint`, () => fixture(async root => {
    const events = []; let calls = 0;
    const result = await runControlledGmailSync({...args(root), onSyncDiagnostic: value => events.push(value),
      clientFactory: settings => new GmailReadClient({...settings, fetchFn: async () => {
        calls++; return {ok: false, status, json: async () => ({error: {message: 'PRIVATE_PROVIDER_DESCRIPTION'}})};
      }})});
    assert.equal(calls, 1); assert.equal(result.state, 'failed'); assert.equal(result.incomplete, true);
    assert.equal(result.syncDiagnostic.stage, 'message_list'); assert.equal(result.syncDiagnostic.category, expected);
    assert.equal(result.syncDiagnostic.httpStatus, status); assert.equal(read(root).checkpoint, null); noLeaks(result); noLeaks(events);
  }));
}
test('HTTP success with invalid JSON reports response parsing separately from permissions', () => fixture(async root => {
  const events = [];
  const result = await runControlledGmailSync({...args(root), onSyncDiagnostic: value => events.push(value),
    clientFactory: settings => new GmailReadClient({...settings, fetchFn: async () => ({ok: true, status: 200,
      json: async () => {throw Error('PRIVATE_RESPONSE_BYTES');}})})});
  assert.equal(result.syncDiagnostic.stage, 'message_list'); assert.equal(result.syncDiagnostic.category, 'response_parse_failed');
  assert.equal(result.syncDiagnostic.httpStatus, 200);
  assert.ok(events.some(event => event.event === 'request_succeeded' && event.httpStatus === 200));
  assert.equal(read(root).checkpoint, null); noLeaks(result); noLeaks(events);
}));
test('metadata normalization identifies its reason without exposing message IDs or headers', () => fixture(async root => {
  const bad = metadata(); bad.payload.headers.push({name: 'From', value: 'PRIVATE_DUPLICATE'});
  const events = [];
  const result = await runControlledGmailSync({...args(root), onSyncDiagnostic: value => events.push(value),
    clientFactory: settings => new GmailReadClient({...settings, fetchFn: async url => ({ok: true, status: 200,
      json: async () => new URL(url).pathname.endsWith('/messages') ? {messages: [{id: 'abc123'}]} : bad})})});
  assert.equal(result.syncDiagnostic.stage, 'metadata_parse'); assert.equal(result.syncDiagnostic.reasonCode, 'AMBIGUOUS_GMAIL_HEADERS');
  assert.ok(events.some(event => event.stage === 'message_metadata' && event.event === 'request_succeeded'));
  assert.equal(read(root).checkpoint, null); noLeaks(result); noLeaks(events);
}));
test('the Gmail first-sync ceiling is one hour and rejects wider windows before authentication', () => fixture(async root => {
  for (const hours of [1.01, 2, 24]) {
    assert.throws(() => runControlledGmailSync({...args(root), hours,
      auth: {connect: () => assert.fail('must not authenticate a wider scan')}}), error => error.code === 'INVALID_CONTROLLED_WINDOW');
  }
  const client = new GmailReadClient({getToken: () => assert.fail('must not get token')});
  await assert.rejects(client.list({since: new Date(now - 3600001).toISOString(), until: at}));
}));
test('a final publication conflict is a synchronization diagnostic and cannot claim completion', () => fixture(async root => {
  const events = [];
  const input = {root, provider: 'gmail', accountId: config.accountId, runId: 'fixture_run_123', expectedRevision: 0,
    since: new Date(now - 3600000).toISOString(), until: at, now: () => at, onDiagnostic: value => events.push(value),
    inspect: async () => ({observations: [], hasMore: false}),
    persistObservations: async () => {
      const h = read(root);
      const health = Object.fromEntries(['accountId', 'connection', 'synchronization', 'folderScope', 'checkpoint', 'retry'].map(key => [key, h[key]]));
      await recordMailboxHealth(root, {operationId: 'competing_writer_123', expectedRevision: 1, health}, {provider: 'gmail', now: at});
    }};
  await assert.rejects(runBoundedMailboxSync(input), error => {
    assert.equal(error.gmailDiagnostic.stage, 'checkpoint_publication');
    assert.equal(error.gmailDiagnostic.category, 'checkpoint_conflict'); return true;
  });
  assert.equal(read(root).checkpoint, null); assert.equal(read(root).synchronization.state, 'syncing'); noLeaks(events);
}));
test('diagnostic projection rejects arbitrary categories and discards untrusted messages/fields', () => {
  assert.equal(sanitizeGmailDiagnostic({stage: 'message_list', category: 'PRIVATE_CONTENT'}), null);
  const safe = sanitizeGmailDiagnostic({stage: 'message_list', category: 'permission_denied', message: 'PRIVATE_MESSAGE',
    requestUrl: 'https://private.invalid', headers: {Authorization: 'PRIVATE_TOKEN'}, httpStatus: 403});
  assert.equal(safe.httpStatus, 403); noLeaks(safe);
});
test('reported HTTP 204 is never JSON-decoded and cannot manufacture a complete empty checkpoint', () => fixture(async root => {
  const events = []; let calls = 0;
  const result = await runControlledGmailSync({...args(root), onSyncDiagnostic: value => events.push(value),
    clientFactory: settings => new GmailReadClient({...settings, fetchFn: async url => {
      calls++;
      assert.match(new URL(url).searchParams.get('fields'), /resultSizeEstimate/);
      return {ok: true, status: 204, json: () => assert.fail('204 must never be JSON parsed')};
    }})});
  assert.equal(calls, 1); assert.equal(result.state, 'idle'); assert.equal(result.incomplete, true);
  assert.equal(result.matchedObservations, 0); assert.equal(read(root).checkpoint, null);
  assert.equal(read(root).synchronization.lastSuccessfulSyncAt, null);
  assert.ok(events.some(event => event.event === 'response_empty' && event.httpStatus === 204)); noLeaks(events);
}));
test('an explicit zero-result JSON list completes the bounded empty window without any metadata/body read', () => fixture(async root => {
  const events = []; let calls = 0;
  const result = await runControlledGmailSync({...args(root), onSyncDiagnostic: value => events.push(value),
    clientFactory: settings => new GmailReadClient({...settings, fetchFn: async url => {
      calls++; assert.ok(new URL(url).searchParams.get('fields').includes('resultSizeEstimate'));
      return {ok: true, status: 200, json: async () => ({resultSizeEstimate: 0})};
    }})});
  assert.equal(calls, 1); assert.equal(result.state, 'idle'); assert.equal(result.incomplete, false);
  assert.equal(result.matchedObservations, 0); assert.equal(read(root).checkpoint.coverage.complete, true);
  assert.ok(events.some(event => event.event === 'response_validated')); noLeaks(result); noLeaks(events);
}));
test('an empty response with positive estimate is inconsistent and cannot advance a checkpoint', () => fixture(async root => {
  const result = await runControlledGmailSync({...args(root),
    clientFactory: settings => new GmailReadClient({...settings, fetchFn: async () => ({ok: true, status: 200,
      json: async () => ({resultSizeEstimate: 2})})})});
  assert.equal(result.state, 'failed'); assert.equal(result.syncDiagnostic.reasonCode, 'INVALID_GMAIL_PAGE');
  assert.equal(read(root).checkpoint, null);
}));
test('a later 204 preserves the last successful checkpoint and never retries the request', () => fixture(async root => {
  await runControlledGmailSync({...args(root), clientFactory: settings => new GmailReadClient({...settings,
    fetchFn: async () => ({ok: true, status: 200, json: async () => ({resultSizeEstimate: 0})})})});
  const original = structuredClone(read(root).checkpoint); let calls = 0;
  const result = await runControlledGmailSync({...args(root), clock: () => now + 60000,
    clientFactory: settings => new GmailReadClient({...settings, fetchFn: async () => {
      calls++; return {ok: true, status: 204, json: () => assert.fail('must not parse 204')};
    }})});
  assert.equal(result.incomplete, true); assert.equal(calls, 1);
  assert.deepEqual(read(root).checkpoint, original); assert.equal(read(root).synchronization.lastSuccessfulSyncAt, at);
}));
test('an uninformative empty JSON object is incomplete rather than a fabricated empty window', () => fixture(async root => {
  const result = await runControlledGmailSync({...args(root), clientFactory: settings => new GmailReadClient({...settings,
    fetchFn: async () => ({ok: true, status: 200, json: async () => ({})})})});
  assert.equal(result.incomplete, true); assert.equal(read(root).checkpoint, null);
}));
test('short npm alias retains explicit connection authorization and the one-hour limit', () => fixture(async root => {
  const authDir = path.join(root, 'auth');
  const env = {...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_GMAIL_AUTH_DIR: authDir};
  const refused = spawnSync('npm', ['run', 'gmail', '--', '-d'], {encoding: 'utf8', timeout: 5000, env});
  assert.equal(refused.status, 1); assert.match(refused.stderr, /GMAIL_CONNECTION_NOT_AUTHORIZED/);
  assert.equal(fs.existsSync(authDir), false);
  fs.mkdirSync(authDir);
  const clientFile = path.join(root, 'client.json');
  fs.writeFileSync(clientFile, JSON.stringify({installed: {
    client_id: '000000000000-fixture.apps.googleusercontent.com', client_secret: 'PRIVATE_SYNTHETIC_CLIENT_SECRET',
  }}), {mode: 0o600});
  fs.writeFileSync(path.join(authDir, 'config.json'), JSON.stringify({...config, clientFile}), {mode: 0o600});
  const tooWide = spawnSync('npm', ['run', 'gmail', '--', '-a', '-d', '--hours', '2'], {encoding: 'utf8', timeout: 5000, env});
  assert.equal(tooWide.status, 1); assert.match(tooWide.stderr, /INVALID_CONTROLLED_WINDOW/);
  assert.ok(!tooWide.stdout.includes('accounts.google.com')); assert.equal(fs.existsSync(path.join(root, 'data')), false);
}));
test('a malformed null collection cannot masquerade as an explicit zero-result JSON list', () => fixture(async root => {
  const result = await runControlledGmailSync({...args(root), clientFactory: settings => new GmailReadClient({...settings,
    fetchFn: async () => ({ok: true, status: 200, json: async () => ({messages: null, resultSizeEstimate: 0})})})});
  assert.equal(result.state, 'failed'); assert.equal(result.syncDiagnostic.reasonCode, 'INVALID_GMAIL_PAGE');
  assert.equal(read(root).checkpoint, null);
}));
