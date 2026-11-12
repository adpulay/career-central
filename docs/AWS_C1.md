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
| DynamoDB table | `pk`/`sk`, on demand with a 10/10 request-unit-per-second ceiling, encrypted with the AWS-owned key (no KMS key, permissions or charges), point-in-time recovery, **retained**; prod adds deletion protection |
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

### Cost guardrails (before any deployment; each step needs approval)

These limit what can be created and where. They make an accidental large bill unlikely, but they are **not a spending cap** (see Residual risks). Files are in `infra/policies/` and are tested offline by `infra/test/dev-guardrails.test.mjs`.
- The evaluator checks every action the plan uses against the SCPs: bootstrap, deploy, runtime, operator checks and budget verification. All are allowed.
- 48 costly actions are denied for every principal, as are other regions and guardrail tampering.
- A mutation adding `ec2:*` to the allowlist was caught.

| # | Guardrail | Where | Who |
|---|---|---|---|
| G1 | $5 account budget `career-central-dev-guardrail`, verified recipient (**Active**) | Dev account | Dev-account root (first sign-in) |
| G2 | Account-level S3 Block Public Access (all four) | Dev account | Dev-account root |
| G3 | SCP `CareerCentralDevRegion`: deny every non-global action outside `us-east-1` | Organizations, attached to the dev **account only** | Management account |
| G4 | SCP `CareerCentralDevServiceAllowlist`: deny every service the test doesn't use (EC2, RDS, SageMaker, Bedrock, OpenSearch, ElastiCache, Redshift, EKS, ECS, Lightsail, API Gateway, CloudFront, ELB, Glue, Athena, Kinesis, SNS, SQS, Marketplace, Savings Plans, support plans, domains, Session Manager, …) | Same | Management account |
| G5 | SCP `CareerCentralDevCostGuardrails`: deny costly features of allowed services, and guardrail tampering | Same | Management account |
| G6 | Read the Lambda concurrency quota; set `reservedConcurrency` 1 when possible | Dev account | Admin session (read-only) |

G5 denies:
- **Costly features:** Lambda provisioned concurrency, Function URLs and resource permissions; DynamoDB global tables, replicas, reserved capacity, Kinesis streaming and Contributor Insights; S3 replication, acceleration, inventory, analytics, Storage Lens and multi-Region access points; KMS customer keys; Logs data protection, anomaly detectors and Live Tail; CloudWatch metric streams, anomaly detectors and Contributor Insights rules; ECR image pushes, replication and enhanced scanning; third-party CloudFormation types.
- **Escapes:** quota increase requests, leaving the organization, enabling opt-in Regions, and IAM users and access keys.
- **Tampering, by anyone except the admin sessions** (Identity Center `CareerCentralDevBootstrap`, `OrganizationAccountAccessRole`): changing or deleting budgets, and changing account Block Public Access.

**G1 + G2 — dev-account root, one console session** (also step A4 of Account setup):
1. Sign in at https://console.aws.amazon.com as the dev account's root, using the *Forgot password* flow on its email if no password exists yet. Turn on root MFA (account menu → Security credentials).
2. Account menu → **Account** → *IAM user and role access to Billing information* → Edit → **Activate**.
3. **Billing and Cost Management → Budgets → Create budget** → *Customize (advanced)* → *Cost budget*:
   - Name `career-central-dev-guardrail`; period *Monthly*; *Recurring*; *Fixed* $5.00; scope *All AWS services*.
   - Alert thresholds: 50 % Actual, 80 % Actual, 100 % Actual and 100 % Forecasted, each to the same email address. Create.
4. Open the verification email within 12 hours **while still signed in to this account**, confirm, and check that the budget's recipient status reads **Active**.
5. **S3 → Block Public Access settings for this account** → Edit → tick all four → Save.

CLI equivalent for G1 (after the CLI is set up, admin profile; replace the placeholder in a scratch copy, never in the repo):

```bash
cp infra/policies/dev-account-budget-notifications.template.json /tmp/budget-notifications.json   # edit <budget-email> there
aws budgets create-budget --account-id "$ACCOUNT" --budget file://infra/policies/dev-account-budget.json \
  --notifications-with-subscribers file:///tmp/budget-notifications.json --profile cc-dev-bootstrap
aws s3control put-public-access-block --account-id "$ACCOUNT" --profile cc-dev-bootstrap \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

**G3–G5 — management account** (modifies the management account's Organizations configuration; separate approval). Console:
1. **AWS Organizations → Policies → Service control policies → Enable service control policies.** This changes nothing on its own; `FullAWSAccess` stays attached everywhere.
2. *Create policy* three times, pasting `scp-dev-region.json`, `scp-dev-service-allowlist.json` and `scp-dev-cost-guardrails.json` as `CareerCentralDevRegion`, `CareerCentralDevServiceAllowlist` and `CareerCentralDevCostGuardrails` (each is well under the 5,120-character limit).
3. For each policy: **Targets → Attach** → select **only** the `career-central-dev` account. Do not attach to *Root* or an OU: that would also restrict any other member accounts. The management account is never restricted by SCPs.

CLI equivalent (a management-account admin profile, which you'd create separately):

```bash
ROOT=$(aws organizations list-roots --query 'Roots[0].Id' --output text)
aws organizations enable-policy-type --root-id "$ROOT" --policy-type SERVICE_CONTROL_POLICY
for p in region:CareerCentralDevRegion service-allowlist:CareerCentralDevServiceAllowlist cost-guardrails:CareerCentralDevCostGuardrails; do
  ID=$(aws organizations create-policy --type SERVICE_CONTROL_POLICY --name "${p#*:}" --description "Career Central dev cost guardrail" \
       --content "$(node -e 'process.stdout.write(JSON.stringify(require(process.argv[1])))' "$PWD/infra/policies/scp-dev-${p%%:*}.json")" --query Policy.PolicySummary.Id --output text)
  aws organizations attach-policy --policy-id "$ID" --target-id "$ACCOUNT"
