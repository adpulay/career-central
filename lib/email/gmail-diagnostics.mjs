// Provider/sync diagnostics use closed vocabularies only. No URLs, IDs, headers,
// query values, addresses, provider descriptions, message content or tokens.
const stages = new Set(['profile', 'message_list', 'message_metadata', 'message_detail',
  'metadata_parse', 'detail_parse', 'inspection', 'sync_start', 'observation_persistence', 'checkpoint_publication']);
const reasons = Object.freeze({
  GMAIL_READ_FAILED: ['api_request_failed', 'Google rejected the read-only API request.'],
  GMAIL_READ_UNAVAILABLE: ['network_failure', 'The read-only API request could not reach Google.'],
  GMAIL_RESPONSE_EMPTY: ['response_empty', 'The API returned no response content; complete coverage could not be verified.'],
  GMAIL_RESPONSE_JSON_INVALID: ['response_parse_failed', 'Google returned a response that could not be parsed as JSON.'],
  INVALID_GMAIL_RESPONSE: ['response_shape_invalid', 'The API response did not match the expected structure.'],
  INVALID_GMAIL_PAGE: ['response_shape_invalid', 'The message-list response did not match the bounded page contract.'],
  INVALID_GMAIL_MESSAGE: ['response_shape_invalid', 'Required message metadata was missing or invalid.'],
  INVALID_GMAIL_DATE: ['response_shape_invalid', 'The message receipt timestamp was invalid.'],
  INVALID_GMAIL_HEADERS: ['message_header_invalid', 'The selected message headers were malformed or exceeded a limit.'],
  AMBIGUOUS_GMAIL_HEADERS: ['message_header_invalid', 'The message contained duplicate selected headers.'],
  INVALID_GMAIL_ADDRESS: ['message_header_invalid', 'A message address header could not be parsed safely.'],
  AMBIGUOUS_GMAIL_SENDER: ['message_header_invalid', 'The message did not contain one unambiguous sender.'],
  GMAIL_IDENTITY_MISMATCH: ['message_identity_mismatch', 'The returned message identity did not match the requested identity.'],
  GMAIL_MIME_LIMIT: ['message_format_unsupported', 'The MIME structure exceeded the safe parsing limit.'],
  GMAIL_BODY_LIMIT: ['message_format_unsupported', 'The selected text exceeded the safe parsing limit.'],
  GMAIL_PLAIN_TEXT_REQUIRED: ['message_format_unsupported', 'No supported inline text body was available.'],
  GMAIL_BODY_ENCODING_INVALID: ['message_format_unsupported', 'The selected text used an unsupported or invalid encoding.'],
  INVALID_SYNC_RESULT: ['synchronization_failed', 'Inspection returned an invalid bounded synchronization result.'],
  STALE_STATE_REVISION: ['checkpoint_conflict', 'Another writer advanced this provider revision. No automatic retry was made.'],
  OPERATION_COMMIT_UNCERTAIN: ['storage_uncertain', 'A local commit acknowledgement was uncertain. Inspect recorded state before retrying.'],
});
const categories = Object.freeze({
  api_disabled: 'Gmail API is disabled for the OAuth project.',
  authentication_required: 'Google rejected or could not obtain the access token. Start a fresh authorized sign-in.',
  permission_denied: 'Google denied the read-only API request. Do not add broader permissions.',
  invalid_request: 'Google rejected an API parameter. No additional mailbox request was made automatically.',
  rate_limited: 'Google rate-limited the request. No automatic retry was made.',
  api_request_failed: 'Google rejected the read-only API request.',
  network_failure: 'The read-only API request could not reach Google.',
  response_empty: 'The API returned no collection data; coverage remains incomplete.',
  response_parse_failed: 'The API response could not be parsed safely.',
  response_shape_invalid: 'The API response did not match the expected bounded structure.',
  message_header_invalid: 'Message headers could not be normalized safely.',
  message_identity_mismatch: 'Message identity changed during inspection.',
  message_format_unsupported: 'The selected message format could not be decoded safely.',
  synchronization_failed: 'Local synchronization failed at the reported stage.',
  checkpoint_conflict: 'The provider revision changed. Check recorded state before retrying.',
  storage_uncertain: 'A local commit acknowledgement was uncertain. Check recorded state before retrying.',
});
export function sanitizeGmailDiagnostic(value) {
  if (!value || !stages.has(value.stage) || !Object.hasOwn(categories, value.category)) return null;
  const result = {stage: value.stage, category: value.category, message: categories[value.category]};
  if (typeof value.reasonCode === 'string' && Object.hasOwn(reasons, value.reasonCode)) {
    result.reasonCode = value.reasonCode;
    if (reasons[value.reasonCode][0] === value.category) result.message = reasons[value.reasonCode][1];
  }
  if (Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) result.httpStatus = value.httpStatus;
  return result;
}
export function classifyGmailFailure(error, stage) {
  const saved = sanitizeGmailDiagnostic(error?.gmailDiagnostic);
  if (saved) return saved;
  const status = error?.status;
  let category = typeof error?.code === 'string' && Object.hasOwn(reasons, error.code) ? reasons[error.code][0] : 'synchronization_failed';
  if (error?.providerReason === 'api_disabled') category = 'api_disabled';
  else if (error?.code === 'GMAIL_SIGN_IN_REQUIRED' || status === 401) category = 'authentication_required';
  else if (status === 403) category = 'permission_denied';
  else if (status === 400) category = 'invalid_request';
  else if (status === 429) category = 'rate_limited';
  return sanitizeGmailDiagnostic({stage, category, httpStatus: status,
    reasonCode: Object.hasOwn(reasons, error?.code ?? '') ? error.code : undefined});
}
export function gmailFailure(error, stage) {
  const diagnostic = classifyGmailFailure(error, stage);
  const code = diagnostic?.reasonCode ?? 'GMAIL_SYNCHRONIZATION_FAILED';
  const wrapped = Object.assign(Error(code), {code, gmailDiagnostic: diagnostic});
  if (diagnostic?.category === 'api_disabled') wrapped.providerReason = 'api_disabled';
  if (Number.isInteger(error?.status)) wrapped.status = error.status;
  return wrapped;
}
export function reportGmailDiagnostic(callback, value) {
  const safe = sanitizeGmailDiagnostic(value);
  if (typeof callback === 'function' && safe) {try {callback({event: 'failure', ...safe});} catch {}}
}
export function reportGmailRequest(callback, stage, event, status) {
  if (typeof callback !== 'function' || !stages.has(stage) || !['request_started', 'request_succeeded', 'response_validated', 'response_empty'].includes(event)) return;
  const result = {event, stage};
  if (Number.isInteger(status) && status >= 100 && status <= 599) result.httpStatus = status;
  try {callback(result);} catch {}
}
