import http from 'node:http';

// No sign-in is initiated by import. Called only after explicit connection consent.
export async function withOAuthLoopback({state, buildUrl, onUrl, exchange, timeoutMs = 300000}) {
  let finish, timer, settled = false;
  const codePromise = new Promise((resolve, reject) => {finish = {resolve, reject};});
  codePromise.catch(() => {});
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    let url;
    try {url = new URL(request.url, 'http://127.0.0.1');} catch {response.writeHead(400); response.end(); return;}
    if (settled || request.method !== 'GET' || url.pathname !== '/oauth2callback' ||
        url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) {
      response.writeHead(400); response.end('Invalid OAuth callback'); return;
    }
    settled = true;
    if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1 ||
        !url.searchParams.get('code') || url.searchParams.get('code').length > 4096) {
      response.end('Sign-in was not completed. Return to the terminal.'); finish.reject(Error('OAUTH_SIGN_IN_FAILED')); return;
    }
    response.end('Sign-in received. Return to the terminal.'); finish.resolve(url.searchParams.get('code'));
  });
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
    timer = setTimeout(() => {settled = true; finish.reject(Error('OAUTH_TIMEOUT'));}, timeoutMs);
    onUrl(await buildUrl(redirectUri));
    return await exchange(await codePromise, redirectUri);
  } finally {clearTimeout(timer); server.close(); server.closeAllConnections();}
}
