// Builds the offline package for running the fixture-only dev test from AWS
// CloudShell (docs/AWS_C1.md, "Running from AWS CloudShell"). Nothing here contacts
// AWS. The package holds:
//   cdk.out/                 the reviewed, pre-synthesized cloud assembly (deployed with
//                            `cdk deploy --app cdk.out`, so CloudShell never re-synthesizes)
//   policies/                the IAM, boundary, SCP and budget documents
//   seed-dev-fixture.mjs     the seeding/probe script as one file with the AWS SDK inlined
//   tracker-aliases.json     runtime data file the bundled modules read
//   MANIFEST.json, SHA256SUMS
// and a tarball beside it. The stack is pinned to account 978446946447 / us-east-1, so
// `cdk deploy` refuses to run with credentials for any other account.
//
//   node scripts/package-cloudshell.mjs [--reserved-concurrency 1]
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {bundle, noMainModule, EXTERNAL, FORBIDDEN} from './bundle.mjs';

const infra = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEV_ACCOUNT = '978446946447', DEV_REGION = 'us-east-1';
export const DEV_CONTEXT = Object.freeze({environment: 'dev', account: DEV_ACCOUNT, region: DEV_REGION, stackBudget: false,
  accountBudgetName: 'career-central-dev-guardrail', fixtureSources: ['alpha'], permissionsBoundaryName: 'CareerCentralDevRoleBoundary'});
export const PACKAGE_NAME = 'career-central-c1';
const POLICY_FILES = ['dev-cfn-execution-policy.json', 'dev-role-boundary.json', 'dev-operator-policy.json', 'scp-dev-region.json',
  'scp-dev-service-allowlist.json', 'scp-dev-cost-guardrails.json', 'dev-account-budget.json', 'dev-account-budget-notifications.template.json'];
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

export async function packageCloudShell({outRoot = path.join(infra, 'dist/cloudshell'), reservedConcurrency} = {}) {
  const dir = path.join(outRoot, PACKAGE_NAME);
  fs.rmSync(outRoot, {recursive: true, force: true}); fs.mkdirSync(path.join(dir, 'policies'), {recursive: true});
  const lambda = await bundle();
  if (lambda.forbidden.length || lambda.unexpectedFiles.length) throw Error('Lambda bundle failed its checks');
  const context = {...DEV_CONTEXT, ...(reservedConcurrency ? {reservedConcurrency} : {})};
  // Synthesize exactly what will be deployed. Stack traces off: no local paths in metadata.
  const synth = spawnSync(process.execPath, [path.join(infra, 'bin/app.mjs')], {cwd: infra, encoding: 'utf8',
    env: {...process.env, CDK_DISABLE_STACK_TRACE: '1', CDK_OUTDIR: path.join(dir, 'cdk.out'),
      CDK_CONTEXT_JSON: JSON.stringify({careerCentral: context, 'aws:cdk:disable-stack-trace': true, 'aws:cdk:disable-creation-stack-traces': true})}});
  if (synth.status !== 0) throw Error(`synth failed: ${synth.stderr.slice(-2000)}`);
  // cdk-nag acknowledgement annotations carry a `trace` (local file paths) that the flags
  // above do not suppress. Traces are diagnostics only; deployment never reads them.
  for (const file of walk(path.join(dir, 'cdk.out')).filter(f => f.endsWith('.metadata.json'))) {
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const entries of Object.values(metadata)) for (const entry of entries) delete entry.trace;
    fs.writeFileSync(file, JSON.stringify(metadata, null, 1) + '\n');
  }
  const seed = await build({entryPoints: [path.join(infra, 'scripts/seed-dev-fixture.mjs')], outfile: path.join(dir, 'seed-dev-fixture.mjs'), bundle: true,
    platform: 'node', target: 'node20', format: 'esm', metafile: true, legalComments: 'none', external: EXTERNAL, plugins: [noMainModule],
    banner: {js: "import {createRequire as __ccRequire} from 'node:module'; const require = __ccRequire(import.meta.url);"}});
  const seedForbidden = Object.keys(seed.metafile.inputs).filter(input => FORBIDDEN.some(re => re.test(input.replaceAll('\\', '/'))));
  if (seedForbidden.length) throw Error(`forbidden modules in seed bundle: ${seedForbidden.join(', ')}`);
  fs.copyFileSync(path.join(infra, '..', 'tracker-aliases.json'), path.join(dir, 'tracker-aliases.json'));
  for (const file of POLICY_FILES) fs.copyFileSync(path.join(infra, 'policies', file), path.join(dir, 'policies', file));
  const manifest = {package: PACKAGE_NAME, account: DEV_ACCOUNT, region: DEV_REGION, context, stack: 'CareerCentralMonitor-dev',
    cdkCli: JSON.parse(fs.readFileSync(path.join(infra, 'node_modules/aws-cdk/package.json'), 'utf8')).version, nodeRequired: '>=20'};
  fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  const files = walk(dir).map(file => path.relative(dir, file).replaceAll('\\', '/')).sort();
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), files.map(rel => `${sha256(path.join(dir, rel))}  ${rel}`).join('\n') + '\n');
  const tarball = path.join(outRoot, `${PACKAGE_NAME}.tar.gz`);
  const tar = spawnSync('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '-czf', tarball, '-C', outRoot, PACKAGE_NAME], {encoding: 'utf8'});
  if (tar.status !== 0) throw Error(`tar failed: ${tar.stderr}`);
  return {dir, tarball, tarballSha256: sha256(tarball), files: [...files, 'SHA256SUMS'].sort(), manifest};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--reserved-concurrency'), rc = i > 0 ? Number(process.argv[i + 1]) : undefined;
  if (rc !== undefined && ![1, 2].includes(rc)) {console.error('--reserved-concurrency must be 1 or 2'); process.exit(1);}
  const result = await packageCloudShell({reservedConcurrency: rc});
  console.log(JSON.stringify({tarball: path.relative(process.cwd(), result.tarball), sha256: result.tarballSha256, files: result.files.length, context: result.manifest.context}, null, 2));
}
