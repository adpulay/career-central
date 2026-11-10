#!/usr/bin/env node
// Explicit local setup / consent-gated read-only Gmail operations. No mailbox writes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {acquireDirLock} from '../lib/dir-lock.mjs';
import {ownedPath, readOwnedJson} from '../web/src/lib/core/operational-files.mjs';
import {privateDirectory} from '../lib/email/private-storage.mjs';
import {writePrivate} from '../lib/email/outlook-auth.mjs';
import {loadGoogleDesktopClient, createGmailAuth} from '../lib/email/gmail-auth.mjs';
import {readGmailConfiguration, validateGmailConfiguration} from '../lib/email/gmail-configuration.mjs';
import {runControlledGmailSync} from '../lib/email/gmail-sync.mjs';
import {sanitizeOAuthDiagnostic} from '../lib/email/oauth-diagnostics.mjs';
import {inspectMailboxSyncRecovery, abandonInterruptedMailboxSync} from '../lib/email/sync-recovery.mjs';

const fail = code => Object.assign(Error(code), {code});
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockOptions = {timeoutMs: 5000, retryMs: 25, maxWaitMs: 5000};
async function locked(file, action) {
  const lock = await acquireDirLock(file, lockOptions);
  try {return await action();} finally {try {lock.release();} catch { /* no private path diagnostics */ }}
}
async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    account: {type: 'string'}, 'application-email': {type: 'string'}, 'client-file': {type: 'string'},
    diagnostics: {type: 'boolean', default: false}, hours: {type: 'string'}, 'authorize-connection': {type: 'boolean', default: false},
    'job-key': {type: 'string'}, sender: {type: 'string'}, 'run-id': {type: 'string'},
    'expected-revision': {type: 'string'}, 'acknowledge-worker-stopped': {type: 'boolean', default: false},
  }});
  if (positionals.length !== 1) throw fail('INVALID_GMAIL_COMMAND');
  const command = positionals[0], root = getCareerOpsRoot();
  if (command === 'recovery-status') {console.log(JSON.stringify(inspectMailboxSyncRecovery({root, provider: 'gmail'}), null, 2)); return;}
  if (command === 'abandon') {
    if (!/^\d+$/.test(values['expected-revision'] || '')) throw fail('INVALID_RECOVERY_REQUEST');
    console.log(JSON.stringify(await abandonInterruptedMailboxSync({root, provider: 'gmail', runId: values['run-id'],
      expectedRevision: Number(values['expected-revision']), workerStopped: values['acknowledge-worker-stopped']}), null, 2)); return;
  }
  if (!['init', 'trust-sender', 'first-sync', 'preview'].includes(command)) throw fail('INVALID_GMAIL_COMMAND');
  if (['first-sync', 'preview'].includes(command) && !values['authorize-connection']) throw fail('GMAIL_CONNECTION_NOT_AUTHORIZED');
  const directory = privateDirectory(process.env.CAREER_OPS_GMAIL_AUTH_DIR || path.join(os.homedir(), '.local/state/career-ops/gmail'), repo);
  const configFile = path.join(directory, 'config.json');
  if (command === 'init') {
    if (!values['client-file']) throw fail('GMAIL_DESKTOP_CLIENT_REQUIRED');
    const config = {schemaVersion: 1, provider: 'gmail', mode: 'observe', account: values.account?.toLowerCase(),
      applicationEmail: values['application-email']?.toLowerCase(), accountId: `gmail_${randomUUID().replaceAll('-', '')}`,
      clientFile: path.resolve(values['client-file']), rules: [], automaticCodeUse: false, automaticStatusChanges: false};
    validateGmailConfiguration(config);
    loadGoogleDesktopClient(config.clientFile, {repo});
    await locked(path.join(directory, 'config.lock'), () => {
      if (fs.existsSync(configFile)) throw fail('GMAIL_CONFIGURATION_EXISTS');
      writePrivate(configFile, JSON.stringify(config, null, 2) + '\n');
    });
    console.log('Private Gmail configuration saved outside Git. No connection or mailbox request made.'); return;
  }
  const config = readGmailConfiguration(configFile);
  if (command === 'trust-sender') {
    const ledger = readOwnedJson(ownedPath(root, 'mailbox'));
    if (!ledger?.jobs?.[values['job-key']] || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.sender || '')) throw fail('INVALID_SENDER_RULE');
    await locked(path.join(directory, 'config.lock'), () => {
      const fresh = readGmailConfiguration(configFile);
      let rule = fresh.rules.find(item => item.jobKey === values['job-key']);
      if (!rule) {rule = {jobKey: values['job-key'], senders: []}; fresh.rules.push(rule);}
      rule.senders = [...new Set([...rule.senders, values.sender.toLowerCase()])];
      writePrivate(configFile, JSON.stringify(fresh, null, 2) + '\n');
    });
    console.log('Exact sender rule saved for one existing application. No mailbox connection made.'); return;
  }
  const credentials = loadGoogleDesktopClient(config.clientFile, {repo});
  const auth = createGmailAuth({...credentials, onDiagnostic: values.diagnostics ? event => console.error(JSON.stringify({oauthDiagnostic: event})) : undefined});
  await locked(path.join(directory, 'session.lock'), async () => {
    try {
      const result = await runControlledGmailSync({root, config, auth, authorizeConnection: true,
        mode: command === 'preview' ? 'preview' : 'sync', hours: values.hours === undefined ? 1 : Number(values.hours),
        onUrl: url => console.log('Open this Google sign-in URL locally; keep the terminal running:\n' + url)});
      console.log(JSON.stringify(result, null, 2));
      if (result.incomplete) process.exitCode = 2;
    } finally {auth.disconnect();}
  });
}
main().catch(error => {
  const allowed = new Set(['GMAIL_CONNECTION_NOT_AUTHORIZED', 'GMAIL_CONFIGURATION_UNAVAILABLE', 'GMAIL_CONFIGURATION_EXISTS',
    'INVALID_GMAIL_CONFIGURATION', 'GMAIL_CLIENT_FILE_UNSAFE', 'GMAIL_DESKTOP_CLIENT_REQUIRED', 'GMAIL_SCOPE_REJECTED',
    'GMAIL_ACCOUNT_REJECTED', 'GMAIL_SIGN_IN_FAILED', 'INVALID_CONTROLLED_WINDOW', 'SESSION_SIGN_IN_REQUIRED',
    'SYNC_RECONCILIATION_REQUIRED', 'SYNC_CONTEXT_CONFLICT', 'SYNC_BACKOFF_ACTIVE', 'STALE_STATE_REVISION',
    'WORKER_STOP_ACKNOWLEDGMENT_REQUIRED', 'SYNC_RECOVERY_CONTEXT_CONFLICT', 'INVALID_RECOVERY_REQUEST']);
  const diagnostic = sanitizeOAuthDiagnostic(error?.oauthDiagnostic);
  console.error(JSON.stringify({error: allowed.has(error?.code) ? error.code : 'GMAIL_OPERATION_FAILED',
    ...(diagnostic ? {oauthDiagnostic: diagnostic} : {}),
    automaticStatusChanges: false, submittedApplications: 0})); process.exitCode = 1;
});
