import {randomUUID} from 'node:crypto';
import {ownedPath, readOwnedJson} from '../../web/src/lib/core/operational-files.mjs';
import {assertStorage} from '../../web/src/lib/core/operational-storage-contract.mjs';
import {OutlookReadClient} from './outlook-client.mjs';
import {inspectMailbox, recordMailObservations} from './application-mail.mjs';
import {mailboxHealthField} from '../career-central/operational-store.mjs';
import {runBoundedMailboxSync} from './bounded-sync.mjs';

const fail = code => Object.assign(Error(code), {code});
export function validateOutlookConfiguration(config, {requireAccountId = true} = {}) {
  if (config?.schemaVersion !== 1 || config.mode !== 'observe' || config.automaticCodeUse !== false ||
      config.automaticStatusChanges !== false || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(config.clientId || '') ||
      !/^\S+@\S+\.\S+$/.test(config.account || '') || !Array.isArray(config.rules) ||
      config.rules.some(rule => !rule || typeof rule.jobKey !== 'string' || !Array.isArray(rule.senders) ||
        rule.senders.some(sender => typeof sender !== 'string' || !/^\S+@\S+\.\S+$/.test(sender)))) throw fail('INVALID_OUTLOOK_CONFIGURATION');
  if (requireAccountId && !/^acct_[A-Za-z0-9_-]{16,96}$/.test(config.accountId || '')) throw fail('PROTECTED_ACCOUNT_ID_REQUIRED');
}

// One explicit invocation: maximum 24 hours, one page of 10 envelopes, at most
// 10 selected detail reads. No next-page follow-up, scheduler or submission path.
export async function runControlledMailboxSync({root, config, auth, interactive = false,
  mode = 'sync', since, hours = 24, clock = Date.now, onUrl,
  clientFactory = options => new OutlookReadClient(options),
  provider = 'outlook', validateConfiguration = validateOutlookConfiguration, analysisConfig = config,
  authorizeConnection = false, onSyncDiagnostic,
}) {
  validateConfiguration(config);
  const field = mailboxHealthField(provider);
  if (!['sync', 'preview'].includes(mode) || !root || !auth) throw fail('INVALID_SYNC_REQUEST');
  const end = clock();
  const start = since === undefined ? end - Number(hours) * 3600000 : Date.parse(since);
  if (!Number.isFinite(end) || !Number.isFinite(start) || start >= end || end - start > 86400000 ||
      !Number.isFinite(Number(hours)) || Number(hours) <= 0 || Number(hours) > 24) throw fail('INVALID_CONTROLLED_WINDOW');
  const until = new Date(end).toISOString();
  const ledger = readOwnedJson(ownedPath(root, 'mailbox')) ?? {schemaVersion: 1, jobs: {}, events: []};
  if (ledger.schemaVersion !== 1 || !ledger.jobs || !Array.isArray(ledger.events)) throw fail('INVALID_LEDGER');
  const previous = ledger[field] ?? null;
  if (previous) {
    if (previous.schemaVersion !== 2) throw fail('LEGACY_MAILBOX_REVIEW_REQUIRED');
    assertStorage('mailbox', previous);
    if (previous.accountId !== config.accountId || previous.folderScope.length !== 1 || previous.folderScope[0] !== 'all_messages') throw fail('SYNC_CONTEXT_CONFLICT');
    if (previous.synchronization?.state === 'syncing') throw fail('SYNC_RECONCILIATION_REQUIRED');
    if (previous.retry.nextAttemptAt && Date.parse(previous.retry.nextAttemptAt) > end) throw fail('SYNC_BACKOFF_ACTIVE');
  }
  if (interactive) {
    if (typeof onUrl !== 'function') throw fail('INTERACTIVE_CALLBACK_REQUIRED');
    await auth.connect(config.account, onUrl, {authorizeConnection});
  } else if (auth.credentialMode === 'session') throw fail('SESSION_SIGN_IN_REQUIRED');
  // Validate the account and returned delegated scopes before publishing health
  // or issuing a Graph request. The access token never enters the result/ledger.
  await auth.token(config.account);
  // This is a five-minute freshness bound on the recorded token-validation
  // observation, not the OAuth token expiry or an independent Graph probe.
  const authenticatedAt = clock();
  const boundPrevious = {...previous, accountId: config.accountId,
    folderScope: previous?.folderScope ?? ['all_messages'],
    connection: {state: 'connected', observedAt: new Date(authenticatedAt).toISOString(),
      expiresAt: new Date(authenticatedAt + 300000).toISOString(), errorCategory: null}};
  const client = clientFactory({getToken: () => auth.token(config.account), onDiagnostic: onSyncDiagnostic});
  let inspection;
  const inspect = async window => {
    inspection = await inspectMailbox({client, config: {...analysisConfig, maxPages: 1, pageSize: 10},
      ledger, ...window, now: end});
    return inspection;
  };
  let outcome;
  if (mode === 'preview') {
    const result = await inspect({since: new Date(start).toISOString(), until});
    outcome = {state: 'preview', incomplete: result.hasMore, reconciliationRequired: false};
  } else {
    outcome = await runBoundedMailboxSync({root, accountId: config.accountId, runId: randomUUID(),
      provider, onDiagnostic: onSyncDiagnostic, expectedRevision: previous?.revision ?? 0, previous: boundPrevious, since: new Date(start).toISOString(), until,
      inspect, persistObservations: observations => recordMailObservations(root, observations, {provider}),
      now: () => new Date(clock()).toISOString()});
  }
  return {mode, ...outcome, since: new Date(start).toISOString(), until,
    metadataLimit: 10, maxPages: 1, matchedObservations: inspection?.observations.length ?? 0,
    duplicatesSkipped: inspection?.duplicatesSkipped ?? 0,
    automaticCodeUse: false, automaticStatusChanges: false, submittedApplications: 0};
}
