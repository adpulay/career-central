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
| Lambda `monitor-tick` | Node 24, arm64, 512 MB, 300 s, no VPC; live reads **disabled** unless configured; async retries **0** and events older than 5 minutes dropped (the Scheduler invokes asynchronously, so without this Lambda would retry a failed tick twice) |
| Log group | Retention from config (default 14 days), deleted with the stack |
| IAM | Function role: write its own log streams; read and write `monitor/partitions/*`; read `projection/*` (plus `fixtures/*` in dev only); `ListBucket` on the bucket, so a missing key reads as 404 rather than 403; `GetItem`/`PutItem` on the one table, and `DeleteItem` only on the tick-lease partition. Scheduler role: `lambda:InvokeFunction` on the one function, assumable only by `scheduler.amazonaws.com` for this account (`aws:SourceAccount`). No managed policies and no wildcard actions |
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
| `permissionsBoundaryName` | unset | name of a pre-created managed policy applied as the boundary of both stack roles (dev: `CareerCentralDevRoleBoundary`) |

## Local checks (no credentials)

```bash
cd infra
npm ci
npm test
npx cdk synth --quiet --context 'careerCentral={"budgetEmail":"you@example.com"}'
```

## First deployment: fixture-only dev test (proposal; every step needs approval)

The first deployment uses one fictional source, synthetic data and manual
invocations only. The schedule stays **DISABLED**, live reads stay **off**, and
no employer feed is contacted. Nothing personal is uploaded:
`infra/scripts/seed-dev-fixture.mjs` writes a synthetic projection and fixture
and reads no user-layer file.

### Account and region

- **A dedicated dev AWS account**, preferably an AWS Organizations member, used for nothing else. The budget is account-wide, so a shared account would mix in unrelated spend. The root user has MFA and no access keys.
- **One region** that offers `nodejs24.x` on arm64 and EventBridge Scheduler. `us-east-1` matches the cost estimates in CLOUD_DEPLOYMENT_PLAN §11.
- **Short-lived credentials only**: an IAM Identity Center (SSO) profile, e.g. `aws sso login --profile cc-dev`. No access keys on disk or in the repository. No GitHub OIDC role for this test.

### Permissions (three reviewed policy files in `infra/policies/`, checked offline by `infra/test/dev-policies.test.mjs`)

CDK's default bootstrap gives CloudFormation `AdministratorAccess`. This proposal replaces it with three layers. Every ARN is pinned to `us-east-1` and to the stack's generated-name prefixes: bucket `careercentralmonitor-dev-*`; table, roles, function, log group, schedule and alarms `CareerCentralMonitor-dev-*`; budget `career-central-dev`.

| Policy | Attached to | What it allows |
|---|---|---|
| `dev-cfn-execution-policy.json` → managed policy `CareerCentralDevCfnExec` | The bootstrap CloudFormation execution role (`--cloudformation-execution-policies`) | Create, update and delete exactly the 11 resource types in the stack. It creates roles **only if** they carry the boundary below, and passes roles only to Lambda and Scheduler. It cannot delete the bucket or table (they are retained). It explicitly **denies** Function URLs, Lambda resource permissions, bucket ACLs, removing public-access blocks or boundaries, managed-policy attachment, IAM users or keys, and EC2, API Gateway, ELB and CloudFront. |
| `dev-role-boundary.json` → managed policy `CareerCentralDevRoleBoundary` | Permissions boundary of both stack roles (`permissionsBoundaryName`) | Exactly the runtime actions the function and scheduler use, and nothing else (a test pins equality). An over-broad inline policy could therefore never take effect. |
| `dev-operator-policy.json` | Inline policy of the Identity Center permission set `CareerCentralDevOperator` | Deploy only by assuming the CDK deploy, file-publishing and lookup roles. Then: invoke, inspect, the emergency stop, seed and probe objects and items, the IAM simulator on the stack roles, viewing budgets, and teardown of the retained bucket and table. It **cannot** edit IAM, CloudFormation, function code or the schedule directly. |

