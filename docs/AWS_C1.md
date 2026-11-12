# Career Central monitor on AWS (CC-017 C1): deploy and teardown runbook

This runbook covers the serverless job monitor defined in `infra/`. **Nothing in
this repository deploys by itself.** `npm test` and `cdk synth` need no AWS
credentials and contact no account. Every `cdk deploy` and every change that
enables the schedule or live reads is a separate, explicitly approved step.

## What the stack contains

One CloudFormation stack per environment, `CareerCentralMonitor-dev` or
`CareerCentralMonitor-prod`:

| Resource | Settings |
|----------|----------|
| S3 bucket | Block Public Access (all four), SSE-S3, TLS-only bucket policy, bucket-owner-enforced ownership, versioning with noncurrent versions expiring after 30 days, aborted multipart uploads cleaned after 1 day, **retained** on stack deletion |
| DynamoDB table | `pk`/`sk`, on demand, AWS-managed encryption, point-in-time recovery, **retained**; prod adds deletion protection |
| Lambda `monitor-tick` | Node 24, arm64, 512 MB, 300 s, no VPC; live reads **disabled** unless configured |
| Log group | Retention from config (default 14 days), deleted with the stack |
| IAM | Function role: write its own log streams; read and write `monitor/partitions/*`; read `projection/*` (plus `fixtures/*` in dev only); `ListBucket` on the bucket, so a missing key reads as 404 rather than 403; `GetItem`/`PutItem` on the one table, and `DeleteItem` only on the tick-lease partition. Scheduler role: `lambda:InvokeFunction` on the one function. No managed policies and no wildcard actions |
| EventBridge Scheduler | `rate(N minutes)`, **DISABLED** unless `scheduleEnabled`, no retries, events dropped after 300 s |
| CloudWatch alarms | `TickErrors`, `TickThrottles`, `TickNearTimeout`, `PollFailures`, `SourcesFailing`, `SourcesOverdue`; plus `TicksMissing` and `AuthorizationExpiring` when the schedule is enabled. No alarm actions until a notification channel is approved |
| AWS Budget | Monthly cost budget (default $5): email at 50 %, 80 % and 100 % actual and 100 % forecast |

There is no VPC, NAT gateway, EC2, RDS, SQS or ECS resource. A test pins the exact
resource-type list. `cdk-nag` AwsSolutions checks run on every synth, and synth
fails on any finding that has not been reviewed. Five findings are acknowledged
individually in `infra/lib/monitor-stack.mjs`: S1 (no access-log bucket) and four
prefix-scoped IAM5 resource wildcards.

What is uploaded: the Lambda bundle, which contains only code and
`tracker-aliases.json` (the bundler refuses to build if anything else is in the
asset directory), plus monitor state and the allowlisted eligibility projection
that you upload yourself. Résumés, email, the profile, `cv.md` and application
records are never uploaded by the stack or the handler.

## Configuration

Configuration is one JSON object passed as CDK context `careerCentral`, and
`infra/lib/config.mjs` validates it:

| Key | Default | Notes |
|-----|---------|-------|
| `environment` | `dev` | `dev` or `prod` |
| `budgetEmail` | none (required) | budget alert recipient |
| `budgetLimitUsd` | `5` | (0, 100] |
| `logRetentionDays` | `14` | 1, 3, 5, 7, 14, 30, 60 or 90 |
| `scheduleEnabled` | `false` | enabling needs separate approval |
| `scheduleMinutes` | `10` | 5–60 |
| `liveReads` | `false` | enabling needs separate approval |
| `fixtureSources` | none | dev only: source ids read from `fixtures/{id}.json` |
| `reservedConcurrency` | unset | 1 or 2; new accounts may lack the headroom |
| `account`, `region` | unset | required for prod |
| `confirmProduction` | `false` | must be `true` for prod |

## Local checks (no credentials)

```bash
cd infra
npm ci
npm test
npx cdk synth --quiet --context 'careerCentral={"budgetEmail":"you@example.com"}'
```

## Deploy (approved step only)

Prerequisites, each approved separately: a dedicated AWS account (or dev
account) and region; deploy credentials scoped to CloudFormation for this stack
(short-lived SSO or OIDC, never long-lived keys in the repo); a budget email.

```bash
cd infra
export AWS_PROFILE=<approved-dev-profile> AWS_REGION=<approved-region>
npx cdk bootstrap aws://<account>/<region>      # once per account and region
npx cdk diff   --context 'careerCentral={"budgetEmail":"you@example.com","fixtureSources":["alpha"]}'
npx cdk deploy --context 'careerCentral={"budgetEmail":"you@example.com","fixtureSources":["alpha"]}'
```

The first deployment keeps the schedule disabled and live reads off. Test it by
uploading a fixture and invoking the function manually:

```bash
aws s3 cp alpha.json s3://<BucketName>/fixtures/alpha.json
aws lambda invoke --function-name <FunctionName> --payload '{}' out.json
```

Enabling the schedule (`"scheduleEnabled":true`) or live reads
(`"liveReads":true`) is a redeploy with changed context, and each needs its own
approval. Before either, hand ownership of a source to the cloud with
`lib/career-central/monitor-transfer.mjs`. Export from local, import into the
cloud with a dry run first, verify, then mark the source `cloud`-owned locally,
so the two schedulers never poll the same employer.

## Pause

To stop all scheduled work without deleting anything, redeploy with
`"scheduleEnabled":false`, or disable the schedule in the console. In-flight
leases expire on their own: 90 s per source, 6 min for the tick.

## Teardown

```bash
cd infra
npx cdk destroy --context 'careerCentral={"budgetEmail":"you@example.com"}'
```

This deletes the function, roles, schedule, alarms, budget and log group. The
**bucket and table are retained** on purpose. To remove them, after exporting
any state you want to keep:

```bash
aws s3api delete-objects ...   # delete every object version and delete marker
aws s3 rb s3://<BucketName>
aws dynamodb update-table --table-name <TableName> --no-deletion-protection-enabled   # prod only
aws dynamodb delete-table --table-name <TableName>
```

Check the Billing console the next day to confirm no resources remain.

## Expected cost

For five employers on a 10-minute schedule, expect roughly $0.20–$1 a month:
about 4,300 short Lambda invocations, a few thousand DynamoDB requests,
small S3 objects, logs kept for 14 days, and alarms within or near the
free tier. The budget alerts at 50 % of $5.
