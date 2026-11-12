// Diagnostics are reconstructed from closed vocabularies, never error messages,
// stack traces, request URLs/headers/bodies, callback parameters or account IDs.
const stages = new Set(['client_setup', 'authorization_url', 'callback_wait', 'code_exchange',
  'token_validation', 'token_info', 'account_verification', 'cleanup']);
const messages = Object.freeze({
  invalid_client: 'Google rejected the desktop client credentials. Verify the downloaded Desktop app JSON belongs to this project.',
  request_rejected: 'Google rejected required OAuth request parameters. Verify the Desktop client setup; keep PKCE and redirect checks enabled.',
  invalid_grant: 'Google rejected the one-time authorization grant. Start a fresh sign-in; do not reuse a callback URL.',
  redirect_mismatch: 'Google rejected the redirect URI. Use a Desktop OAuth client and the new loopback URL generated for this attempt.',
  consent_denied: 'Google sign-in or consent was denied. No mailbox connection was established.',
  scope_rejected: 'Permissions outside the exact Gmail read-only scope were requested or granted. Connection refused.',
  account_mismatch: 'The verified Gmail account differs from the configured receiving account. Connection refused.',
  token_rejected: 'The token response, expiry or client audience failed validation. Connection refused.',
  api_disabled: 'Gmail API is disabled or unavailable for this OAuth project. Enable Gmail API in the same project as the Desktop client.',
  permission_denied: 'Google denied this operation. Verify Gmail API is enabled and only the required read-only scope was consented.',
  authentication_required: 'Google rejected the access token. Start a fresh sign-in.',
  rate_limited: 'Google rate-limited this request. Stop and retry later; no automatic mailbox retry was started.',
  network_dns: 'WSL could not resolve a Google endpoint. Check DNS without changing OAuth security.',
  network_timeout: 'The Google request timed out. Check WSL network/proxy connectivity, then start a fresh sign-in.',
  network_connection: 'The connection to Google failed. Check WSL network/proxy connectivity.',
  tls_trust: 'TLS certificate verification failed. Fix the trusted CA/proxy configuration; do not disable certificate verification.',
  listener_unavailable: 'The IPv4 loopback callback listener could not start.',
  callback_timeout: 'No valid OAuth callback reached this listener before its timeout. Check Windows-to-WSL forwarding and keep the terminal open.',
  callback_invalid: 'The OAuth callback was incomplete or invalid. Start a fresh sign-in.',
  provider_unavailable: 'Google returned a temporary service error. Stop and retry later with a fresh sign-in.',
  unexpected_error: 'Authentication failed at the reported stage. Raw provider details were suppressed to protect credentials.',
});
const networkCategories = Object.freeze({ENOTFOUND: 'network_dns', EAI_AGAIN: 'network_dns',
  TimeoutError: 'network_timeout', ETIMEDOUT: 'network_timeout', ECONNABORTED: 'network_timeout', UND_ERR_CONNECT_TIMEOUT: 'network_timeout',
  ECONNRESET: 'network_connection', ECONNREFUSED: 'network_connection', EHOSTUNREACH: 'network_connection', ENETUNREACH: 'network_connection',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls_trust', UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'tls_trust',
  SELF_SIGNED_CERT_IN_CHAIN: 'tls_trust', DEPTH_ZERO_SELF_SIGNED_CERT: 'tls_trust', CERT_HAS_EXPIRED: 'tls_trust', ERR_TLS_CERT_ALTNAME_INVALID: 'tls_trust'});
const typed = Object.freeze({GMAIL_SCOPE_REJECTED: 'scope_rejected', GMAIL_ACCOUNT_REJECTED: 'account_mismatch',
  GMAIL_TOKEN_REJECTED: 'token_rejected', OAUTH_TIMEOUT: 'callback_timeout', OAUTH_LISTENER_FAILED: 'listener_unavailable',
  OAUTH_SIGN_IN_FAILED: 'consent_denied', OAUTH_CALLBACK_INVALID: 'callback_invalid'});
