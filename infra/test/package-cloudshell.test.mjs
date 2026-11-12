// The offline CloudShell package: exactly the reviewed assembly, policies and a
// self-contained seed script; checksummed; pinned to the dev account; nothing local
// or personal inside; the seed script runs from an empty directory without side effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {packageCloudShell, DEV_ACCOUNT, DEV_REGION} from '../scripts/package-cloudshell.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cloudshell-'));
const pkg = await packageCloudShell({outRoot});
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
test.after(() => fs.rmSync(outRoot, {recursive: true, force: true}));

test('package holds exactly the reviewed files, and SHA256SUMS verifies every one', () => {
  const rel = pkg.files.map(f => f.replace(/^cdk\.out\/asset\.[0-9a-f]{64}\//, 'cdk.out/asset/'));
  assert.deepEqual(rel, ['MANIFEST.json', 'SHA256SUMS', 'cdk.out/CareerCentralMonitor-dev.assets.json', 'cdk.out/CareerCentralMonitor-dev.metadata.json',
    'cdk.out/CareerCentralMonitor-dev.template.json', 'cdk.out/asset/index.mjs', 'cdk.out/asset/tracker-aliases.json', 'cdk.out/cdk.out', 'cdk.out/manifest.json',
    'cdk.out/tree.json', 'cdk.out/validation-report.json', 'policies/dev-account-budget-notifications.template.json', 'policies/dev-account-budget.json',
    'policies/dev-cfn-execution-policy.json', 'policies/dev-operator-policy.json', 'policies/dev-role-boundary.json', 'policies/scp-dev-cost-guardrails.json',
    'policies/scp-dev-region.json', 'policies/scp-dev-service-allowlist.json', 'seed-dev-fixture.mjs', 'tracker-aliases.json']);
  for (const line of fs.readFileSync(path.join(pkg.dir, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
    const [sum, file] = line.split(/\s+/);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(pkg.dir, file))).digest('hex'), sum, file);
  }
  assert.ok(fs.statSync(pkg.tarball).size < 10 * 1024 * 1024, 'small enough for a CloudShell upload');
});

test('nothing local, personal or secret anywhere in the package', () => {
  const patterns = {localPath: /\/home\/[^/\s"']+\/|[A-Za-z]:\\\\Users\\\\|\/root\//, email: /\b[\w.+-]+@(?!example\.(com|org|net|invalid)\b)[\w-]+\.(com|org|net|io|edu|me|co)\b/i,
    awsKey: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/, privateKey: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, token: /\bgh[pousr]_[A-Za-z0-9]{36,}|\bsk-ant-[A-Za-z0-9_-]{20,}|GOCSPX-/};
  const hits = walk(pkg.dir).flatMap(file => {const text = fs.readFileSync(file, 'utf8'); return Object.entries(patterns).filter(([, re]) => re.test(text)).map(([k]) => `${path.relative(pkg.dir, file)}: ${k}`);});
  assert.deepEqual(hits, []);
});

test('assembly: pinned to the dev account and region, fixture-only, boundary on, no budget, cdk-nag clean', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pkg.dir, 'cdk.out/manifest.json'), 'utf8'));
  assert.equal(manifest.artifacts['CareerCentralMonitor-dev'].environment, `aws://${DEV_ACCOUNT}/${DEV_REGION}`, 'cdk deploy refuses credentials for any other account');
  const t = JSON.parse(fs.readFileSync(path.join(pkg.dir, 'cdk.out/CareerCentralMonitor-dev.template.json'), 'utf8')), R = Object.values(t.Resources);
  assert.equal(R.length, 17);
  assert.equal(R.find(r => r.Type === 'AWS::Scheduler::Schedule').Properties.State, 'DISABLED');
  const env = R.find(r => r.Type === 'AWS::Lambda::Function').Properties.Environment.Variables;
  assert.equal(env.MONITOR_LIVE_READS, 'disabled'); assert.equal(env.MONITOR_FIXTURE_SOURCES, 'alpha');
  for (const role of R.filter(r => r.Type === 'AWS::IAM::Role')) assert.match(JSON.stringify(role.Properties.PermissionsBoundary), /policy\/CareerCentralDevRoleBoundary/);
  assert.equal(R.filter(r => r.Type === 'AWS::Budgets::Budget').length, 0);
  assert.deepEqual(R.find(r => r.Type === 'AWS::DynamoDB::Table').Properties.OnDemandThroughput, {MaxReadRequestUnits: 10, MaxWriteRequestUnits: 10});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pkg.dir, 'cdk.out/validation-report.json'), 'utf8')).pluginReports, []);
  assert.deepEqual(pkg.manifest.context.fixtureSources, ['alpha']);
});

test('bundled seed script: dry run from an empty directory touches nothing; --apply refuses non-dev targets', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-seed-'));
  try {
    const script = path.join(pkg.dir, 'seed-dev-fixture.mjs');
    const dry = spawnSync(process.execPath, ['--import', path.join(here, 'helpers/side-effect-guard.mjs'), script, 'probe'], {cwd, encoding: 'utf8', env: {PATH: process.env.PATH, HOME: cwd}, timeout: 60000});
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout.trim().split('\n').at(-1)).dryRun, true);
    const bad = spawnSync(process.execPath, [script, 'seed', '--apply', '--bucket', 'some-prod-bucket', '--table', 'prod-table', '--region', DEV_REGION], {cwd, encoding: 'utf8', env: {PATH: process.env.PATH, HOME: cwd}, timeout: 60000});
    assert.equal(bad.status, 1); assert.match(bad.stderr, /SEED_TARGET_NOT_DEV/);
    assert.deepEqual(fs.readdirSync(cwd), []);
  } finally {fs.rmSync(cwd, {recursive: true, force: true});}
});