done
aws organizations list-policies-for-target --target-id "$ACCOUNT" --filter SERVICE_CONTROL_POLICY --query 'Policies[].Name'
```

Check: the list shows `FullAWSAccess` plus the three. In the dev account, `aws ec2 describe-instances --profile cc-dev-bootstrap` fails with an explicit deny from a service control policy, and `aws sts get-caller-identity` still works.

**G6 — Lambda concurrency (read-only):** `aws service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384 --profile cc-dev-bootstrap --query Quota.Value`.
- At **1,000 or more**, deploy with `"reservedConcurrency":1`: at most one tick at a time, which caps Lambda compute at about $17 for a month of non-stop use.
- At **10** (common for new accounts), Lambda requires the unreserved pool to stay intact, so nothing can be reserved. Rely on the controls under Residual risks. The SCP stops anyone in the account requesting a higher quota.

**Why the deployment permissions cannot bypass these.**
- SCPs bind **every** principal in the dev account: its root user, `OrganizationAccountAccessRole`, both Identity Center roles, the CDK bootstrap and CloudFormation execution roles, and the stack's roles. Only service-linked roles are exempt.
- Nothing in the dev account can detach an SCP; only the management account can. Leaving the organization is denied.
- The CloudFormation execution policy cannot touch budgets or create users or keys, and the stack's roles are capped by their boundary.
- The admin exception in G5 covers only budgets and account Block Public Access, not the service or region denials.

**Stack cost ceilings and drivers** (synthesized 2026-11-12, dev context: 17 resources):

| Resource | Bills for | Ceiling or bound |
|---|---|---|
| Lambda (512 MB, 300 s, arm64, no VPC, no tracing) | Requests, GB-seconds | Only IAM principals can invoke: no URL, no resource permission, schedule DISABLED, async retries 0. A hard cap only with `reservedConcurrency` 1 (G6). |
| DynamoDB on demand + PITR | Request units, storage, PITR storage | **Throughput capped at 10 RRU and 10 WRU per second**: under about $20 for a full month at the cap. PITR on kilobytes. |
| S3 (versioned, 30-day old versions) | Requests, storage | Bounded by Lambda; no replication or acceleration (G5) |
| CloudWatch Logs (14 days) | Ingestion, storage | Bounded by Lambda; allowlisted short log lines |
| Custom metrics (EMF) | Metric-months | Fixed 10 names × 1 dimension, so at most 10 metrics (about $3 a month beyond the free tier) |
| 6 alarms | Alarm-months | $0.60 a month beyond the free tier |
| Scheduler | Invocations | DISABLED |
| Roles, policies, bucket policy, event-invoke config | Nothing | — |

**Residual risks, and why this is not an absolute cap.**
- **AWS has no hard spending limit.** Budgets only alert, and billing data lags hours (up to about a day), so spend can pass $5 before the email arrives.
- **SCPs limit categories, not volume.** Inside the allowed services, anyone with admin rights in the account can still create costly things by hand, for example a DynamoDB table with large *provisioned* capacity (no IAM condition key limits capacity), large S3 uploads, or Lambda invoked in a loop.
- **Without reserved concurrency, Lambda compute has no ceiling** beyond the account quota.
- **Stored data keeps costing** until deleted. The bucket and table are retained by design, so teardown is required.
- **Outside this account's guardrails:** the management account (never restricted by SCPs), other member accounts, support-plan or Marketplace purchases made from the management account, and taxes.
- **Optional stronger steps** (not proposed now): an AWS Budgets *action* in the management account that attaches a deny-all SCP to the dev account at 100 % actual. It is still subject to the billing-data lag. Also Cost Anomaly Detection, which is free.
- **Lambda and DynamoDB service quotas** bound the worst case, but at default quotas, not at $5.

### Account setup (done by the user; nothing here deploys)

Local state checked 2026-11-12: no AWS CLI in WSL, no `~/.aws` configuration in WSL or Windows, no `AWS_*` environment variables, no cached SSO sessions. The CDK CLI 2.1146.1 is installed in `infra/` (pinned).

**A. AWS Organizations and the dev account (console, as the management account's root or admin).**
1. In the management account, turn on root MFA and remove any root access keys. If you have no AWS account yet, sign up first; that account becomes the management account and hosts no workloads.
2. **AWS Organizations** → *Create an organization* (all features).
3. *Add an AWS account* → *Create an AWS account*: name `career-central-dev`, plus an email address used by no other AWS account. Plus-addressing such as `you+cc-dev@…` works if your provider supports it. Keep the default access role name.
4. In the new account, recover root via *Forgot password* on its email, then turn on root MFA and create no root access keys. While signed in as that root: **Account** → *IAM user and role access to Billing information* → **Activate**, so the Identity Center roles can create and view the budget (preflight P4).

**B. IAM Identity Center (management account, home region `us-east-1`).**
1. **IAM Identity Center** → *Enable* (organization instance). Create one user for yourself and require MFA.
2. Create the permission set **`CareerCentralDevBootstrap`**: AWS managed policy `AdministratorAccess`, session duration 1 hour.
3. Create the permission set **`CareerCentralDevOperator`**: inline policy = the contents of `infra/policies/dev-operator-policy.json`, session duration 4 hours.
4. *AWS accounts* → `career-central-dev` → assign your user both permission sets. Remove the bootstrap assignment once P1–P4 pass.
5. Note the **AWS access portal URL** (`https://<id>.awsapps.com/start`) and the 12-digit `career-central-dev` account id.

