import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runBoundedMailboxSync} from '../lib/email/bounded-sync.mjs';
const at = '2026-11-10T12:00:00.000Z';
const health = root => JSON.parse(fs.readFileSync(path.join(root, 'data/application-automation/ledger.json'))).mailboxHealth;
async function fixture(use) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sync-'));
  try { await use(root); } finally { fs.rmSync(root, {recursive: true, force: true}); }
}
const request = root => ({root, accountId: 'acct_fixture_123', runId: 'run_fixture_123', expectedRevision: 0,
  since: '2026-11-10T11:00:00.000Z', until: at, now: () => at,
  inspect: async () => ({observations: [], hasMore: false}), persistObservations: async () => {}});
test('checkpoint publication follows observation persistence through the actual owner writer', () => fixture(async root => {
  const input = request(root);
  input.persistObservations = async () => {
    assert.equal(health(root).synchronization.state, 'syncing');
    assert.equal(health(root).checkpoint, null);
  };
  assert.deepEqual(await runBoundedMailboxSync(input), {state: 'idle', incomplete: false, reconciliationRequired: false});
  assert.equal(health(root).revision, 2);
  assert.equal(health(root).checkpoint.coverage.complete, true);
  assert.deepEqual(health(root).folderScope, ['all_messages']);
}));
test('partial window preserves the last successful checkpoint', () => fixture(async root => {
  await runBoundedMailboxSync(request(root));
  const previous = health(root);
  await runBoundedMailboxSync({...request(root), previous, expectedRevision: 2, runId: 'run_fixture_456',
    inspect: async () => ({observations: [], hasMore: true})});
  assert.deepEqual(health(root).checkpoint, previous.checkpoint);
  assert.equal(health(root).synchronization.incomplete, true);
  assert.equal(health(root).synchronization.lastSuccessfulSyncAt, at);
}));
test('throttling is redacted, records failure and performs no retry', () => fixture(async root => {
  let calls = 0;
  const result = await runBoundedMailboxSync({...request(root), inspect: async () => {
    calls++; throw Object.assign(Error('PRIVATE_BODY_AND_TOKEN'), {status: 429});
  }, persistObservations: async () => assert.fail('unexpected observation write')});
  assert.equal(calls, 1);
  assert.equal(result.errorCategory, 'rate_limited');
  assert.equal(health(root).checkpoint, null);
  assert.ok(!JSON.stringify(health(root)).includes('PRIVATE'));
}));
test('uncertain observation write never advances checkpoint or repeats processing on replay', () => fixture(async root => {
  let inspections = 0;
  const input = {...request(root), inspect: async () => {inspections++; return {observations: [], hasMore: false};},
    persistObservations: async () => {throw Error('PRIVATE_STORAGE_ERROR');}};
  const result = await runBoundedMailboxSync(input);
  assert.equal(result.reconciliationRequired, true);
  assert.equal(health(root).checkpoint, null);
  await assert.rejects(runBoundedMailboxSync(input), e => e.code === 'SYNC_RECONCILIATION_REQUIRED');
  assert.equal(inspections, 1);
}));
test('context switches, unbounded windows and future coverage are rejected before writes', () => fixture(async root => {
  for (const change of [{until: '2027-01-01T00:00:00Z'}, {since: '2026-01-01T00:00:00Z'},
    {previous: {accountId: 'acct_other_123', folderScope: ['all_messages']}}]) {
    await assert.rejects(runBoundedMailboxSync({...request(root), ...change}));
  }
  assert.equal(fs.existsSync(path.join(root, 'data')), false);
}));
test('completed-run replay and stale revisions never inspect again', () => fixture(async root => {
  let calls = 0;
  const input = {...request(root), inspect: async () => {calls++; return {observations: [], hasMore: false};}};
  await runBoundedMailboxSync(input);
  const before = JSON.stringify(health(root));
  await assert.rejects(runBoundedMailboxSync(input), e => e.code === 'SYNC_RECONCILIATION_REQUIRED');
  await assert.rejects(runBoundedMailboxSync({...input, runId: 'run_stale_123'}), e => e.code === 'STALE_STATE_REVISION');
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(health(root)), before);
}));
test('malformed inspection results cannot persist observations or claim complete coverage', () => fixture(async root => {
  const result = await runBoundedMailboxSync({...request(root),
    inspect: async () => ({observations: [], hasMore: 'false'}),
    persistObservations: async () => assert.fail('unexpected persistence')});
  assert.equal(result.state, 'failed');
  assert.equal(health(root).checkpoint, null);
}));
test('lost final publication retains incomplete state and never replays observation writes', () => fixture(async root => {
  const {recordMailboxHealth} = await import('../lib/career-central/operational-store.mjs');
  let writes = 0;
  const input = {...request(root), persistObservations: async () => {
    writes++;
    const current = health(root);
    await recordMailboxHealth(root, {operationId: 'other_writer_123', expectedRevision: 1,
      health: {accountId: current.accountId, connection: null,
        synchronization: {state: 'syncing', observedAt: at, lastSuccessfulSyncAt: null,
          coverage: {from: input.since, through: at, complete: false}, incomplete: true, errorCategory: null},
        folderScope: ['all_messages'], checkpoint: null,
        retry: {attempt: 0, delaySeconds: 0, nextAttemptAt: null}}}, {now: at});
  }};
  await assert.rejects(runBoundedMailboxSync(input), e => e.code === 'STALE_STATE_REVISION');
  assert.equal(health(root).checkpoint, null);
  assert.equal(health(root).synchronization.state, 'syncing');
  await assert.rejects(runBoundedMailboxSync(input), e => e.code === 'SYNC_RECONCILIATION_REQUIRED');
  assert.equal(writes, 1);
}));
test('existing analyzer and observation writer preserve review-only evidence and bounded coverage', () => fixture(async root => {
  const {inspectMailbox, recordMailObservations} = await import('../lib/email/application-mail.mjs');
  const {updateLedger} = await import('../lib/applications/store.mjs');
  const job = {key: 'fixture-job', company: 'Fictional Labs', requisitionId: 'REQ123',
    status: 'Awaiting Approval', createdAt: '2026-11-10T10:00:00.000Z'};
  await updateLedger(root, ledger => {ledger.jobs[job.key] = job;});
  const ledger = {jobs: {[job.key]: job}};
  const config = {account: 'candidate@example.invalid', rules: [{jobKey: job.key, senders: ['hiring@example.invalid']}]};
  const message = {id: 'immutable-fixture-123', subject: 'Fictional Labs REQ123 application received',
    from: {emailAddress: {address: 'hiring@example.invalid'}},
    toRecipients: [{emailAddress: {address: config.account}}], receivedDateTime: '2026-11-10T11:30:00.000Z',
    body: {content: 'PRIVATE_BODY_FIXTURE'}};
  const client = {
    async list(window) {assert.equal(window.until, at); return {messages: [message], hasMore: false};},
    async detail(id) {assert.equal(id, message.id); return message;},
  };
  await runBoundedMailboxSync({...request(root),
    inspect: window => inspectMailbox({client, config, ledger, ...window, now: Date.parse(at)}),
    persistObservations: observations => recordMailObservations(root, observations)});
  const bytes = fs.readFileSync(path.join(root, 'data/application-automation/ledger.json'), 'utf8');
  const saved = JSON.parse(bytes);
  assert.equal(saved.jobs[job.key].status, 'Awaiting Approval');
  assert.equal(Object.keys(saved.emailInbox).length, 1);
  assert.equal(Object.values(saved.emailInbox)[0].requiresReview, true);
  assert.equal(Object.values(saved.emailInbox)[0].codeUseAllowed, false);
  assert.ok(!bytes.includes('PRIVATE_BODY_FIXTURE'));
  assert.ok(!JSON.stringify(saved.mailboxHealth).includes('Fictional Labs'));
  assert.equal(saved.mailboxHealth.checkpoint.coverage.complete, true);
}));
test('an outstanding backoff blocks inspection before any owner-store write', () => fixture(async root => {
  await assert.rejects(runBoundedMailboxSync({...request(root), previous: {
    accountId: 'acct_fixture_123', folderScope: ['all_messages'],
    retry: {attempt: 1, delaySeconds: 60, nextAttemptAt: '2026-11-10T12:01:00.000Z'},
  }, inspect: async () => assert.fail('backoff must prevent inspection')}), e => e.code === 'SYNC_BACKOFF_ACTIVE');
  assert.equal(fs.existsSync(path.join(root, 'data')), false);
}));
