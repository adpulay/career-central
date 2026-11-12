// Request-level regression tests of the dev IAM design: the CloudFormation execution
// policy, the role boundary, the synthesized runtime policies, the operator policy and
// the SCPs, evaluated together by test/helpers/iam-eval.mjs (a model of IAM; AWS's own
// evaluation is checked in the account at P2 and with the policy simulator).
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
import {evaluate, resolveIntrinsics, SUPPORTED_OPERATORS} from './helpers/iam-eval.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(here, '../policies', name), 'utf8'));
const exec = read('dev-cfn-execution-policy.json'), boundary = read('dev-role-boundary.json'), operator = read('dev-operator-policy.json');
const scps = ['scp-dev-region.json', 'scp-dev-service-allowlist.json', 'scp-dev-cost-guardrails.json'].map(read);
const A = '978446946447', OTHER = '111111111111', R = 'us-east-1';
const BOUNDARY_ARN = `arn:aws:iam::${A}:policy/CareerCentralDevRoleBoundary`;
const N = {
  bucket: 'careercentralmonitor-dev-monitorbucketeb03716e-1a2b3c4d5e6f', table: 'CareerCentralMonitor-dev-MonitorTableC7E99F62-1A2B3C',
  logs: 'CareerCentralMonitor-dev-MonitorTickLogs91B5E054-1A2B3C', fn: 'CareerCentralMonitor-dev-MonitorTick74D3E705-1A2B3C',
  tickRole: 'CareerCentralMonitor-dev-MonitorTickRoleD30A0824-1A2B3C', schedRole: 'CareerCentralMonitor-dev-SchedulerRole59E73443-1A2B3C',
};
const ARN = {
  bucket: `arn:aws:s3:::${N.bucket}`, table: `arn:aws:dynamodb:${R}:${A}:table/${N.table}`, logs: `arn:aws:logs:${R}:${A}:log-group:${N.logs}:*`,
  fn: `arn:aws:lambda:${R}:${A}:function:${N.fn}`, tickRole: `arn:aws:iam::${A}:role/${N.tickRole}`, schedRole: `arn:aws:iam::${A}:role/${N.schedRole}`,
  execRole: `arn:aws:iam::${A}:role/cdk-hnb659fds-cfn-exec-role-${A}-${R}`, deployRole: `arn:aws:iam::${A}:role/cdk-hnb659fds-deploy-role-${A}-${R}`,
  staging: `arn:aws:s3:::cdk-hnb659fds-assets-${A}-${R}`,
};
const inAcct = {'aws:ResourceAccount': A};

// Runtime policies exactly as synthesized for the dev context, with intrinsics resolved.
const bundleDir = (await bundle()).outfile.replace(/[\\/]index\.mjs$/, '');
const template = Template.fromStack(new MonitorStack(new App(), 'CareerCentralMonitor-dev', {bundleDir,
  config: monitorConfig({stackBudget: false, accountBudgetName: 'career-central-dev-guardrail', fixtureSources: ['alpha'], permissionsBoundaryName: 'CareerCentralDevRoleBoundary'})})).toJSON();
const idOf = type => Object.entries(template.Resources).filter(([, r]) => r.Type === type).map(([id]) => id);
const [roleTick, roleSched] = ['MonitorTickRole', 'SchedulerRole'].map(prefix => idOf('AWS::IAM::Role').find(id => id.startsWith(prefix)));
const byId = {
  [idOf('AWS::S3::Bucket')[0]]: {name: N.bucket, arn: ARN.bucket}, [idOf('AWS::DynamoDB::Table')[0]]: {name: N.table, arn: ARN.table},
  [idOf('AWS::Logs::LogGroup')[0]]: {name: N.logs, arn: ARN.logs}, [idOf('AWS::Lambda::Function')[0]]: {name: N.fn, arn: ARN.fn},
  [roleTick]: {name: N.tickRole, arn: ARN.tickRole}, [roleSched]: {name: N.schedRole, arn: ARN.schedRole},
};
const inlineFor = roleId => Object.values(template.Resources).filter(r => r.Type === 'AWS::IAM::Policy' && r.Properties.Roles.some(ref => ref.Ref === roleId))
  .map(r => resolveIntrinsics(r.Properties.PolicyDocument, {account: A, byId}));
