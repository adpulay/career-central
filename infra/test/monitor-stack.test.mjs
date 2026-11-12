// Synth-only tests of the monitor stack: no AWS credentials, account or deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {App, Validations, aws_iam as iam} from 'aws-cdk-lib';
import {Template, Annotations, Match} from 'aws-cdk-lib/assertions';
import cdkNag from 'cdk-nag';
const {AwsSolutionsChecks} = cdkNag; // CommonJS package
import {bundle} from '../scripts/bundle.mjs';
import {monitorConfig, contextConfig} from '../lib/config.mjs';
import {MonitorStack} from '../lib/monitor-stack.mjs';

const report = await bundle();
const bundleDir = report.outfile.replace(/[\\/]index\.mjs$/, '');
const EMAIL = 'budget-alerts@example.invalid';
function synth(overrides = {}) {
  const app = new App(), config = monitorConfig({budgetEmail: EMAIL, ...overrides});
  const stack = new MonitorStack(app, `CareerCentralMonitor-${config.environment}`, {config, bundleDir,
    ...(config.account ? {env: {account: config.account, region: config.region}} : {})});
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  app.synth(); // throws 'Validation failed' on any unacknowledged cdk-nag finding
  return {stack, template: Template.fromStack(stack)};
}
const {stack, template} = synth();
const resourcesOf = type => Object.values(template.findResources(type));

test('bucket: no public access, encrypted, TLS-only, versioned with bounded old versions, retained', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true},
    BucketEncryption: {ServerSideEncryptionConfiguration: [{ServerSideEncryptionByDefault: {SSEAlgorithm: 'AES256'}}]},
    VersioningConfiguration: {Status: 'Enabled'}, OwnershipControls: {Rules: [{ObjectOwnership: 'BucketOwnerEnforced'}]},
    LifecycleConfiguration: {Rules: Match.arrayWith([Match.objectLike({NoncurrentVersionExpiration: {NoncurrentDays: 30}, AbortIncompleteMultipartUpload: {DaysAfterInitiation: 1}})])}});
  template.hasResource('AWS::S3::Bucket', {DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain'});
  template.hasResourceProperties('AWS::S3::BucketPolicy', {PolicyDocument: {Statement: Match.arrayWith([Match.objectLike({
    Effect: 'Deny', Action: 's3:*', Condition: {Bool: {'aws:SecureTransport': 'false'}}, Principal: {AWS: '*'}})])}});
  assert.equal(resourcesOf('AWS::S3::Bucket').length, 1);
});

test('table: on-demand, encrypted, point-in-time recovery, retained; prod adds deletion protection', () => {
  template.hasResourceProperties('AWS::DynamoDB::Table', {BillingMode: 'PAY_PER_REQUEST', SSESpecification: {SSEEnabled: true},
    PointInTimeRecoverySpecification: {PointInTimeRecoveryEnabled: true}, KeySchema: [{AttributeName: 'pk', KeyType: 'HASH'}, {AttributeName: 'sk', KeyType: 'RANGE'}]});
  template.hasResource('AWS::DynamoDB::Table', {DeletionPolicy: 'Retain'});
  const prod = synth({environment: 'prod', confirmProduction: true, account: '123456789012', region: 'us-east-1'}).template;
  prod.hasResourceProperties('AWS::DynamoDB::Table', {DeletionProtectionEnabled: true});
});

test('lambda: arm64 Node 24, bounded, no VPC, live reads off by default, logs retained 14 days', () => {
  template.hasResourceProperties('AWS::Lambda::Function', {Runtime: 'nodejs24.x', Architectures: ['arm64'], MemorySize: 512, Timeout: 300, Handler: 'index.handler',
    Environment: {Variables: Match.objectLike({MONITOR_ENVIRONMENT: 'dev', MONITOR_LIVE_READS: 'disabled'})}});
  const [fn] = resourcesOf('AWS::Lambda::Function');
  assert.equal(fn.Properties.VpcConfig, undefined); assert.equal(fn.Properties.Environment.Variables.MONITOR_FIXTURE_SOURCES, undefined);
  assert.equal(fn.Properties.ReservedConcurrentExecutions, undefined, 'not reserved by default (new accounts may lack headroom); distributed leases provide exclusion');
  template.hasResourceProperties('AWS::Logs::LogGroup', {RetentionInDays: 14});
  assert.equal(resourcesOf('AWS::Lambda::Function').length, 1, 'no extra helper functions (no autoDeleteObjects custom resource)');
});

