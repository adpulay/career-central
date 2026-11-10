import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {GMAIL_SCOPES, createGmailAuth, createGoogleOAuthClient} from '../lib/email/gmail-auth.mjs';
import {GmailReadClient} from '../lib/email/gmail-client.mjs';
import {withOAuthLoopback} from '../lib/email/oauth-loopback.mjs';
import {classifyOAuthFailure, sanitizeOAuthDiagnostic, reportOAuthEvent} from '../lib/email/oauth-diagnostics.mjs';

const clientId = '000000000000-fixture.apps.googleusercontent.com';
const receiving = 'receiver@example.invalid';
const rawSecret = 'PRIVATE_AUTHORIZATION_CODE_ACCESS_TOKEN_CLIENT_SECRET';
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json'}});
function sdkFetch({failureStage, providerError = 'invalid_grant', status = 400, requests = []} = {}) {
  return async (input, options) => {
    const url = new URL(input);
    const stage = url.pathname === '/token' ? 'code_exchange' : 'token_info';
    requests.push({stage, options});
    assert.equal(url.origin, 'https://oauth2.googleapis.com');
    assert.equal(options.method, 'POST'); assert.equal(options.retryConfig.retry, 0); assert.equal(options.retryConfig.noResponseRetries, 0); assert.equal(options.retry, false); assert.equal(options.maxRedirects, 0); assert.equal(options.redirect, 'error');
    if (stage === failureStage) return json({error: providerError, error_description: rawSecret, token: rawSecret}, status);
    if (stage === 'code_exchange') {
      const body = new URLSearchParams(String(options.body));
      assert.equal(body.get('code'), 'synthetic-code');
      assert.ok(body.get('code_verifier').length >= 43);
      assert.equal(body.get('client_id'), clientId);
      return json({access_token: 'PRIVATE_ACCESS_TOKEN', refresh_token: 'PRIVATE_REFRESH_TOKEN', expires_in: 3600,
        token_type: 'Bearer', scope: GMAIL_SCOPES[0]});
    }
    return json({aud: clientId, scope: GMAIL_SCOPES[0], expires_in: 3600});
  };
}
function flow({failureStage, providerError, status, profileReader} = {}) {
  const events = [], requests = []; let profileCalls = 0;
  const auth = createGmailAuth({clientId, clientSecret: rawSecret,
    onDiagnostic: value => events.push(value),
    clientFactory: options => createGoogleOAuthClient({...options, transporterOptions: {
      ...options.transporterOptions, fetchImplementation: sdkFetch({failureStage, providerError, status, requests}),
    }}),
    profileReader: async token => {
      profileCalls++; assert.equal(token, 'PRIVATE_ACCESS_TOKEN');
      return profileReader ? profileReader(token) : {emailAddress: receiving};
    }});
  const onUrl = value => {
    const url = new URL(value), callback = new URL(url.searchParams.get('redirect_uri'));
    assert.equal(url.hostname, 'accounts.google.com'); assert.equal(url.searchParams.get('scope'), GMAIL_SCOPES[0]);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(callback.hostname, '127.0.0.1');
    setTimeout(async () => {
      const wrong = new URL(callback); wrong.searchParams.set('state', rawSecret); wrong.searchParams.set('code', rawSecret);
      assert.equal((await fetch(wrong)).status, 400);
      callback.searchParams.set('state', url.searchParams.get('state')); callback.searchParams.set('code', 'synthetic-code');
      const response = await fetch(callback);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Authentication is still being verified/);
    }, 0);
  };
  return {auth, onUrl, events, requests, profileCalls: () => profileCalls};
}
function noLeaks(value) {assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|receiver@|oauth2callback\?|code_verifier|code_challenge|client_secret|access_token|refresh_token/);}

