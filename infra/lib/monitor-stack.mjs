// Career Central monitor stack (CC-017 C1): the minimal always-available
// monitoring deployment from CLOUD_DEPLOYMENT_PLAN.md. Defined for synth and
// tests; deploying it is a separate, approved step.
//
// S3 (partitions, projection, dev fixtures) + DynamoDB (control items, leases)
// + one arm64 Lambda (the bundled monitor tick) + EventBridge Scheduler
// (DISABLED by default) + a 14-day log group + at most 10 alarms + an AWS
// Budget. No VPC, NAT gateway, EC2, RDS, SQS or ECS.
import {Stack, Duration, RemovalPolicy, Tags, CfnOutput, Validations} from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as budgets from 'aws-cdk-lib/aws-budgets';

export const METRIC_NAMESPACE = 'CareerCentral/Monitor';

export class MonitorStack extends Stack {
  constructor(scope, id, {config, bundleDir, ...props}) {
    super(scope, id, props);
    const env = config.environment, prod = env === 'prod';
    for (const [key, value] of Object.entries({project: 'career-central', environment: env, component: 'monitor', 'cost-center': 'personal'})) Tags.of(this).add(key, value);

    const bucket = new s3.Bucket(this, 'MonitorBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.S3_MANAGED, enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED, versioned: true,
      lifecycleRules: [{noncurrentVersionExpiration: Duration.days(30), abortIncompleteMultipartUploadAfter: Duration.days(1)}],
      removalPolicy: RemovalPolicy.RETAIN, autoDeleteObjects: false,
    });
    const table = new dynamodb.Table(this, 'MonitorTable', {
      partitionKey: {name: 'pk', type: dynamodb.AttributeType.STRING}, sortKey: {name: 'sk', type: dynamodb.AttributeType.STRING},
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {pointInTimeRecoveryEnabled: true}, deletionProtection: prod, removalPolicy: RemovalPolicy.RETAIN,
    });
    const logGroup = new logs.LogGroup(this, 'MonitorTickLogs', {retention: config.logRetentionDays, removalPolicy: RemovalPolicy.DESTROY});