const tick = {identity: inlineFor(roleTick), boundary, scps}, sched = {identity: inlineFor(roleSched), boundary, scps};
const cfn = {identity: [exec], scps}, op = {identity: [operator], scps};
const ctx = (extra = {}) => ({'aws:PrincipalArn': ARN.execRole, 'aws:RequestedRegion': R, ...extra});
const check = (principal, cases) => {
  const wrong = cases.filter(([action, resource, context, expected]) => evaluate(principal, {action, resource, context: context ?? {}}) !== expected)
    .map(([action, resource, , expected]) => `${action} on ${resource}: expected ${expected}, got ${evaluate(principal, {action, resource, context: cases.find(c => c[0] === action && c[1] === resource)[2] ?? {}})}`);
  assert.deepEqual(wrong, []);
};

test('every condition operator is a valid IAM operator modeled by the evaluator; keys are the intended ones', () => {
  const keys = new Set(), docs = [exec, boundary, operator, ...scps, ...inlineFor(roleTick), ...inlineFor(roleSched)];
  for (const doc of docs) for (const s of doc.Statement) for (const [op, entries] of Object.entries(s.Condition ?? {})) {
    assert.ok(SUPPORTED_OPERATORS.has(op), `${s.Sid}: ${op}`);
    Object.keys(entries).forEach(k => keys.add(k));
  }
  assert.deepEqual([...keys].sort(), ['aws:PrincipalArn', 'aws:RequestedRegion', 'aws:ResourceAccount', 'dynamodb:LeadingKeys', 'iam:PassedToService', 'iam:PermissionsBoundary', 'kms:ViaService']);
});

test('CloudFormation role: creates and rolls back exactly the stack, roles only with the boundary', () => {
  const bnd = ctx({'iam:PermissionsBoundary': BOUNDARY_ARN});
  check(cfn, [
    ['iam:CreateRole', ARN.tickRole, bnd, 'allowed'], ['iam:PutRolePolicy', ARN.tickRole, bnd, 'allowed'], ['iam:PutRolePermissionsBoundary', ARN.tickRole, bnd, 'allowed'],
    ['iam:TagRole', ARN.tickRole, ctx(), 'allowed'], ['iam:GetRole', ARN.tickRole, ctx(), 'allowed'],
    ['iam:PassRole', ARN.tickRole, ctx({'iam:PassedToService': 'lambda.amazonaws.com'}), 'allowed'],
    ['iam:PassRole', ARN.schedRole, ctx({'iam:PassedToService': 'scheduler.amazonaws.com'}), 'allowed'],
    ['s3:CreateBucket', ARN.bucket, ctx(), 'allowed'], ['s3:PutBucketPolicy', ARN.bucket, ctx(), 'allowed'], ['s3:PutLifecycleConfiguration', ARN.bucket, ctx(), 'allowed'],
    ['s3:PutBucketPublicAccessBlock', ARN.bucket, ctx(), 'allowed'], ['s3:PutBucketOwnershipControls', ARN.bucket, ctx(), 'allowed'],
    ['s3:GetObject', `${ARN.staging}/abc.zip`, ctx(inAcct), 'allowed'], ['kms:Decrypt', `arn:aws:kms:${R}:${A}:key/1234`, ctx({'kms:ViaService': `s3.${R}.amazonaws.com`}), 'allowed'],
    ['dynamodb:CreateTable', ARN.table, ctx(), 'allowed'], ['dynamodb:UpdateContinuousBackups', ARN.table, ctx(), 'allowed'], ['dynamodb:DescribeTable', ARN.table, ctx(), 'allowed'],
    ['lambda:CreateFunction', ARN.fn, ctx(), 'allowed'], ['lambda:PutFunctionEventInvokeConfig', ARN.fn, ctx(), 'allowed'], ['lambda:GetFunctionRecursionConfig', ARN.fn, ctx(), 'allowed'],
    ['logs:CreateLogGroup', ARN.logs.replace(/:\*$/, ''), ctx(), 'allowed'], ['logs:PutRetentionPolicy', ARN.logs.replace(/:\*$/, ''), ctx(), 'allowed'],
    ['scheduler:CreateSchedule', `arn:aws:scheduler:${R}:${A}:schedule/default/CareerCentralMonitor-dev-MonitorTickSchedule-1A2B`, ctx(), 'allowed'],
    ['cloudwatch:PutMetricAlarm', `arn:aws:cloudwatch:${R}:${A}:alarm:CareerCentralMonitor-dev-TickErrors7ABA3AC7-1A2B`, ctx(), 'allowed'],
    // Rollback and stack deletion
    ['lambda:DeleteFunction', ARN.fn, ctx(), 'allowed'], ['lambda:DeleteFunctionEventInvokeConfig', ARN.fn, ctx(), 'allowed'],
    ['iam:DeleteRolePolicy', ARN.tickRole, ctx(), 'allowed'], ['iam:ListInstanceProfilesForRole', ARN.tickRole, ctx(), 'allowed'], ['iam:DeleteRole', ARN.tickRole, ctx(), 'allowed'],
    ['logs:DeleteLogGroup', ARN.logs.replace(/:\*$/, ''), ctx(), 'allowed'], ['s3:DeleteBucketPolicy', ARN.bucket, ctx(), 'allowed'],
    ['scheduler:DeleteSchedule', `arn:aws:scheduler:${R}:${A}:schedule/default/CareerCentralMonitor-dev-MonitorTickSchedule-1A2B`, ctx(), 'allowed'],
    ['cloudwatch:DeleteAlarms', `arn:aws:cloudwatch:${R}:${A}:alarm:CareerCentralMonitor-dev-TickErrors7ABA3AC7-1A2B`, ctx(), 'allowed'],
  ]);
});

