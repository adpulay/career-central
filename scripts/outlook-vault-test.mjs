// Synthetic storage-only test. Never opens OAuth configuration or token caches.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createMicrosoftProtectedPersistence} from '../lib/email/protected-persistence.mjs';
import {acquireDirLock} from '../lib/dir-lock.mjs';

try {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {'test-id': {type: 'string'}}});
  const id = values['test-id'];
  if (!/^[a-f0-9]{32}$/.test(id || '') || positionals.length !== 1 || !['save', 'verify', 'delete'].includes(positionals[0])) throw Error();
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const storageDir = path.join(process.env.CAREER_OPS_OUTLOOK_AUTH_DIR || path.join(os.homedir(), '.local/state/career-ops/outlook'), 'vault-tests');
  const {persistence} = await createMicrosoftProtectedPersistence({repo, storageDir,
    serviceName: 'CareerCentral-Synthetic-Vault-Test', accountName: `test_${id}`});
  const lock = await acquireDirLock(persistence.getFilePath() + '.test-operation.lock', {timeoutMs: 5000, retryMs: 25, maxWaitMs: 5000});
  try {
    const marker = `CareerOps-SYNTHETIC-NOT-A-TOKEN-${id}`;
    if (positionals[0] === 'save') await persistence.save(marker);
    if (positionals[0] === 'verify') {
      if (await persistence.load() !== marker) throw Error();
      // Windows stores encrypted bytes at this path. Linux stores only a dummy
      // mtime marker; neither may contain the synthetic value in plaintext.
      if (fs.existsSync(persistence.getFilePath()) && fs.readFileSync(persistence.getFilePath()).includes(Buffer.from(marker))) throw Error();
      await persistence.delete();
    }
    if (positionals[0] === 'delete') await persistence.delete();
    console.log(JSON.stringify({result: 'passed', operation: positionals[0], syntheticOnly: true}));
  } finally {try {lock.release();} catch { /* no secret/path logging */ }}
} catch {console.error(JSON.stringify({error: 'SYNTHETIC_VAULT_TEST_FAILED'})); process.exitCode = 2;}