**C. AWS CLI v2 in WSL (x86_64), installed by the user.**

```bash
curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp/awscli && /tmp/awscli/aws/install && rm -rf /tmp/awscli /tmp/awscliv2.zip
aws --version
```

**D. SSO profiles** (no secrets: tokens are obtained at login and cached under `~/.aws/sso/cache`). Append to `~/.aws/config`:

```ini
[sso-session cc]
sso_start_url = https://<id>.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access

[profile cc-dev-bootstrap]
sso_session = cc
sso_account_id = <dev account id>
sso_role_name = CareerCentralDevBootstrap
region = us-east-1
output = json

[profile cc-dev]
sso_session = cc
sso_account_id = <dev account id>
sso_role_name = CareerCentralDevOperator
region = us-east-1
output = json
```

Then sign in with `aws sso login --sso-session cc --use-device-code`. It prints a URL and a code to open in the Windows browser.

**E. Read-only verification (run before approval; prints identities and flags, never credentials).**

| Check | Command | Expected |
|---|---|---|
| Operator identity | `aws sts get-caller-identity --profile cc-dev` | `Account` = dev account id; `Arn` contains `AWSReservedSSO_CareerCentralDevOperator` |
| Bootstrap identity | `aws sts get-caller-identity --profile cc-dev-bootstrap` | Same account; `AWSReservedSSO_CareerCentralDevBootstrap` |
| Region | `aws configure get region --profile cc-dev` | `us-east-1` |
| Dedicated member account | `aws organizations describe-organization --profile cc-dev-bootstrap --query Organization.MasterAccountId` | **Not** the dev account id |
| Root hygiene | `aws iam get-account-summary --profile cc-dev-bootstrap --query 'SummaryMap.[AccountMFAEnabled,AccountAccessKeysPresent]'` | `[1, 0]` |
| No long-lived keys anywhere | `aws iam list-users --profile cc-dev-bootstrap --query 'length(Users)'`; no `~/.aws/credentials` | `0`; absent |
| Clean slate | `aws cloudformation describe-stacks --stack-name CDKToolkit --profile cc-dev-bootstrap` and `aws budgets describe-budgets --account-id <id> --profile cc-dev-bootstrap` | Stack does not exist; no budgets (or none named `career-central-dev`) |

### Permissions (three reviewed policy files in `infra/policies/`, checked offline by `infra/test/dev-policies.test.mjs`, `dev-iam-evaluation.test.mjs` and `iam-catalog.test.mjs`)

**Action names are validated** against a snapshot of AWS's Service Authorization Reference (`infra/test/fixtures/iam-catalog.json`). Refresh it with `node infra/scripts/refresh-iam-catalog.mjs` (network, no AWS account) and review the diff. Access Analyzer (CloudShell step 3) remains the authoritative check.

**S3 Block Public Access.** S3 has no separate IAM action for removing a bucket's public-access block: `DeletePublicAccessBlock` is authorized by `s3:PutBucketPublicAccessBlock`, the same permission CloudFormation needs to set it. That permission is therefore allowed only on the stack's own bucket, and the protection against weakening it is **account-level** Block Public Access (G2), which overrides every bucket-level setting. Only the admin session can change it (SCP), and the CloudFormation policy explicitly denies it. No policy allows bucket or object ACL writes, and the bucket has ACLs disabled (`BucketOwnerEnforced`) and a Deny-only bucket policy.

