import path from 'node:path';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
import {readPrivate} from './outlook-auth.mjs';
import {withOAuthLoopback} from './oauth-loopback.mjs';
import {GmailReadClient} from './gmail-client.mjs';
import {classifyOAuthFailure, reportOAuthEvent, reportOAuthFailure} from './oauth-diagnostics.mjs';

export const GMAIL_SCOPES = Object.freeze(['https://www.googleapis.com/auth/gmail.readonly']);
const fail = code => Object.assign(Error(code), {code});
export function validateGmailScopes(scopes) {
  if (!Array.isArray(scopes) || !scopes.length || scopes.some(scope => scope !== GMAIL_SCOPES[0])) throw fail('GMAIL_SCOPE_REJECTED');
}
export function loadGoogleDesktopClient(file, {repo}) {
  if (!path.isAbsolute(file)) throw fail('GMAIL_CLIENT_FILE_UNSAFE');
  const full = path.resolve(file), base = fs.realpathSync(repo);
  if (full === base || full.startsWith(base + path.sep)) throw fail('GMAIL_CLIENT_FILE_UNSAFE');
  let cursor = full;
  for (;;) {
    if (fs.lstatSync(cursor).isSymbolicLink() || fs.existsSync(path.join(cursor, '.git'))) throw fail('GMAIL_CLIENT_FILE_UNSAFE');
    if (cursor === path.dirname(cursor)) break;
    cursor = path.dirname(cursor);
  }
  let value;
  try {value = JSON.parse(readPrivate(full)).installed;} catch {throw fail('GMAIL_CLIENT_FILE_UNSAFE');}
  if (!value || typeof value.client_id !== 'string' || !/^[A-Za-z0-9_-]{10,200}\.apps\.googleusercontent\.com$/.test(value.client_id) ||
      typeof value.client_secret !== 'string' || !value.client_secret || value.client_secret.length > 512) throw fail('GMAIL_DESKTOP_CLIENT_REQUIRED');
  return {clientId: value.client_id, clientSecret: value.client_secret};
}

// First-use security choice: online OAuth and in-memory tokens only. No refresh
// token serialization or persistent cache fallback, even if Google returns one.
export function createGoogleOAuthClient(options) {
  const client = new OAuth2Client(options);
  const request = client.transporter.request.bind(client.transporter);
  // SDK auth methods override transporter defaults with retry:true. A one-time
  // code must not be retried automatically after an uncertain exchange outcome.
  client.transporter.request = settings => request({...settings, retry: false, retryConfig: {retry: 0, noResponseRetries: 0, shouldRetry: () => false}, timeout: 20000, maxRedirects: 0, redirect: 'error'});
  return client;
}
export function createGmailAuth({clientId, clientSecret, clock = Date.now,
  clientFactory = createGoogleOAuthClient,
  profileReader = token => new GmailReadClient({getToken: async () => token}).profile(),
  timeoutMs = 300000, onDiagnostic,
}) {
  let accessToken = null, expiresAt = 0, boundAccount = null;
  const disconnect = () => {accessToken = null; expiresAt = 0; boundAccount = null;};
  return {
    credentialMode: 'session',
    disconnect,
    async token(expected) {
      if (!accessToken || boundAccount !== expected?.toLowerCase() || clock() >= expiresAt - 5000) throw fail('GMAIL_SIGN_IN_REQUIRED');
      return accessToken;
    },
    async connect(expected, onUrl, {authorizeConnection = false} = {}) {
      if (authorizeConnection !== true) throw fail('GMAIL_CONNECTION_NOT_AUTHORIZED');
      if (typeof expected !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expected) || typeof onUrl !== 'function') throw fail('INVALID_GMAIL_ACCOUNT');
      disconnect();
      let client, stage = 'client_setup';
      try {
        client = clientFactory({clientId, clientSecret, transporterOptions: {timeout: 20000, retry: false, maxRedirects: 0}});
        const pkce = await client.generateCodeVerifierAsync();
        const state = randomUUID();
        stage = 'callback_wait';
        await withOAuthLoopback({state, timeoutMs, onUrl, onDiagnostic,
          buildUrl: redirectUri => {stage = 'authorization_url'; const url = client.generateAuthUrl({redirect_uri: redirectUri, scope: [...GMAIL_SCOPES],
            access_type: 'online', include_granted_scopes: false, prompt: 'select_account consent', login_hint: expected,
            state, code_challenge: pkce.codeChallenge, code_challenge_method: 'S256'}); stage = 'callback_wait'; return url;},
          exchange: async (code, redirectUri) => {
            stage = 'code_exchange'; reportOAuthEvent(onDiagnostic, 'code_exchange_started');
            const {tokens} = await client.getToken({code, codeVerifier: pkce.codeVerifier, redirect_uri: redirectUri});
            reportOAuthEvent(onDiagnostic, 'code_exchange_succeeded'); stage = 'token_validation';
            if (typeof tokens?.access_token !== 'string' || !tokens.access_token || !Number.isFinite(tokens.expiry_date) || tokens.expiry_date <= clock()) throw fail('GMAIL_TOKEN_REJECTED');
            if (tokens.scope !== undefined) validateGmailScopes(tokens.scope.split(/\s+/).filter(Boolean));
            stage = 'token_info'; reportOAuthEvent(onDiagnostic, 'token_info_started');
            const info = await client.getTokenInfo(tokens.access_token);
            validateGmailScopes(info.scopes);
            if (info.aud !== clientId) throw fail('GMAIL_TOKEN_REJECTED');
            reportOAuthEvent(onDiagnostic, 'token_info_succeeded');
            stage = 'account_verification'; reportOAuthEvent(onDiagnostic, 'account_verification_started');
            const profile = await profileReader(tokens.access_token);
            if (typeof profile?.emailAddress !== 'string' || profile.emailAddress.toLowerCase() !== expected.toLowerCase()) throw fail('GMAIL_ACCOUNT_REJECTED');
            reportOAuthEvent(onDiagnostic, 'account_verified');
            accessToken = tokens.access_token; expiresAt = tokens.expiry_date; boundAccount = expected.toLowerCase();
          }});
        return {connected: true, credentialMode: 'session'};
      } catch (error) {
        disconnect();
        const allowed = ['GMAIL_SCOPE_REJECTED', 'GMAIL_ACCOUNT_REJECTED', 'GMAIL_TOKEN_REJECTED'];
        const diagnostic = classifyOAuthFailure(error, stage);
        reportOAuthFailure(onDiagnostic, diagnostic);
        throw Object.assign(fail(allowed.includes(error?.code) ? error.code : 'GMAIL_SIGN_IN_FAILED'), {oauthDiagnostic: diagnostic});
      } finally {if (client) client.setCredentials({});}
    },
  };
}
