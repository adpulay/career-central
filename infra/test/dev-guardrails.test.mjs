// Offline evaluation of the proposed dev-account SCPs (infra/policies/scp-dev-*.json):
// they must deny costly services, other regions and guardrail tampering, yet allow
// every action the fixture test needs. A small evaluator models SCP Deny statements
// (Action / NotAction, aws:RequestedRegion, aws:PrincipalArn). Real evaluation is
// confirmed in AWS by the IAM policy simulator, which applies SCPs (runbook step G4).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {App} from 'aws-cdk-lib';
import {Template} from 'aws-cdk-lib/assertions';
import {bundle} from '../scripts/bundle.mjs';
import {monitorConfig} from '../lib/config.mjs';
import {MonitorStack, TABLE_MAX_REQUEST_UNITS} from '../lib/monitor-stack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(here, '../policies', name), 'utf8'));
const SCPS = ['scp-dev-region.json', 'scp-dev-service-allowlist.json', 'scp-dev-cost-guardrails.json'].map(read);
const ACCT = '111111111111';
const P = {
  admin: `arn:aws:iam::${ACCT}:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_CareerCentralDevBootstrap_0123abcd`,
  operator: `arn:aws:iam::${ACCT}:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_CareerCentralDevOperator_0123abcd`,
  exec: `arn:aws:iam::${ACCT}:role/cdk-hnb659fds-cfn-exec-role-${ACCT}-us-east-1`,
  deploy: `arn:aws:iam::${ACCT}:role/cdk-hnb659fds-deploy-role-${ACCT}-us-east-1`,
  tick: `arn:aws:iam::${ACCT}:role/CareerCentralMonitor-dev-MonitorTickRoleD30A0824-AbC`,
  scheduler: `arn:aws:iam::${ACCT}:role/CareerCentralMonitor-dev-SchedulerRole59E73443-AbC`,
};
const glob = pattern => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
const matches = (patterns, value) => [patterns].flat().some(p => glob(p).test(value));
function deniedBy(request) {
  // resource defaults to a stack-owned ARN; resource-scoped statements (e.g. the bootstrap-role
  // protection) apply only when the request targets a matching resource.
  const {action, region = 'us-east-1', principal, resource = `arn:aws:iam::${ACCT}:role/CareerCentralMonitor-dev-Resource`} = request;
  for (const scp of SCPS) for (const s of scp.Statement) {
    if (s.Effect !== 'Deny') continue;
    if (s.Action ? !matches(s.Action, action) : matches(s.NotAction, action)) continue;
    if (s.Resource && s.Resource !== '*' && !matches(s.Resource, resource)) continue;
    const c = s.Condition ?? {};
    if (c.StringNotEquals?.['aws:RequestedRegion'] && c.StringNotEquals['aws:RequestedRegion'].includes(region)) continue;
    if (c.ArnNotLike?.['aws:PrincipalArn'] && matches(c.ArnNotLike['aws:PrincipalArn'], principal)) continue;
    return s.Sid;
  }
  return null;
}
const concrete = action => action.endsWith('*') ? `${action.slice(0, -1)}Probe` : action;
const allowActions = file => read(file).Statement.filter(s => s.Effect === 'Allow').flatMap(s => [s.Action].flat()).map(concrete);

test('every SCP fits the 5,120-character limit when minified and is a deny-only document', () => {
  for (const scp of SCPS) {
    assert.ok(JSON.stringify(scp).length <= 5120, `${JSON.stringify(scp).length} characters`);
    assert.ok(scp.Statement.every(s => s.Effect === 'Deny'), 'SCPs here only deny; FullAWSAccess stays attached');
  }
});

