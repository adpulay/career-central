// Builds the Lambda bundle, then runs it in a child process under a side-effect
// guard: no network, file writes, child processes or credential reads, in an
// empty working directory with no AWS environment. Drives the BUNDLED handler
// with dev fixtures and fake AWS clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {bundle, MAX_BUNDLE_BYTES} from '../scripts/bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('bundle builds within limits with pinned SDK, runtime assets and stubbed main-module guard', async () => {
  const report = await bundle();
  assert.deepEqual(report.forbidden, []); assert.ok(report.bytes < MAX_BUNDLE_BYTES, `${report.bytes} bytes`);
  assert.equal(report.mainGuardStubbed, true); assert.equal(report.sdkPinned, true);
  assert.deepEqual(report.unexpectedFiles, [], 'the deployed asset directory holds only the bundle and runtime assets');
  const deployed = fs.readdirSync(path.dirname(report.outfile)).map(name => fs.readFileSync(path.join(path.dirname(report.outfile), name), 'utf8')).join('\n');
  assert.doesNotMatch(deployed, /\/home\/[^/\s"']+\/|[A-Za-z]:\\Users\\/, 'no local absolute paths ship to Lambda');
  for (const asset of report.assets) assert.ok(fs.existsSync(path.join(path.dirname(report.outfile), asset)), `${asset} packaged`);
});

test('bundled handler: no side effects on import; dev fixtures only; quiet baseline, one alert, no duplicate; ownership respected', async () => {
  const report = await bundle();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-smoke-'));
  try {
    const run = spawnSync(process.execPath, ['--import', path.join(here, 'helpers/side-effect-guard.mjs'), path.join(here, 'helpers/bundle-child.mjs')],
      {cwd, encoding: 'utf8', env: {PATH: process.env.PATH, HOME: cwd, BUNDLE: report.outfile}, timeout: 120000});
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout.trim().split('\n').at(-1));
    assert.deepEqual(out.afterImport, [], 'importing the bundle had no side effects');
    assert.deepEqual(out.sideEffects, [], 'the whole fixture run had no network, file, process or credential access');
    assert.deepEqual(out.exports, ['function', 'function']);
    assert.equal(out.liveFetches, 0, 'live reader never called');
    assert.equal(out.run1.ok, true); assert.equal(out.run2.ok, true); assert.equal(out.run3.ok, true);
    assert.equal(out.alerts, 1, 'baseline quiet, one alert for the controlled change, none on repeat');
    assert.equal(out.alphaCheckpoint, 'synthetic', 'fixture data is never recorded as a live feed');
    assert.deepEqual({status: out.bravo.status, errorCategory: out.bravo.errorCategory, checkpoint: out.bravo.checkpoint}, {status: 'failed', errorCategory: 'MONITOR_LIVE_NOT_AUTHORIZED', checkpoint: null}, 'non-fixture source fails closed');
    assert.equal(out.charlieCheckpoint, null, 'locally owned source skipped by the cloud handler');
    assert.equal(out.logLeak, false); assert.ok(out.logCount > 0);
    assert.deepEqual(fs.readdirSync(cwd), [], 'nothing written to the working directory');
  } finally {fs.rmSync(cwd, {recursive: true, force: true});}
});
