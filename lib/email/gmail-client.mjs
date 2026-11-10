import addresses from 'email-addresses';
import {gmailFailure, reportGmailRequest} from './gmail-diagnostics.mjs';

const NO_CONTENT = Symbol('gmail-list-no-content');
const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const fail = code => Object.assign(Error(code), {code});
const idValid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value);
const headerNames = ['From', 'Sender', 'To', 'Cc', 'Subject', 'Date'];
function headersOf(message) {
  const result = new Map();
  for (const header of message.payload?.headers ?? []) {
    if (!header || typeof header.name !== 'string' || typeof header.value !== 'string' || header.value.length > 16384) throw fail('INVALID_GMAIL_HEADERS');
    const key = header.name.toLowerCase();
    if (!headerNames.some(name => name.toLowerCase() === key)) continue;
    if (result.has(key)) throw fail('AMBIGUOUS_GMAIL_HEADERS');
    result.set(key, header.value);
  }
  return result;
}
function mailboxes(value) {
  if (!value) return [];
  const parsed = addresses.parseAddressList(value);
  if (!parsed || parsed.length > 50 || parsed.some(item => item.type !== 'mailbox')) throw fail('INVALID_GMAIL_ADDRESS');
  return parsed.map(item => ({emailAddress: {address: item.address.toLowerCase()}}));
}
function textBody(payload, wanted = 'text/plain', depth = 0, budget = {bytes: 0, parts: 0}) {
  if (!payload || depth > 12 || ++budget.parts > 100) throw fail('GMAIL_MIME_LIMIT');
  // Attachments and forwarded RFC822 files are not interpreted.
  // Unsupported forms fail closed rather than trusting embedded From/To text.
  if (payload.filename || payload.mimeType === 'message/rfc822') return '';
  if (payload.mimeType === wanted && payload.body?.data) {
    if (typeof payload.body.data !== 'string' || payload.body.data.length > 150000) throw fail('GMAIL_BODY_LIMIT');
    const decoded = Buffer.from(payload.body.data, 'base64url');
    budget.bytes += decoded.length;
    if (budget.bytes > 100000) throw fail('GMAIL_BODY_LIMIT');
    return new TextDecoder('utf-8', {fatal: true}).decode(decoded);
  }
  if (Array.isArray(payload.parts)) return payload.parts.map(part => textBody(part, wanted, depth + 1, budget)).filter(Boolean).join('\n');
  return '';
}
export function normalizeGmailMessage(message, {detail = false} = {}) {
  if (!message || !idValid(message.id) || !/^\d{1,16}$/.test(String(message.internalDate ?? ''))) throw fail('INVALID_GMAIL_MESSAGE');
  const timestamp = Number(message.internalDate);
  if (!Number.isSafeInteger(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) throw fail('INVALID_GMAIL_DATE');
  const headers = headersOf(message), from = mailboxes(headers.get('from')), sender = mailboxes(headers.get('sender'));
  if (from.length !== 1 || sender.length > 1) throw fail('AMBIGUOUS_GMAIL_SENDER');
  const normalized = {id: message.id, subject: headers.get('subject') ?? '', from: from[0],
    toRecipients: mailboxes(headers.get('to')), ccRecipients: mailboxes(headers.get('cc')),
    receivedDateTime: new Date(timestamp).toISOString(), isDraft: message.labelIds?.includes('DRAFT') ?? false};
  if (sender.length) normalized.sender = sender[0];
  const original = Date.parse(headers.get('date'));
  normalized.originalReceivedDateTime = Number.isFinite(original) ? new Date(original).toISOString() : null;
  if (detail) {
    const content = textBody(message.payload) || textBody(message.payload, 'text/html');
    if (!content) throw fail('GMAIL_PLAIN_TEXT_REQUIRED');
    normalized.body = {contentType: 'text', content};
  }
  return normalized;
}

// Construct URLs internally. No caller-controlled URL, method, user or page token.
export class GmailReadClient {
  constructor({getToken, fetchFn = globalThis.fetch, onDiagnostic}) {this.getToken = getToken; this.fetchFn = fetchFn; this.onDiagnostic = onDiagnostic;}
  async get(resource, params = {}) {
    const stage = resource === 'profile' ? 'profile' : resource === 'messages' ? 'message_list' : params.format === 'metadata' ? 'message_metadata' : 'message_detail';
    try {return await this.request(resource, params, stage);} catch (error) {
      throw gmailFailure(error, stage);
    }
  }
  async request(resource, params, stage) {
    if (resource !== 'profile' && resource !== 'messages' && !/^messages\/[A-Za-z0-9_-]{1,256}$/.test(resource)) throw fail('GMAIL_READ_ENDPOINT_REFUSED');
    const url = new URL(`${BASE}/${resource}`);
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
    }
    reportGmailRequest(this.onDiagnostic, stage, 'request_started');
    let response;
    try {response = await this.fetchFn(url.href, {method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: {Authorization: `Bearer ${await this.getToken()}`}});} catch {throw fail('GMAIL_READ_UNAVAILABLE');}
    if (!response.ok) {
      // Extract only a closed API-disabled signal, never the provider's message,
      // metadata, request IDs or raw JSON. Other failures retain just HTTP status.
      let providerReason;
      try {
        const data = await response.json();
        const reasons = [...(Array.isArray(data.error?.errors) ? data.error.errors.slice(0, 10) : []),
          ...(Array.isArray(data.error?.details) ? data.error.details.slice(0, 10) : [])];
        if (reasons.some(item => item?.reason === 'accessNotConfigured' || item?.reason === 'SERVICE_DISABLED')) providerReason = 'api_disabled';
      } catch { /* Malformed provider error content stays private. */ }
      throw Object.assign(fail('GMAIL_READ_FAILED'), {status: response.status, ...(providerReason ? {providerReason} : {})});
    }
    // Raw provider error messages/bodies are never echoed.
    reportGmailRequest(this.onDiagnostic, stage, 'request_succeeded', response.status ?? 200);
    if (response.status === 204) {
      if (stage === 'message_list') return NO_CONTENT;
      throw Object.assign(fail('GMAIL_RESPONSE_EMPTY'), {status: 204});
    }
    try {return await response.json();} catch {throw Object.assign(fail('GMAIL_RESPONSE_JSON_INVALID'), {status: response.status ?? 200});}
  }
  profile() {return this.get('profile', {fields: 'emailAddress'});}
  async list({since, until, maxPages = 1, pageSize = 10}) {
    const from = Date.parse(since), through = Date.parse(until);
    if (!Number.isFinite(from) || !Number.isFinite(through) || from >= through || through - from > 3600000 || maxPages !== 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10) throw fail('INVALID_GMAIL_WINDOW');
    // Gmail search seconds are coarser than our timestamps. Search a superset,
    // then filter by Gmail internalDate before requesting any bodies.
    const data = await this.get('messages', {maxResults: pageSize, includeSpamTrash: true,
      q: `after:${Math.floor(from / 1000) - 1} before:${Math.ceil(through / 1000) + 1}`,
      fields: 'messages(id),nextPageToken,resultSizeEstimate'});
    if (data === NO_CONTENT) {
      // 204 is a successful HTTP request, but contains no collection or cursor
      // proof. Do not parse it or fabricate complete/empty coverage.
      reportGmailRequest(this.onDiagnostic, 'message_list', 'response_empty', 204);
      return {messages: [], hasMore: true};
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw gmailFailure(fail('INVALID_GMAIL_RESPONSE'), 'message_list');
    if (data.messages === undefined && data.resultSizeEstimate === undefined && !data.nextPageToken) {
      reportGmailRequest(this.onDiagnostic, 'message_list', 'response_empty', 200);
      return {messages: [], hasMore: true};
    }
    const rows = data.messages === undefined ? [] : data.messages;
    if (!Array.isArray(rows) || rows.length > pageSize || rows.some(row => !idValid(row?.id)) ||
        (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string')) throw gmailFailure(fail('INVALID_GMAIL_PAGE'), 'message_list');
    if ((data.resultSizeEstimate !== undefined && (!Number.isInteger(data.resultSizeEstimate) || data.resultSizeEstimate < 0)) ||
        (rows.length === 0 && data.resultSizeEstimate > 0)) throw gmailFailure(fail('INVALID_GMAIL_PAGE'), 'message_list');
    const messages = [], seen = new Set();
    for (const row of rows) {
      if (seen.has(row.id)) continue; seen.add(row.id);
      const raw = await this.get(`messages/${row.id}`, {format: 'metadata', metadataHeaders: headerNames,
        fields: 'id,internalDate,labelIds,payload(headers)'});
      if (raw.id !== row.id) throw fail('GMAIL_IDENTITY_MISMATCH');
      let message;
      try {message = normalizeGmailMessage(raw);} catch (error) {throw gmailFailure(error, 'metadata_parse');}
      const time = Date.parse(message.receivedDateTime);
      if (time >= from && time <= through) messages.push(message);
    }
    // Headers may include drafts/sent mail; the analyzer rejects drafts and
    // requires an approved employer sender and original application recipient.
    reportGmailRequest(this.onDiagnostic, 'message_list', 'response_validated');
    return {messages, hasMore: Boolean(data.nextPageToken)};
  }
  async detail(id) {
    if (!idValid(id)) throw fail('INVALID_GMAIL_MESSAGE_ID');
    const raw = await this.get(`messages/${id}`, {format: 'full', fields: 'id,internalDate,labelIds,payload'});
    if (raw.id !== id) throw fail('GMAIL_IDENTITY_MISMATCH');
    try {return normalizeGmailMessage(raw, {detail: true});} catch (error) {throw gmailFailure(error, 'detail_parse');}
  }
}