const provider = Object.freeze({invalid_client: 'invalid_client', unauthorized_client: 'invalid_client',
  invalid_request: 'request_rejected', unsupported_grant_type: 'request_rejected',
  invalid_token: 'authentication_required', invalid_grant: 'invalid_grant', redirect_uri_mismatch: 'redirect_mismatch', access_denied: 'consent_denied',
  invalid_scope: 'scope_rejected', temporarily_unavailable: 'provider_unavailable', server_error: 'provider_unavailable'});

export function sanitizeOAuthDiagnostic(value) {
  if (!value || !stages.has(value.stage) || !Object.hasOwn(messages, value.category)) return null;
  const result = {stage: value.stage, category: value.category, message: messages[value.category]};
  if (Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) result.httpStatus = value.httpStatus;
  if (typeof value.networkCode === 'string' && Object.hasOwn(networkCategories, value.networkCode)) result.networkCode = value.networkCode;
  return result;
}
export function classifyOAuthFailure(error, stage) {
  const status = error?.status ?? error?.response?.status;
  let category = typeof error?.code === 'string' && Object.hasOwn(typed, error.code) ? typed[error.code] : undefined;
  const providerError = error?.response?.data?.error;
  if (!category && typeof providerError === 'string' && Object.hasOwn(provider, providerError)) category = provider[providerError];
  if (!category && error?.providerReason === 'api_disabled') category = 'api_disabled';
  let networkCode;
  let cursor = error;
  for (let depth = 0; depth < 4 && cursor; depth++, cursor = cursor.cause) {
    if (typeof cursor.code === 'string' && Object.hasOwn(networkCategories, cursor.code)) {networkCode = cursor.code; break;}
  }
  if (!category && networkCode) category = networkCategories[networkCode];
  if (!category) category = status === 401 ? 'authentication_required' : status === 403 ? 'permission_denied' : status === 429 ? 'rate_limited' :
    Number.isInteger(status) && status >= 500 && status <= 599 ? 'provider_unavailable' : 'unexpected_error';
  return sanitizeOAuthDiagnostic({stage: stages.has(stage) ? stage : 'client_setup', category, httpStatus: status, networkCode});
}
const events = Object.freeze({
  listener_ready: ['callback_wait', 'IPv4 loopback listener is ready; keep this process running.'],
  callback_rejected: ['callback_wait', 'A local callback request was rejected; no callback data was logged.'],
  callback_received: ['callback_wait', 'The OAuth callback reached this listener and passed state/code checks.'],
  callback_denied: ['callback_wait', 'Google returned a sign-in denial to the callback listener.'],
  code_exchange_started: ['code_exchange', 'Exchanging the one-time code with Google.'],
  code_exchange_succeeded: ['code_exchange', 'The authorization-code exchange completed.'],
  token_info_started: ['token_info', 'Verifying granted scopes and client audience with Google.'],
  token_info_succeeded: ['token_info', 'The token scopes and client audience passed verification.'],
  account_verification_started: ['account_verification', 'Verifying only the receiving account identity; no message listing has started.'],
  account_verified: ['account_verification', 'The receiving account identity passed verification.'],
  listener_closed: ['cleanup', 'The loopback listener was closed after this authentication attempt.'],
});
export function reportOAuthEvent(callback, event, details = {}) {
  if (typeof callback !== 'function' || !Object.hasOwn(events, event)) return;
  const [stage, message] = events[event], value = {event, stage, message};
  if (event === 'listener_ready' && Number.isInteger(details.port) && details.port > 0 && details.port <= 65535) {
    value.listenerHost = '127.0.0.1'; value.listenerPort = details.port;
  }
  try {callback(value);} catch { /* A diagnostic sink cannot affect authentication. */ }
}
export function reportOAuthFailure(callback, diagnostic) {
  const value = sanitizeOAuthDiagnostic(diagnostic);
  if (typeof callback === 'function' && value) {try {callback({event: 'authentication_failed', ...value});} catch {}}
}
