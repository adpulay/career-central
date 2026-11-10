#!/usr/bin/env node
// User-operated review/send only. Importing this script is not a worker hook.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {readPrivate} from '../lib/email/outlook-auth.mjs';
import {privateDirectory} from '../lib/email/private-storage.mjs';
import {readGmailConfiguration} from '../lib/email/gmail-configuration.mjs';
import {createGmailAuth, loadGoogleDesktopClient} from '../lib/email/gmail-auth.mjs';
import {reviewMail, sendReviewedMail, emailStyleNotes} from '../lib/email/gmail-send.mjs';
import {ownedPath, readOwnedJson} from '../web/src/lib/core/operational-files.mjs';
import {sanitizeOAuthDiagnostic} from '../lib/email/oauth-diagnostics.mjs';

const fail = code => Object.assign(Error(code), {code});
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function main() {
  const {values} = parseArgs({options: {draft: {type: 'string'}, 'job-key': {type: 'string'}, 'test-reply': {type: 'boolean', default: false}, preview: {type: 'boolean', default: false}}});
  const root = getCareerOpsRoot();
  const directory = privateDirectory(process.env.CAREER_OPS_GMAIL_AUTH_DIR || path.join(os.homedir(), '.local/state/career-ops/gmail'), repo);
  const config = readGmailConfiguration(path.join(directory, 'config.json'));
  let mail, recipients;
  if (values['test-reply']) {
    if (values.draft || values['job-key']) throw fail('GMAIL_DRAFT_REJECTED');
    mail = JSON.parse(readPrivate(path.join(directory, 'test-reply.json')));
    const context = JSON.parse(readPrivate(path.join(directory, 'test-reply-context.json')));
    const expected = {...context.draft, body: 'Thanks, I got your reply. The email connection is working.'};
    if (context.purpose !== 'connection_test' || context.draft?.from !== config.account || context.draft?.to !== config.applicationEmail ||
        JSON.stringify(mail) !== JSON.stringify(expected)) throw fail('GMAIL_DRAFT_REJECTED');
    recipients = [config.applicationEmail];
  } else if (values.draft) {
    // Only private absolute files outside every Git checkout; no mailbox imports.
    if (!path.isAbsolute(values.draft)) throw fail('GMAIL_DRAFT_REJECTED');
    let cursor = values.draft;
    for (;;) {
      if (fs.lstatSync(cursor).isSymbolicLink() || fs.existsSync(path.join(cursor, '.git'))) throw fail('GMAIL_DRAFT_REJECTED');
      if (cursor === path.dirname(cursor)) break;
      cursor = path.dirname(cursor);
    }
    mail = JSON.parse(readPrivate(values.draft));
    const job = readOwnedJson(ownedPath(root, 'mailbox'))?.jobs?.[values['job-key']];
    recipients = config.rules.find(rule => rule.jobKey === values['job-key'])?.senders;
    if (!job || mail.kind !== 'reply' || !recipients?.length) throw fail('GMAIL_DRAFT_REJECTED');
  } else {
    recipients = [config.applicationEmail];
    mail = {kind: 'test', from: config.account, to: config.applicationEmail,
      subject: 'Career Ops TEST: email connection',
      body: 'This is a Career Ops email test. No application was submitted.\n\nPlease reply with: Test received.\n\nNo verification code or personal information is needed.'};
  }
  const review = reviewMail(mail, {account: config.account, recipients});
  // The preview intentionally displays the exact outbound content locally.
  // Diagnostics and shared records never contain it.
  console.log(`From: ${review.mail.from}\nTo: ${review.mail.to}\nSubject: ${review.mail.subject}\n\n${review.mail.body}\n`);
  if (review.mail.kind === 'reply') console.log('Thread headers are supplied by the private draft. Confirm the recipient and original thread in Gmail before sending.');
  for (const note of emailStyleNotes(review.mail.body)) console.log('Editing note: ' + note);
  if (values.preview) {console.log('Preview only. No connection or send attempted.'); return;}
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw fail('GMAIL_INTERACTIVE_REVIEW_REQUIRED');
  const terminal = createInterface({input: process.stdin, output: process.stdout});
  let answer;
  try {answer = await terminal.question('Send this exact email? Type SEND to approve, or Enter to cancel: ');} finally {terminal.close();}
  if (answer !== 'SEND') {console.log('Cancelled. No connection or send attempted.'); return;}
  const auth = createGmailAuth({...loadGoogleDesktopClient(config.clientFile, {repo}), purpose: 'reviewed-send'});
  try {
    await auth.connect(config.account, url => console.log('Open this Google URL locally; keep the terminal running:\n' + url),
      {authorizeConnection: true, authorizeSending: true});
    const result = await sendReviewedMail({root, review, approvedDigest: review.digest, account: config.account, recipients,
      getToken: () => auth.token(config.account), authorizeSending: true});
    console.log(JSON.stringify(result, null, 2));
  } finally {auth.disconnect();}
}
main().catch(error => {
  const codes = ['GMAIL_DRAFT_REJECTED', 'GMAIL_INTERACTIVE_REVIEW_REQUIRED', 'GMAIL_REVIEW_EXPIRED', 'GMAIL_APPROVAL_MISMATCH',
    'GMAIL_SENDING_NOT_AUTHORIZED', 'GMAIL_SEND_RECONCILIATION_REQUIRED', 'GMAIL_SEND_OUTCOME_UNCERTAIN', 'GMAIL_SEND_PERMISSION_DENIED',
    'GMAIL_SIGN_IN_REQUIRED', 'GMAIL_SIGN_IN_FAILED', 'GMAIL_SCOPE_REJECTED', 'GMAIL_ACCOUNT_REJECTED', 'GMAIL_CONFIGURATION_UNAVAILABLE'];
  const diagnostic = sanitizeOAuthDiagnostic(error?.oauthDiagnostic);
  console.error(JSON.stringify({error: codes.includes(error?.code) ? error.code : 'GMAIL_SEND_FAILED',
    ...(diagnostic ? {oauthDiagnostic: diagnostic} : {}), automaticReplies: false, submittedApplications: 0}));
  process.exitCode = 1;
});
