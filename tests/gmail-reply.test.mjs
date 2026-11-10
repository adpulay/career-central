import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReplyContext, TEST_SUBJECT} from '../lib/email/gmail-reply.mjs';
import {GmailReadClient} from '../lib/email/gmail-client.mjs';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const now = Date.parse('2026-11-10T12:00:00Z');
const account = 'receiver@example.invalid', original = 'candidate@msn.invalid', recruiter = 'hiring@employer.invalid';
const addr = address => ({emailAddress: {address}});
const config = {account, applicationEmail: original, rules: [{jobKey: 'job', senders: [recruiter]}]};
const ledger = {jobs: {job: {key: 'job', company: 'Fictional Labs', requisitionId: 'REQ123', createdAt: '2026-11-10T10:00:00Z', status: 'Evaluated'}}};
const message = {id: 'fixture123', subject: 'Re: ' + TEST_SUBJECT, from: addr(original), toRecipients: [addr(account)],
  receivedDateTime: '2026-11-10T11:59:00.000Z', originalReceivedDateTime: '2026-11-10T11:59:00.000Z',
  isDraft: false, threadId: 'thread123', internetMessageId: '<original@msn.invalid>', body: {content: 'Test received.\n\nOriginal quoted test: No verification code is needed.'}};
function options(overrides = {}) {
  let calls = 0;
  return {now, config, ledger, authorizeConnection: true, select: async () => 0,
    client: {list: async args => {assert.equal(args.maxPages, 1); assert.equal(args.pageSize, 10);
      assert.equal(Date.parse(args.until) - Date.parse(args.since), 3600000); return {messages: [message], hasMore: false};},
    replyDetail: async id => {calls++; assert.equal(calls, 1); assert.equal(id, message.id); return message;}}, ...overrides};
}