test('CloudFormation role cannot escalate, remove boundaries, open public endpoints, delete retained data or leave its scope', () => {
  check(cfn, [
    ['iam:CreateRole', ARN.tickRole, ctx(), 'explicitDeny'],
    ['iam:CreateRole', ARN.tickRole, ctx({'iam:PermissionsBoundary': `arn:aws:iam::${A}:policy/SomethingBroader`}), 'explicitDeny'],
    ['iam:CreateRole', `arn:aws:iam::${A}:role/AnyOtherRole`, ctx({'iam:PermissionsBoundary': BOUNDARY_ARN}), 'implicitDeny'],
    ['iam:CreateRole', `arn:aws:iam::${OTHER}:role/CareerCentralMonitor-dev-X`, ctx({'iam:PermissionsBoundary': BOUNDARY_ARN}), 'implicitDeny'],
    ['iam:PutRolePolicy', ARN.tickRole, ctx(), 'explicitDeny'],
    ['iam:DeleteRolePermissionsBoundary', ARN.tickRole, ctx(), 'explicitDeny'],
    ['iam:AttachRolePolicy', ARN.tickRole, ctx(), 'explicitDeny'],
    ['iam:CreatePolicyVersion', `arn:aws:iam::${A}:policy/CareerCentralDevCfnExec`, ctx(), 'explicitDeny'],
    ['iam:SetDefaultPolicyVersion', `arn:aws:iam::${A}:policy/CareerCentralDevRoleBoundary`, ctx(), 'explicitDeny'],
    ['iam:PutRolePolicy', ARN.execRole, ctx({'iam:PermissionsBoundary': BOUNDARY_ARN}), 'explicitDeny'],
    ['iam:UpdateAssumeRolePolicy', ARN.deployRole, ctx(), 'explicitDeny'],
    ['iam:PassRole', ARN.tickRole, ctx({'iam:PassedToService': 'ec2.amazonaws.com'}), 'implicitDeny'],
    ['iam:PassRole', ARN.execRole, ctx({'iam:PassedToService': 'cloudformation.amazonaws.com'}), 'implicitDeny'],
    ['iam:CreateUser', `arn:aws:iam::${A}:user/x`, ctx(), 'explicitDeny'], ['iam:CreateAccessKey', `arn:aws:iam::${A}:user/x`, ctx(), 'explicitDeny'],
    ['lambda:CreateFunctionUrlConfig', ARN.fn, ctx(), 'explicitDeny'], ['lambda:AddPermission', ARN.fn, ctx(), 'explicitDeny'],
    ['lambda:PutProvisionedConcurrencyConfig', ARN.fn, ctx(), 'explicitDeny'],
    ['s3:PutBucketAcl', ARN.bucket, ctx(), 'explicitDeny'], ['s3:PutAccountPublicAccessBlock', '*', ctx(), 'explicitDeny'],
    // Bucket-level Block Public Access: S3 has no separate "delete" permission (DeletePublicAccessBlock is
    // authorized by s3:PutBucketPublicAccessBlock), so CloudFormation may set it only on the stack's bucket.
    ['s3:PutBucketPublicAccessBlock', ARN.staging, ctx(), 'implicitDeny'],
    ['s3:PutBucketPublicAccessBlock', 'arn:aws:s3:::any-other-bucket', ctx(), 'implicitDeny'],
    ['s3:DeleteBucket', ARN.bucket, ctx(), 'implicitDeny'], ['dynamodb:DeleteTable', ARN.table, ctx(), 'implicitDeny'],
    ['s3:GetObject', `arn:aws:s3:::cdk-hnb659fds-assets-${OTHER}-${R}/abc.zip`, ctx({'aws:ResourceAccount': OTHER}), 'implicitDeny'],
    ['kms:Decrypt', `arn:aws:kms:${R}:${A}:key/1234`, ctx(), 'implicitDeny'], ['kms:CreateKey', '*', ctx(), 'explicitDeny'],
    ['ec2:RunInstances', '*', ctx(), 'explicitDeny'], ['apigateway:POST', '*', ctx(), 'explicitDeny'], ['sagemaker:CreateEndpoint', '*', ctx(), 'explicitDeny'],
    ['budgets:ModifyBudget', `arn:aws:budgets::${A}:budget/career-central-dev-guardrail`, ctx(), 'explicitDeny'],
    ['lambda:CreateFunction', `arn:aws:lambda:us-west-2:${A}:function:CareerCentralMonitor-dev-X`, ctx({'aws:RequestedRegion': 'us-west-2'}), 'explicitDeny'],
  ]);
});