test('the fixture test is not blocked: bootstrap, deploy, runtime, operator checks and budget verification', () => {
  const needed = [
    ...allowActions('dev-cfn-execution-policy.json').map(action => ({action, principal: P.exec})),
    ...allowActions('dev-operator-policy.json').map(action => ({action, principal: P.operator})),
    ...allowActions('dev-role-boundary.json').map(action => ({action, principal: P.tick})),
    {action: 'lambda:InvokeFunction', principal: P.scheduler},
    ...['cloudformation:CreateChangeSet', 'cloudformation:ExecuteChangeSet', 'cloudformation:DescribeStacks', 'cloudformation:DeleteStack',
      's3:PutObject', 'ssm:GetParameters', 'iam:PassRole'].map(action => ({action, principal: P.deploy})),
    ...['cloudformation:CreateStack', 's3:CreateBucket', 's3:PutBucketPolicy', 'ssm:PutParameter', 'ecr:CreateRepository', 'ecr:SetRepositoryPolicy',
      'ecr:PutLifecyclePolicy', 'ecr:DeleteRepository', 'iam:CreateRole', 'iam:AttachRolePolicy', 'iam:PutRolePolicy', 'iam:CreatePolicy', 'iam:DeletePolicy',
      'access-analyzer:ValidatePolicy', 'sts:GetCallerIdentity', 'budgets:ModifyBudget', 'budgets:ViewBudget', 's3:PutAccountPublicAccessBlock',
      'servicequotas:GetServiceQuota', 'organizations:DescribeOrganization', 'iam:GetAccountSummary', 'iam:ListUsers', 'iam:SimulatePrincipalPolicy',
      'notifications-contacts:GetEmailContact', 'notifications:ListNotificationEvents', 'ce:GetCostAndUsage', 'account:GetAccountInformation',
      'cloudtrail:LookupEvents', 'dynamodb:DeleteTable', 's3:DeleteBucket', 's3:DeleteObjectVersion'].map(action => ({action, principal: P.admin})),
  ];
  const blocked = needed.filter(request => deniedBy(request)).map(r => `${r.action} (${deniedBy(r)})`);
  assert.deepEqual(blocked, []);
  // IAM, STS, Organizations and Budgets are global: a request routed through another region still works.
  for (const action of ['sts:GetCallerIdentity', 'iam:GetRole', 'budgets:ViewBudget']) assert.equal(deniedBy({action, region: 'us-west-2', principal: P.admin}), null, action);
});