test('IAM: exact actions on exact resources, no wildcard actions, no managed policies, no admin', () => {
  const policies = resourcesOf('AWS::IAM::Policy').flatMap(policy => policy.Properties.PolicyDocument.Statement);
  const actions = policies.flatMap(statement => [statement.Action].flat()).sort();
  assert.deepEqual([...new Set(actions)], ['dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'lambda:InvokeFunction', 'logs:CreateLogStream', 'logs:PutLogEvents', 's3:GetObject', 's3:ListBucket', 's3:PutObject']);
  const del = policies.filter(statement => [statement.Action].flat().includes('dynamodb:DeleteItem'));
  assert.equal(del.length, 1); assert.deepEqual([del[0].Action].flat(), ['dynamodb:DeleteItem']);
  assert.deepEqual(del[0].Condition, {'ForAllValues:StringEquals': {'dynamodb:LeadingKeys': ['MONITOR']}}, 'deletes confined to the tick-lease partition');
  const list = policies.find(statement => statement.Sid === 'MissingObjectsAs404');
  assert.deepEqual([list.Action].flat(), ['s3:ListBucket'], 'ListBucket only, so a missing key reads as 404 not 403');
  assert.doesNotMatch(JSON.stringify(list.Resource), /\/\*/, 'ListBucket on the bucket ARN, not objects');
  for (const statement of policies) {
    assert.equal(statement.Effect, 'Allow');
    assert.ok(![statement.Resource].flat().includes('*'), `no Resource "*" in ${statement.Sid}`);
    assert.ok(![statement.Action].flat().some(action => action.includes('*')), `no wildcard action in ${statement.Sid}`);
  }
  for (const role of resourcesOf('AWS::IAM::Role')) assert.equal(role.Properties.ManagedPolicyArns, undefined, 'no managed policies');
  const partition = policies.find(statement => statement.Sid === 'MonitorPartitions');
  assert.match(JSON.stringify(partition.Resource), /monitor\/partitions\/\*/);
  const projection = policies.find(statement => statement.Sid === 'ReadProjection');
  assert.deepEqual([projection.Action].flat(), ['s3:GetObject'], 'projection and fixtures are read-only');
  const prodPolicies = Object.values(synth({environment: 'prod', confirmProduction: true, account: '123456789012', region: 'us-east-1'}).template.findResources('AWS::IAM::Policy'))
    .flatMap(policy => policy.Properties.PolicyDocument.Statement);
  assert.ok(!JSON.stringify(prodPolicies).includes('fixtures/'), 'prod cannot read fixtures');
});

test('schedule: DISABLED by default; enabling is explicit; scheduler role can only invoke the tick', () => {
  template.hasResourceProperties('AWS::Scheduler::Schedule', {State: 'DISABLED', ScheduleExpression: 'rate(10 minutes)', FlexibleTimeWindow: {Mode: 'OFF'},
    Target: Match.objectLike({RetryPolicy: {MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 300}})});
  synth({scheduleEnabled: true}).template.hasResourceProperties('AWS::Scheduler::Schedule', {State: 'ENABLED'});
});

test('no VPC, NAT, EC2, RDS, SQS, ECS or other unexpected services', () => {
  const types = new Set(Object.values(template.toJSON().Resources).map(resource => resource.Type));
  for (const type of types) assert.ok(!/^AWS::(EC2|RDS|SQS|ECS|ElastiCache|OpenSearchService|Elasticsearch)::/.test(type), `unexpected ${type}`);
  assert.deepEqual([...types].sort(), ['AWS::Budgets::Budget', 'AWS::CloudWatch::Alarm', 'AWS::DynamoDB::Table', 'AWS::IAM::Policy', 'AWS::IAM::Role',
    'AWS::Lambda::Function', 'AWS::Logs::LogGroup', 'AWS::S3::Bucket', 'AWS::S3::BucketPolicy', 'AWS::Scheduler::Schedule']);
});

test('alarms stay within the free allowance; activation-only alarms appear when the schedule is enabled', () => {
  assert.equal(resourcesOf('AWS::CloudWatch::Alarm').length, 6);
  const enabled = synth({scheduleEnabled: true}).template;
  assert.equal(Object.keys(enabled.findResources('AWS::CloudWatch::Alarm')).length, 8);
  for (const alarm of resourcesOf('AWS::CloudWatch::Alarm')) assert.equal(alarm.Properties.AlarmActions, undefined, 'no notification channel without approval');
  const missingPeriod = t => Object.values(t.findResources('AWS::CloudWatch::Alarm')).find(a => a.Properties.MetricName === 'Invocations' && a.Properties.ComparisonOperator === 'LessThanThreshold').Properties.Period;
  assert.equal(missingPeriod(enabled), 1800);
  assert.equal(missingPeriod(synth({scheduleEnabled: true, scheduleMinutes: 60}).template), 10800, 'TicksMissing spans three ticks of a slow schedule');
});

test('budget: monthly cost alerts at 50/80/100 % actual and 100 % forecast to the configured address', () => {
  template.hasResourceProperties('AWS::Budgets::Budget', {Budget: {BudgetType: 'COST', TimeUnit: 'MONTHLY', BudgetLimit: {Amount: 5, Unit: 'USD'}, BudgetName: 'career-central-dev'}});
  const [budget] = resourcesOf('AWS::Budgets::Budget');
  assert.deepEqual(budget.Properties.NotificationsWithSubscribers.map(n => [n.Notification.Threshold, n.Notification.NotificationType]), [[50, 'ACTUAL'], [80, 'ACTUAL'], [100, 'ACTUAL'], [100, 'FORECASTED']]);
  assert.ok(budget.Properties.NotificationsWithSubscribers.every(n => n.Subscribers[0].Address === EMAIL));
});

test('tags and environment separation: distinct stack names, prod needs explicit account, region and confirmation', () => {
  assert.equal(stack.stackName, 'CareerCentralMonitor-dev');
  const tags = template.toJSON().Resources[Object.keys(template.findResources('AWS::Lambda::Function'))[0]].Properties.Tags;
  assert.deepEqual(Object.fromEntries(tags.map(tag => [tag.Key, tag.Value])), {component: 'monitor', 'cost-center': 'personal', environment: 'dev', project: 'career-central'});
  assert.throws(() => monitorConfig({environment: 'prod', budgetEmail: EMAIL}), /prod requires/);
  assert.throws(() => monitorConfig({environment: 'prod', budgetEmail: EMAIL, confirmProduction: true, account: '123456789012'}), /prod requires/);
  assert.throws(() => monitorConfig({}), /budgetEmail is required/);
  assert.throws(() => monitorConfig({budgetEmail: EMAIL, environment: 'prod', confirmProduction: true, account: '123456789012', region: 'us-east-1', fixtureSources: 'alpha'}), /dev-only/);
  assert.throws(() => monitorConfig({budgetEmail: EMAIL, logRetentionDays: 365}), /logRetentionDays/);
  assert.equal(synth({environment: 'prod', confirmProduction: true, account: '123456789012', region: 'us-east-1'}).stack.stackName, 'CareerCentralMonitor-prod');
});

test('cdk-nag AwsSolutions: synth passes with only the reviewed acknowledgements; an unreviewed wildcard fails synth', () => {
  // synth() above already ran the AwsSolutions plugin (dev, prod, schedule enabled) without throwing.
  const app = new App(), config = monitorConfig({budgetEmail: EMAIL});
  const extra = new MonitorStack(app, 'CareerCentralMonitor-dev', {config, bundleDir});
  extra.node.findChild('MonitorTickRole').addToPrincipalPolicy(new iam.PolicyStatement({actions: ['s3:GetObject'], resources: ['arn:aws:s3:::other-bucket/*']}));
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  assert.throws(() => app.synth(), /Validation failed/);
});

test('CDK context: object (cdk.json) and JSON string (--context) forms both validate', () => {
  assert.equal(contextConfig({budgetEmail: EMAIL}).budgetEmail, EMAIL);
  assert.equal(contextConfig(JSON.stringify({budgetEmail: EMAIL, logRetentionDays: 7})).logRetentionDays, 7);
  assert.throws(() => contextConfig('not json'), /JSON object/);
  assert.throws(() => contextConfig('[1]'), /JSON object/);
  assert.throws(() => contextConfig(undefined), /budgetEmail is required/);
});