test('runtime role (synthesized policy under the boundary): its exact runtime actions only', () => {
  const t = (extra = {}) => ({'aws:PrincipalArn': ARN.tickRole, 'aws:RequestedRegion': R, ...inAcct, ...extra});
  check(tick, [
    ['s3:GetObject', `${ARN.bucket}/monitor/partitions/alpha.json`, t(), 'allowed'], ['s3:PutObject', `${ARN.bucket}/monitor/partitions/alpha.json`, t(), 'allowed'],
    ['s3:GetObject', `${ARN.bucket}/projection/eligibility-v1.json`, t(), 'allowed'], ['s3:GetObject', `${ARN.bucket}/fixtures/alpha.json`, t(), 'allowed'],
    ['s3:ListBucket', ARN.bucket, t(), 'allowed'],
    ['dynamodb:GetItem', ARN.table, t(), 'allowed'], ['dynamodb:PutItem', ARN.table, t(), 'allowed'],
    ['dynamodb:DeleteItem', ARN.table, t({'dynamodb:LeadingKeys': ['MONITOR']}), 'allowed'],
    ['logs:PutLogEvents', `arn:aws:logs:${R}:${A}:log-group:${N.logs}:log-stream:2026/11/12/abc`, t(), 'allowed'],
    ['s3:PutObject', `${ARN.bucket}/projection/eligibility-v1.json`, t(), 'implicitDeny'], ['s3:DeleteObject', `${ARN.bucket}/monitor/partitions/alpha.json`, t(), 'implicitDeny'],
    ['dynamodb:DeleteItem', ARN.table, t({'dynamodb:LeadingKeys': ['SOURCE#alpha']}), 'implicitDeny'], ['dynamodb:Scan', ARN.table, t(), 'implicitDeny'],
    ['s3:GetObject', `arn:aws:s3:::careercentralmonitor-dev-elsewhere/monitor/partitions/x.json`, t({'aws:ResourceAccount': OTHER}), 'implicitDeny'],
    ['iam:CreateUser', `arn:aws:iam::${A}:user/x`, t(), 'explicitDeny'], ['ec2:RunInstances', '*', t(), 'explicitDeny'],
  ]);
  // The boundary caps even an over-broad inline policy added later.
  const widened = {...tick, identity: [...tick.identity, {Statement: [{Effect: 'Allow', Action: '*', Resource: '*'}]}]};
  check(widened, [['s3:DeleteObject', `${ARN.bucket}/x`, t(), 'implicitDeny'], ['iam:PutRolePolicy', ARN.tickRole, t(), 'implicitDeny'],
    ['dynamodb:DeleteTable', ARN.table, t(), 'implicitDeny'], ['lambda:UpdateFunctionCode', ARN.fn, t(), 'implicitDeny']]);
  check(sched, [['lambda:InvokeFunction', ARN.fn, {'aws:PrincipalArn': ARN.schedRole, 'aws:RequestedRegion': R}, 'allowed'],
    ['lambda:InvokeFunction', `arn:aws:lambda:${R}:${A}:function:SomethingElse`, {'aws:PrincipalArn': ARN.schedRole, 'aws:RequestedRegion': R}, 'implicitDeny']]);
});