CDK's default bootstrap gives CloudFormation `AdministratorAccess`. This proposal replaces it with three layers. Every ARN is pinned to `us-east-1` and to the stack's generated-name prefixes: bucket `careercentralmonitor-dev-*`; table, roles, function, log group, schedule and alarms `CareerCentralMonitor-dev-*`; budget `career-central-dev`.

| Policy | Attached to | What it allows |
|---|---|---|
| `dev-cfn-execution-policy.json` → managed policy `CareerCentralDevCfnExec` | The bootstrap CloudFormation execution role (`--cloudformation-execution-policies`) | Create, update and delete exactly the 10 resource types in the dev stack (no budgets: the account budget belongs to the admin session). It creates roles **only if** they carry the boundary below, and passes roles only to Lambda and Scheduler. It cannot delete the bucket or table (they are retained). It explicitly **denies** Function URLs, Lambda resource permissions, bucket ACLs, changing account-level Block Public Access, removing boundaries, managed-policy attachment, IAM users or keys, and EC2, API Gateway, ELB and CloudFront. |
| `dev-role-boundary.json` → managed policy `CareerCentralDevRoleBoundary` | Permissions boundary of both stack roles (`permissionsBoundaryName`) | Exactly the runtime actions the function and scheduler use, and nothing else (a test pins equality). An over-broad inline policy could therefore never take effect. |
| `dev-operator-policy.json` | Inline policy of the Identity Center permission set `CareerCentralDevOperator` | Deploy only by assuming the CDK deploy and file-publishing roles (not the lookup role, which carries `ReadOnlyAccess`; this stack does no lookups). Then: invoke, inspect, the emergency stop, seed and probe objects and items, the IAM simulator on the stack roles, viewing budgets, and teardown of the retained bucket and table. It **cannot** edit IAM, CloudFormation, function code or the schedule directly. |

**Bootstrap (one session):** the `AdministratorAccess` permission set is assigned only for creating the two managed policies and running `cdk bootstrap`, and unassigned straight afterwards. Bootstrap itself creates IAM roles, so a narrower bootstrap identity is not practical.

**Known limit.** The execution policy relies on CloudFormation naming resources `<stack>-<logicalId>-<suffix>`. If AWS names one differently, `cdk deploy` fails with `AccessDenied` and rolls back; a failed first create can leave the retained bucket and table behind (see Rollback). That is a safe failure. Fixing it means amending the policy, which is a new approval, never a switch to `AdministratorAccess`.

### What CDK creates

| Stack | Resources |
|---|---|
| `CDKToolkit` (bootstrap, once per account and region) | Staging S3 bucket (retained when the stack is deleted), an empty ECR repository, five IAM roles (deploy, file publishing, image publishing, lookup, and CloudFormation execution with `CareerCentralDevCfnExec` instead of the default `AdministratorAccess`), SSM parameter `/cdk-bootstrap/hnb659fds/version`. Default bucket encryption; no customer-managed KMS key (`--bootstrap-customer-key` is not used) |
| Created by hand before bootstrap | Managed policies `CareerCentralDevCfnExec` and `CareerCentralDevRoleBoundary` |
| `CareerCentralMonitor-dev` (17 resources) | 1 S3 bucket + bucket policy; 1 DynamoDB table; 1 log group; 2 IAM roles + 2 inline policies; 1 Lambda function + its event-invoke config (async retries 0); 1 schedule (**DISABLED**); 6 alarms (no actions). DynamoDB on-demand ceiling 10 read and 10 write request units per second. No budget (`stackBudget: false`) |

The synthesized template has no VPC, NAT, EC2, RDS, SQS, ECS, KMS key or `AWS::CDK::Metadata` resource. It also has no publicly reachable endpoint:
- No Lambda Function URL, resource-based permission, API Gateway, load balancer or CloudFront.
- The bucket policy contains only a TLS-only Deny, and all four public-access blocks are on.
- The function is invoked only by IAM-authenticated calls: the operator, or the disabled schedule's role.

With no VPC there is no NAT gateway or interface endpoint charge. The fixture test makes no outbound employer requests, so data transfer is effectively zero.

### Budget

