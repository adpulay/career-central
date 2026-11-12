import {randomUUID} from 'node:crypto';
import {getCareerOpsRoot} from '../../path-resolver.mjs';
import {ownedPath, readOwnedJson} from '../../web/src/lib/core/operational-files.mjs';
import {assertStorage} from '../../web/src/lib/core/operational-storage-contract.mjs';
import {recordMailboxHealth,mailboxHealthField} from '../career-central/operational-store.mjs';

const fail = code => Object.assign(Error(code), {code});
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
function snapshot(root, provider) {
  const field = mailboxHealthField(provider);
  const ledger = readOwnedJson(ownedPath(root, 'mailbox'));
  if (!ledger) return null;
  if (ledger.schemaVersion !== 1 || !ledger.jobs || !Array.isArray(ledger.events)) throw fail('INVALID_LEDGER');
  const health = ledger[field];
  if (!health) return null;
  if (health.schemaVersion !== 2) throw fail('LEGACY_MAILBOX_REVIEW_REQUIRED');
  assertStorage('mailbox', health);
  return health;
}
function interruptedRun(health) {
  if (health?.synchronization?.state !== 'syncing') return null;
  const operation = health.provenance?.operationId;
  const match = typeof operation === 'string' && operation.match(/^([A-Za-z0-9_-]{8,128})_start$/);
  return match ? match[1] : null;
}

// Reads only bounded owner metadata, never configuration, messages or credentials.
export function inspectMailboxSyncRecovery({root = getCareerOpsRoot(), provider = 'outlook'} = {}) {
  const health = snapshot(root, provider);
  const runId = interruptedRun(health);
  return {schemaVersion: 1, revision: health?.revision ?? 0,
    state: health?.synchronization?.state ?? 'unknown',
    recoveryAvailable: Boolean(runId), runId,
    workerStoppedVerified: false,
    lastSuccessfulSyncAt: health?.synchronization?.lastSuccessfulSyncAt ?? null};
}

// Acknowledgment is a human precondition, not an independently verified lease.
// This operation never runs inspection, reads mail, or retries observation writes.
export async function abandonInterruptedMailboxSync({root = getCareerOpsRoot(), runId,
  provider = 'outlook', expectedRevision, workerStopped = false, operationId = randomUUID(),
  now = new Date().toISOString(),
} = {}) {
  if (!workerStopped) throw fail('WORKER_STOP_ACKNOWLEDGMENT_REQUIRED');
  if (!opaque(runId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw fail('INVALID_RECOVERY_REQUEST');
  const current = snapshot(root, provider);
  if (current?.revision !== expectedRevision) throw fail('STALE_STATE_REVISION');
  if (interruptedRun(current) !== runId) throw fail('SYNC_RECOVERY_CONTEXT_CONFLICT');
  const synchronization = {...current.synchronization, state: 'failed', observedAt: now,
    incomplete: true, errorCategory: 'unknown'};
  if (synchronization.coverage) synchronization.coverage = {...synchronization.coverage, complete: false};
  const result = await recordMailboxHealth(root, {operationId, expectedRevision, health: {
    accountId: current.accountId, connection: current.connection, synchronization,
    folderScope: current.folderScope, checkpoint: current.checkpoint,
    retry: {attempt: current.retry.attempt, delaySeconds: 0, nextAttemptAt: null},
  }}, {now, provider});
  return {revision: result.revision, state: 'failed', incomplete: true,
    observationsReplayed: false, checkpointAdvanced: false};
}