**Bootstrap (one session):** the `AdministratorAccess` permission set is assigned only for creating the two managed policies and running `cdk bootstrap`, and unassigned straight afterwards. Bootstrap itself creates IAM roles, so a narrower bootstrap identity is not practical.

**Known limit.** The execution policy relies on CloudFormation naming resources `<stack>-<logicalId>-<suffix>`. If AWS names one differently, `cdk deploy` fails with `AccessDenied` and rolls back; a failed first create can leave the retained bucket and table behind (see Rollback). That is a safe failure. Fixing it means amending the policy, which is a new approval, never a switch to `AdministratorAccess`.

### What CDK creates

| Stack | Resources |
|---|---|
| `CDKToolkit` (bootstrap, once per account and region) | Staging S3 bucket (retained when the stack is deleted), an empty ECR repository, five IAM roles (deploy, file publishing, image publishing, lookup, and CloudFormation execution with `CareerCentralDevCfnExec` instead of the default `AdministratorAccess`), SSM parameter `/cdk-bootstrap/hnb659fds/version`. Default bucket encryption; no customer-managed KMS key (`--bootstrap-customer-key` is not used) |
| Created by hand before bootstrap | Managed policies `CareerCentralDevCfnExec` and `CareerCentralDevRoleBoundary` |
| `CareerCentralMonitor-dev` (18 resources) | 1 S3 bucket + bucket policy; 1 DynamoDB table; 1 log group; 2 IAM roles + 2 inline policies; 1 Lambda function + its event-invoke config (async retries 0); 1 schedule (**DISABLED**); 6 alarms (no actions); 1 budget |

The synthesized template has no VPC, NAT, EC2, RDS, SQS, ECS, KMS key or `AWS::CDK::Metadata` resource. It also has no publicly reachable endpoint:
- No Lambda Function URL, resource-based permission, API Gateway, load balancer or CloudFront.
- The bucket policy contains only a TLS-only Deny, and all four public-access blocks are on.
- The function is invoked only by IAM-authenticated calls: the operator, or the disabled schedule's role.

With no VPC there is no NAT gateway or interface endpoint charge. The fixture test makes no outbound employer requests, so data transfer is effectively zero.

### Budget

