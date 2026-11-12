// IAM name validity and S3 public-access protections. Action names and service
// condition keys are checked against test/fixtures/iam-catalog.json, a snapshot of
// AWS's Service Authorization Reference (refresh: node scripts/refresh-iam-catalog.mjs),
// so an action AWS does not know, such as s3:DeleteBucketPublicAccessBlock, fails here
// instead of in Access Analyzer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {App} from 'aws-cdk-lib';
import {Template} from 'aws-cdk-lib/assertions';
import {bundle} from '../scripts/bundle.mjs';
import {monitorConfig} from '../lib/config.mjs';
import {MonitorStack} from '../lib/monitor-stack.mjs';
import {policyPrefixes, POLICY_GLOB} from '../scripts/refresh-iam-catalog.mjs';
import {evaluate} from './helpers/iam-eval.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/iam-catalog.json'), 'utf8'));
const policyDir = path.join(here, '../policies');
const policies = Object.fromEntries(fs.readdirSync(policyDir).filter(f => POLICY_GLOB.test(f)).map(f => [f, JSON.parse(fs.readFileSync(path.join(policyDir, f), 'utf8'))]));
const GLOBAL_KEYS = new Set(['aws:PrincipalArn', 'aws:RequestedRegion', 'aws:ResourceAccount', 'aws:SecureTransport']);
const glob = p => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');

export function invalidActions(doc) {
  const bad = [];
  for (const s of doc.Statement) for (const action of [s.Action ?? s.NotAction].flat()) {
    if (action === '*') continue;
    const [prefix, name] = action.split(':'), known = catalog.services[prefix?.toLowerCase()]?.actions;
    if (!known) bad.push(`${action} (service not in catalog)`);
    else if (!name || !known.some(a => glob(name).test(a))) bad.push(`${action} (${s.Sid ?? 'no Sid'})`);
  }
  return bad;
}
function invalidConditionKeys(doc) {
  const bad = [];
  for (const s of doc.Statement) for (const keys of Object.values(s.Condition ?? {})) for (const key of Object.keys(keys)) {
    if (key.startsWith('aws:')) {if (!GLOBAL_KEYS.has(key)) bad.push(key); continue;}
    const service = catalog.services[key.split(':')[0]];
    if (!service || !service.conditionKeys.some(k => k.toLowerCase() === key.toLowerCase())) bad.push(`${key} (${s.Sid})`);
  }
  return bad;
}

const bundleDir = (await bundle()).outfile.replace(/[\\/]index\.mjs$/, '');
const template = Template.fromStack(new MonitorStack(new App(), 'CareerCentralMonitor-dev', {bundleDir, config: monitorConfig({stackBudget: false,
  accountBudgetName: 'career-central-dev-guardrail', fixtureSources: ['alpha'], permissionsBoundaryName: 'CareerCentralDevRoleBoundary'})})).toJSON();
const resources = type => Object.values(template.Resources).filter(r => r.Type === type);
const stackDocs = [...resources('AWS::IAM::Policy'), ...resources('AWS::S3::BucketPolicy')].map(r => r.Properties.PolicyDocument);

