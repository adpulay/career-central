import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {OAuth2Client} from 'google-auth-library';
import {GMAIL_SCOPES, createGmailAuth, validateGmailScopes, loadGoogleDesktopClient} from '../lib/email/gmail-auth.mjs';
import {GmailReadClient, normalizeGmailMessage} from '../lib/email/gmail-client.mjs';
import {runControlledGmailSync} from '../lib/email/gmail-sync.mjs';
import {inspectMailbox, analyzeMessage} from '../lib/email/application-mail.mjs';
import {updateLedger} from '../lib/applications/store.mjs';
import {recordMailboxHealth} from '../lib/career-central/operational-store.mjs';
import {inspectMailboxSyncRecovery, abandonInterruptedMailboxSync} from '../lib/email/sync-recovery.mjs';

const at = '2026-11-10T12:00:00.000Z', now = Date.parse(at);
const receiving = 'receiver@example.invalid', original = 'candidate@msn.invalid', sender = 'hiring@employer.invalid';
const clientId = '000000000000-fixture.apps.googleusercontent.com';
const config = {schemaVersion: 1, provider: 'gmail', mode: 'observe', account: receiving,
  applicationEmail: original, accountId: 'gmail_' + 'a'.repeat(32), clientFile: '/private/client.json',
  rules: [{jobKey: 'job', senders: [sender]}], automaticCodeUse: false, automaticStatusChanges: false};
const job = {key: 'job', company: 'Fictional Labs', requisitionId: 'REQ123', status: 'Awaiting Approval',
  createdAt: '2026-11-10T10:00:00.000Z'};
