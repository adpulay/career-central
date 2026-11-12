import http from 'node:http';
import {reportOAuthEvent} from './oauth-diagnostics.mjs';
const fail = code => Object.assign(Error(code), {code});

// No sign-in is initiated by import. Called only after explicit connection consent.
export async function withOAuthLoopback({state, buildUrl, onUrl, exchange, timeoutMs = 300000, onDiagnostic}) {
  let finish, timer, settled = false;
  const codePromise = new Promise((resolve, reject) => {finish = {resolve, reject};});
  codePromise.catch(() => {});
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    let url;
    try {url = new URL(request.url, 'http://127.0.0.1');} catch {response.writeHead(400); response.end(); return;}
    if (settled || request.method !== 'GET' || url.pathname !== '/oauth2callback' ||
        url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) {
      reportOAuthEvent(onDiagnostic, 'callback_rejected');
      response.writeHead(400); response.end('Invalid OAuth callback'); return;
    }
    settled = true;
    if (url.searchParams.has('error')) {
      reportOAuthEvent(onDiagnostic, 'callback_denied');
      response.end('Sign-in was not completed. Return to the terminal.'); finish.reject(fail('OAUTH_SIGN_IN_FAILED')); return;
    }
    if (url.searchParams.getAll('code').length !== 1 ||
        !url.searchParams.get('code') || url.searchParams.get('code').length > 4096) {
      response.end('Sign-in was not completed. Return to the terminal.'); finish.reject(fail('OAUTH_CALLBACK_INVALID')); return;
    }
    reportOAuthEvent(onDiagnostic, 'callback_received');
    response.end('Authorization callback received. Authentication is still being verified. Return to the terminal.'); finish.resolve(url.searchParams.get('code'));
  });
  try {
    await new Promise((resolve, reject) => {server.once('error', () => reject(fail('OAUTH_LISTENER_FAILED'))); server.listen(0, '127.0.0.1', resolve);});
    const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
    reportOAuthEvent(onDiagnostic, 'listener_ready', {port: server.address().port});
    timer = setTimeout(() => {settled = true; finish.reject(fail('OAUTH_TIMEOUT'));}, timeoutMs);
    onUrl(await buildUrl(redirectUri));
    return await exchange(await codePromise, redirectUri);
  } finally {
    clearTimeout(timer);
    await new Promise(resolve => {server.close(() => resolve()); server.closeAllConnections();});
    reportOAuthEvent(onDiagnostic, 'listener_closed');
  }
}