test('real SDK exchange/token-info complete with strict scope and sanitized lifecycle events', async () => {
  const run = flow();
  await run.auth.connect(receiving, run.onUrl, {authorizeConnection: true});
  assert.equal(await run.auth.token(receiving), 'PRIVATE_ACCESS_TOKEN');
  assert.deepEqual(run.requests.map(request => request.stage), ['code_exchange', 'token_info']);
  assert.equal(run.profileCalls(), 1);
  const events = run.events.map(event => event.event);
  assert.ok(events.indexOf('listener_ready') < events.indexOf('callback_received'));
  assert.ok(events.indexOf('callback_received') < events.indexOf('code_exchange_started'));
  assert.ok(events.indexOf('code_exchange_succeeded') < events.indexOf('account_verification_started'));
  assert.equal(events.at(-1), 'listener_closed'); noLeaks(run.events);
  run.auth.disconnect();
});
for (const [failureStage, providerError, category, status] of [
  ['code_exchange', 'invalid_grant', 'invalid_grant', 400],
  ['code_exchange', 'invalid_client', 'invalid_client', 401],
  ['code_exchange', 'redirect_uri_mismatch', 'redirect_mismatch', 400],
  ['code_exchange', 'temporarily_unavailable', 'provider_unavailable', 503],
  ['token_info', 'invalid_grant', 'invalid_grant', 400],
  ['token_info', 'invalid_token', 'authentication_required', 400],
]) test(`${failureStage} ${providerError} exposes only stage/category/status and is never retried`, async () => {
  const run = flow({failureStage, providerError, status});
  await assert.rejects(run.auth.connect(receiving, run.onUrl, {authorizeConnection: true}), error => {
    assert.equal(error.code, 'GMAIL_SIGN_IN_FAILED'); assert.equal(error.oauthDiagnostic.stage, failureStage);
    assert.equal(error.oauthDiagnostic.category, category); assert.equal(error.oauthDiagnostic.httpStatus, status);
    noLeaks(error.oauthDiagnostic); return true;
  });
  assert.equal(run.requests.filter(request => request.stage === failureStage).length, 1);
  assert.equal(run.profileCalls(), 0); noLeaks(run.events);
  await assert.rejects(run.auth.token(receiving));
});
test('disabled Gmail API during account verification is distinguished from code exchange and never lists messages', async () => {
  const run = flow({profileReader: token => new GmailReadClient({getToken: async () => token,
    fetchFn: async (url, options) => {
      assert.equal(new URL(url).pathname, '/gmail/v1/users/me/profile'); assert.equal(options.method, 'GET');
      return {ok: false, status: 403, json: async () => ({error: {message: rawSecret,
        errors: [{reason: 'accessNotConfigured'}], details: [{reason: 'SERVICE_DISABLED', metadata: {secret: rawSecret}}]}})};
    }}).profile()});
  await assert.rejects(run.auth.connect(receiving, run.onUrl, {authorizeConnection: true}), error => {
    assert.equal(error.oauthDiagnostic.stage, 'account_verification'); assert.equal(error.oauthDiagnostic.category, 'api_disabled');
    assert.equal(error.oauthDiagnostic.httpStatus, 403); noLeaks(error.oauthDiagnostic); return true;
  });
  assert.equal(run.profileCalls(), 1); noLeaks(run.events); await assert.rejects(run.auth.token(receiving));
});
test('callback listener remains on IPv4 loopback during pending verification, then closes', async () => {
  let redirect, allowCompletion, entered;
  const started = new Promise(resolve => {entered = resolve;});
  const pending = new Promise(resolve => {allowCompletion = resolve;});
  const events = [];
  const operation = withOAuthLoopback({state: 'synthetic-state', onDiagnostic: event => events.push(event),
    buildUrl: url => url, onUrl: url => {
      redirect = new URL(url); const callback = new URL(url);
      callback.searchParams.set('state', 'synthetic-state'); callback.searchParams.set('code', 'synthetic-code');
      setTimeout(() => {fetch(callback).catch(() => {});}, 0);
    }, exchange: async code => {assert.equal(code, 'synthetic-code'); entered(); await pending; return 'complete';}});
  await started;
  try {
    assert.equal(redirect.hostname, '127.0.0.1');
    assert.equal((await fetch(redirect)).status, 400); // Still listening; no valid state/code.
    assert.ok(!events.some(event => event.event === 'listener_closed'));
  } finally {allowCompletion();}
  assert.equal(await operation, 'complete');
  await assert.rejects(fetch(redirect));
  assert.equal(events.at(-1).event, 'listener_closed'); noLeaks(events);
});
test('no callback yields a distinct bounded timeout and closes its listener', async () => {
  let redirect;
  await assert.rejects(withOAuthLoopback({state: 'synthetic-state', timeoutMs: 20,
    buildUrl: url => url, onUrl: url => {redirect = url;}, exchange: () => assert.fail('must not exchange without callback')}), error => {
    assert.equal(error.code, 'OAUTH_TIMEOUT');
    assert.equal(classifyOAuthFailure(error, 'callback_wait').category, 'callback_timeout'); return true;
  });
  await assert.rejects(fetch(redirect));
});
test('nested DNS/TLS errors are classified without raw request/error messages or unsafe fields', () => {
  for (const [code, category] of [['ENOTFOUND', 'network_dns'], ['ETIMEDOUT', 'network_timeout'],
    ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'tls_trust'], ['ECONNRESET', 'network_connection']]) {
    const error = Object.assign(Error(rawSecret), {cause: Object.assign(Error(rawSecret), {code}),
      config: {url: 'https://example.invalid/?code=' + rawSecret, headers: {Authorization: rawSecret}}});
    const diagnostic = classifyOAuthFailure(error, 'code_exchange');
    assert.equal(diagnostic.category, category); assert.equal(diagnostic.networkCode, code); noLeaks(diagnostic);
  }
  assert.equal(classifyOAuthFailure({code: '__proto__', message: rawSecret}, 'token_info').category, 'unexpected_error');
  const value = sanitizeOAuthDiagnostic({stage: 'code_exchange', category: 'invalid_client', message: rawSecret,
    url: rawSecret, httpStatus: 401, networkCode: rawSecret});
  assert.equal(value.httpStatus, 401); noLeaks(value);
  assert.equal(sanitizeOAuthDiagnostic({stage: rawSecret, category: 'invalid_client'}), null);
  assert.doesNotThrow(() => reportOAuthEvent(() => {throw Error(rawSecret);}, 'listener_ready', {port: 12345, url: rawSecret}));
});
test('enabling diagnostic output alone cannot authorize a Gmail connection or open configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-diagnostic-gate-'));
  try {
    const authDir = path.join(root, 'auth');
    const result = spawnSync(process.execPath, ['scripts/gmail-email.mjs', 'first-sync', '--diagnostics'], {
      encoding: 'utf8', timeout: 5000, env: {...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_GMAIL_AUTH_DIR: authDir},
    });
    assert.equal(result.status, 1); assert.match(result.stderr, /GMAIL_CONNECTION_NOT_AUTHORIZED/);
    assert.equal(result.stdout, ''); assert.equal(fs.existsSync(authDir), false);
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});