test('the catalog snapshot covers every service prefix the policies use', () => {
  assert.match(catalog.retrieved, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(policyPrefixes().filter(p => !catalog.services[p]), []);
});

test('the validator itself rejects names AWS does not define', () => {
  const probe = {Statement: [{Sid: 'Probe', Effect: 'Deny', Action: ['s3:DeleteBucketPublicAccessBlock', 'ec2:RunInstancez', 'notaservice:Do', 's3:Get*', 'lambda:*'], Resource: '*'}]};
  assert.deepEqual(invalidActions(probe), ['s3:DeleteBucketPublicAccessBlock (Probe)', 'ec2:RunInstancez (Probe)', 'notaservice:Do (service not in catalog)']);
});

test('every action and NotAction in every policy file and in the synthesized stack is a real IAM action', () => {
  const bad = Object.fromEntries([...Object.entries(policies), ...stackDocs.map((doc, i) => [`stack#${i}`, doc])].map(([name, doc]) => [name, invalidActions(doc)]).filter(([, v]) => v.length));
  assert.deepEqual(bad, {});
});

test('every condition key is a real service condition key or an expected global key', () => {
  const bad = Object.fromEntries([...Object.entries(policies), ...stackDocs.map((doc, i) => [`stack#${i}`, doc])].map(([name, doc]) => [name, invalidConditionKeys(doc)]).filter(([, v]) => v.length));
  assert.deepEqual(bad, {});
});

test('S3 public access stays prohibited: bucket hardened, nothing can grant public ACLs or weaken account-level Block Public Access', () => {
  const [bucket] = resources('AWS::S3::Bucket');
  assert.deepEqual(bucket.Properties.PublicAccessBlockConfiguration, {BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true});
  assert.deepEqual(bucket.Properties.OwnershipControls, {Rules: [{ObjectOwnership: 'BucketOwnerEnforced'}]}, 'ACLs disabled on the bucket');
  for (const s of resources('AWS::S3::BucketPolicy')[0].Properties.PolicyDocument.Statement) assert.equal(s.Effect, 'Deny', 'the bucket policy grants nothing');

  // No Allow anywhere (identity policies, boundary, runtime) may grant public-access weakening actions.
  const weakening = ['s3:PutAccountPublicAccessBlock', 's3:PutAccessPointPublicAccessBlock', 's3:PutBucketAcl', 's3:PutObjectAcl', 's3:PutObjectVersionAcl'];
  const allowDocs = [...Object.entries(policies).filter(([f]) => !f.startsWith('scp-')), ...stackDocs.map((doc, i) => [`stack#${i}`, doc])];
  for (const [name, doc] of allowDocs) for (const s of doc.Statement.filter(s => s.Effect === 'Allow'))
    for (const action of weakening) assert.ok(![s.Action].flat().some(a => glob(a).test(action)), `${name}/${s.Sid} must not allow ${action}`);
  // Bucket-level Block Public Access can be set (and, by the same permission, removed) only on the stack's own bucket.
  const bpa = Object.values(policies).flatMap(d => d.Statement).filter(s => s.Effect === 'Allow' && [s.Action].flat().some(a => glob(a).test('s3:PutBucketPublicAccessBlock')));
  assert.deepEqual(bpa.flatMap(s => [s.Resource].flat()), ['arn:aws:s3:::careercentralmonitor-dev-*']);
  // Account-level Block Public Access (which overrides any bucket setting) is locked by the SCP for every non-admin principal.
  const scps = Object.entries(policies).filter(([f]) => f.startsWith('scp-')).map(([, d]) => d), A = '978446946447';
  const anyone = {identity: [{Statement: [{Effect: 'Allow', Action: '*', Resource: '*'}]}], scps};
  for (const principal of [`arn:aws:iam::${A}:role/cdk-hnb659fds-cfn-exec-role-${A}-us-east-1`, `arn:aws:iam::${A}:role/cdk-hnb659fds-deploy-role-${A}-us-east-1`,
    `arn:aws:iam::${A}:role/aws-reserved/sso.amazonaws.com/us-east-2/AWSReservedSSO_CareerCentralDevOperator_0123`, `arn:aws:iam::${A}:role/CareerCentralMonitor-dev-MonitorTickRole-X`, `arn:aws:iam::${A}:root`])
    assert.equal(evaluate(anyone, {action: 's3:PutAccountPublicAccessBlock', context: {'aws:PrincipalArn': principal, 'aws:RequestedRegion': 'us-east-1'}}), 'explicitDeny', principal);
  assert.equal(evaluate(anyone, {action: 's3:PutAccountPublicAccessBlock', context: {'aws:PrincipalArn': `arn:aws:iam::${A}:role/aws-reserved/sso.amazonaws.com/us-east-2/AWSReservedSSO_AdministratorAccess_0123`, 'aws:RequestedRegion': 'us-east-1'}}), 'allowed', 'the admin session can still set it (G2)');
});
