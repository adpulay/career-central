// Read one explicitly selected message from one bounded metadata page.
// Returned content is private drafting context, never diagnostic output.
import {analyzeMessage, envelopeMatches} from './application-mail.mjs';
import {reviewMail} from './gmail-send.mjs';

const fail = code => Object.assign(Error(code), {code});
const address = value => value?.emailAddress?.address;
const unsafe = /password|account recovery|security|verification|one.time|\bOTP\b|authenticator|sign[ -]?in|log[ -]?in|multi.factor|two.factor|reset code/i;
export const TEST_SUBJECT = 'Career Ops TEST: email connection';
const testSubject = subject => String(subject).replace(/^(?:re:\s*)+/i, '') === TEST_SUBJECT;

export function replyEligible(message, {config, ledger, jobKey, now = Date.now()}) {
  if (message.isDraft || unsafe.test(message.subject || '')) return false;
  if (!jobKey) return address(message.from) === config.applicationEmail &&
    (!message.sender || address(message.sender) === config.applicationEmail) &&
    message.toRecipients?.some(value => address(value) === config.account) && testSubject(message.subject);
  const job = ledger.jobs?.[jobKey], rule = config.rules.find(value => value.jobKey === jobKey);
  return [config.account, config.applicationEmail].some(account =>
    envelopeMatches(message, {...config, account, requireOriginalDate: true}, job, rule, now));
}

export async function collectReplyContext({client, config, ledger, jobKey, select, authorizeConnection = false, now = Date.now()}) {
  if (authorizeConnection !== true) throw fail('GMAIL_CONNECTION_NOT_AUTHORIZED');
  if (jobKey && (!ledger.jobs?.[jobKey] || !config.rules.some(rule => rule.jobKey === jobKey))) throw fail('GMAIL_REPLY_JOB_UNAVAILABLE');
  const since = new Date(now - 3600000).toISOString(), until = new Date(now).toISOString();
  const page = await client.list({since, until, maxPages: 1, pageSize: 10});
  if (!Array.isArray(page.messages) || page.messages.length > 10 || typeof page.hasMore !== 'boolean') throw fail('GMAIL_REPLY_PAGE_REJECTED');
  const eligible = page.messages.filter(message => {
    const time = Date.parse(message.receivedDateTime);
    return Number.isFinite(time) && time >= now - 3600000 && time <= now && replyEligible(message, {config, ledger, jobKey, now});
  });
  if (!eligible.length) return {state: 'no_eligible_reply', incomplete: page.hasMore, metadataLimit: 10, maxPages: 1};
  const index = await select(eligible.map(message => ({subject: message.subject, receivedAt: message.receivedDateTime})));
  if (!Number.isInteger(index) || index < 0 || index >= eligible.length) throw fail('GMAIL_REPLY_SELECTION_CANCELLED');
  const selected = eligible[index], detail = await client.replyDetail(selected.id);
  if (detail.id !== selected.id || detail.receivedDateTime !== selected.receivedDateTime || detail.subject !== selected.subject ||
      address(detail.from) !== address(selected.from) || !replyEligible(detail, {config, ledger, jobKey, now})) throw fail('GMAIL_REPLY_IDENTITY_REJECTED');
  let content = String(detail.body?.content || '');
  if (!jobKey) {
    // The round-trip test consumes only this fixed acknowledgment, never quoted
    // original messages or extra instructions/content underneath it.
    const plain = content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').trim();
    if (!/^Test received[.!]?(?=\s|$)/i.test(plain)) throw fail('GMAIL_REPLY_CONTEXT_UNMATCHED');
    content = 'Test received.';
  } else if (!content || unsafe.test(content)) throw fail('GMAIL_REPLY_SECURITY_EXCLUDED');
  let category = 'connection_test';
  if (jobKey) {
    const analysis = [config.account, config.applicationEmail].map(account => analyzeMessage(detail,
      {...config, account, rules: config.rules.filter(rule => rule.jobKey === jobKey), requireOriginalDate: true}, ledger.jobs, now)).find(result => result.matched);
    if (!analysis || analysis.category === 'verification') throw fail('GMAIL_REPLY_CONTEXT_UNMATCHED');
    category = analysis.category;
  }
  const subject = /^re:/i.test(detail.subject) ? detail.subject : 'Re: ' + detail.subject;
  const draft = {kind: 'reply', from: config.account, to: address(detail.from), subject,
    body: '', threadId: detail.threadId, inReplyTo: detail.internetMessageId};
  // Reuse the sending validator before saving any thread/header context.
  reviewMail({...draft, body: 'Pending review.'}, {account: config.account, recipients: [address(detail.from)], now});
  return {state: 'context_ready', incomplete: page.hasMore, metadataLimit: 10, maxPages: 1,
    context: {schemaVersion: 1, purpose: jobKey ? 'recruiter_reply' : 'connection_test', jobKey: jobKey ?? null,
      category, receivedAt: detail.receivedDateTime, preparedAt: new Date(now).toISOString(),
      untrustedContent: content.slice(0, 16000).replace(/\b\d{6,10}\b/g, '[number redacted]'),
      senderAuthentication: 'not-live-validated', requiresReview: true, draft}};
}