**The dev account's budget is created by hand, before anything is deployed** (guardrail G1 below). It is not created by the stack, which is why `stackBudget: false` is set. It then also covers bootstrap costs, survives `cdk destroy`, and is never re-created by a redeploy, so it needs verifying only once. It is `career-central-dev-guardrail`: $5 monthly cost budget, email at 50, 80 and 100 % of actual and 100 % of forecast (`infra/policies/dev-account-budget*.json`). Only the admin session can change or delete it (SCP `scp-dev-cost-guardrails.json`). The stack's own budget (`stackBudget` default `true`) remains available for accounts without one.
- **Email verification is required** (AWS Budgets, for recipients added from 2026-09-30; [AWS announcement](https://aws.amazon.com/about-aws/whats-new/2026/10/aws-budgets/), [user guide](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-email-recipients.html)).
  - When the budget is created, AWS sends a verification email. **Only verified addresses receive budget alerts.**
  - The recipient must open the link while signed in to **this dev account** (its root session at G1, or an Identity Center session).
  - The link expires after **12 hours**. If it expires, choose **Resend verification** on the budget's detail page (Billing and Cost Management → Budgets → `career-central-dev-guardrail`).
  - The detail page shows the recipient as **Pending**, **Active** or **Inactive**. Acceptance requires **Active** (G1, rechecked at step 6a); Pending or Inactive blocks bootstrap and deployment.
  - Re-creating the budget adds the recipient again, so plan to verify again.
  - Use an address you read promptly.
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
CTX='careerCentral={"stackBudget":false,"accountBudgetName":"career-central-dev-guardrail","fixtureSources":["alpha"],"permissionsBoundaryName":"CareerCentralDevRoleBoundary"}'
# Add ,"reservedConcurrency":1 inside the braces if G5 found a Lambda concurrency quota of 1,000 or more (it hard-caps compute).
[ "$(aws sts get-caller-identity --query Account --output text)" = "$ACCOUNT" ] || echo "WRONG ACCOUNT - stop"   # 1
npx cdk synth --quiet --context "$CTX"                     # 3. clean cdk-nag report
npx cdk diff --context "$CTX"                              # 4. review: only the 17 resources above, both roles with the boundary
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
| 6 | Read back the configuration: `aws scheduler get-schedule` (name from `describe-stack-resources`), `aws lambda get-function-configuration --function-name "$FN" --query Environment.Variables`, `aws lambda get-function-event-invoke-config --function-name "$FN"`, `aws s3api get-public-access-block --bucket "$B"`, `aws dynamodb describe-continuous-backups --table-name "$T"`, `aws budgets describe-subscribers-for-notification --account-id "$ACCOUNT" --budget-name career-central-dev-guardrail --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=50,ThresholdType=PERCENTAGE` | Schedule `DISABLED`; `MONITOR_LIVE_READS=disabled`, `MONITOR_FIXTURE_SOURCES=alpha`; `MaximumRetryAttempts` 0; all four public-access blocks true; PITR `ENABLED`; table `OnDemandThroughput` 10/10 (`aws dynamodb describe-table`); one `EMAIL` subscriber with the approved address |
| 6a | Billing and Cost Management → Budgets → `career-central-dev-guardrail`: read the recipient status. It was verified at G1; if it is not Active, use **Resend verification** and complete it while signed in to the dev account. If the operator session cannot open the page, use a short `CareerCentralDevBootstrap` session and record that. | The recipient status is **Active** (verified). **Pending** or **Inactive** fails the test: alerts would reach nobody. Stop here until it is Active. |
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

## Running from AWS CloudShell (the current path: WSL SSO is not working)

Target: account **978446946447**, region **us-east-1** (Identity Center lives in us-east-2, which does not matter here). Everything runs in a CloudShell session **in us-east-1**, signed in to 978446946447 with the Identity Center `AdministratorAccess` permission set.
- CloudShell never synthesizes or builds anything. It deploys the reviewed, pre-synthesized assembly from the offline package.
- The assembly is pinned to `aws://978446946447/us-east-1`, so `cdk deploy` refuses credentials for any other account.
- Commands are written for an interactive shell: no `set -e`, which would close CloudShell on the first error. Each check prints `OK` or `STOP`; stop at the first `STOP`.

**0. Build the package (WSL, offline; already done for this review).**

```bash
cd <C1 worktree>/infra && npm run package:cloudshell
sha256sum dist/cloudshell/career-central-c1/SHA256SUMS     # record this value
```

The SHA256SUMS hash is the integrity anchor. The tarball's own hash changes on every rebuild (file timestamps), but its contents do not. Upload `infra/dist/cloudshell/career-central-c1.tar.gz` (from Windows: `\\wsl$\<distro>\<path to the C1 worktree>\infra\dist\cloudshell\`) with CloudShell → **Actions → Upload file**.

**1. Identity, region and package (read-only).**

```bash
export ACCOUNT=978446946447 AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1 CDK="npx --yes aws-cdk@2.1146.1"
[ "$(aws sts get-caller-identity --query Account --output text)" = "$ACCOUNT" ] && echo "OK account" || echo "STOP: wrong account"
aws sts get-caller-identity --query Arn --output text          # expect .../AWSReservedSSO_AdministratorAccess_...
node --version                                                  # expect v20 or later
mkdir -p ~/cc && tar -xzf ~/career-central-c1.tar.gz -C ~/cc && cd ~/cc/career-central-c1
sha256sum SHA256SUMS                                            # must equal the value recorded at step 0
sha256sum -c SHA256SUMS --quiet && echo "OK package" || echo "STOP: package altered"
cat MANIFEST.json
```

**2. Guardrail gates (read-only; G1–G6 must be in place first).**

```bash
aws budgets describe-budget --account-id $ACCOUNT --budget-name career-central-dev-guardrail --query 'Budget.[BudgetLimit.Amount,TimeUnit]' --output text   # 5.0 MONTHLY
#   Console: Billing and Cost Management → Budgets → career-central-dev-guardrail → recipient status must be Active.
aws s3control get-public-access-block --account-id $ACCOUNT --query 'PublicAccessBlockConfiguration' --output text    # True True True True
aws ec2 describe-regions --region us-east-1 >/dev/null 2>&1 && echo "STOP: service-allowlist SCP not attached" || echo "OK ec2 denied by SCP"
aws lambda list-functions --region us-west-2 >/dev/null 2>&1 && echo "STOP: region SCP not attached" || echo "OK other regions denied"
aws service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384 --query Quota.Value --output text  # >=1000: rebuild with --reserved-concurrency 1
aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1 && echo "STOP: already bootstrapped - review first" || echo "OK not bootstrapped"
for p in CareerCentralDevRoleBoundary CareerCentralDevCfnExec; do aws iam get-policy --policy-arn arn:aws:iam::$ACCOUNT:policy/$p >/dev/null 2>&1 && echo "STOP: $p exists" || echo "OK $p absent"; done
```

**3. Validate the policies with IAM Access Analyzer (read-only, free).**

```bash
for p in dev-cfn-execution-policy dev-role-boundary dev-operator-policy; do echo "== $p"; aws accessanalyzer validate-policy --policy-type IDENTITY_POLICY --policy-document file://policies/$p.json --query 'findings[].[findingType,issueCode]' --output text; done
for p in scp-dev-region scp-dev-service-allowlist scp-dev-cost-guardrails; do echo "== $p"; aws accessanalyzer validate-policy --policy-type SERVICE_CONTROL_POLICY --policy-document file://policies/$p.json --query 'findings[].[findingType,issueCode]' --output text; done
```

Pass: no `ERROR` and no `SECURITY_WARNING`. A `SUGGESTION` or `WARNING` is recorded and reviewed, not ignored.

**4. Create the two managed policies — APPROVAL REQUIRED.**

```bash
aws iam create-policy --policy-name CareerCentralDevRoleBoundary --description "Career Central dev: permissions boundary for stack roles" --policy-document file://policies/dev-role-boundary.json --query Policy.Arn --output text
aws iam create-policy --policy-name CareerCentralDevCfnExec --description "Career Central dev: CloudFormation execution policy" --policy-document file://policies/dev-cfn-execution-policy.json --query Policy.Arn --output text
```

**5. Restricted CDK bootstrap — APPROVAL REQUIRED.**

```bash
mkdir -p ~/cc/bootstrap && cd ~/cc/bootstrap          # empty directory: no app, nothing to synthesize
$CDK bootstrap aws://978446946447/us-east-1 \
  --cloudformation-execution-policies arn:aws:iam::978446946447:policy/CareerCentralDevCfnExec \
  --bootstrap-kms-key-id AWS_MANAGED_KEY --public-access-block-configuration true
```

Verify (read-only). The execution role must carry **only** `CareerCentralDevCfnExec`, never `AdministratorAccess`:

```bash
EXEC=cdk-hnb659fds-cfn-exec-role-$ACCOUNT-us-east-1
aws iam list-attached-role-policies --role-name $EXEC --query 'AttachedPolicies[].PolicyArn' --output text   # exactly arn:aws:iam::978446946447:policy/CareerCentralDevCfnExec
[ "$(aws iam list-attached-role-policies --role-name $EXEC --query 'AttachedPolicies[].PolicyName' --output text)" = "CareerCentralDevCfnExec" ] && echo "OK restricted exec role" || echo "STOP: unexpected exec-role policies"
[ -z "$(aws iam list-role-policies --role-name $EXEC --query 'PolicyNames' --output text)" ] && echo "OK no inline policies" || echo "STOP: inline policy on exec role"
aws cloudformation describe-stacks --stack-name CDKToolkit --query "Stacks[0].Parameters[?ParameterKey=='CloudFormationExecutionPolicies'||ParameterKey=='TrustedAccounts'||ParameterKey=='FileAssetsBucketKmsKeyId'].[ParameterKey,ParameterValue]" --output text
#   expect: the CareerCentralDevCfnExec ARN, an empty TrustedAccounts, and AWS_MANAGED_KEY
```

Then simulate the execution role (read-only; the simulator applies SCPs). Each line prints the decision:

```bash
EXEC_ARN=arn:aws:iam::$ACCOUNT:role/$EXEC; BND=arn:aws:iam::$ACCOUNT:policy/CareerCentralDevRoleBoundary; ROLE=arn:aws:iam::$ACCOUNT:role/CareerCentralMonitor-dev-Probe
sim() { aws iam simulate-principal-policy --policy-source-arn $EXEC_ARN "$@" --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text; }
sim --action-names iam:CreateRole iam:PutRolePolicy --resource-arns $ROLE --context-entries "ContextKeyName=iam:PermissionsBoundary,ContextKeyValues=$BND,ContextKeyType=string"   # allowed allowed
sim --action-names iam:CreateRole iam:PutRolePolicy --resource-arns $ROLE                                                                                            # explicitDeny explicitDeny
sim --action-names iam:CreateRole --resource-arns $ROLE --context-entries "ContextKeyName=iam:PermissionsBoundary,ContextKeyValues=arn:aws:iam::aws:policy/AdministratorAccess,ContextKeyType=string"  # explicitDeny
sim --action-names iam:DeleteRolePermissionsBoundary iam:AttachRolePolicy --resource-arns $ROLE                                                                      # explicitDeny explicitDeny
sim --action-names iam:CreatePolicyVersion iam:SetDefaultPolicyVersion --resource-arns arn:aws:iam::$ACCOUNT:policy/CareerCentralDevCfnExec                          # explicitDeny explicitDeny
sim --action-names iam:PutRolePolicy --resource-arns $EXEC_ARN                                                                                                       # explicitDeny
sim --action-names lambda:CreateFunctionUrlConfig lambda:AddPermission --resource-arns arn:aws:lambda:us-east-1:$ACCOUNT:function:CareerCentralMonitor-dev-Probe  # explicitDeny explicitDeny
sim --action-names ec2:RunInstances s3:DeleteBucket dynamodb:DeleteTable                                                                                            # explicitDeny implicitDeny implicitDeny
```

**6. Fixture-only deployment — APPROVAL REQUIRED.**

```bash
cd ~/cc/career-central-c1
$CDK diff --app cdk.out CareerCentralMonitor-dev          # review: 17 resources, both roles with the boundary, no budget
$CDK deploy --app cdk.out CareerCentralMonitor-dev --require-approval broadening   # confirm the IAM summary when prompted
```

**7. Acceptance (steps 6–17 of the test table, CloudShell form).** Capture the names first; teardown needs them after the stack is gone:

```bash
q() { aws cloudformation describe-stacks --stack-name CareerCentralMonitor-dev --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
B=$(q BucketName); T=$(q TableName); FN=$(q FunctionName); echo "B=$B T=$T FN=$FN" | tee ~/cc/names.txt
res() { aws cloudformation describe-stack-resources --stack-name CareerCentralMonitor-dev --query "StackResources[?$1].PhysicalResourceId" --output text; }
SCHED=$(res "ResourceType=='AWS::Scheduler::Schedule'"); TICK=$(res "ResourceType=='AWS::IAM::Role' && starts_with(LogicalResourceId,'MonitorTickRole')")
LG=$(aws lambda get-function-configuration --function-name "$FN" --query LoggingConfig.LogGroup --output text)
# 6: configuration
aws scheduler get-schedule --name "$SCHED" --query State --output text                                            # DISABLED
aws lambda get-function-configuration --function-name "$FN" --query 'Environment.Variables.[MONITOR_LIVE_READS,MONITOR_FIXTURE_SOURCES]' --output text   # disabled alpha
aws lambda get-function-event-invoke-config --function-name "$FN" --query '[MaximumRetryAttempts,MaximumEventAgeInSeconds]' --output text   # 0 300
aws lambda get-function-url-config --function-name "$FN" >/dev/null 2>&1 && echo "STOP: function URL" || echo "OK no function URL"
aws lambda get-policy --function-name "$FN" >/dev/null 2>&1 && echo "STOP: resource policy" || echo "OK no resource policy"
aws s3api get-public-access-block --bucket "$B" --query PublicAccessBlockConfiguration --output text               # True True True True
aws dynamodb describe-table --table-name "$T" --query 'Table.[BillingModeSummary.BillingMode,OnDemandThroughput.MaxReadRequestUnits,OnDemandThroughput.MaxWriteRequestUnits]' --output text   # PAY_PER_REQUEST 10 10
aws dynamodb describe-continuous-backups --table-name "$T" --query ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus --output text   # ENABLED
for r in $(res "ResourceType=='AWS::IAM::Role'"); do aws iam get-role --role-name $r --query 'Role.[RoleName,PermissionsBoundary.PermissionsBoundaryArn]' --output text; done   # both: ...policy/CareerCentralDevRoleBoundary
# 7-14: fixture flow
SEED="node $HOME/cc/career-central-c1/seed-dev-fixture.mjs"; TARGET="--apply --bucket $B --table $T --region us-east-1"
invoke() { aws lambda invoke --function-name "$FN" --cli-binary-format raw-in-base64-out --payload '{}' "$1" --query '[StatusCode,FunctionError]' --output text; cat "$1"; echo; }
invoke ~/cc/out0.json        # 7: FunctionError Unhandled with MONITOR_LAMBDA_OBJECT_MISSING (NOT AccessDenied)
$SEED probe $TARGET          # 8: "passed":true
$SEED seed $TARGET --hours 2 && invoke ~/cc/out1.json && $SEED status $TARGET                 # 9: ok, polled 1, alertCount 0, provenance synthetic
$SEED fixture --step 2 $TARGET && sleep 370 && invoke ~/cc/out2.json && $SEED status $TARGET  # 10: alertCount 1
sleep 370 && invoke ~/cc/out3.json && $SEED status $TARGET                                     # 11: alertCount still 1
for i in 1 2; do aws lambda invoke --function-name "$FN" --invocation-type Event --cli-binary-format raw-in-base64-out --payload '{}' /dev/null --query StatusCode --output text & done; wait; sleep 30; $SEED status $TARGET   # 12: alertCount still 1
TICK_ARN=arn:aws:iam::$ACCOUNT:role/$TICK
aws iam simulate-principal-policy --policy-source-arn $TICK_ARN --action-names s3:DeleteObject s3:PutObject --resource-arns "arn:aws:s3:::$B/projection/x" --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text   # 13: implicitDeny implicitDeny
aws iam simulate-principal-policy --policy-source-arn $TICK_ARN --action-names dynamodb:DeleteItem --resource-arns arn:aws:dynamodb:us-east-1:$ACCOUNT:table/$T --context-entries "ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=SOURCE#alpha,ContextKeyType=stringList" --query 'EvaluationResults[].EvalDecision' --output text   # implicitDeny
aws iam simulate-principal-policy --policy-source-arn $TICK_ARN --action-names dynamodb:DeleteItem --resource-arns arn:aws:dynamodb:us-east-1:$ACCOUNT:table/$T --context-entries "ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=MONITOR,ContextKeyType=stringList" --query 'EvaluationResults[].EvalDecision' --output text   # allowed
$SEED revoke $TARGET && sleep 370 && invoke ~/cc/out4.json && $SEED status $TARGET             # 14: ok false, MONITOR_RECURRING_NOT_AUTHORIZED; nothing polled
# 15-16: logs and alarms
for p in '"example.invalid"' '"Fictional Alpha"'; do aws logs filter-log-events --log-group-name "$LG" --filter-pattern "$p" --query 'length(events)' --output text; done   # 0 and 0
aws cloudwatch describe-alarms --alarm-name-prefix CareerCentralMonitor-dev --query "MetricAlarms[?StateValue=='ALARM'].AlarmName" --output text   # empty
```

Step 17, the next day: Billing → Bills, under $0.50. **Emergency stop at any point:** `aws lambda put-function-concurrency --function-name "$FN" --reserved-concurrent-executions 0`.

**8. Teardown — DESTRUCTIVE, APPROVAL REQUIRED.** Run in order. The first line reloads the names saved at step 7, in case the session restarted.

```bash
cd ~/cc/career-central-c1 && eval "$(sed 's/ /\n/g' ~/cc/names.txt)" && echo "B=$B T=$T"
$CDK destroy --app cdk.out CareerCentralMonitor-dev        # confirm interactively; deletes all but the retained bucket and table
empty_bucket() {   # deletes every object version and delete marker, 1,000 at a time
  while :; do
    aws s3api list-object-versions --bucket "$1" --max-items 1000 --output json > ~/cc/v.json || return 1
    node -e 'const v=require(process.env.HOME+"/cc/v.json");const o=[...(v.Versions||[]),...(v.DeleteMarkers||[])].slice(0,1000).map(x=>({Key:x.Key,VersionId:x.VersionId}));if(!o.length)process.exit(3);require("fs").writeFileSync(process.env.HOME+"/cc/del.json",JSON.stringify({Objects:o,Quiet:true}))'
    [ $? -eq 3 ] && break
    aws s3api delete-objects --bucket "$1" --delete file://$HOME/cc/del.json --query 'length(Errors || `[]`)' --output text
  done
}
empty_bucket "$B" && aws s3api delete-bucket --bucket "$B" && echo "OK bucket deleted"
aws dynamodb delete-table --table-name "$T" --query TableDescription.TableStatus --output text      # DELETING
# Optional, once nothing else uses the bootstrap:
aws cloudformation delete-stack --stack-name CDKToolkit && aws cloudformation wait stack-delete-complete --stack-name CDKToolkit && echo "OK CDKToolkit deleted"
empty_bucket cdk-hnb659fds-assets-$ACCOUNT-us-east-1 && aws s3api delete-bucket --bucket cdk-hnb659fds-assets-$ACCOUNT-us-east-1   # retained by bootstrap
aws iam delete-policy --policy-arn arn:aws:iam::$ACCOUNT:policy/CareerCentralDevCfnExec
aws iam delete-policy --policy-arn arn:aws:iam::$ACCOUNT:policy/CareerCentralDevRoleBoundary
aws s3api list-buckets --query "Buckets[?starts_with(Name,'careercentralmonitor-dev')||starts_with(Name,'cdk-hnb659fds')].Name" --output text   # empty
aws dynamodb list-tables --query "TableNames[?starts_with(@,'CareerCentralMonitor-dev')]" --output text                                       # empty
```

The budget and SCPs remain as account guardrails; removing them is a separate decision.

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
