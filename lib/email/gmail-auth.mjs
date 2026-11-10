import path from 'node:path';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
import {readPrivate} from './outlook-auth.mjs';
import {withOAuthLoopback} from './oauth-loopback.mjs';
import {GmailReadClient} from './gmail-client.mjs';

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
export function createGmailAuth({clientId, clientSecret, clock = Date.now,
  clientFactory = options => new OAuth2Client(options),
  profileReader = token => new GmailReadClient({getToken: async () => token}).profile(),
  timeoutMs = 300000,
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
      const client = clientFactory({clientId, clientSecret, transporterOptions: {timeout: 20000, retry: false, maxRedirects: 0}});
      try {
        const pkce = await client.generateCodeVerifierAsync();
        const state = randomUUID();
        await withOAuthLoopback({state, timeoutMs, onUrl,
          buildUrl: redirectUri => client.generateAuthUrl({redirect_uri: redirectUri, scope: [...GMAIL_SCOPES],
            access_type: 'online', include_granted_scopes: false, prompt: 'select_account consent', login_hint: expected,
            state, code_challenge: pkce.codeChallenge, code_challenge_method: 'S256'}),
          exchange: async (code, redirectUri) => {
            const {tokens} = await client.getToken({code, codeVerifier: pkce.codeVerifier, redirect_uri: redirectUri});
            if (typeof tokens.access_token !== 'string' || !tokens.access_token || !Number.isFinite(tokens.expiry_date) || tokens.expiry_date <= clock()) throw fail('GMAIL_TOKEN_REJECTED');
            if (tokens.scope !== undefined) validateGmailScopes(tokens.scope.split(/\s+/).filter(Boolean));
            const info = await client.getTokenInfo(tokens.access_token);
            validateGmailScopes(info.scopes);
            if (info.aud !== clientId) throw fail('GMAIL_TOKEN_REJECTED');
            const profile = await profileReader(tokens.access_token);
            if (typeof profile?.emailAddress !== 'string' || profile.emailAddress.toLowerCase() !== expected.toLowerCase()) throw fail('GMAIL_ACCOUNT_REJECTED');
            accessToken = tokens.access_token; expiresAt = tokens.expiry_date; boundAccount = expected.toLowerCase();
          }});
        return {connected: true, credentialMode: 'session'};
      } catch (error) {
        disconnect();
        const allowed = ['GMAIL_SCOPE_REJECTED', 'GMAIL_ACCOUNT_REJECTED', 'GMAIL_TOKEN_REJECTED'];
        throw fail(allowed.includes(error?.code) ? error.code : 'GMAIL_SIGN_IN_FAILED');
      } finally {client.setCredentials({});}
    },
  };
}