test('costly services, other regions and guardrail tampering are denied for every principal, including the admin session', () => {
  const blockedEverywhere = ['ec2:RunInstances', 'ec2:CreateNatGateway', 'ec2:AllocateAddress', 'rds:CreateDBInstance', 'rds:CreateDBCluster',
    'sagemaker:CreateNotebookInstance', 'sagemaker:CreateEndpoint', 'bedrock:InvokeModel', 'es:CreateDomain', 'elasticache:CreateCacheCluster',
    'redshift:CreateCluster', 'eks:CreateCluster', 'ecs:CreateService', 'lightsail:CreateInstances', 'apigateway:POST', 'cloudfront:CreateDistribution',
    'elasticloadbalancing:CreateLoadBalancer', 'glue:CreateJob', 'athena:StartQueryExecution', 'kinesis:CreateStream', 'sns:Publish', 'sqs:CreateQueue',
    'aws-marketplace:Subscribe', 'savingsplans:CreateSavingsPlan', 'supportplans:CreateSupportPlanSchedule', 'route53domains:RegisterDomain', 'route53:CreateHostedZone',
    'ssm:StartSession', 'ssm:StartAutomationExecution', 'lambda:PutProvisionedConcurrencyConfig', 'lambda:CreateFunctionUrlConfig', 'lambda:AddPermission',
    'dynamodb:CreateTableReplica', 'dynamodb:PurchaseReservedCapacityOfferings', 's3:PutReplicationConfiguration', 's3:CreateMultiRegionAccessPoint',
    'kms:CreateKey', 'logs:StartLiveTail', 'logs:PutDataProtectionPolicy', 'cloudwatch:PutMetricStream', 'ecr:PutImage',
    'servicequotas:RequestServiceQuotaIncrease', 'organizations:LeaveOrganization', 'account:EnableRegion', 'iam:CreateUser', 'iam:CreateAccessKey',
    'cloudformation:ActivateType', 'cloudtrail:CreateTrail'];
  for (const principal of [P.admin, P.exec, P.operator, P.tick]) {
    const allowed = blockedEverywhere.filter(action => !deniedBy({action, principal}));
    assert.deepEqual(allowed, [], principal.split('/').at(-1));
  }
  for (const action of ['lambda:CreateFunction', 's3:CreateBucket', 'dynamodb:CreateTable', 'cloudformation:CreateStack', 'logs:CreateLogGroup'])
    for (const region of ['us-west-2', 'eu-west-1', 'ap-southeast-1']) assert.ok(deniedBy({action, region, principal: P.admin}), `${action} in ${region}`);
  // Identity Center role ARNs may carry the home region in their path; both forms keep admin access.
  const adminWithRegionPath = `arn:aws:iam::${ACCT}:role/aws-reserved/sso.amazonaws.com/us-east-1/AWSReservedSSO_CareerCentralDevBootstrap_0123abcd`;
  for (const principal of [P.admin, adminWithRegionPath]) assert.equal(deniedBy({action: 'budgets:ModifyBudget', principal}), null);
  for (const principal of [P.exec, P.operator, P.tick, P.deploy]) {
    assert.ok(deniedBy({action: 'budgets:ModifyBudget', principal}), 'only the admin session may change or delete budgets');
    assert.ok(deniedBy({action: 's3:PutAccountPublicAccessBlock', principal}), 'only the admin session may change account Block Public Access');
  }
});

test('stack cost ceilings: DynamoDB on-demand throughput capped; the stack budget can defer to a pre-existing account budget', async () => {
  const bundleDir = (await bundle()).outfile.replace(/[\\/]index\.mjs$/, '');
  const synth = overrides => {const app = new App(); const stack = new MonitorStack(app, 'CareerCentralMonitor-dev', {config: monitorConfig({fixtureSources: ['alpha'], ...overrides}), bundleDir}); return Template.fromStack(stack);};
  const deferred = synth({stackBudget: false, accountBudgetName: 'career-central-dev-guardrail', permissionsBoundaryName: 'CareerCentralDevRoleBoundary'});
  deferred.hasResourceProperties('AWS::DynamoDB::Table', {BillingMode: 'PAY_PER_REQUEST', OnDemandThroughput: {MaxReadRequestUnits: TABLE_MAX_REQUEST_UNITS, MaxWriteRequestUnits: TABLE_MAX_REQUEST_UNITS}});
  assert.equal(Object.keys(deferred.findResources('AWS::Budgets::Budget')).length, 0);
  assert.equal(Object.keys(synth({budgetEmail: 'budget@example.invalid'}).findResources('AWS::Budgets::Budget')).length, 1, 'default still creates the stack budget');
  assert.throws(() => monitorConfig({stackBudget: false}), /accountBudgetName/);
  assert.throws(() => monitorConfig({}), /budgetEmail is required/);
  const budget = read('dev-account-budget.json'), notifications = read('dev-account-budget-notifications.template.json');
  assert.deepEqual([budget.BudgetName, budget.BudgetType, budget.TimeUnit, budget.BudgetLimit], ['career-central-dev-guardrail', 'COST', 'MONTHLY', {Amount: '5', Unit: 'USD'}]);
  assert.deepEqual(notifications.map(n => [n.Notification.NotificationType, n.Notification.Threshold]), [['ACTUAL', 50], ['ACTUAL', 80], ['ACTUAL', 100], ['FORECASTED', 100]]);
  assert.ok(notifications.every(n => n.Subscribers[0].Address === '<budget-email>'), 'the committed template carries a placeholder, never a real address');
});
