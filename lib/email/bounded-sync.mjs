import {recordMailboxHealth,mailboxHealthField} from '../career-central/operational-store.mjs';

const fail = code => Object.assign(Error(code), {code});
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);

// Explicit local orchestration only. Callers supply inspection and observation
// persistence capabilities; this module cannot authenticate or create a client.
// No automatic retry: replay/interrupted runs require explicit reconciliation.
export async function runBoundedMailboxSync({root, accountId, runId, expectedRevision,
  previous = null, since, until, inspect, persistObservations, provider = 'outlook',
  now = () => new Date().toISOString(),
}) {
  mailboxHealthField(provider);
  const from = Date.parse(since), through = Date.parse(until);
  if (!root || !opaque(accountId) || !opaque(runId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !Number.isFinite(from) || !Number.isFinite(through) || from > through || through - from > 31 * 86400000 ||
      typeof inspect !== 'function' || typeof persistObservations !== 'function') throw fail('INVALID_SYNC_REQUEST');
  const startedAt = now();
  if (!Number.isFinite(Date.parse(startedAt)) || through > Date.parse(startedAt)) throw fail('INVALID_SYNC_WINDOW');
  if (previous && (previous.accountId !== accountId || previous.folderScope?.length !== 1 || previous.folderScope[0] !== 'all_messages')) throw fail('SYNC_CONTEXT_CONFLICT');
  if (previous?.synchronization?.state === 'syncing') throw fail('SYNC_RECONCILIATION_REQUIRED');
  if (previous?.retry?.nextAttemptAt && Date.parse(previous.retry.nextAttemptAt) > Date.parse(startedAt)) throw fail('SYNC_BACKOFF_ACTIVE');
  const coverage = {from: new Date(from).toISOString(), through: new Date(through).toISOString(), complete: false};
  const base = {
    accountId,
    connection: previous?.connection ?? null,
    folderScope: ['all_messages'],
    checkpoint: previous?.checkpoint ?? null,
    retry: {attempt: previous?.retry?.attempt ?? 0, delaySeconds: 0, nextAttemptAt: null},
  };
  const sync = (state, observedAt, errorCategory = null) => ({state, observedAt,
    lastSuccessfulSyncAt: previous?.synchronization?.lastSuccessfulSyncAt ?? null,
    coverage: {...coverage}, incomplete: true, errorCategory});
  const publish = (suffix, revision, health, at) => recordMailboxHealth(root,
    {operationId: `${runId}_${suffix}`, expectedRevision: revision, health}, {now: at, provider});
  const started = await publish('start', expectedRevision,
    {...base, synchronization: sync('syncing', startedAt)}, startedAt);
  if (started.replayed) throw fail('SYNC_RECONCILIATION_REQUIRED');

  let result;
  let phase = 'inspection';
  try {
    result = await inspect({since: coverage.from, until: coverage.through});
    if (!result || !Array.isArray(result.observations) || result.observations.length > 1000 || typeof result.hasMore !== 'boolean') throw fail('INVALID_SYNC_RESULT');
    phase = 'persistence';
    await persistObservations(result.observations);
  } catch (error) {
    const finishedAt = now();
    const category = phase === 'inspection'
      ? ({401: 'authentication_required', 403: 'permission_denied', 429: 'rate_limited'}[error?.status] ?? 'provider')
      : 'unknown';
    // A persistence acknowledgement can be lost after commit. Preserve the old
    // checkpoint and report uncertainty; never repeat observations here.
    await publish('failed', started.revision, {...base,
      synchronization: sync('failed', finishedAt, category)}, finishedAt);
    return {state: 'failed', incomplete: true, errorCategory: category,
      reconciliationRequired: phase === 'persistence'};
  }
  const finishedAt = now();
  const synchronization = sync('idle', finishedAt);
  if (!result.hasMore) {
    synchronization.incomplete = false;
    synchronization.coverage.complete = true;
    synchronization.lastSuccessfulSyncAt = finishedAt;
  }
  const complete = !result.hasMore;
  // Observation commit precedes checkpoint publication. If publication fails,
  // propagate its category-only owner-store error; never infer rollback/retry.
  await publish('finish', started.revision, {...base, synchronization,
    checkpoint: complete ? {id: runId, completedAt: finishedAt,
      coverage: {...coverage, complete: true}, folderScope: ['all_messages']} : base.checkpoint,
    retry: complete ? {attempt: 0, delaySeconds: 0, nextAttemptAt: null} : base.retry,
  }, finishedAt);
  return {state: 'idle', incomplete: !complete, reconciliationRequired: false};
}
