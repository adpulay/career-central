// Offline checks of the proposed dev-account IAM policies (infra/policies/) against
// the synthesized stack. Nothing here calls AWS; IAM's own evaluation is confirmed
// in the dev test (policy simulator step). See docs/AWS_C1.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {App, Validations} from 'aws-cdk-lib';
import {Template} from 'aws-cdk-lib/assertions';
import cdkNag from 'cdk-nag';
const {AwsSolutionsChecks} = cdkNag;
import {bundle} from '../scripts/bundle.mjs';
import {monitorConfig} from '../lib/config.mjs';
import {MonitorStack} from '../lib/monitor-stack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = name => JSON.parse(fs.readFileSync(path.join(here, '../policies', `${name}.json`), 'utf8'));
const exec = policy('dev-cfn-execution-policy'), boundary = policy('dev-role-boundary'), operator = policy('dev-operator-policy');
const BOUNDARY = 'CareerCentralDevRoleBoundary';
const bundleDir = (await bundle()).outfile.replace(/[\\/]index\.mjs$/, '');
function synth(overrides = {}) {
  const app = new App(), config = monitorConfig({budgetEmail: 'budget@example.invalid', fixtureSources: ['alpha'], ...overrides});
  const stack = new MonitorStack(app, 'CareerCentralMonitor-dev', {config, bundleDir});
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app)); app.synth();
  return Template.fromStack(stack).toJSON();
}
// The dev deployment context: boundary on, and the account-level guardrail budget
// (created and verified before deployment) instead of a stack budget.
const deployed = synth({permissionsBoundaryName: BOUNDARY, stackBudget: false, accountBudgetName: 'career-central-dev-guardrail'});
const allows = doc => doc.Statement.filter(s => s.Effect === 'Allow');
const actionsOf = doc => new Set(allows(doc).flatMap(s => [s.Action].flat()));
const covers = (granted, action) => [...granted].some(g => g === action || (g.endsWith('*') && action.startsWith(g.slice(0, -1))));

test('every policy: valid, Allow statements name exact services, us-east-1 only, no unscoped wildcards', () => {
  for (const [name, doc] of Object.entries({exec, boundary, operator})) {
    assert.equal(doc.Version, '2012-10-17', name);
    for (const s of allows(doc)) {
      for (const action of [s.Action].flat()) assert.match(action, /^[a-z0-9-]+:[A-Za-z]+\*?$/, `${name}/${s.Sid}: ${action}`);
      for (const resource of [s.Resource].flat()) {
        if (resource === '*') assert.ok(s.Condition || ['ListForOrphanCheck'].includes(s.Sid), `${name}/${s.Sid}: Resource "*" needs a condition or a list-only reason`);
        else assert.match(resource, /^arn:aws:[a-z0-9-]+:(us-east-1)?:/, `${name}/${s.Sid}: ${resource}`);
      }
    }
  }
  const unscopedAllows = [...allows(operator), ...allows(exec)].filter(s => [s.Resource].flat().includes('*')).flatMap(s => [s.Action].flat()).sort();
  assert.deepEqual(unscopedAllows, ['dynamodb:ListTables', 's3:ListAllMyBuckets']);
  // Every ARN that has an account field names the development account, never a wildcard.
  for (const doc of [exec, boundary, operator]) for (const s of allows(doc)) for (const arn of [s.Resource].flat().filter(r => r !== '*' && !r.startsWith('arn:aws:s3:::')))
    assert.match(arn, /^arn:aws:[a-z0-9-]+:(us-east-1)?:978446946447:/, `${s.Sid}: ${arn}`);
  // S3 ARNs carry no account, so S3 object and bucket access in the boundary and operator policy is pinned by aws:ResourceAccount.
  for (const doc of [boundary, operator]) for (const s of allows(doc).filter(s => [s.Resource].flat().some(r => r.startsWith('arn:aws:s3:::'))))
    assert.deepEqual(s.Condition, {StringEquals: {'aws:ResourceAccount': '978446946447'}}, s.Sid);
});

test('execution policy can create exactly the resource types the stack contains', () => {
  const required = {'AWS::S3::Bucket': 's3:CreateBucket', 'AWS::S3::BucketPolicy': 's3:PutBucketPolicy', 'AWS::DynamoDB::Table': 'dynamodb:CreateTable',
    'AWS::Logs::LogGroup': 'logs:CreateLogGroup', 'AWS::IAM::Role': 'iam:CreateRole', 'AWS::IAM::Policy': 'iam:PutRolePolicy',
    'AWS::Lambda::Function': 'lambda:CreateFunction', 'AWS::Lambda::EventInvokeConfig': 'lambda:PutFunctionEventInvokeConfig',
    'AWS::Scheduler::Schedule': 'scheduler:CreateSchedule', 'AWS::CloudWatch::Alarm': 'cloudwatch:PutMetricAlarm', 'AWS::Budgets::Budget': 'budgets:ModifyBudget'};
  const granted = actionsOf(exec);
  for (const type of new Set(Object.values(deployed.Resources).map(r => r.Type))) {
    assert.ok(required[type], `new resource type ${type}: add its permissions to the execution policy and this map`);
    assert.ok(covers(granted, required[type]), `${type} needs ${required[type]}`);
  }
  for (const missing of ['dynamodb:DeleteTable', 's3:DeleteBucket', 'iam:AttachRolePolicy', 'lambda:AddPermission', 'lambda:CreateFunctionUrlConfig'])
    assert.ok(!covers(granted, missing), `${missing} is not granted (retained data; no managed policies; no public endpoints)`);
  // Budgets are managed only by the admin session (the SCP reserves budgets:ModifyBudget for it).
  assert.equal(Object.values(deployed.Resources).filter(r => r.Type === 'AWS::Budgets::Budget').length, 0);
  assert.ok(!covers(granted, 'budgets:ModifyBudget'), 'CloudFormation cannot create, change or delete budgets');
});

