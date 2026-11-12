#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {privateDirectory} from '../lib/email/private-storage.mjs';
import {writePrivate} from '../lib/email/outlook-auth.mjs';
import {readGmailConfiguration} from '../lib/email/gmail-configuration.mjs';
import {createGmailAuth, loadGoogleDesktopClient} from '../lib/email/gmail-auth.mjs';
import {GmailReadClient} from '../lib/email/gmail-client.mjs';
import {collectReplyContext} from '../lib/email/gmail-reply.mjs';
import {ownedPath, readOwnedJson} from '../web/src/lib/core/operational-files.mjs';
import {sanitizeOAuthDiagnostic} from '../lib/email/oauth-diagnostics.mjs';
import {sanitizeGmailDiagnostic} from '../lib/email/gmail-diagnostics.mjs';

const fail = code => Object.assign(Error(code), {code});
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function main() {
  const {values} = parseArgs({options: {'authorize-connection': {type: 'boolean', short: 'a', default: false}, 'job-key': {type: 'string'}}});
  if (!values['authorize-connection']) throw fail('GMAIL_CONNECTION_NOT_AUTHORIZED');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw fail('GMAIL_INTERACTIVE_REVIEW_REQUIRED');
  const root = getCareerOpsRoot(), directory = privateDirectory(process.env.CAREER_OPS_GMAIL_AUTH_DIR || path.join(os.homedir(), '.local/state/career-ops/gmail'), repo);
  const config = readGmailConfiguration(path.join(directory, 'config.json'));
  const ledger = readOwnedJson(ownedPath(root, 'mailbox')) ?? {jobs: {}};
  const jobKey = values['job-key'];
  if (jobKey && (!ledger.jobs?.[jobKey] || !config.rules.some(rule => rule.jobKey === jobKey))) throw fail('GMAIL_REPLY_JOB_UNAVAILABLE');
  const auth = createGmailAuth(loadGoogleDesktopClient(config.clientFile, {repo}));
  try {
    await auth.connect(config.account, url => console.log('Open this Google URL locally; keep the terminal running:\n' + url), {authorizeConnection: true});
    const result = await collectReplyContext({client: new GmailReadClient({getToken: () => auth.token(config.account)}),
      config, ledger, jobKey, authorizeConnection: true, select: async choices => {
        // Sanitize terminal control characters; content remains untrusted data.
        choices.forEach((choice, index) => console.log(`${index + 1}. ${choice.subject.replace(/[\x00-\x1f\x7f-\x9f]/g, '')}`));
        const terminal = createInterface({input: process.stdin, output: process.stdout});
        try {const answer = await terminal.question('Read one message for reply review (number, or Enter to cancel): ');
          return /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
        } finally {terminal.close();}
      }});
    if (result.context) {
      const contextFile = path.join(directory, jobKey ? 'reply-context.json' : 'test-reply-context.json');
      writePrivate(contextFile, JSON.stringify(result.context, null, 2) + '\n');
      if (!jobKey) {
        const draft = {...result.context.draft, body: 'Thanks, I got your reply. The email connection is working.'};
        writePrivate(path.join(directory, 'test-reply.json'), JSON.stringify(draft, null, 2) + '\n');
      }
      console.log(jobKey ? 'Private reply context saved. Ask the assistant to draft from it using your personal writing profile.' :
        'Test acknowledgment prepared. Preview it with: npm run gmail:send -- --test-reply --preview');
    }
    const {context, ...summary} = result;
    console.log(JSON.stringify({...summary, bodiesRead: context ? 1 : 0, automaticReplies: false, automaticStatusChanges: false, submittedApplications: 0}));
  } finally {auth.disconnect();}
}
main().catch(error => {
  const codes = ['GMAIL_CONNECTION_NOT_AUTHORIZED', 'GMAIL_INTERACTIVE_REVIEW_REQUIRED', 'GMAIL_REPLY_JOB_UNAVAILABLE',
    'GMAIL_REPLY_SELECTION_CANCELLED', 'GMAIL_REPLY_IDENTITY_REJECTED', 'GMAIL_REPLY_SECURITY_EXCLUDED', 'GMAIL_REPLY_CONTEXT_UNMATCHED',
    'GMAIL_SIGN_IN_FAILED', 'GMAIL_SCOPE_REJECTED', 'GMAIL_ACCOUNT_REJECTED'];
  const oauthDiagnostic = sanitizeOAuthDiagnostic(error?.oauthDiagnostic), syncDiagnostic = sanitizeGmailDiagnostic(error?.gmailDiagnostic);
  console.error(JSON.stringify({error: codes.includes(error?.code) ? error.code : 'GMAIL_REPLY_FAILED',
    ...(oauthDiagnostic ? {oauthDiagnostic} : {}), ...(syncDiagnostic ? {syncDiagnostic} : {}), automaticReplies: false, submittedApplications: 0}));
  process.exitCode = 1;
});