    // Least privilege: exact actions on exact resources, no managed policies.
    const role = new iam.Role(this, 'MonitorTickRole', {assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'), description: 'Career Central monitor tick'});
    role.addToPolicy(new iam.PolicyStatement({sid: 'WriteOwnLogs', actions: ['logs:CreateLogStream', 'logs:PutLogEvents'], resources: [`${logGroup.logGroupArn}:*`]}));
    role.addToPolicy(new iam.PolicyStatement({sid: 'MonitorPartitions', actions: ['s3:GetObject', 's3:PutObject'], resources: [bucket.arnForObjects('monitor/partitions/*')]}));
    role.addToPolicy(new iam.PolicyStatement({sid: 'ReadProjection', actions: ['s3:GetObject'], resources: [bucket.arnForObjects('projection/*'), ...(env === 'dev' ? [bucket.arnForObjects('fixtures/*')] : [])]}));
    // Without s3:ListBucket, S3 answers GetObject on a missing key with 403 AccessDenied
    // instead of 404 NoSuchKey, so a source whose partition does not exist yet would
    // fail as an ambiguous error. A prefix condition cannot be used here: the GetObject
    // request carries no s3:prefix key. The bucket holds only data this role can read.
    role.addToPolicy(new iam.PolicyStatement({sid: 'MissingObjectsAs404', actions: ['s3:ListBucket'], resources: [bucket.bucketArn]}));
    role.addToPolicy(new iam.PolicyStatement({sid: 'MonitorTable', actions: ['dynamodb:GetItem', 'dynamodb:PutItem'], resources: [table.tableArn]}));
    // Deletes are only for releasing the tick lease (pk MONITOR); source control items cannot be deleted.
    role.addToPolicy(new iam.PolicyStatement({sid: 'ReleaseTickLease', actions: ['dynamodb:DeleteItem'], resources: [table.tableArn],
      conditions: {'ForAllValues:StringEquals': {'dynamodb:LeadingKeys': ['MONITOR']}}}));

    const fn = new lambda.Function(this, 'MonitorTick', {
      runtime: lambda.Runtime.NODEJS_24_X, architecture: lambda.Architecture.ARM_64, handler: 'index.handler',
      code: lambda.Code.fromAsset(bundleDir), memorySize: 512, timeout: Duration.seconds(300), role, logGroup,
      // The Scheduler invokes asynchronously, so Lambda's own async retries (default 2) would
      // re-run a failed tick even with the schedule's retries at 0. The next tick is the retry.
      retryAttempts: 0, maxEventAge: Duration.minutes(5),
      ...(config.reservedConcurrency ? {reservedConcurrentExecutions: config.reservedConcurrency} : {}),
      environment: {MONITOR_BUCKET: bucket.bucketName, MONITOR_TABLE: table.tableName, MONITOR_ENVIRONMENT: env,
        MONITOR_LIVE_READS: config.liveReads ? 'enabled' : 'disabled', ...(config.fixtureSources.length ? {MONITOR_FIXTURE_SOURCES: config.fixtureSources.join(',')} : {})},
      description: `Career Central monitor tick (${env})`,
    });

    // Confused-deputy guard: only schedules in this account may assume the role.
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {conditions: {StringEquals: {'aws:SourceAccount': this.account}}})});
    schedulerRole.addToPolicy(new iam.PolicyStatement({sid: 'InvokeTick', actions: ['lambda:InvokeFunction'], resources: [fn.functionArn]}));
    new scheduler.CfnSchedule(this, 'MonitorTickSchedule', {
      scheduleExpression: `rate(${config.scheduleMinutes} minutes)`, state: config.scheduleEnabled ? 'ENABLED' : 'DISABLED',
      flexibleTimeWindow: {mode: 'OFF'}, description: 'Career Central monitor tick (activation is a separate approved step)',
      target: {arn: fn.functionArn, roleArn: schedulerRole.roleArn, retryPolicy: {maximumRetryAttempts: 0, maximumEventAgeInSeconds: 300}},
    });

    // Alarms (no actions: visible in the console; a notification channel is a separate decision).
    const period = Duration.minutes(Math.max(5, config.scheduleMinutes));
    const custom = (metricName, statistic) => new cloudwatch.Metric({namespace: METRIC_NAMESPACE, metricName, dimensionsMap: {Environment: env}, statistic, period});
    const alarm = (id, metric, threshold, evaluationPeriods, comparisonOperator, treatMissingData = cloudwatch.TreatMissingData.NOT_BREACHING) =>
      new cloudwatch.Alarm(this, id, {metric, threshold, evaluationPeriods, comparisonOperator, treatMissingData, alarmDescription: `Career Central monitor (${env}): ${id}`});
    const GTE = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, GT = cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD, LT = cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD;
    alarm('TickErrors', fn.metricErrors({period}), 1, 3, GTE);
    alarm('TickThrottles', fn.metricThrottles({period}), 1, 1, GTE);
    alarm('TickNearTimeout', fn.metricDuration({period, statistic: 'Maximum'}), 240000, 1, GT);
    alarm('PollFailures', custom('PollFailed', 'Sum'), 3, 3, GTE);
    alarm('SourcesFailing', custom('SourcesFailing', 'Maximum'), 1, 3, GTE);
    alarm('SourcesOverdue', custom('SourcesOverdue', 'Maximum'), 1, 3, GTE);
    if (config.scheduleEnabled) {
      // The window spans at least three scheduled ticks, so a slow schedule (up to 60 min) cannot false-alarm.
      alarm('TicksMissing', fn.metricInvocations({period: Duration.minutes(Math.max(30, 3 * config.scheduleMinutes))}), 1, 1, LT, cloudwatch.TreatMissingData.BREACHING);
      alarm('AuthorizationExpiring', custom('AuthorizationHoursRemaining', 'Minimum'), 24, 1, LT);
    }

    // Budget alerts (not a hard cap): 50/80/100 % actual and 100 % forecast.
    new budgets.CfnBudget(this, 'MonitorBudget', {
      budget: {budgetName: `career-central-${env}`, budgetType: 'COST', timeUnit: 'MONTHLY', budgetLimit: {amount: config.budgetLimitUsd, unit: 'USD'}},
      notificationsWithSubscribers: [[50, 'ACTUAL'], [80, 'ACTUAL'], [100, 'ACTUAL'], [100, 'FORECASTED']].map(([threshold, notificationType]) => ({
        notification: {comparisonOperator: 'GREATER_THAN', notificationType, threshold, thresholdType: 'PERCENTAGE'},
        subscribers: [{subscriptionType: 'EMAIL', address: config.budgetEmail}]})),
    });

    new CfnOutput(this, 'BucketName', {value: bucket.bucketName});
    new CfnOutput(this, 'TableName', {value: table.tableName});
    new CfnOutput(this, 'FunctionName', {value: fn.functionName});

    // cdk-nag findings acknowledged individually, by exact finding id, with reasons.
    const bucketId = this.getLogicalId(bucket.node.defaultChild), logsId = this.getLogicalId(logGroup.node.defaultChild);
    Validations.of(bucket).acknowledge({id: 'AwsSolutions-S1', reason: 'Server access logs would add a second bucket and cost for a single-owner bucket with Block Public Access, a TLS-only policy and versioning; CloudTrail data events can be enabled if needed.'});
    for (const prefix of ['monitor/partitions', 'projection', ...(env === 'dev' ? ['fixtures'] : [])]) {
      Validations.of(role).acknowledge({id: `AwsSolutions-IAM5[Resource::<${bucketId}.Arn>/${prefix}/*]`, reason: `Object access is confined to the fixed ${prefix}/ prefix of the monitor bucket.`});
    }
    Validations.of(role).acknowledge({id: `AwsSolutions-IAM5[Resource::<${logsId}.Arn>:*]`, reason: 'Log streams of the function\'s own log group only.'});
  }
}