test('operator: deploys only via the CDK roles; seeds and tears down only its own account resources', () => {
  const o = (extra = {}) => ({'aws:PrincipalArn': `arn:aws:iam::${A}:role/aws-reserved/sso.amazonaws.com/us-east-2/AWSReservedSSO_CareerCentralDevOperator_0123`, 'aws:RequestedRegion': R, ...extra});
  check(op, [
    ['sts:AssumeRole', ARN.deployRole, o(), 'allowed'], ['sts:AssumeRole', ARN.execRole, o(), 'implicitDeny'], ['sts:AssumeRole', `arn:aws:iam::${A}:role/cdk-hnb659fds-lookup-role-${A}-${R}`, o(), 'implicitDeny'],
    ['s3:PutObject', `${ARN.bucket}/fixtures/alpha.json`, o(inAcct), 'allowed'], ['s3:DeleteObjectVersion', `${ARN.bucket}/x`, o(inAcct), 'allowed'],
    ['s3:PutObject', `arn:aws:s3:::careercentralmonitor-dev-elsewhere/x`, o({'aws:ResourceAccount': OTHER}), 'implicitDeny'],
    ['lambda:InvokeFunction', ARN.fn, o(), 'allowed'], ['lambda:UpdateFunctionCode', ARN.fn, o(), 'implicitDeny'],
    ['iam:CreateRole', ARN.tickRole, o({'iam:PermissionsBoundary': BOUNDARY_ARN}), 'implicitDeny'], ['cloudformation:UpdateStack', '*', o(), 'implicitDeny'],
    ['budgets:ModifyBudget', `arn:aws:budgets::${A}:budget/career-central-dev-guardrail`, o(), 'explicitDeny'],
    ['dynamodb:DeleteTable', ARN.table, o(), 'allowed'], ['s3:DeleteBucket', ARN.bucket, o(inAcct), 'allowed'],
  ]);
});

test('SCPs: CloudShell works for the admin session in us-east-1 only; admin sessions keep guardrail control', () => {
  const adminArn = `arn:aws:iam::${A}:role/aws-reserved/sso.amazonaws.com/us-east-2/AWSReservedSSO_AdministratorAccess_0123abcd`;
  const admin = {identity: [{Statement: [{Effect: 'Allow', Action: '*', Resource: '*'}]}], scps};
  check(admin, [
    ['cloudshell:CreateSession', '*', {'aws:PrincipalArn': adminArn, 'aws:RequestedRegion': R}, 'allowed'],
    ['cloudshell:CreateSession', '*', {'aws:PrincipalArn': adminArn, 'aws:RequestedRegion': 'us-east-2'}, 'explicitDeny'],
    ['budgets:ModifyBudget', '*', {'aws:PrincipalArn': adminArn, 'aws:RequestedRegion': R}, 'allowed'],
    ['iam:CreatePolicy', `arn:aws:iam::${A}:policy/CareerCentralDevCfnExec`, {'aws:PrincipalArn': adminArn, 'aws:RequestedRegion': R}, 'allowed'],
    ['iam:CreateRole', ARN.execRole, {'aws:PrincipalArn': adminArn, 'aws:RequestedRegion': R}, 'allowed'],
    ['iam:PutRolePolicy', ARN.execRole, {'aws:PrincipalArn': adminArn, 'aws:RequestedRegion': R}, 'allowed'],
    ['ec2:RunInstances', '*', {'aws:PrincipalArn': adminArn, 'aws:RequestedRegion': R}, 'explicitDeny'],
    ['kms:CreateKey', '*', {'aws:PrincipalArn': adminArn, 'aws:RequestedRegion': R}, 'explicitDeny'],
    ['organizations:LeaveOrganization', '*', {'aws:PrincipalArn': adminArn, 'aws:RequestedRegion': R}, 'explicitDeny'],
    ['iam:DeleteRolePermissionsBoundary', ARN.tickRole, {'aws:PrincipalArn': ARN.execRole, 'aws:RequestedRegion': R}, 'explicitDeny'],
    ['iam:PutRolePolicy', ARN.execRole, {'aws:PrincipalArn': ARN.deployRole, 'aws:RequestedRegion': R}, 'explicitDeny'],
  ]);
});
