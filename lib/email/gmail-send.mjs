// Explicitly reviewed outbound email. Separate from the read-only sync adapter.
import {createHash} from 'node:crypto';
import {updateLedger} from '../applications/store.mjs';

const fail = code => Object.assign(Error(code), {code});
const email = value => typeof value === 'string' && value.length <= 254 &&
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const messageId = value => typeof value === 'string' && /^<[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+>$/.test(value);

export function reviewMail(input, {account, recipients, now = Date.now()}) {
  // Closed schema excludes attachments, Bcc, Cc, arbitrary headers and submissions.
  const allowed = ['kind', 'from', 'to', 'subject', 'body', 'threadId', 'inReplyTo'];
  if (!input || Object.keys(input).some(key => !allowed.includes(key)) ||
      !['test', 'reply'].includes(input.kind) || !email(account) || input.from !== account ||
      !email(input.to) || !recipients?.includes(input.to) ||
      typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 120 || /[\x00-\x1f\x7f]/.test(input.subject) ||
      typeof input.body !== 'string' || !input.body.trim() || Buffer.byteLength(input.body) > 16000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.body)) throw fail('GMAIL_DRAFT_REJECTED');
  if (input.kind === 'reply' ? !/^[A-Za-z0-9_-]{1,200}$/.test(input.threadId || '') || !messageId(input.inReplyTo) : input.threadId !== undefined || input.inReplyTo !== undefined) throw fail('GMAIL_DRAFT_REJECTED');
  const mail = {kind: input.kind, from: input.from, to: input.to, subject: input.subject, body: input.body.replace(/\r\n?/g, '\n'),
    ...(input.kind === 'reply' ? {threadId: input.threadId, inReplyTo: input.inReplyTo} : {})};
  const digest = hash(JSON.stringify(mail));
  return {mail: Object.freeze(mail), digest, expiresAt: now + 10 * 60000};
}

export function encodeMail(mail) {
  // Encode both Unicode subject and body; no content can become a MIME header.
  const chunks = [''];
  for (const character of mail.subject) {
    if (Buffer.byteLength(chunks.at(-1) + character) > 42) chunks.push('');
    chunks[chunks.length - 1] += character;
  }
  const subject = chunks.map(chunk => `=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`).join('\r\n ');
  const body = Buffer.from(mail.body.replace(/\n/g, '\r\n')).toString('base64').match(/.{1,76}/g).join('\r\n');
  const headers = [`From: ${mail.from}`, `To: ${mail.to}`, `Subject: ${subject}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  if (mail.kind === 'reply') headers.push(`In-Reply-To: ${mail.inReplyTo}`, `References: ${mail.inReplyTo}`);
  return {raw: Buffer.from(headers.join('\r\n') + '\r\n\r\n' + body + '\r\n').toString('base64url'),
    ...(mail.kind === 'reply' ? {threadId: mail.threadId} : {})};
}

export async function sendReviewedMail({root, review, approvedDigest, account, recipients, getToken,
  authorizeSending = false, fetchFn = globalThis.fetch, now = Date.now()}) {
  if (authorizeSending !== true) throw fail('GMAIL_SENDING_NOT_AUTHORIZED');
  if (!review || !Number.isFinite(review.expiresAt) || review.expiresAt <= now || review.expiresAt > now + 10 * 60000) throw fail('GMAIL_REVIEW_EXPIRED');
  const checked = reviewMail(review.mail, {account, recipients, now});
  if (approvedDigest !== checked.digest || review.digest !== checked.digest) throw fail('GMAIL_APPROVAL_MISMATCH');
  const payload = encodeMail(checked.mail);
  const token = await getToken();
  if (typeof token !== 'string' || !token) throw fail('GMAIL_SIGN_IN_REQUIRED');
  const key = hash(account + '\0' + checked.digest);
  // Durable reservation precedes the POST. A crash/timeout/invalid success body
  // leaves an uncertain record and blocks replay, even across process restarts.
  await updateLedger(root, ledger => {
    ledger.reviewedMailSends ??= {};
    if (ledger.reviewedMailSends[key]) throw fail('GMAIL_SEND_RECONCILIATION_REQUIRED');
    ledger.reviewedMailSends[key] = {digest: checked.digest, state: 'uncertain', attemptedAt: new Date(now).toISOString()};
  });
  let response;
  try {
    response = await fetchFn('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(20000),
    });
  } catch {throw fail('GMAIL_SEND_OUTCOME_UNCERTAIN');}
  if (!response.ok) {
    // Never log provider text, message bodies, request objects or tokens.
    throw fail(response.status === 401 || response.status === 403 ? 'GMAIL_SEND_PERMISSION_DENIED' : 'GMAIL_SEND_OUTCOME_UNCERTAIN');
  }
  let receipt;
  try {receipt = await response.json();} catch {throw fail('GMAIL_SEND_OUTCOME_UNCERTAIN');}
  if (typeof receipt?.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(receipt.id)) throw fail('GMAIL_SEND_OUTCOME_UNCERTAIN');
  await updateLedger(root, ledger => {
    const record = ledger.reviewedMailSends?.[key];
    if (record?.state !== 'uncertain' || record.digest !== checked.digest) throw fail('GMAIL_SEND_RECONCILIATION_REQUIRED');
    record.state = 'accepted'; record.receiptHash = hash(receipt.id);
  });
  return {state: 'accepted_by_gmail', delivered: 'unverified', automaticReplies: false, automaticStatusChanges: false, submittedApplications: 0};
}

// Advisory editing checks, never an AI detector or a factual-accuracy check.
export function emailStyleNotes(body) {
  const notes = [];
  if (/\b(delve|leverage|synergy|tapestry|game.changer)\b/i.test(body)) notes.push('Replace generic promotional wording with specific plain language.');
  if (/I hope this (?:email|message) finds you well|I hope this helps|certainly!/i.test(body)) notes.push('Remove canned openings or assistant commentary.');
  if (/—/.test(body)) notes.push('Use a period, comma or parentheses instead of an em dash.');
  if (/not (?:just|only|about)\b[\s\S]{0,100}\bbut\b/i.test(body)) notes.push('State the point directly without a rhetorical contrast.');
  return notes;
}
