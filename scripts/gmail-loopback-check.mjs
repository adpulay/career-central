#!/usr/bin/env node
// Synthetic Windows -> WSL connectivity check. No OAuth/config/credential imports.
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const marker = 'CAREER_OPS_LOCAL_CONNECTIVITY_OK';
const probePath = '/career-ops-probe-' + randomUUID();
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET' || request.url !== probePath) {response.writeHead(404); response.end(); return;}
  response.end(marker);
});
try {
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}${probePath}`;
  const local = await fetch(url, {signal: AbortSignal.timeout(5000)});
  if (await local.text() !== marker) throw Error();
  // URL is generated exclusively from a literal host, numeric port and UUID.
  // No account, OAuth URL, authorization code, token or user input is interpolated.
  const command = `$ErrorActionPreference = 'Stop'; try { $r = [System.Net.HttpWebRequest]::Create('${url}'); $r.Proxy = $null; $r.Timeout = 5000; $r.AllowAutoRedirect = $false; $s = $r.GetResponse(); $reader = New-Object System.IO.StreamReader($s.GetResponseStream()); $text = $reader.ReadToEnd(); $reader.Dispose(); $s.Dispose(); if ($text -eq '${marker}') { Write-Output 'WINDOWS_TO_WSL_OK' } else { exit 2 } } catch { exit 2 }`;
  let windows = 'unreachable';
  try {
    const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
      {timeout: 10000, maxBuffer: 4096, windowsHide: true});
    if (result.stdout.trim() === 'WINDOWS_TO_WSL_OK') windows = 'passed';
  } catch (error) {if (error.code === 'ENOENT') windows = 'windows_interop_unavailable';}
  console.log(JSON.stringify({probe: 'synthetic_windows_to_wsl', listenerHost: '127.0.0.1',
    listenerPort: port, wslLocal: 'passed', windowsToWsl: windows, oauthAttempted: false}, null, 2));
  if (windows !== 'passed') process.exitCode = 2;
} catch {console.error(JSON.stringify({error: 'SYNTHETIC_LOOPBACK_CHECK_FAILED', oauthAttempted: false})); process.exitCode = 2;}
finally {server.close(); server.closeAllConnections();}