test('reply context requires connection authorization before any mailbox request', async () => {
  await assert.rejects(collectReplyContext(options({authorizeConnection: false, client: {list: () => assert.fail()}})), {code: 'GMAIL_CONNECTION_NOT_AUTHORIZED'});
});
test('test round trip reads one selected message and consumes only the fixed acknowledgment', async () => {
  const before = JSON.stringify(ledger);
  const result = await collectReplyContext(options());
  assert.equal(result.state, 'context_ready'); assert.equal(result.context.untrustedContent, 'Test received.');
  assert.equal(result.context.draft.to, original); assert.equal(result.context.draft.threadId, 'thread123');
  assert.equal(result.context.draft.body, ''); assert.equal(result.context.requiresReview, true);
  assert.equal(JSON.stringify(ledger), before);
});
test('test mode rejects unrelated subjects, senders, drafts and out-of-window metadata before body reads', async () => {
  for (const changes of [{subject: 'Password reset'}, {subject: 'An unrelated email'}, {from: addr(recruiter)},
    {sender: addr(recruiter)}, {toRecipients: [addr(original)]}, {isDraft: true}, {receivedDateTime: '2026-11-10T10:00:00Z'}]) {
    const result = await collectReplyContext(options({client: {list: async () => ({messages: [{...message, ...changes}], hasMore: false}), replyDetail: () => assert.fail()}}));
    assert.equal(result.state, 'no_eligible_reply');
  }
});
test('partial page remains incomplete without following a cursor', async () => {
  const result = await collectReplyContext(options({client: {list: async () => ({messages: [], hasMore: true}), replyDetail: () => assert.fail()}}));
  assert.equal(result.incomplete, true);
});
test('oversized page and cancelled selection cannot fetch a body', async () => {
  await assert.rejects(collectReplyContext(options({client: {list: async () => ({messages: Array(11).fill(message), hasMore: true}), replyDetail: () => assert.fail()}})), {code: 'GMAIL_REPLY_PAGE_REJECTED'});
  await assert.rejects(collectReplyContext(options({select: async () => -1, client: {list: async () => ({messages: [message], hasMore: false}), replyDetail: () => assert.fail()}})), {code: 'GMAIL_REPLY_SELECTION_CANCELLED'});
});
test('body response must match selected identity, timestamp, subject and sender', async () => {
  for (const changes of [{id: 'different'}, {from: addr(recruiter)}, {subject: 'Different'}, {receivedDateTime: '2026-11-10T11:58:00Z'}]) {
    await assert.rejects(collectReplyContext(options({client: {list: async () => ({messages: [message], hasMore: false}),
      replyDetail: async () => ({...message, ...changes})}})), {code: 'GMAIL_REPLY_IDENTITY_REJECTED'});
  }
});
const recruiting = {...message, from: addr(recruiter), subject: 'Fictional Labs interview REQ123', body: {content: 'Fictional Labs REQ123: Could we schedule an interview?'}};
const recruitingOptions = changes => options({jobKey: 'job', client: {list: async () => ({messages: [recruiting], hasMore: false}), replyDetail: async () => ({...recruiting, ...changes})}});
test('direct Gmail recruiting mail reuses application matching and preserves job status', async () => {
  const result = await collectReplyContext(recruitingOptions());
  assert.equal(result.context.category, 'interview'); assert.equal(result.context.jobKey, 'job');
  assert.equal(result.context.draft.to, recruiter); assert.equal(ledger.jobs.job.status, 'Evaluated');
});
test('redirected recruiting mail may retain original application recipient', async () => {
  const redirected = {...recruiting, toRecipients: [addr(original)]};
  const result = await collectReplyContext(options({jobKey: 'job', client: {list: async () => ({messages: [redirected], hasMore: false}), replyDetail: async () => redirected}}));
  assert.equal(result.state, 'context_ready');
});
test('unknown jobs fail before mailbox access', async () => {
  await assert.rejects(collectReplyContext(options({jobKey: 'missing', client: {list: () => assert.fail()}})), {code: 'GMAIL_REPLY_JOB_UNAVAILABLE'});
});
test('security and code-containing recruiting messages never produce drafting context', async () => {
  for (const body of ['Your verification code is 123456', 'Password reset', 'Google account recovery', 'Your one-time code: 123456']) {
    await assert.rejects(collectReplyContext(recruitingOptions({body: {content: body}})), {code: 'GMAIL_REPLY_SECURITY_EXCLUDED'});
  }
});
test('numeric strings are redacted from private drafting context', async () => {
  const result = await collectReplyContext(recruitingOptions({body: {content: 'Fictional Labs REQ123 interview, reference 123456'}}));
  assert.equal(result.context.untrustedContent.includes('123456'), false);
});
function raw(extraHeaders = []) {
  return {id: 'fixture123', threadId: 'thread123', internalDate: String(now - 60000), payload: {mimeType: 'text/plain',
    headers: [{name: 'From', value: original}, {name: 'To', value: account}, {name: 'Subject', value: 'Re: ' + TEST_SUBJECT},
      {name: 'Message-ID', value: '<original@msn.invalid>'}, ...extraHeaders], body: {data: Buffer.from('Test received.').toString('base64url')}}};
}
test('reply detail GET captures thread metadata without introducing write endpoints', async () => {
  const client = new GmailReadClient({getToken: async () => 'PRIVATE_TOKEN', fetchFn: async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.ok(new URL(url).searchParams.get('fields').includes('threadId'));
    return {ok: true, json: async () => raw()};
  }});
  const result = await client.replyDetail('fixture123'); assert.equal(result.internetMessageId, '<original@msn.invalid>');
  assert.equal(result.threadId, 'thread123');
});
test('alternate Reply-To, duplicate Message-ID and header injection are refused', async () => {
  for (const headers of [[{name: 'Reply-To', value: 'attacker@example.invalid'}], [{name: 'Message-ID', value: '<second@example.invalid>'}],
    [{name: 'Reply-To', value: original + ',other@example.invalid'}]]) {
    const client = new GmailReadClient({getToken: async () => 'PRIVATE_TOKEN', fetchFn: async () => ({ok: true, json: async () => raw(headers)})});
    await assert.rejects(client.replyDetail('fixture123'));
  }
});
test('reply CLI cannot connect without explicit authorization or interactive review', () => {
  const denied = spawnSync(process.execPath, ['scripts/gmail-reply.mjs'], {encoding: 'utf8'});
  assert.equal(denied.status, 1); assert.match(denied.stderr, /GMAIL_CONNECTION_NOT_AUTHORIZED/);
  const noninteractive = spawnSync(process.execPath, ['scripts/gmail-reply.mjs', '-a'], {encoding: 'utf8'});
  assert.equal(noninteractive.status, 1); assert.match(noninteractive.stderr, /GMAIL_INTERACTIVE_REVIEW_REQUIRED/);
});
test('prepared test reply previews only matching private context and rejects changed content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-roundtrip-'));
  try {
    const privateDir = path.join(root, 'private'); fs.mkdirSync(privateDir, {mode: 0o700});
    const write = (name, value) => fs.writeFileSync(path.join(privateDir, name), JSON.stringify(value), {mode: 0o600});
    write('config.json', {...config, schemaVersion: 1, provider: 'gmail', mode: 'observe',
      accountId: 'gmail_' + 'a'.repeat(32), clientFile: '/missing/client.json', automaticCodeUse: false, automaticStatusChanges: false});
    const draft = {kind: 'reply', from: account, to: original, subject: 'Re: ' + TEST_SUBJECT, body: '', threadId: 'thread123', inReplyTo: '<original@msn.invalid>'};
    write('test-reply-context.json', {purpose: 'connection_test', draft});
    const outgoing = {...draft, body: 'Thanks, I got your reply. The email connection is working.'};
    write('test-reply.json', outgoing);
    const run = () => spawnSync(process.execPath, ['scripts/gmail-send.mjs', '--test-reply', '--preview'],
      {env: {...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_GMAIL_AUTH_DIR: privateDir}, encoding: 'utf8'});
    const good = run(); assert.equal(good.status, 0, good.stderr); assert.match(good.stdout, /Preview only/);
    for (const change of [{body: 'Changed'}, {to: recruiter}, {threadId: 'changed'}]) {
      write('test-reply.json', {...outgoing, ...change}); const bad = run(); assert.equal(bad.status, 1); assert.match(bad.stderr, /GMAIL_DRAFT_REJECTED/);
    }
    assert.equal(fs.existsSync(path.join(root, 'data/application-automation/ledger.json')), false);
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});
