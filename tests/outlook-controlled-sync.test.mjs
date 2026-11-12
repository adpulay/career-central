import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {runControlledMailboxSync} from '../lib/email/controlled-sync.mjs';
import {createOutlookAuth, MAIL_SCOPES} from '../lib/email/outlook-auth.mjs';
import {OutlookReadClient} from '../lib/email/outlook-client.mjs';
import {inspectMailbox} from '../lib/email/application-mail.mjs';
import {updateLedger} from '../lib/applications/store.mjs';
import {assertWindowsPrivatePath} from '../lib/email/windows-private-path.mjs';
import {createMicrosoftProtectedPersistence} from '../lib/email/protected-persistence.mjs';

const at = '2026-11-10T12:00:00.000Z', account = 'candidate@example.invalid';
const cfg = {schemaVersion: 1, clientId: '00000000-0000-0000-0000-000000000001',
  account, accountId: 'acct_fixture_123456789', mode: 'observe', automaticCodeUse: false,
  automaticStatusChanges: false, maxPages: 20, pageSize: 50, rules: []};
const ledgerFile = root => path.join(root, 'data/application-automation/ledger.json');
const read = root => JSON.parse(fs.readFileSync(ledgerFile(root)));
async function fixture(use) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-controlled-'));
  try {await use(root);} finally {fs.rmSync(root, {recursive: true, force: true});}
}
const input = root => ({root, config: cfg, hours: 1, clock: () => Date.parse(at), interactive: true, onUrl: () => {}});
test('same-process session OAuth, Graph adapter, analyzer and coordinator preserve read-only boundaries', () => fixture(async root => {
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  let request, signedIn = false;
  const auth = createOutlookAuth({repo, storageDir: path.join(root, 'auth'), clientId: cfg.clientId,
    clientFactory: options => {
      assert.deepEqual(options.cache, {});
      assert.equal(options.auth.authority, 'https://login.microsoftonline.com/consumers');
      const result = () => ({account: {username: account, homeAccountId: 'fixture-home'}, scopes: MAIL_SCOPES, accessToken: 'PRIVATE_TOKEN_FIXTURE'});
      return {getAuthCodeUrl: async r => {request = r; return 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';},
        acquireTokenByCode: async () => {signedIn = true; return result();},
        getTokenCache: () => ({getAllAccounts: async () => signedIn ? [result().account] : []}),
        acquireTokenSilent: async () => result()};
    }});
  const job = {key: 'job', company: 'Fictional Labs', requisitionId: 'REQ123', status: 'Awaiting Approval', createdAt: '2026-11-10T10:00:00.000Z'};
  await updateLedger(root, ledger => {ledger.jobs.job = job;});
  const config = {...cfg, rules: [{jobKey: 'job', senders: ['hiring@example.invalid']}]};
  const message = {id: 'immutable123', subject: 'Fictional Labs application received REQ123',
    receivedDateTime: '2026-11-10T11:30:00.000Z', from: {emailAddress: {address: 'hiring@example.invalid'}},
    toRecipients: [{emailAddress: {address: account}}], body: {content: 'PRIVATE_BODY_FIXTURE'}};
  const calls = [];
  const result = await runControlledMailboxSync({...input(root), config, auth,
    onUrl: () => {setTimeout(async () => {const u = new URL(request.redirectUri); u.searchParams.set('state', request.state); u.searchParams.set('code', 'fixture-code'); await fetch(u);}, 0);},
    clientFactory: options => new OutlookReadClient({...options, fetchFn: async (url, init) => {
      calls.push({url, init});
      const data = new URL(url).pathname === '/v1.0/me/messages' ? {value: [message], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=PRIVATE_CURSOR'} : message;
      return {ok: true, json: async () => data};
    }})});
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).searchParams.get('$top'), '10');
  assert.match(new URL(calls[0].url).searchParams.get('$filter'), /11:00:00/);
  assert.ok(calls.every(call => call.init.method === 'GET' && call.init.redirect === 'error'));
  assert.equal(result.incomplete, true);
  assert.equal(read(root).mailboxHealth.checkpoint, null);
  assert.equal(read(root).mailboxHealth.connection.state, 'connected');
  assert.equal(read(root).jobs.job.status, 'Awaiting Approval');
  assert.equal(Object.values(read(root).emailInbox)[0].requiresReview, true);
  assert.equal(Object.values(read(root).emailInbox)[0].codeUseAllowed, false);
  assert.doesNotMatch(JSON.stringify(read(root)) + JSON.stringify(result), /PRIVATE_BODY|PRIVATE_TOKEN|PRIVATE_CURSOR/);
  assert.deepEqual(fs.readdirSync(auth.directory), []);
}));
test('invalid windows and session-only noninteractive use fail before auth or Graph', () => fixture(async root => {
  const auth = {credentialMode: 'session', connect: async () => assert.fail('must not authenticate'), token: async () => assert.fail('must not get token')};
  for (const change of [{hours: 25}, {hours: NaN}, {since: '2026-01-01'}, {since: '2026-11-11'}]) {
    await assert.rejects(runControlledMailboxSync({...input(root), auth, ...change}), e => e.code === 'INVALID_CONTROLLED_WINDOW');
  }
  await assert.rejects(runControlledMailboxSync({...input(root), auth, interactive: false}), e => e.code === 'SESSION_SIGN_IN_REQUIRED');
  assert.equal(fs.existsSync(ledgerFile(root)), false);
}));
test('scope/account rejection clears MSAL cache and prevents Graph access and health writes', () => fixture(async root => {
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  let clears = 0;
  const auth = createOutlookAuth({repo, clientId: cfg.clientId, storageDir: path.join(root, 'auth'), clientFactory: () => ({
    getTokenCache: () => ({getAllAccounts: async () => [{username: account}], removeAccount: async () => {clears++;}}),
    acquireTokenSilent: async () => ({account: {username: account}, scopes: [...MAIL_SCOPES, 'Mail.Send'], accessToken: 'BAD_TOKEN'}),
  })});
  // Reuse a pre-existing session here to exercise scope validation, independently
  // of the CLI's required same-process interactive entry point.
  await assert.rejects(runControlledMailboxSync({...input(root), auth: {...auth, credentialMode: 'protected'}, interactive: false,
    clientFactory: () => assert.fail('Graph must not be constructed')}), e => e.code === 'OAUTH_ACCOUNT_OR_SCOPE_REJECTED');
  assert.equal(clears, 1);
  assert.equal(fs.existsSync(ledgerFile(root)), false);
}));
test('preview has no ledger writes and ignores configured page-count escalation', () => fixture(async root => {
  let limits;
  const result = await runControlledMailboxSync({...input(root), mode: 'preview', auth: {connect: async () => {}, token: async () => 'fixture'},
    clientFactory: () => ({list: async options => {limits = options; return {messages: [], hasMore: false};}})});
  assert.equal(limits.maxPages, 1); assert.equal(limits.pageSize, 10);
  assert.equal(result.automaticStatusChanges, false);
  assert.equal(fs.existsSync(ledgerFile(root)), false);
}));
test('oversized provider page is rejected after one GET without detail reads', async () => {
  let calls = 0;
  const client = new OutlookReadClient({getToken: async () => 'fixture', fetchFn: async () => {
    calls++; return {ok: true, json: async () => ({value: Array.from({length: 11}, (_, i) => ({id: String(i)}))})};
  }});
  await assert.rejects(client.list({since: '2026-11-10T11:00:00Z', until: at, maxPages: 1, pageSize: 10}));
  assert.equal(calls, 1);
});
test('duplicate envelopes are processed once; out-of-window and changed detail dates are refused', async () => {
  const msg = {id: 'id123', receivedDateTime: '2026-11-10T11:30:00.000Z', from: {emailAddress: {address: 'hiring@example.invalid'}},
    toRecipients: [{emailAddress: {address: account}}], subject: 'Fictional Labs REQ123 application received'};
  const config = {...cfg, rules: [{jobKey: 'job', senders: ['hiring@example.invalid']}]};
  const ledger = {jobs: {job: {key: 'job', company: 'Fictional Labs', requisitionId: 'REQ123', createdAt: '2026-11-10T10:00:00.000Z'}}};
  let details = 0;
  const client = {list: async () => ({messages: [msg, msg], hasMore: false}), detail: async () => {details++; return msg;}};
  const args = {client, config, ledger, since: '2026-11-10T11:00:00Z', until: at, now: Date.parse(at)};
  assert.equal((await inspectMailbox(args)).duplicatesSkipped, 1); assert.equal(details, 1);
  await assert.rejects(inspectMailbox({...args, client: {...client, list: async () => ({messages: [{...msg, receivedDateTime: '2026-11-09'}], hasMore: false})}}));
  await assert.rejects(inspectMailbox({...args, client: {...client, detail: async () => ({...msg, receivedDateTime: at})}}));
});
test('Windows ACL validator never interpolates paths and suppresses native errors', () => {
  assertWindowsPrivatePath('C:\\private path\\$(untrusted)', {run: (command, args, options) => {
    assert.equal(command, 'powershell.exe'); assert.ok(!args.join(' ').includes('$(untrusted)'));
    assert.equal(options.env.CAREER_OPS_ACL_CHECK_PATH, 'C:\\private path\\$(untrusted)');
    return 'PRIVATE_ACL_CONFIRMED\r\n';
  }});
  assert.throws(() => assertWindowsPrivatePath('fixture', {run: () => {throw Error('PRIVATE_NATIVE_ERROR');}}),
    e => e.code === 'WINDOWS_PRIVATE_ACL_UNVALIDATED' && !e.message.includes('PRIVATE_NATIVE_ERROR'));
});
test('protected backend refuses preexisting vendor validation files without altering them', () => fixture(async root => {
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  const storageDir = path.join(root, 'auth'); fs.mkdirSync(storageDir);
  fs.writeFileSync(path.join(storageDir, 'test.cache'), 'PRIVATE_EXISTING_CONTENT');
  await assert.rejects(createMicrosoftProtectedPersistence({repo, storageDir, accountName: cfg.accountId,
    extensionLoader: () => assert.fail('must not load backend')}), e => e.code === 'PROTECTED_BACKEND_UNAVAILABLE');
  assert.equal(fs.readFileSync(path.join(storageDir, 'test.cache'), 'utf8'), 'PRIVATE_EXISTING_CONTENT');
}));
test('CLI rejects missing opaque identity and supports explicit identity-only migration', () => fixture(async root => {
  fs.mkdirSync(path.dirname(ledgerFile(root)), {recursive: true});
  const file = path.join(path.dirname(ledgerFile(root)), 'outlook.json');
  const config = {...cfg}; delete config.accountId;
  fs.writeFileSync(file, JSON.stringify(config), {mode: 0o600});
  const env = {...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root};
  const run = args => spawnSync(process.execPath, ['scripts/outlook-email.mjs', ...args], {env, encoding: 'utf8'});
  const refused = run(['first-sync']); assert.equal(refused.status, 1); assert.match(refused.stderr, /PROTECTED_ACCOUNT_ID_REQUIRED/);
  const migrated = run(['migrate-identity']); assert.equal(migrated.status, 0, migrated.stderr);
  const updated = JSON.parse(fs.readFileSync(file)); assert.match(updated.accountId, /^acct_[a-f0-9]{32}$/);
  delete updated.accountId; assert.deepEqual(updated, config);
  assert.equal(fs.existsSync(ledgerFile(root)), false);
}));
test('disconnect uses the installed MSAL removeAccount API rather than an unsupported clear method', () => fixture(async root => {
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  let removed = 0;
  const auth = createOutlookAuth({repo, storageDir: path.join(root, 'auth'), clientId: cfg.clientId,
    clientFactory: () => ({getTokenCache: () => ({getAllAccounts: async () => [{username: account}],
      removeAccount: async value => {assert.equal(value.username, account); removed++;}})})});
  assert.equal(await auth.disconnect(account), true);
  assert.equal(removed, 1);
}));
test('wrong account and all write/shared/identity scopes fail before token forwarding', () => fixture(async root => {
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  for (const result of [{account: {username: 'other@example.invalid'}, scopes: MAIL_SCOPES},
    ...['Mail.ReadWrite', 'Mail.Send', 'Mail.Read.Shared', 'User.Read', 'Files.Read', '.default'].map(scope => ({account: {username: account}, scopes: [...MAIL_SCOPES, scope]}))]) {
    const auth = createOutlookAuth({repo, clientId: cfg.clientId, storageDir: path.join(root, 'auth'),
      clientFactory: () => ({getTokenCache: () => ({getAllAccounts: async () => [{username: account}], removeAccount: async () => {}}),
        acquireTokenSilent: async () => ({...result, accessToken: 'REJECTED_TOKEN'})})});
    await assert.rejects(auth.token(account), e => e.code === 'OAUTH_ACCOUNT_OR_SCOPE_REJECTED');
  }
}));
test('first-sync CLI rejects a broad window before any OAuth interaction', () => fixture(async root => {
  const dataRoot = path.join(root, 'private-data');
  fs.mkdirSync(path.dirname(ledgerFile(dataRoot)), {recursive: true});
  fs.writeFileSync(path.join(path.dirname(ledgerFile(dataRoot)), 'outlook.json'), JSON.stringify(cfg), {mode: 0o600});
  const authDir = path.join(root, 'auth');
  const result = spawnSync(process.execPath, ['scripts/outlook-email.mjs', 'first-sync', '--hours', '48'], {
    encoding: 'utf8', timeout: 5000, env: {...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: dataRoot,
      CAREER_OPS_OUTLOOK_AUTH_DIR: authDir, CAREER_OPS_OUTLOOK_CREDENTIAL_MODE: 'session'},
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INVALID_CONTROLLED_WINDOW/);
  assert.equal(result.stdout, '');
  assert.equal(fs.existsSync(ledgerFile(dataRoot)), false);
  assert.deepEqual(fs.readdirSync(authDir), []);
}));
test('protected cache is created owner-only before the native factory and reopens safely', () => fixture(async root => {
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  const storageDir = path.join(root, 'auth'); let cachePath;
  const extensionLoader = async () => ({DataProtectionScope: {CurrentUser: 'user'}, PersistenceCachePlugin: class {},
    PersistenceCreator: {async createPersistence(options) {
      cachePath = options.cachePath;
      if (process.platform !== 'win32') assert.equal(fs.statSync(cachePath).mode & 0o777, 0o600);
      assert.equal(options.usePlaintextFileOnLinux, false);
      return {verifyPersistence: async () => true};
    }}});
  await createMicrosoftProtectedPersistence({repo, storageDir, accountName: cfg.accountId, extensionLoader});
  fs.writeFileSync(cachePath, 'ENCRYPTED_FIXTURE');
  await createMicrosoftProtectedPersistence({repo, storageDir, accountName: cfg.accountId, extensionLoader});
  assert.equal(fs.readFileSync(cachePath, 'utf8'), 'ENCRYPTED_FIXTURE');
}));
