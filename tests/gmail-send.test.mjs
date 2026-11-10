import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {OAuth2Client} from 'google-auth-library';
import {spawnSync} from 'node:child_process';
import {reviewMail, sendReviewedMail, emailStyleNotes, encodeMail} from '../lib/email/gmail-send.mjs';
import {createGmailAuth, GMAIL_SCOPES, GMAIL_REVIEWED_SEND_SCOPES, validateReviewedSendScopes, validateGmailScopes} from '../lib/email/gmail-auth.mjs';
import {updateLedger} from '../lib/applications/store.mjs';

const account = 'receiver@example.invalid', recipient = 'candidate@msn.invalid', now = Date.now();
const policy = {account, recipients: [recipient], now};
const mail = {kind: 'test', from: account, to: recipient, subject: 'Career Ops TEST', body: 'Test received.\nThanks!'};
const fixture = async fn => {const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-send-')); try {await fn(root);} finally {fs.rmSync(root, {recursive: true, force: true});}};
const read = root => JSON.parse(fs.readFileSync(path.join(root, 'data/application-automation/ledger.json')));
const request = root => {const review = reviewMail(mail, policy); return {root, review, approvedDigest: review.digest,
  ...policy, getToken: async () => 'PRIVATE_TOKEN', authorizeSending: true};};

test('review refuses header injection, extra recipients, attachments and submission kinds', () => {
  for (const change of [{to: recipient + ',other@example.invalid'}, {to: 'other@example.invalid'}, {from: recipient},
    {subject: 'Hi\r\nBcc: someone@example.invalid'}, {attachments: []}, {kind: 'application'}, {body: '\0secret'},
    {threadId: 'unexpected'}, {subject: ''}]) assert.throws(() => reviewMail({...mail, ...change}, policy), {code: 'GMAIL_DRAFT_REJECTED'});
});
test('approval and expiry checks happen before token access and reservation', () => fixture(async root => {
  for (const change of [{authorizeSending: false}, {approvedDigest: 'wrong'}, {review: {...reviewMail(mail, policy), expiresAt: now - 1}},
    {review: {...reviewMail(mail, policy), mail: {...mail, body: 'Changed after review'}}}]) {
    await assert.rejects(sendReviewedMail({...request(root), ...change, getToken: () => assert.fail('must not request a token')}));
  }
  assert.equal(fs.existsSync(path.join(root, 'data/application-automation/ledger.json')), false);
}));
test('one approved plain-text POST is durably recorded without content or status changes; replay blocked', () => fixture(async root => {
  await updateLedger(root, ledger => {ledger.jobs.job = {status: 'Evaluated'};});
  let calls = 0;
  const fetchFn = async (url, init) => {
    calls++; assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.equal(Object.values(read(root).reviewedMailSends)[0].state, 'uncertain');
    const payload = JSON.parse(init.body), mime = Buffer.from(payload.raw, 'base64url').toString();
    assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/); assert.match(mime, /Content-Transfer-Encoding: base64/);
    assert.equal(Buffer.from(mime.split('\r\n\r\n')[1].replace(/\s/g, ''), 'base64').toString(), 'Test received.\r\nThanks!');
    return {ok: true, json: async () => ({id: 'fixture_123'})};
  };
  assert.equal((await sendReviewedMail({...request(root), fetchFn})).state, 'accepted_by_gmail');
  await assert.rejects(sendReviewedMail({...request(root), fetchFn}), {code: 'GMAIL_SEND_RECONCILIATION_REQUIRED'});
  assert.equal(calls, 1); assert.equal(read(root).jobs.job.status, 'Evaluated');
  const persisted = JSON.stringify(read(root));
  for (const sensitive of [account, recipient, 'Test received', 'PRIVATE_TOKEN', 'fixture_123']) assert.equal(persisted.includes(sensitive), false);
}));
for (const outcome of ['network', 'permission', 'invalid_json', 'missing_receipt', 'server']) test(`uncertain ${outcome} outcome blocks a second POST`, () => fixture(async root => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    if (outcome === 'network') throw Error('PRIVATE_PROVIDER_BODY');
    return {ok: !['permission', 'server'].includes(outcome), status: outcome === 'permission' ? 403 : 503,
      json: async () => {if (outcome === 'invalid_json') throw Error('PRIVATE_BODY'); return {};}};
  };
  await assert.rejects(sendReviewedMail({...request(root), fetchFn}), e => /^GMAIL_SEND_/.test(e.code) && !e.message.includes('PRIVATE'));
  await assert.rejects(sendReviewedMail({...request(root), fetchFn}), {code: 'GMAIL_SEND_RECONCILIATION_REQUIRED'});
  assert.equal(calls, 1); assert.equal(Object.values(read(root).reviewedMailSends)[0].state, 'uncertain');
}));
test('concurrent approved sends serialize; only one can POST', () => fixture(async root => {
  let calls = 0;
  const fetchFn = async () => {calls++; return {ok: true, json: async () => ({id: 'fixture'})};};
  const results = await Promise.allSettled([sendReviewedMail({...request(root), fetchFn}), sendReviewedMail({...request(root), fetchFn})]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(calls, 1);
}));
test('reviewed reply encodes approved thread headers and rejects injection', () => fixture(async root => {
  const reply = {...mail, kind: 'reply', threadId: 'thread123', inReplyTo: '<original@example.invalid>', subject: 'Re: Interview'};
  const review = reviewMail(reply, policy);
  await sendReviewedMail({...request(root), review, approvedDigest: review.digest, fetchFn: async (_, init) => {
    const payload = JSON.parse(init.body), mime = Buffer.from(payload.raw, 'base64url').toString();
    assert.equal(payload.threadId, reply.threadId); assert.match(mime, /In-Reply-To: <original@example.invalid>/);
    assert.match(mime, /References: <original@example.invalid>/); return {ok: true, json: async () => ({id: 'reply123'})};
  }});
  assert.throws(() => reviewMail({...reply, inReplyTo: '<x@y.invalid>\r\nBcc: x@y.invalid'}, policy));
}));
test('send permissions are exact and cannot broaden the default read-only validator', () => {
  validateReviewedSendScopes(GMAIL_REVIEWED_SEND_SCOPES);
  for (const scopes of [GMAIL_SCOPES, [...GMAIL_REVIEWED_SEND_SCOPES, 'https://mail.google.com/'],
    [GMAIL_SCOPES[0], 'https://www.googleapis.com/auth/gmail.modify']]) assert.throws(() => validateReviewedSendScopes(scopes));
  assert.throws(() => validateGmailScopes(GMAIL_REVIEWED_SEND_SCOPES));
});
test('send OAuth requires separate authorization before opening any listener', async () => {
  const auth = createGmailAuth({purpose: 'reviewed-send', clientFactory: () => assert.fail('must not construct OAuth client')});
  await assert.rejects(auth.connect(account, () => {}, {authorizeConnection: true}), {code: 'GMAIL_SENDING_NOT_AUTHORIZED'});
});
test('reviewed-send OAuth preserves PKCE, audience/account checks and exact scopes', async () => {
  const clientId = '000000000000-fixture.apps.googleusercontent.com'; let options;
  const auth = createGmailAuth({purpose: 'reviewed-send', clientId, clock: () => now,
    profileReader: async () => ({emailAddress: account}), clientFactory: settings => {
      const client = new OAuth2Client(settings);
      client.generateAuthUrl = value => {options = value; return 'https://accounts.google.com/o/oauth2/v2/auth';};
      client.getToken = async value => {assert.ok(value.codeVerifier.length >= 43); return {tokens: {access_token: 'PRIVATE_TOKEN', expiry_date: now + 3600000, scope: GMAIL_REVIEWED_SEND_SCOPES.join(' ')}};};
      client.getTokenInfo = async () => ({scopes: GMAIL_REVIEWED_SEND_SCOPES, aud: clientId}); return client;
    }});
  try {
    await auth.connect(account, () => {setTimeout(async () => {
      assert.deepEqual(options.scope, GMAIL_REVIEWED_SEND_SCOPES); assert.equal(options.code_challenge_method, 'S256');
      assert.equal(options.include_granted_scopes, false); assert.equal(options.access_type, 'online');
      const callback = new URL(options.redirect_uri); callback.searchParams.set('state', options.state); callback.searchParams.set('code', 'fixture_code');
      assert.equal((await fetch(callback)).status, 200);
    }, 0);}, {authorizeConnection: true, authorizeSending: true});
    assert.equal(await auth.token(account), 'PRIVATE_TOKEN');
  } finally {auth.disconnect();}
  await assert.rejects(auth.token(account), {code: 'GMAIL_SIGN_IN_REQUIRED'});
});
test('style checks are advisory, do not rewrite facts, and flag canned phrasing', () => {
  assert.deepEqual(emailStyleNotes('Thanks for reaching out. Tuesday works for me.'), []);
  assert.ok(emailStyleNotes('I hope this email finds you well. Let us leverage synergy—certainly!').length >= 3);
});
test('long Unicode subject folds into valid encoded words without splitting characters', () => {
  const subject = 'Interview café 🙂 '.repeat(6);
  const mime = Buffer.from(encodeMail(reviewMail({...mail, subject}, policy).mail).raw, 'base64url').toString();
  const words = [...mime.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
  assert.ok(words.length > 1);
  assert.equal(words.map(word => Buffer.from(word[1], 'base64').toString()).join(''), subject);
  for (const word of words) assert.ok(word[0].length <= 75);
});
test('offline CLI preview needs no client credentials; noninteractive send fails before OAuth', () => fixture(async root => {
  const directory = path.join(root, 'private'); fs.mkdirSync(directory, {mode: 0o700});
  const config = {schemaVersion: 1, provider: 'gmail', mode: 'observe', account, applicationEmail: recipient,
    accountId: 'gmail_' + 'a'.repeat(32), clientFile: '/nonexistent/client.json', rules: [], automaticCodeUse: false, automaticStatusChanges: false};
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config), {mode: 0o600});
  const env = {...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_GMAIL_AUTH_DIR: directory};
  const preview = spawnSync(process.execPath, ['scripts/gmail-send.mjs', '--preview', '-d'], {env, encoding: 'utf8'});
  assert.equal(preview.status, 0, preview.stderr); assert.match(preview.stdout, /Preview only/); assert.match(preview.stdout, /Career Ops TEST/);
  assert.equal(preview.stderr, '');
  const send = spawnSync(process.execPath, ['scripts/gmail-send.mjs'], {env, encoding: 'utf8'});
  assert.equal(send.status, 1); assert.match(send.stderr, /GMAIL_INTERACTIVE_REVIEW_REQUIRED/);
  assert.equal(fs.existsSync(path.join(root, 'data/application-automation/ledger.json')), false);
}));
