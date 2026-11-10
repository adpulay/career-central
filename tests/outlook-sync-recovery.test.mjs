import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {runBoundedMailboxSync} from '../lib/email/bounded-sync.mjs';
import {inspectMailboxSyncRecovery, abandonInterruptedMailboxSync} from '../lib/email/sync-recovery.mjs';
const t0 = '2026-11-10T12:00:00.000Z', t1 = '2026-11-10T12:01:00.000Z', t2 = '2026-11-10T12:02:00.000Z';
const ledgerFile = root => path.join(root, 'data/application-automation/ledger.json');
const read = root => JSON.parse(fs.readFileSync(ledgerFile(root)));
const req = root => ({root, accountId: 'acct_fixture_123', runId: 'run_success_123', expectedRevision: 0,
  since: '2026-11-10T11:00:00.000Z', until: t0, now: () => t0,
  inspect: async () => ({observations: [], hasMore: false}), persistObservations: async () => {}});
async function fixture(use) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sync-recovery-'));
  try {await use(root);} finally {fs.rmSync(root, {recursive: true, force: true});}
}
async function interrupt(root) {
  await runBoundedMailboxSync(req(root));
  const previous = read(root).mailboxHealth;
  let ticks = 0;
  await assert.rejects(runBoundedMailboxSync({...req(root), previous, expectedRevision: 2,
    runId: 'run_interrupted_123', until: t1, now: () => {
      if (++ticks === 1) return t1;
      throw Error('simulated stop after observations committed');
    }}));
  return previous;
}
test('absent status is read-only and creates no data directories', () => fixture(async root => {
  assert.equal(inspectMailboxSyncRecovery({root}).recoveryAvailable, false);
  assert.equal(fs.existsSync(path.join(root, 'data')), false);
}));
test('interrupted run inspection is redacted and leaves ledger bytes unchanged', () => fixture(async root => {
  await interrupt(root);
  const before = fs.readFileSync(ledgerFile(root));
  const status = inspectMailboxSyncRecovery({root});
  assert.equal(status.runId, 'run_interrupted_123');
  assert.equal(status.revision, 3);
  assert.equal(status.workerStoppedVerified, false);
  assert.ok(!JSON.stringify(status).includes('acct_fixture'));
  assert.deepEqual(fs.readFileSync(ledgerFile(root)), before);
}));
test('explicit abandonment preserves evidence/checkpoint and allows a separately invoked new run', () => fixture(async root => {
  const previous = await interrupt(root);
  const before = read(root);
  const result = await abandonInterruptedMailboxSync({root, runId: 'run_interrupted_123',
    expectedRevision: 3, workerStopped: true, now: t2});
  assert.equal(result.revision, 4);
  const after = read(root);
  assert.deepEqual(after.mailboxHealth.checkpoint, previous.checkpoint);
  assert.equal(after.mailboxHealth.synchronization.lastSuccessfulSyncAt, t0);
  assert.equal(after.mailboxHealth.synchronization.incomplete, true);
  assert.deepEqual(after.events, before.events);
  assert.deepEqual(after.jobs, before.jobs);
  assert.equal(inspectMailboxSyncRecovery({root}).recoveryAvailable, false);
  await runBoundedMailboxSync({...req(root), runId: 'run_resumed_123', expectedRevision: 4,
    previous: after.mailboxHealth, until: t2, now: () => t2});
  assert.equal(read(root).mailboxHealth.revision, 6);
}));
test('missing acknowledgment, stale revision, wrong run and repeated recovery leave bytes unchanged', () => fixture(async root => {
  await interrupt(root);
  const before = fs.readFileSync(ledgerFile(root));
  const input = {root, runId: 'run_interrupted_123', expectedRevision: 3, workerStopped: true, now: t2};
  for (const [change, code] of [[{workerStopped: false}, 'WORKER_STOP_ACKNOWLEDGMENT_REQUIRED'],
    [{expectedRevision: 2}, 'STALE_STATE_REVISION'], [{runId: 'run_other_123'}, 'SYNC_RECOVERY_CONTEXT_CONFLICT']]) {
    await assert.rejects(abandonInterruptedMailboxSync({...input, ...change}), e => e.code === code);
    assert.deepEqual(fs.readFileSync(ledgerFile(root)), before);
  }
  await abandonInterruptedMailboxSync(input);
  const recovered = fs.readFileSync(ledgerFile(root));
  await assert.rejects(abandonInterruptedMailboxSync(input), e => e.code === 'STALE_STATE_REVISION');
  assert.deepEqual(fs.readFileSync(ledgerFile(root)), recovered);
}));
test('two concurrent recoveries cannot both commit', () => fixture(async root => {
  await interrupt(root);
  const input = {root, runId: 'run_interrupted_123', expectedRevision: 3, workerStopped: true, now: t2};
  const results = await Promise.allSettled([abandonInterruptedMailboxSync(input), abandonInterruptedMailboxSync(input)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'STALE_STATE_REVISION').length, 1);
}));
test('CLI respects data-root override and redacts invalid ledger contents', () => fixture(async root => {
  const run = args => spawnSync(process.execPath, ['scripts/outlook-sync-recovery.mjs', ...args],
    {encoding: 'utf8', env: {...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root}});
  const status = run(['status']);
  assert.equal(status.status, 0);
  assert.equal(JSON.parse(status.stdout).revision, 0);
  assert.equal(fs.existsSync(path.join(root, 'data')), false);
  fs.mkdirSync(path.dirname(ledgerFile(root)), {recursive: true});
  fs.writeFileSync(ledgerFile(root), 'PRIVATE_LEDGER_CONTENT');
  const invalid = run(['status']);
  assert.equal(invalid.status, 2);
  assert.ok(!invalid.stderr.includes('PRIVATE_LEDGER_CONTENT'));
}));
test('CLI abandonment requires acknowledgment and mutates only the selected fictional data root', () => fixture(async root => {
  await interrupt(root);
  const args = ['scripts/outlook-sync-recovery.mjs', 'abandon', '--run-id', 'run_interrupted_123', '--expected-revision', '3'];
  const options = {encoding: 'utf8', env: {...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root}};
  const before = fs.readFileSync(ledgerFile(root));
  const refused = spawnSync(process.execPath, args, options);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /WORKER_STOP_ACKNOWLEDGMENT_REQUIRED/);
  assert.deepEqual(fs.readFileSync(ledgerFile(root)), before);
  const accepted = spawnSync(process.execPath, [...args, '--acknowledge-worker-stopped'], options);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).checkpointAdvanced, false);
  assert.equal(read(root).mailboxHealth.synchronization.state, 'failed');
}));
test('legacy mailbox metadata requires review and is never migrated by recovery', () => fixture(async root => {
  fs.mkdirSync(path.dirname(ledgerFile(root)), {recursive: true});
  const bytes = JSON.stringify({schemaVersion: 1, jobs: {}, events: [], mailboxHealth: {schemaVersion: 1}});
  fs.writeFileSync(ledgerFile(root), bytes);
  assert.throws(() => inspectMailboxSyncRecovery({root}), e => e.code === 'LEGACY_MAILBOX_REVIEW_REQUIRED');
  await assert.rejects(abandonInterruptedMailboxSync({root, runId: 'run_interrupted_123', expectedRevision: 1,
    workerStopped: true}), e => e.code === 'LEGACY_MAILBOX_REVIEW_REQUIRED');
  assert.equal(fs.readFileSync(ledgerFile(root), 'utf8'), bytes);
}));
