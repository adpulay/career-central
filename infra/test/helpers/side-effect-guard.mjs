// Preload (node --import) that records and blocks side effects: network
// (sockets, TLS, DNS, HTTP, fetch), file writes, child processes and reads of
// AWS credential files. Used to prove the Lambda bundle and its handler (with
// injected fake clients) do none of these.
import fs from 'node:fs'; import net from 'node:net'; import tls from 'node:tls'; import dns from 'node:dns';
import http from 'node:http'; import https from 'node:https'; import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
const violations = globalThis.__sideEffects = [];
const block = label => function blocked() {violations.push(label); throw Object.assign(Error(`BLOCKED_${label}`), {code: 'BLOCKED'});};
for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'createWriteStream', 'renameSync', 'unlinkSync', 'rmSync', 'copyFileSync', 'symlinkSync', 'mkdtempSync']) fs[name] = block(`fs.${name}`);
for (const name of ['writeFile', 'appendFile', 'mkdir', 'rename', 'unlink', 'rm', 'copyFile', 'mkdtemp']) fs.promises[name] = block(`fs.promises.${name}`);
const openSync = fs.openSync; fs.openSync = (file, flags = 'r', ...rest) => {if (/[wa+]/.test(String(flags))) block(`fs.openSync:${flags}`)(); return openSync(file, flags, ...rest);};
const readFileSync = fs.readFileSync; fs.readFileSync = (file, ...rest) => {if (/[\\/]\.aws[\\/]/.test(String(file))) block('read:~/.aws')(); return readFileSync(file, ...rest);};
net.Socket.prototype.connect = block('net.Socket.connect'); net.connect = net.createConnection = block('net.connect'); tls.connect = block('tls.connect');
dns.lookup = block('dns.lookup'); dns.promises.lookup = block('dns.promises.lookup');
http.request = http.get = block('http.request'); https.request = https.get = block('https.request'); globalThis.fetch = block('fetch');
for (const name of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) cp[name] = block(`child_process.${name}`);
syncBuiltinESMExports();