test('execution policy: roles only with the boundary; pass roles only to Lambda and Scheduler; public endpoints denied', () => {
  const boundaryArn = `arn:aws:iam::978446946447:policy/${BOUNDARY}`, roleActions = ['iam:CreateRole', 'iam:PutRolePermissionsBoundary', 'iam:PutRolePolicy'];
  const create = exec.Statement.find(s => s.Sid === 'CreateOrChangeStackRolesOnlyWithBoundary');
  assert.deepEqual([create.Action].flat().sort(), roleActions);
  // Exact ARN with StringEquals (iam:PermissionsBoundary is a single-valued string key), scoped to this account.
  assert.deepEqual(create.Condition, {StringEquals: {'iam:PermissionsBoundary': boundaryArn}});
  const guard = exec.Statement.find(s => s.Sid === 'DenyRoleChangesWithoutTheBoundary');
  assert.equal(guard.Effect, 'Deny'); assert.deepEqual([guard.Action].flat().sort(), roleActions); assert.equal(guard.Resource, '*');
  assert.deepEqual(guard.Condition, {StringNotEquals: {'iam:PermissionsBoundary': boundaryArn}}, 'a missing or different boundary is an explicit deny');
  assert.ok(!allows(exec).filter(s => s !== create).some(s => roleActions.some(action => covers(new Set([s.Action].flat()), action))), 'no unconditioned role creation');
  assert.deepEqual(exec.Statement.find(s => s.Sid === 'PassStackRolesToLambdaAndScheduler').Condition, {StringEquals: {'iam:PassedToService': ['lambda.amazonaws.com', 'scheduler.amazonaws.com']}});
  const denied = new Set(exec.Statement.filter(s => s.Effect === 'Deny').flatMap(s => [s.Action].flat()));
  for (const action of ['lambda:CreateFunctionUrlConfig', 'lambda:AddPermission', 's3:DeleteBucketPublicAccessBlock', 'iam:DeleteRolePermissionsBoundary', 'ec2:*',
    'iam:CreatePolicyVersion', 'iam:SetDefaultPolicyVersion', 'iam:AttachRolePolicy', 'iam:CreateUser', 'iam:CreateAccessKey']) assert.ok(denied.has(action), action);
});

test('boundary: applied to every stack role when configured, absent otherwise, and covers every runtime action', () => {
  const roles = Object.values(deployed.Resources).filter(r => r.Type === 'AWS::IAM::Role');
  assert.equal(roles.length, 2);
  for (const role of roles) assert.match(JSON.stringify(role.Properties.PermissionsBoundary), new RegExp(`:policy/${BOUNDARY}"`));
  for (const role of Object.values(synth().Resources).filter(r => r.Type === 'AWS::IAM::Role')) assert.equal(role.Properties.PermissionsBoundary, undefined);
  const runtime = Object.values(deployed.Resources).filter(r => r.Type === 'AWS::IAM::Policy').flatMap(p => p.Properties.PolicyDocument.Statement.flatMap(s => [s.Action].flat()));
  const capped = actionsOf(boundary);
  for (const action of runtime) assert.ok(covers(capped, action), `boundary must allow ${action}, or the function breaks`);
  assert.deepEqual([...capped].sort(), [...new Set(runtime)].sort(), 'the boundary grants nothing the roles do not use');
  assert.throws(() => monitorConfig({budgetEmail: 'budget@example.invalid', permissionsBoundaryName: 'bad name!'}), /permissionsBoundaryName/);
});

test('operator policy: deploys only through the CDK bootstrap roles and never edits IAM', () => {
  const granted = actionsOf(operator);
  assert.ok(allows(operator).find(s => s.Sid === 'CdkDeployThroughBootstrapRoles').Resource.every(arn => /role\/cdk-hnb659fds-(deploy|file-publishing)-role-978446946447-us-east-1$/.test(arn)));
  for (const action of ['iam:CreateRole', 'iam:PutRolePolicy', 'iam:PassRole', 'cloudformation:CreateStack', 'cloudformation:UpdateStack', 'lambda:UpdateFunctionCode', 'scheduler:UpdateSchedule'])
    assert.ok(!covers(granted, action), `operator cannot ${action} directly`);
});