`budgetLimitUsd` 5 and `budgetEmail` set to the approved address. It emails at 50, 80 and 100 % of actual cost and 100 % of forecast cost.
- **Email verification is required** (AWS Budgets, for recipients added from 2026-09-30; [AWS announcement](https://aws.amazon.com/about-aws/whats-new/2026/10/aws-budgets/), [user guide](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-email-recipients.html)).
  - When `cdk deploy` creates the budget, AWS sends a verification email to `budgetEmail`. **Only verified addresses receive budget alerts.**
  - The recipient must open the link while signed in to **this dev account** (the operator's Identity Center console session works).
  - The link expires after **12 hours**. If it expires, choose **Resend verification** on the budget's detail page (Billing and Cost Management → Budgets → `career-central-dev`).
  - The detail page shows the recipient as **Pending**, **Active** or **Inactive**. Acceptance requires **Active** (step 6a); Pending or Inactive fails the test.
  - Re-creating the budget (for example after a teardown and redeploy) adds the recipient again, so plan to verify again.
  - Use an address you read promptly; it is stored in the Budget resource and the CloudFormation template.
  - Allow mail from AWS so the verification and alert emails aren't filtered as spam.
  - No test alert can be triggered. Verification status is the strongest delivery evidence available before real spend.
- **Billing access.** In a member account, the root user may need to enable *IAM user and role access to Billing information* (Account settings) before an Identity Center role can create or view budgets. Preflight step P4 checks this.
- **Forecast alerts** need cost history, so in a new account the 100 % forecast alert may not fire for weeks; the actual-cost alerts do.
- It is an **alert, not a cap**. AWS updates billing data a few times a day, so an alert can lag by hours.
- At 100 %: throttle the function to 0 (Emergency stop below) and tear down.

### Steps

Preconditions, in `infra/`: `npm ci`, `npm test` (all pass), and the synth below with no findings.

**P — one-time setup with the bootstrap permission set** (`AWS_PROFILE=cc-dev-bootstrap`; unassign it afterwards):

```bash
cd infra
export AWS_PROFILE=cc-dev-bootstrap AWS_REGION=us-east-1 ACCOUNT=<12-digit dev account id>
[ "$(aws sts get-caller-identity --query Account --output text)" = "$ACCOUNT" ] || echo "WRONG ACCOUNT - stop"   # P1
for p in dev-cfn-execution-policy dev-role-boundary; do                                                  # P2: free, read-only lint
  aws accessanalyzer validate-policy --policy-type IDENTITY_POLICY --policy-document file://policies/$p.json --query 'findings[].[findingType,issueCode]'; done
aws iam create-policy --policy-name CareerCentralDevRoleBoundary --policy-document file://policies/dev-role-boundary.json   # P3
aws iam create-policy --policy-name CareerCentralDevCfnExec      --policy-document file://policies/dev-cfn-execution-policy.json
npx cdk bootstrap aws://$ACCOUNT/us-east-1 --cloudformation-execution-policies arn:aws:iam::$ACCOUNT:policy/CareerCentralDevCfnExec
aws budgets describe-budgets --account-id "$ACCOUNT" --query 'length(Budgets || `[]`)'                   # P4: billing access works
```

P2 must report no `ERROR` or `SECURITY_WARNING` findings. If it does, stop and amend the file (a new review).

**Deploy with the operator permission set:**

```bash
export AWS_PROFILE=cc-dev AWS_REGION=us-east-1
CTX='careerCentral={"budgetEmail":"<approved-address>","budgetLimitUsd":5,"fixtureSources":["alpha"],"permissionsBoundaryName":"CareerCentralDevRoleBoundary"}'
[ "$(aws sts get-caller-identity --query Account --output text)" = "$ACCOUNT" ] || echo "WRONG ACCOUNT - stop"   # 1
npx cdk synth --quiet --context "$CTX"                     # 3. clean cdk-nag report
npx cdk diff --context "$CTX"                              # 4. review: only the 18 resources above, both roles with the boundary
npx cdk deploy CareerCentralMonitor-dev --context "$CTX" --require-approval broadening   # 5. confirm the IAM summary
OUT=$(aws cloudformation describe-stacks --stack-name CareerCentralMonitor-dev --query 'Stacks[0].Outputs' --output json)
B=$(echo "$OUT" | node -pe 'JSON.parse(require("fs").readFileSync(0)).find(o=>o.OutputKey==="BucketName").OutputValue')
T=$(echo "$OUT" | node -pe 'JSON.parse(require("fs").readFileSync(0)).find(o=>o.OutputKey==="TableName").OutputValue')
FN=$(echo "$OUT" | node -pe 'JSON.parse(require("fs").readFileSync(0)).find(o=>o.OutputKey==="FunctionName").OutputValue')
SEED="node scripts/seed-dev-fixture.mjs"; TARGET="--apply --bucket $B --table $T --region $AWS_REGION"
invoke() { aws lambda invoke --function-name "$FN" --cli-binary-format raw-in-base64-out --payload '{}' "$1" && cat "$1"; echo; }
```

| # | Action | Success criterion |
|---|---|---|
| 6 | Read back the configuration: `aws scheduler get-schedule` (name from `describe-stack-resources`), `aws lambda get-function-configuration --function-name "$FN" --query Environment.Variables`, `aws lambda get-function-event-invoke-config --function-name "$FN"`, `aws s3api get-public-access-block --bucket "$B"`, `aws dynamodb describe-continuous-backups --table-name "$T"`, `aws budgets describe-subscribers-for-notification --account-id "$ACCOUNT" --budget-name career-central-dev --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=50,ThresholdType=PERCENTAGE` | Schedule `DISABLED`; `MONITOR_LIVE_READS=disabled`, `MONITOR_FIXTURE_SOURCES=alpha`; `MaximumRetryAttempts` 0; all four public-access blocks true; PITR `ENABLED`; one `EMAIL` subscriber with the approved address |
| 6a | Within 12 hours of the deploy, open the AWS Budgets verification email for `budgetEmail` while signed in to the dev account and confirm. Then open Billing and Cost Management → Budgets → `career-central-dev` and read the recipient status (use **Resend verification** if the link expired). | The recipient status is **Active** (verified). **Pending** or **Inactive** fails the test: alerts would reach nobody. Stop here until it is Active. |
| 7 | `invoke out0.json` **before seeding** | Function error with message `MONITOR_LAMBDA_OBJECT_MISSING`, **not** `AccessDenied`. This proves a missing key reads as 404 under the function role (the `ListBucket` grant). |
| 8 | `$SEED probe $TARGET` | `passed: true`. Every check holds on the real services: S3 missing key → null, `If-None-Match: *` and stale `If-Match` → 412, current ETag accepted; DynamoDB create-only and stale version → conditional failure, consistent read sees the latest, stale delete refused, probe item removed. |
| 9 | `$SEED seed $TARGET --hours 2`, then `invoke out1.json`, then `$SEED status $TARGET` | `ok: true`, `polled: 1`; `alertCount` 0 (quiet baseline); `provenance: synthetic` |
| 10 | `$SEED fixture --step 2 $TARGET`; wait 6 minutes (5-minute interval); `invoke out2.json`; `status` | `alertCount` 1 (exactly one alert for one new posting) |
| 11 | Wait 6 minutes; `invoke out3.json`; `status` | `alertCount` still 1 (no duplicate) |
| 12 | Two concurrent async invocations: `aws lambda invoke --invocation-type Event …` twice at once; `status` and logs | `alertCount` still 1; any overlap is a `tick_skipped`; no `MONITOR_STORE_CONFLICT` left unresolved |
| 13 | `aws iam simulate-principal-policy` for the function role: `s3:DeleteObject`, `s3:PutObject` on `projection/x`, `dynamodb:Scan`, and `dynamodb:DeleteItem` with context `dynamodb:LeadingKeys=SOURCE#alpha` | All `implicitDeny`. `DeleteItem` with `LeadingKeys=MONITOR` is `allowed`. |
| 14 | `$SEED revoke $TARGET`; wait 6 minutes; `invoke out4.json`; `status` | `ok: false` with `errorCode: MONITOR_RECURRING_NOT_AUTHORIZED`; the tick polls nothing and the source's last attempt is unchanged |
| 15 | `aws logs filter-log-events --log-group-name <log group> --filter-pattern '"example.invalid"' --query 'length(events)'`, and the same for `"Fictional Alpha"` | 0 and 0: no posting URLs or company text in logs |
| 16 | `aws cloudwatch describe-alarms --alarm-name-prefix CareerCentralMonitor-dev --query 'MetricAlarms[].[AlarmName,StateValue]'` | No alarm in `ALARM` |
| 17 | The next day: Billing → Bills, and the budget's actual cost | Under $0.50 |

Any unmet criterion stops the test. Record the outcome in CC-017 before any further step.

**Deliberately not tested in this first run:** the schedule, live employer reads, the hand-over of a real source, alarm notifications, the restore drill and prod. Each is its own approval (CC-017 C1 acceptance).

### Emergency stop and rollback

- **Stop all invocations immediately:** `aws lambda put-function-concurrency --function-name "$FN" --reserved-concurrent-executions 0`. Undo with `delete-function-concurrency`.
- **Failed deploy:** CloudFormation rolls back by itself. The bucket and table are `Retain`, so a failed *first* create can leave them behind. Check with `aws s3api list-buckets --query "Buckets[?starts_with(Name,'careercentralmonitor-dev')].Name"` and `aws dynamodb list-tables`, and remove them as in Teardown.
- **Bad code after a successful deploy:** check out the previous commit and run `cdk deploy` again. The table and bucket are unchanged across deploys.

### Data retention and privacy boundaries

| Data | Where | Retention |
|---|---|---|
| Synthetic projection, fixture snapshots, probe object | S3 `projection/`, `fixtures/`, `probe/` | Until teardown; old versions expire after 30 days |
| Monitor state for the fictional source (postings, alerts, checkpoint) | S3 `monitor/partitions/`, DynamoDB | Until teardown; PITR keeps 35 days of table history |
| Function logs (allowlisted fields, no titles, URLs or profile values) | CloudWatch Logs | 14 days; deleted with the stack |
| Aggregate metrics | CloudWatch | AWS-managed (15 months) |
| Budget alert address | Budget resource; CloudFormation template (also in the CDK staging bucket) | Until stack and bootstrap teardown |
| The Lambda code bundle | CDK staging bucket, Lambda | Until teardown |

Never uploaded by this test: `cv.md`, the profile, policy, application history or ledger, email state, résumés, OAuth tokens and real employer data.

## Later stages (each a separate approval)

Enabling the schedule (`"scheduleEnabled":true`) or live reads
(`"liveReads":true`) is a redeploy with changed context, and each needs its own
approval. Before either, hand ownership of a source to the cloud with
`lib/career-central/monitor-transfer.mjs`: export from local, import into the
cloud with a dry run first, verify, then mark the source `cloud`-owned locally,
so the two schedulers never poll the same employer.

## Pause

To stop all scheduled work without deleting anything, redeploy with
`"scheduleEnabled":false`, or disable the schedule in the console. In-flight
leases expire on their own: 90 s per source, 6 min for the tick.

## Teardown

```bash
cd infra
npx cdk destroy CareerCentralMonitor-dev --context "$CTX"
```

This deletes the function, roles, schedule, alarms, budget and log group. The
**bucket and table are retained** on purpose. After exporting any state you want
to keep, remove them. Each `delete-objects` handles up to 1,000 entries; skip it
when the listing is empty.

```bash
aws s3api delete-objects --bucket "$B" --delete "$(aws s3api list-object-versions --bucket "$B" --output json --query '{Objects: Versions[].{Key: Key, VersionId: VersionId}, Quiet: `true`}')"
aws s3api delete-objects --bucket "$B" --delete "$(aws s3api list-object-versions --bucket "$B" --output json --query '{Objects: DeleteMarkers[].{Key: Key, VersionId: VersionId}, Quiet: `true`}')"
aws s3api delete-bucket --bucket "$B"
aws dynamodb update-table --table-name "$T" --no-deletion-protection-enabled   # prod only
aws dynamodb delete-table --table-name "$T"
```

To remove the bootstrap as well (optional, once nothing else uses it; bootstrap permission set):
1. `aws cloudformation delete-stack --stack-name CDKToolkit`.
2. Empty and delete the retained `cdk-hnb659fds-assets-<account>-<region>` bucket the same way.
3. `aws iam delete-policy --policy-arn arn:aws:iam::$ACCOUNT:policy/CareerCentralDevCfnExec`, then the same for `CareerCentralDevRoleBoundary`. Do this only after both stacks are gone, since a policy still attached to a role cannot be deleted.
4. Remove the `CareerCentralDevOperator` permission-set assignment in IAM Identity Center.

Check the Billing console the next day to confirm no resources remain.

## Expected cost

Estimates from AWS list prices (us-east-1); the dev test measures the real figure.

| Scenario | Expected | What drives it |
|---|---|---|
| Fixture-only dev test (about 20 manual invocations over a day) | under $0.25 | Lambda, DynamoDB, S3 and logs round to $0. Alarms (6 × $0.10/month, prorated) and custom metrics ($0.30/metric-month, prorated, billed only in hours with data) are free if the account is within its 10 free alarms and 10 free metrics. The bootstrap staging bucket costs cents. |
| Stack left deployed, schedule disabled | about $0–0.60 a month | Alarms beyond the free allowance; PITR at $0.20/GB-month on a table of kilobytes |
| Five employers on a 10-minute schedule (later stage) | about $0.20–1 a month | About 4,300 short invocations, a few thousand DynamoDB requests, small S3 objects, 14-day logs |

The budget alerts at 50 % of $5. It does not stop spend.