const ledgerFile = root => path.join(root, 'data/application-automation/ledger.json');
const read = root => JSON.parse(fs.readFileSync(ledgerFile(root)));
const fixture = async use => {const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-ops-')); try {await use(root);} finally {fs.rmSync(root, {recursive: true, force: true});}};
function raw(text = 'Fictional Labs received your application REQ123') {
  return {id: 'abc123', internalDate: String(now - 60000), labelIds: ['INBOX'], payload: {mimeType: 'text/plain',
    headers: [{name: 'From', value: `Fictional Labs <${sender}>`}, {name: 'To', value: `Candidate <${original}>`},
      {name: 'Subject', value: 'Fictional Labs application REQ123'}, {name: 'Date', value: 'Tue, 10 Nov 2026 11:59:00 +0000'}],
    body: {data: Buffer.from(text).toString('base64url')}}};
}
function fakeAuth({scopes = GMAIL_SCOPES, email = receiving, aud = clientId, exchangeError = null, infoScopes = scopes} = {}) {
  let request, exchanges = 0, profiles = 0, cleared = 0, tokenInfo = 0;
  const auth = createGmailAuth({clientId, clientSecret: 'FICTIONAL_SECRET', clock: () => now,
    profileReader: async () => {profiles++; return {emailAddress: email};}, clientFactory: options => {
      const client = new OAuth2Client(options);
      const generate = client.generateAuthUrl.bind(client);
      client.generateAuthUrl = options => {request = options; return generate(options);};
      client.getToken = async options => {
        exchanges++; assert.ok(options.codeVerifier.length >= 43); assert.equal(options.redirect_uri, request.redirect_uri);
        if (exchangeError) throw Error(exchangeError);
        return {tokens: {access_token: 'PRIVATE_ACCESS_TOKEN', refresh_token: 'PRIVATE_REFRESH_TOKEN',
          expiry_date: now + 3600000, scope: scopes.join(' ')}};
      };
      client.getTokenInfo = async () => {tokenInfo++; return {scopes: infoScopes, aud};};
      client.setCredentials = value => {assert.deepEqual(value, {}); cleared++;};
      return client;
    }});
  const onUrl = url => {
    const printed = new URL(url);
    assert.equal(printed.hostname, 'accounts.google.com');
    assert.equal(printed.searchParams.get('scope'), GMAIL_SCOPES[0]);
    assert.equal(printed.searchParams.get('access_type'), 'online');
    assert.equal(printed.searchParams.get('include_granted_scopes'), 'false');
    assert.equal(printed.searchParams.get('code_challenge_method'), 'S256');
    setTimeout(async () => {
      const callback = new URL(request.redirect_uri);
      callback.searchParams.set('state', 'wrong');
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set('state', request.state); callback.searchParams.set('code', 'fixture-code');
      assert.equal((await fetch(callback)).status, 200);
    }, 0);
  };
  return {auth, onUrl, counts: () => ({exchanges, profiles, cleared, tokenInfo})};
}
const options = root => ({root, config, mode: 'sync', hours: 1, clock: () => now, authorizeConnection: true});
function graphFetch(calls, message = raw(), more = false) {
  return async (url, init) => {
    calls.push({url, init});
    const request = new URL(url);
    const data = request.pathname.endsWith('/messages') ? {messages: [{id: message.id}], ...(more ? {nextPageToken: 'PRIVATE_PAGE_TOKEN'} : {})} : message;
    return {ok: true, json: async () => data};
  };
}
test('authorization is required before OAuth construction, profile reads or local sync writes', () => fixture(async root => {
  const noSideEffects = () => assert.fail('must not construct OAuth');
  const auth = createGmailAuth({clientId, clientFactory: noSideEffects});
  await assert.rejects(auth.connect(receiving, noSideEffects), e => e.code === 'GMAIL_CONNECTION_NOT_AUTHORIZED');
  assert.throws(() => runControlledGmailSync({...options(root), authorizeConnection: false, auth}), e => e.code === 'GMAIL_CONNECTION_NOT_AUTHORIZED');
  assert.equal(fs.existsSync(ledgerFile(root)), false);
}));
test('real Google library PKCE/loopback flow validates scope/audience/profile and keeps tokens only in memory', async () => {
  const {auth, onUrl, counts} = fakeAuth();
  await auth.connect(receiving, onUrl, {authorizeConnection: true});
  assert.equal(await auth.token(receiving), 'PRIVATE_ACCESS_TOKEN');
  await assert.rejects(auth.token(original), e => e.code === 'GMAIL_SIGN_IN_REQUIRED');
  assert.deepEqual(counts(), {exchanges: 1, profiles: 1, cleared: 1, tokenInfo: 1});
  auth.disconnect(); await assert.rejects(auth.token(receiving));
});
test('extra scope, token-info scope escalation, wrong client and wrong mailbox are refused', async () => {
  for (const change of [{scopes: [...GMAIL_SCOPES, 'https://mail.google.com/']},
    {infoScopes: [...GMAIL_SCOPES, 'https://www.googleapis.com/auth/gmail.modify']},
    {aud: 'foreign-client'}, {email: 'other@example.invalid'}]) {
    const {auth, onUrl} = fakeAuth(change);
    await assert.rejects(auth.connect(receiving, onUrl, {authorizeConnection: true}));
    await assert.rejects(auth.token(receiving));
  }
  for (const scopes of [[], ['openid'], ['https://www.googleapis.com/auth/gmail.send']]) assert.throws(() => validateGmailScopes(scopes));
});
test('provider OAuth errors are redacted and never retain usable credentials', async () => {
  const {auth, onUrl} = fakeAuth({exchangeError: 'PRIVATE_PROVIDER_BODY'});
  await assert.rejects(auth.connect(receiving, onUrl, {authorizeConnection: true}), error => error.code === 'GMAIL_SIGN_IN_FAILED' && !error.message.includes('PRIVATE'));
  await assert.rejects(auth.token(receiving));
});
test('full Gmail pipeline reuses analyzer/coordinator and preserves Outlook health, job status and privacy', () => fixture(async root => {
  await updateLedger(root, ledger => {ledger.jobs.job = job; ledger.mailboxHealth = {fixture: 'preserve-outlook-bytes'};});
  const {auth, onUrl} = fakeAuth(), calls = [];
  const result = await runControlledGmailSync({...options(root), auth, onUrl,
    clientFactory: settings => new GmailReadClient({...settings, fetchFn: graphFetch(calls)})});
  assert.equal(result.incomplete, false); assert.equal(result.matchedObservations, 1);
  assert.equal(calls.length, 3); // one ID page, one metadata envelope, one matched body
  assert.ok(calls.every(call => call.init.method === 'GET' && call.init.redirect === 'error'));
  assert.equal(new URL(calls[0].url).searchParams.get('maxResults'), '10');
  const saved = read(root); assert.deepEqual(saved.mailboxHealth, {fixture: 'preserve-outlook-bytes'});
  assert.equal(saved.gmailMailboxHealth.revision, 2);
  assert.equal(saved.jobs.job.status, 'Awaiting Approval');
  const observation = Object.values(saved.emailInbox)[0];
  assert.equal(observation.source, 'gmail_api'); assert.equal(observation.requiresReview, true); assert.equal(observation.codeUseAllowed, false);
  assert.doesNotMatch(JSON.stringify(saved) + JSON.stringify(result), /PRIVATE_ACCESS|PRIVATE_REFRESH|Fictional Labs received|hiring@|candidate@|receiver@/);
}));
test('page cap never follows nextPageToken and partial coverage cannot advance checkpoint', () => fixture(async root => {
  await updateLedger(root, ledger => {ledger.jobs.job = job;});
  const {auth, onUrl} = fakeAuth(), calls = [];
  const result = await runControlledGmailSync({...options(root), auth, onUrl,
    clientFactory: settings => new GmailReadClient({...settings, fetchFn: graphFetch(calls, raw(), true)})});
  assert.equal(result.incomplete, true); assert.equal(read(root).gmailMailboxHealth.checkpoint, null);
  assert.equal(calls.length, 3); assert.ok(calls.every(call => !call.url.includes('PRIVATE_PAGE_TOKEN')));
}));
test('preview authenticates but leaves all ledger bytes unchanged', () => fixture(async root => {
  await updateLedger(root, ledger => {ledger.jobs.job = job;});
  const before = fs.readFileSync(ledgerFile(root)); const {auth, onUrl} = fakeAuth();
  const result = await runControlledGmailSync({...options(root), mode: 'preview', auth, onUrl,
    clientFactory: settings => new GmailReadClient({...settings, fetchFn: graphFetch([])})});
  assert.equal(result.matchedObservations, 1); assert.deepEqual(fs.readFileSync(ledgerFile(root)), before);
}));
test('Google/MSN account-security messages and ordinary inline forwards never trigger detail reads', async () => {
  for (const message of [raw('Google account verification code 123456'), raw('Password reset code 123456')]) {
    assert.equal(analyzeMessage(normalizeGmailMessage(message, {detail: true}), {...config, account: original, requireOriginalDate: true}, {job}, now).matched, false);
  }
  const forwarded = normalizeGmailMessage(raw());
  forwarded.from = {emailAddress: {address: original}}; forwarded.toRecipients = [{emailAddress: {address: receiving}}];
  const result = await inspectMailbox({client: {list: async () => ({messages: [forwarded], hasMore: false}), detail: () => assert.fail('must not read inline forward body')},
    config: {...config, account: original, requireOriginalDate: true}, ledger: {jobs: {job}}, since: new Date(now - 3600000).toISOString(), now});
  assert.equal(result.observations.length, 0);
});
test('redirected verification codes require a fresh original date and never enter evidence output', async () => {
  const active = {...job, activeVerification: {jobKey: 'job', purpose: 'application_email_verification', expectedSender: sender,
    requestedAt: new Date(now - 120000).toISOString(), expiresAt: new Date(now + 120000).toISOString()}};
  const message = normalizeGmailMessage(raw('Fictional Labs application verification code is 123456 for REQ123'), {detail: true});
  const analysisConfig = {...config, account: original, requireOriginalDate: true};
  const result = analyzeMessage(message, analysisConfig, {job: active}, now);
  assert.equal(result.category, 'verification'); assert.equal(result.hasUniqueCode, true); assert.equal(result.codeUseAllowed, false);
  assert.ok(!JSON.stringify(result).includes('123456'));
  const stale = analyzeMessage({...message, originalReceivedDateTime: new Date(now - 600000).toISOString()}, analysisConfig, {job: active}, now);
  assert.equal(stale.hasUniqueCode, false);
});
test('message time uses internalDate for the bounded window and original Date for application context', async () => {
  const message = raw(); message.internalDate = String(now - 3600001);
  const client = new GmailReadClient({getToken: async () => 'fixture', fetchFn: graphFetch([], message)});
  assert.deepEqual((await client.list({since: new Date(now - 3600000).toISOString(), until: at})).messages, []);
  const missingDate = raw(); missingDate.payload.headers = missingDate.payload.headers.filter(header => header.name !== 'Date');
  const normalized = normalizeGmailMessage(missingDate);
  const result = await inspectMailbox({client: {list: async () => ({messages: [normalized], hasMore: false}), detail: () => assert.fail('missing original date must not fetch body')},
    config: {...config, account: original, requireOriginalDate: true}, ledger: {jobs: {job}}, since: new Date(now - 3600000).toISOString(), now});
  assert.equal(result.observations.length, 0);
});
test('read adapter refuses write/foreign/attachment endpoints before accessing a token', async () => {
  let tokens = 0; const client = new GmailReadClient({getToken: () => {tokens++;}});
  for (const endpoint of ['/messages/send', '/messages/trash', 'messages/abc/modify', 'messages/abc/attachments/xyz',
    'https://evil.invalid/messages', '../other', 'users/other/messages']) {
    await assert.rejects(client.get(endpoint));
  }
  assert.equal(tokens, 0);
});
test('oversized pages, malformed headers and provider errors fail closed without response-body disclosure', async () => {
  const client = new GmailReadClient({getToken: async () => 'fixture', fetchFn: async () => ({ok: true,
    json: async () => ({messages: Array.from({length: 11}, (_, index) => ({id: String(index)}))})})});
  await assert.rejects(client.list({since: new Date(now - 3600000).toISOString(), until: at}));
  const malformed = raw(); malformed.payload.headers.push({name: 'From', value: 'other@invalid.test'});
  assert.throws(() => normalizeGmailMessage(malformed));
  const denied = new GmailReadClient({getToken: async () => 'fixture', fetchFn: async () => ({ok: false, status: 403,
    json: async () => ({error: {message: 'PRIVATE_PROVIDER_BODY', details: [{reason: 'SERVICE_DISABLED'}]}})})});
  await assert.rejects(denied.profile(), error => error.status === 403 && error.message === 'GMAIL_READ_FAILED' && error.providerReason === 'api_disabled');
});
test('plain/HTML multipart bodies are analyzed without attachments or embedded header promotion', () => {
  const message = raw(); message.payload.mimeType = 'multipart/alternative'; delete message.payload.body;
  message.payload.parts = [{mimeType: 'text/html', body: {data: Buffer.from('<p>Fictional Labs assessment REQ123</p>').toString('base64url')}},
    {mimeType: 'message/rfc822', filename: 'forward.eml', body: {data: Buffer.from('PRIVATE_ATTACHMENT').toString('base64url')}}];
  const normalized = normalizeGmailMessage(message, {detail: true});
  assert.ok(normalized.body.content.includes('assessment')); assert.ok(!normalized.body.content.includes('PRIVATE_ATTACHMENT'));
});
test('private desktop client rejects Git locations, broad file permissions, symlinks and web clients', () => fixture(async root => {
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo); fs.mkdirSync(path.join(repo, '.git'));
  const file = path.join(root, 'client.json'), value = {installed: {client_id: clientId, client_secret: 'FICTIONAL_SECRET'}};
  fs.writeFileSync(file, JSON.stringify(value), {mode: 0o600});
  assert.equal(loadGoogleDesktopClient(file, {repo}).clientId, clientId);
  fs.chmodSync(file, 0o644); assert.throws(() => loadGoogleDesktopClient(file, {repo})); fs.chmodSync(file, 0o600);
  fs.symlinkSync(file, path.join(root, 'link')); assert.throws(() => loadGoogleDesktopClient(path.join(root, 'link'), {repo}));
  const inside = path.join(repo, 'client.json'); fs.copyFileSync(file, inside); assert.throws(() => loadGoogleDesktopClient(inside, {repo}));
  fs.writeFileSync(file, JSON.stringify({web: value.installed})); assert.throws(() => loadGoogleDesktopClient(file, {repo}));
}));
test('Gmail recovery uses its own health revision and leaves Outlook state byte-identical', () => fixture(async root => {
  const h = {accountId: config.accountId, connection: null, folderScope: ['all_messages'], checkpoint: null,
    synchronization: {state: 'syncing', observedAt: at, lastSuccessfulSyncAt: null,
      coverage: {from: new Date(now - 3600000).toISOString(), through: at, complete: false}, incomplete: true, errorCategory: null},
    retry: {attempt: 0, delaySeconds: 0, nextAttemptAt: null}};
  await updateLedger(root, ledger => {ledger.mailboxHealth = {fixture: 'unchanged-outlook'};});
  await recordMailboxHealth(root, {operationId: 'fixture_run_123_start', expectedRevision: 0, health: h}, {provider: 'gmail', now: at});
  const status = inspectMailboxSyncRecovery({root, provider: 'gmail'}); assert.equal(status.runId, 'fixture_run_123');
  await abandonInterruptedMailboxSync({root, provider: 'gmail', runId: status.runId, expectedRevision: 1, workerStopped: true,
    now: new Date(now + 60000).toISOString()});
  assert.equal(read(root).gmailMailboxHealth.synchronization.state, 'failed');
  assert.deepEqual(read(root).mailboxHealth, {fixture: 'unchanged-outlook'});
}));
test('offline CLI init stores identities/credentials outside Git and cannot sign in without explicit authorization', () => fixture(async root => {
  const dataRoot = path.join(root, 'data-root'); fs.mkdirSync(dataRoot);
  const authDir = path.join(root, 'auth'), file = path.join(root, 'client.json');
  fs.writeFileSync(file, JSON.stringify({installed: {client_id: clientId, client_secret: 'FICTIONAL_SECRET'}}), {mode: 0o600});
  const env = {...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: dataRoot, CAREER_OPS_GMAIL_AUTH_DIR: authDir};
  const run = args => spawnSync(process.execPath, ['scripts/gmail-email.mjs', ...args], {env, encoding: 'utf8', timeout: 5000});
  const refused = run(['first-sync']); assert.equal(refused.status, 1); assert.match(refused.stderr, /GMAIL_CONNECTION_NOT_AUTHORIZED/);
  assert.equal(fs.existsSync(authDir), false);
  const setup = run(['init', '--client-file', file, '--account', receiving, '--application-email', original]);
  assert.equal(setup.status, 0, setup.stderr); assert.equal(fs.existsSync(ledgerFile(dataRoot)), false);
  const cfg = JSON.parse(fs.readFileSync(path.join(authDir, 'config.json')));
  assert.equal(cfg.account, receiving); assert.equal(cfg.applicationEmail, original);
  assert.ok(!JSON.stringify(cfg).includes('FICTIONAL_SECRET'));
  assert.equal(fs.statSync(path.join(authDir, 'config.json')).mode & 0o777, 0o600);
  const before = fs.readFileSync(path.join(authDir, 'config.json'));
  assert.equal(run(['preview']).status, 1);
  assert.deepEqual(fs.readFileSync(path.join(authDir, 'config.json')), before);
}));
for (const [category, text] of [
  ['application_confirmation', 'Fictional Labs received your application REQ123'],
  ['assessment', 'Fictional Labs assessment invitation REQ123'],
  ['interview', 'Fictional Labs interview invitation REQ123'],
  ['recruiter_update', 'Fictional Labs recruiter update REQ123'],
  ['rejection', 'Fictional Labs unfortunately not moving forward REQ123'],
]) test(`redirected Gmail ${category} is review-only`, () => {
  const result = analyzeMessage(normalizeGmailMessage(raw(text), {detail: true}),
    {...config, account: original, requireOriginalDate: true}, {job}, now);
  assert.equal(result.category, category); assert.equal(result.requiresReview, true); assert.equal(result.codeUseAllowed, false);
});
test('clear account-security subjects are rejected before fetching a body, even for an approved sender', async () => {
  const message = raw(); message.payload.headers.find(header => header.name === 'Subject').value = 'Fictional Labs REQ123 password reset';
  const result = await inspectMailbox({client: {list: async () => ({messages: [normalizeGmailMessage(message)], hasMore: false}),
    detail: () => assert.fail('account-security body must not be fetched')},
    config: {...config, account: original, requireOriginalDate: true}, ledger: {jobs: {job}}, since: new Date(now - 3600000).toISOString(), now});
  assert.equal(result.observations.length, 0);
});
test('Outlook and Gmail writers serialize on one ledger but maintain independent health revisions', () => fixture(async root => {
  const health = {accountId: config.accountId, connection: null, folderScope: ['all_messages'], checkpoint: null,
    synchronization: {state: 'syncing', observedAt: at, lastSuccessfulSyncAt: null, coverage: null, incomplete: true, errorCategory: null},
    retry: {attempt: 0, delaySeconds: 0, nextAttemptAt: null}};
  await Promise.all([
    recordMailboxHealth(root, {operationId: 'gmail_fixture_123', expectedRevision: 0, health}, {provider: 'gmail', now: at}),
    recordMailboxHealth(root, {operationId: 'outlook_fixture_123', expectedRevision: 0,
      health: {...health, accountId: 'outlook_fixture_123'}}, {now: at}),
  ]);
  assert.equal(read(root).mailboxHealth.revision, 1); assert.equal(read(root).gmailMailboxHealth.revision, 1);
  assert.equal(read(root).mailboxHealth.accountId, 'outlook_fixture_123');
  assert.equal(read(root).gmailMailboxHealth.accountId, config.accountId);
}));
test('Gmail account rebind is refused before authentication and legacy Outlook metadata remains independent', () => fixture(async root => {
  await updateLedger(root, ledger => {ledger.jobs.job = job;});
  const {auth, onUrl} = fakeAuth();
  await runControlledGmailSync({...options(root), auth, onUrl, clientFactory: settings => new GmailReadClient({...settings, fetchFn: graphFetch([])})});
  const before = fs.readFileSync(ledgerFile(root));
  for (const change of [{accountId: 'gmail_' + 'b'.repeat(32)}, {account: 'another@example.invalid'}, {applicationEmail: 'another@msn.invalid'}]) {
    await assert.rejects(runControlledGmailSync({...options(root), config: {...config, ...change},
      auth: {connect: () => assert.fail('must not sign in before resolving rebind')}}), e => e.code === 'SYNC_CONTEXT_CONFLICT');
  }
  assert.deepEqual(fs.readFileSync(ledgerFile(root)), before);
}));
test('Gmail duplicate detection cannot collide with Outlook IDs and does not repeat a body read', async () => {
  const message = normalizeGmailMessage(raw()), legacyKey = createHash('sha256').update(original + '\0' + message.id).digest('hex');
  const analysisConfig = {...config, account: original, requireOriginalDate: true, messageKeyNamespace: `gmail:${config.accountId}`};
  const ledger = {jobs: {job}, emailInbox: {[legacyKey]: {source: 'microsoft_graph'}}};
  let detailReads = 0;
  const request = {client: {list: async () => ({messages: [message], hasMore: false}), detail: async () => {detailReads++; return normalizeGmailMessage(raw(), {detail: true});}},
    config: analysisConfig, ledger, since: new Date(now - 3600000).toISOString(), now};
  const first = await inspectMailbox(request); assert.equal(first.observations.length, 1); assert.notEqual(first.observations[0].messageKey, legacyKey);
  ledger.emailInbox[first.observations[0].messageKey] = {source: 'gmail_api'};
  assert.equal((await inspectMailbox(request)).duplicatesSkipped, 1); assert.equal(detailReads, 1);
});
test('Google sign-in denial never exchanges codes or verifies a mailbox profile', async () => {
  let request, exchanged = false;
  const auth = createGmailAuth({clientId, clientSecret: 'FICTIONAL_SECRET',
    clientFactory: options => {
      const client = new OAuth2Client(options);
      client.generateAuthUrl = value => {request = value; return 'https://accounts.google.com/o/oauth2/v2/auth';};
      client.getToken = () => {exchanged = true; assert.fail('must not exchange denied sign-in');}; return client;
    }, profileReader: () => assert.fail('must not read a profile')});
  await assert.rejects(auth.connect(receiving, () => {setTimeout(async () => {
    const url = new URL(request.redirect_uri); url.searchParams.set('state', request.state); url.searchParams.set('error', 'access_denied'); await fetch(url);
  }, 0);}, {authorizeConnection: true}), e => e.code === 'GMAIL_SIGN_IN_FAILED');
  assert.equal(exchanged, false);
});
