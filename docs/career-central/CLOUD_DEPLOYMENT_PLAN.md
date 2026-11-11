# Cloud infrastructure readiness and minimal deployment plan

Date: 2026-11-11. Status: **proposed plan; nothing provisioned.** Supersedes the *ordering* of [audit §15.8](../architecture/career-central-audit.md#158-incremental-hybrid-deployment-plan-and-acceptance-gates). Unattended monitoring moves ahead of a hosted dashboard, recorded in [ADR 0003](decisions/0003-cloud-monitoring-first.md). The security, authentication, worker-protocol and outbound-only principles of audit §15.4–15.6 remain in force. The first milestone is specified in [CC-017](tasks/CC-017.md).

Product context: the [product vision](PRODUCT.md) and [ADR 0004](decisions/0004-product-vision-expansion.md) (single-user first; no billing, organizations or multi-tenancy in the near-term plan). Current pilot state: [STATUS](STATUS.md).

Goal: the smallest reliable, secure, cost-controlled AWS system that runs employer monitoring while the PC is off. It must extend later to a hosted dashboard, hybrid browser workers and approved automation without a rewrite.

## 1. Readiness assessment (inspected 2026-11-11)

| Area | Current state | Cloud readiness |
|---|---|---|
| Poll cycle and evaluator (`pollSource`, `evaluateMonitoredJob`, `monitor-feed.mjs`) | Pure Node with injected clock, fetch and store. Bounded HTTP (2 allowlisted GETs, 20 s timeout, 8 MiB cap, no redirects). Leases, backoff and Retry-After, adaptive jitter, conditional reads, per-version alert deduplication. | **Compatible** with Lambda once a cloud store adapter exists. No browser and no secrets: public ATS feeds only. |
| Scheduler (`runMonitorTick`, `monitorHealth`) | One bounded pass with a non-overlap lock, persisted expiring authorization and distinct health states. Simulated 8-hour run validated. | **Compatible**: maps onto a scheduled Lambda (Section 3). The tick lock becomes reserved concurrency 1 plus per-source leases. |
| Monitor storage (`monitor-store.mjs`) | Per-source partition documents (~0.7–1.0 MB compact each) with digest-guarded atomic replace, index written last. Verified migration and rollback. Real data still in legacy mode. | **Maps directly** to S3 objects with `If-Match` conditional writes plus a small DynamoDB control table (Section 5). Needs two changes: per-source scoped updates (today every operation assembles all partitions) and no partition rewrite when a snapshot is unchanged (today `lastSeenAt` changes every poll). |
| Eligibility inputs | Reads the full private profile/policy, `portals.yml`, blacklist, tracker and the application ledger's jobs. | **Not cloud-ready.** Needs a minimized, versioned eligibility projection (Section 7). No résumé, email, contacts or raw application records. |
| Dashboard (`web/`, Next.js 16) | Filesystem-bound server components and routes; loopback/same-origin guard, which is not authentication. | **Local only.** A hosted dashboard is stage C3; before then a local `pull` command mirrors cloud results into the local dashboard. |
| Application automation | Playwright sessions, local files and kill switches (`STOP`, `CAREER_OPS_STOP_SUBMISSIONS`). | **Local only by design** (stage C4 outbound worker). Never a Lambda. |
| Email (Gmail/Outlook) | Local OAuth/token caches; reviewed sending. | Local until a separate C5 decision on token custody. |
| CI | GitHub Actions: tests, web CI, CodeQL, dependency review, SBOM, `no-user-data`. No deploy pipeline, no IaC, no AWS identity. | Extend with a separate, path-filtered infra workflow (Section 9). |
| Authentication/authorization | None for cloud. | Not needed for C1, which has no inbound API. Required before C3. |
| IaC | None (only Dockerfiles). | Greenfield (Section 8). |

Readiness verdict: the monitoring logic is cloud-shaped and safe to move first. It needs no credentials, no inbound endpoint and no browser. The blockers are local and fixable before any AWS spend: a scoped store port, an unchanged-snapshot fast path, a minimized eligibility projection, structured redacted telemetry, and a Lambda handler wrapper (stage C0 in [CC-017](tasks/CC-017.md)).

## 2. Target hybrid architecture (end state, staged)

```text
                      ┌──────────────────────── AWS (per environment: dev, prod) ─────────────────────────┐
 EventBridge Scheduler │  rate(5 min) ──▶ Lambda monitor-tick (reserved concurrency 1, no VPC)            │
                      │                     │  claim/release lease (conditional)   ──▶ DynamoDB control   │
                      │                     │  GET/PUT partition (If-Match ETag)    ──▶ S3 partitions/    │
                      │                     │  public ATS feeds (HTTPS, allowlisted)                       │
                      │                     └─ EMF metrics + redacted JSON logs ──▶ CloudWatch + alarms   │
                      │  [C2+] dispatcher ──▶ SQS poll queue (+DLQ) ──▶ Lambda poll-worker (concurrency N) │
                      │  [C3]  CloudFront + S3 static app ── Cognito ── API Gateway HTTP API ── Lambda API │
                      │  [C4]  DynamoDB task records (authoritative) + optional SQS wake-up hints          │
                      │  AWS Budgets ─ cost alarms; IAM roles per function; GitHub OIDC deploy role       │
                      └──────────────────────────────────────▲──────────────────────────────────────────┘
                                                             │ outbound HTTPS only (pull / claim / report)
                      Windows/WSL: local CLI + dashboard; [C1] `monitor pull` mirror; [C4] Playwright
                      worker (authenticated employer sessions, CAPTCHA/human handoff, final approval)
```

The PC never accepts inbound connections. Cloud components own unattended monitoring; local components own credentials, browser sessions, résumé bytes and every external application action.

## 3. Service decision matrix

| Service | Decision | Why it is needed | Alternatives considered | Cost/complexity introduced |
|---|---|---|---|---|
| EventBridge Scheduler | **C1** | Durable, managed periodic trigger independent of the PC. | EventBridge rules (fine, fewer features); cron on an always-on VM (patching, ~$3.5–12/mo). | Free up to 14M invocations/mo, $1/M after ([pricing](https://aws.amazon.com/eventbridge/pricing/)); the tick runs ~8,640×/mo. Minimal complexity. |
| Lambda (Node 22, arm64) | **C1** | Runs the existing tick/poll code with no servers; monitoring is short and bursty. | ECS/Fargate (always-on or task overhead, ~$9/mo minimum); Lightsail VM. | Free allowance covers scenario A; cost grows with duration (Section 11). The 15-minute limit is irrelevant (ticks are bounded). |
| DynamoDB (on-demand, PITR) | **C1** for control records | Conditional writes give leases, schedules, authorization, alert/task items and idempotency keys. Per-key queries for the scheduler and dashboard. | RDS/Aurora (idle cost, VPC, NAT risk); Postgres later only if relational analytics need it. | Pennies at these volumes. Partition documents don't fit the 400 KB item limit, hence S3. |
| S3 (private, versioned) | **C1** for per-source partition documents | One object per employer mirrors the local partition file. `If-Match` conditional PUT reproduces the local digest compare-and-swap. Large and cheap. | Per-posting DynamoDB items (rewriting `lastSeen` for ~450 postings per poll costs far more writes); EFS (VPC/NAT). | Pennies with change-only writes and a lifecycle on non-current versions. |
| CloudWatch (Logs, EMF metrics, alarms) | **C1** | Health, failure and latency signals while unattended. | Third-party observability (new vendor, secrets). | Logs $0.50/GB ingest; keep about 10 aggregate metrics and 10 alarms inside free allowances. Per-source metric dimensions multiply cost; per-source detail goes in logs and DynamoDB instead. |
| IAM | **C1** | Per-function least privilege; GitHub OIDC deploy role; no long-lived keys. | — | Free. Needs policy tests (Section 8). |
| AWS Budgets | **C1** | Spending alerts (not hard caps). | Cost Explorer only. | Free budgets for alerts. |
| SQS Standard + DLQ | **Deferred to C2** | Fan-out when one sequential tick can't finish all due sources (beyond ~15–20 sources or 5-minute sources), plus retry isolation and DLQ visibility. Later wake-up hints for worker tasks. | Sequential tick (C1); Step Functions (unnecessary). | ~$0.40/M requests after 1M free. Adds visibility-timeout and idempotency design. Never the authoritative task ledger (14-day retention). |
| Secrets Manager / SSM Parameter Store | **Not needed in C1** (public feeds). C5: an SSM SecureString (standard tier) or one Secrets Manager secret for cloud mail tokens if approved. | Token custody for cloud email sync. | Keep tokens local (default). | $0.40/secret/mo (Secrets Manager); standard SSM parameters have no storage charge. |
| API Gateway HTTP API | **C3** | Authenticated dashboard/worker API. | Lambda function URLs (weaker authorizer story). | ~$1/M requests. |
| CloudFront + S3 static app | **C3** | Hosted dashboard shell. | Amplify SSR (Next 16 support unverified). | Usually within the free allowance. |
| Cognito user pool | **C3** | Owner login with MFA; separate worker client with narrow scopes. | Self-built auth (rejected). | Free for one user (verify plan). |
| ECS/Fargate | **Evaluate in C6 only**, as short-lived tasks | Ephemeral cloud browser workers, if measured local-worker unavailability blocks valuable preparation (§16). Authenticated employer sessions stay local by default. | A Lambda container image with headless Chromium for short, stateless page work; local Chromium (default) | Per-second billing with a 1-minute minimum per task; no always-on service. |
| EC2 | **Not planned** | Only if measured, sustained browser workload makes it cheaper than ephemeral tasks | Fargate tasks; Lambda | Always-on cost and patching; justify with measurements first. |
| VPC / NAT Gateway | **Avoid** | Nothing private to reach; Lambdas use public AWS endpoints. | — | A NAT Gateway is ~$33/mo plus data. |
| Bedrock (AI matching) | **Later, opt-in** | Semantic matching for postings that already pass deterministic filters. | Local/agent evaluation (current). | Haiku-class ~$1/M input, $5/M output tokens (verify). Capped by budget. |

## 4. Continuous monitoring design in the cloud

- **Schedule:** one Scheduler at `rate(5 minutes)`, which is the finest employer target. Per-source intervals (5/15/30–60 minutes, adaptive up to 4×, jitter, exponential backoff, Retry-After) are already enforced by `nextDueAt` in the source control record, so the tick polls only due sources. A target is not a latency guarantee.
- **Rate limits:** per-source minimum interval (validated ≥ 5 minutes), at most 2 allowlisted GETs per cycle, honored Retry-After and backoff up to 24 hours, at most N polls per tick from the authorization record, and C2 queue concurrency caps.
- **Identity and times:** the provider/board/native-ID hash, the canonical URL key, the content hash/version, `firstSeenAt` (never rewritten), nullable `employerPublishedAt` with provenance, `lastSeenAt` at snapshot level, and missing-count expiry, all reused unchanged. Publication time is never inferred from discovery.
- **Change detection:** baseline polls are quiet. New, updated, reappeared and expired are distinct events. One alert per (posting, version); preparation proposals are unique per posting.
- **Crash recovery and idempotency:** claim → fetch → conditional partition write → conditional release (Section 5). Any interruption is replay-safe because alerts and proposals are keyed inside the same partition write.
- **Health:** the same states as local (`ok_no_changes`, `ok_changes`, `failing`, `rate_limited`, `overdue`, `worker_lost`, `paused`, `never_polled`, `cached_only`; scheduler `running`/`stale`/`not_authorized`/`authorization_expired`), written to the control table and as aggregate metrics.

## 5. How per-employer storage maps to cloud persistence

| Local (implemented) | Cloud | Concurrency control |
|---|---|---|
| `data/job-monitor/sources/{id}.json` (source, postings, alerts, proposals) | `s3://cc-{env}-monitor/partitions/{sourceId}.json` (SSE-S3, versioned) | `PutObject` with `If-Match: <ETag read at claim>`; a stale writer gets 412 and aborts. Equivalent to the local `expectedDigest`. |
| `source` record fields used for scheduling (lease, nextDueAt, paused, failures, status, checkpoint summary) | DynamoDB `PK=SOURCE#{id}`, `SK=CONTROL` | Claim: `ConditionExpression attribute_not_exists(lease) OR lease.until < :now`, then set `lease={token,until}`. Release: condition `lease.token = :token`. |
| `index.json` (source list, revision, scheduler/authorization, lastTick) | `PK=MONITOR`, `SK=SCHEDULER` and `SK=AUTH` | Conditional on `version`. |
| Alerts/proposals inside the partition | Kept in the partition (authoritative); projected to `PK=ALERT#{eventId}` with `attribute_not_exists(PK)` for dashboard queries | Idempotent put; duplicates are no-ops. |
| Ledger jobs read by the evaluator | `s3://…/projection/eligibility-v{n}.json` (minimized, hashed history keys) | Versioned upload from local; the tick records the projection version in `match.profileDigest`. |

Transaction boundary: one source cycle, as locally. Crash windows:
- After the claim: the lease expires (`worker_lost`) and the next tick reclaims it.
- After the S3 write but before the release: the next claim sees the newer object, re-polling yields `unchanged`, and the alerts were already committed.
- If the release fails: same as an expired lease.

Single-writer rule: each partition carries `owner: local|cloud`. Migration flips ownership per source, and local ticks are revoked for cloud-owned sources, so there is no split-brain.

## 6. Durable task queue (C2/C4) and application coordination

- **SQS semantics:** at-least-once delivery, possible duplicates and no ordering, so consumers must be idempotent. Message body is `{schemaVersion, type, sourceId|taskId, dueAt, correlationId}`; it never carries profile data, answers, codes or tokens. Visibility timeout ≥ 6× function timeout; `ReportBatchItemFailures`; `maxReceiveCount` 3 → DLQ with an alarm on any visible message (poison messages are inspected, not auto-replayed). Payload schema validation at the consumer; unknown versions go to the DLQ.
- **Authority:** DynamoDB task records are authoritative (states `queued → leased → running → waiting_for_information|waiting_for_approval → succeeded|failed|cancelled|reconciliation_required`). SQS only wakes consumers. Logical ownership is the lease token plus task generation; external side effects are recorded separately as attempts with evidence.
- **Duplicate-application prevention:** before any external action, a conditional write on `PK=APPLICATION#{canonicalKey}` (and the requisition group) moves `attempt=none → dispatching` with the approval grant hash. A redelivered message or second worker fails the condition. An ambiguous dispatch becomes `reconciliation_required` and is **never retried automatically**.
- **Worker protocol (C4):** the local worker authenticates outbound (Cognito device client, short-lived tokens), claims a task, fetches only the fields that task needs, prepares, and requests approval. On approval (a grant bound to plan/document hashes with an expiry) it re-validates liveness, revocation and the kill switch before submitting, then reports evidence.
  - Browser crash, disconnect or lease loss: the task returns to `leased → expired`, and any partial external effect is reconciled, never re-submitted.
  - Form changes: the task goes to `waiting_for_information`.
  - Security challenge: human handoff.
  - Approval revoked while queued: the claim condition fails.
  - Global emergency stop: a cloud flag plus the existing local `STOP`. Both are checked at every safe boundary.

## 7. Persistence, data minimization and migration

- **Source of truth by stage:**
  - C1: the cloud is authoritative for monitor partitions of cloud-owned sources only.
  - Application history, profile facts, résumé versions and email stay local and authoritative.
  - The cloud receives a **minimized eligibility projection:** graduation month, authorization/citizenship/sponsorship booleans, verified skills list, earliest start month, role-family weights, score threshold, and blacklist/history keys as hashes. It never receives résumé bytes, contacts, email, compensation or free-text answers.
- **Schema versioning:** every partition and item has `schemaVersion`. Adapters reject unknown versions (fail closed, as locally) and migrations are explicit commands with dry runs.
- **Migration path:**
  1. Local legacy → split, with the verified, rollback-capable `migrate-store` (pending your approval).
  2. Local split → S3 via a `cloud-push --source` command: upload the partition with `If-None-Match: *`, create the control item conditionally, verify the canonical hash round trip, then flip `owner=cloud` and revoke the local authorization for that source.
  3. Rollback: `cloud-pull --source`, verify, set `owner=local`, and disable the Scheduler or remove the source from the cloud authorization.
- **Backup and recovery:** S3 versioning (non-current versions kept 30 days), DynamoDB PITR (35 days), and a quarterly restore drill restoring one partition and the control item into dev. Local backups remain under `data/backups/` (git-ignored, 0700).
- **Retention:** logs 14 days; alerts 180 days; expired postings archived after 90 days (C2); the eligibility projection keeps its current and previous version.

## 8. Security architecture

- Separate **dev and prod** accounts under AWS Organizations (preferred), or at least separate stacks with tag-scoped IAM. Root account with MFA and no access keys.
- **IAM:** the tick role may only `dynamodb:GetItem/UpdateItem/PutItem/Query` on the monitor table, `s3:GetObject/PutObject` on `partitions/*` and `GetObject` on `projection/*` (no delete, no list beyond the prefix), and write its own logs. The deploy role is assumed via GitHub OIDC, restricted to this repository's `main` branch and protected environments. CDK assertion tests pin these policies.
- **Encryption:** TLS-only bucket policy, SSE-S3, Block Public Access, ownership enforced; DynamoDB encryption with an AWS-owned key. No customer-managed KMS keys unless required.
- **Secrets:** none in C1. Later secrets go in SSM SecureString or Secrets Manager with per-function access, rotation, and nothing in environment variables or logs. OAuth tokens stay local unless C5 approves cloud custody.
- **Untrusted content:** job descriptions are data. The evaluator is deterministic regex/heuristics, with no LLM in C1. Any later LLM prompt treats posting text as quoted data with a fixed output schema, cannot trigger actions, and imperative text is flagged as a Block G anomaly.
- **Redaction:** logs carry IDs, counts, categories and durations only — no descriptions, profile facts, URLs with tokens, answers or email content. Redaction is unit-tested. No inbound endpoint exists until C3, and C3 requires Cognito JWT plus server-side ownership checks.
- **Revocation:** `revoke-recurring` (local) and disabling the cloud Scheduler or authorization record stop polling. Worker devices are revocable in C4.

## 9. IaC and CI/CD

- **IaC recommendation: AWS CDK v2 in TypeScript** under `infra/`.
  - It matches the repository's TypeScript/Node stack and test runner.
  - It synthesizes CloudFormation (managed rollback, drift detection, change sets).
  - It supports cdk-nag security checks and fine-grained assertion tests on IAM, encryption and alarms.
  - Terraform is a good alternative with portable skills, but adds a second language and state backend. Raw CloudFormation is verbose and harder to unit test.
  - Tags on every resource: `project=career-central`, `env`, `component`, `cost-center=personal`.
- **CI** (new `career-central-infra.yml`, path-filtered to `infra/**` and `lib/career-central/**`, separate from the upstream workflows):
  - Lint, unit and contract tests (file adapter and S3/DynamoDB adapters against mocked clients).
  - `cdk synth`, cdk-nag, assertion and snapshot tests.
  - `npm audit --omit=dev`; the existing CodeQL, dependency review and SBOM continue.
  - Once the read-only OIDC role is approved, `cdk diff` against dev is posted on the PR.
- **CD:** deploy to dev via manual `workflow_dispatch`; deploy to prod only through a protected GitHub environment with a required reviewer. Releases are immutable Lambda versions behind an alias. Rollback means redeploying the previous commit or shifting the alias, with automatic CloudFormation rollback on failed updates.
- **Protected `main`:** required checks, signed tags for prod releases. Infrastructure, function code and the eligibility projection version are released together from one commit. The local worker (C4) checks the API's minimum worker version before claiming.
- **GitOps:** "Git as the reviewed source of truth plus a PR diff plus gated deploys" is sufficient. A continuously reconciling controller (Argo/Flux) would need Kubernetes, which this system doesn't need.

## 10. Observability and reliability

- **Metrics** (EMF, namespace `CareerCentral/Monitor`, aggregate only, ≤ 10): `PollSucceeded`, `PollFailed`, `RateLimited`, `NotModified`, `NewOrChangedPostings`, `AlertsCreated`, `PollLagSeconds` (p90), `TickDurationMs`, `SourcesOverdue`, `AuthorizationHoursRemaining`.
- **Logs:** JSON with `correlationId` (tick ID + source ID) and the health state.
- **Alarms (≤ 10):**
  - Tick errors in 3 consecutive periods.
  - Missing tick metric for 30 minutes (treat missing data as breaching → scheduler stale).
  - Any source failing 3 consecutive cycles.
  - `SourcesOverdue > 0` for 30 minutes.
  - Lambda throttles.
  - Authorization expiring in under 24 hours.
  - (C2) DLQ visible messages > 0; queue age > 15 minutes.
  - Budget at 50/80/100% of the forecast.
- **States kept distinct:** no new jobs (`ok_no_changes`) versus failed source (`failing`) versus delayed (`overdue`, `PollLagSeconds`) versus disconnected worker (`worker_lost` / C4 heartbeat) versus failed application (task `failed` or `reconciliation_required`) versus awaiting approval (`waiting_for_approval`).
- **Runbook entries:**
  - Failing source: inspect the category, pause it, wait out backoff.
  - Stale scheduler: check the Scheduler and its role.
  - Worker lost: no action needed; it's reclaimed automatically.
  - DLQ: inspect and redrive manually.
  - Budget: disable the Scheduler.

## 11. Estimated monthly cost (us-east-1, USD, before tax; assumptions explicit)

Prices used (re-verify in the AWS Pricing Calculator before approval):
- **Lambda:** $0.20/M requests, $0.0000166667/GB-s, with an always-free 1M requests and 400k GB-s.
- **EventBridge Scheduler:** free to 14M invocations, then $1/M.
- **SQS:** $0.40/M after 1M free.
- **DynamoDB on-demand:** modelled at $1.25/M writes and $0.25/M reads. AWS's examples show $0.625 and $0.125; sources disagree, so the higher rate is used. Storage $0.25/GB.
- **S3:** $0.023/GB-mo, PUT $0.005/1k, GET $0.0004/1k.
- **CloudWatch:** Logs $0.50/GB ingest (5 GB free); custom metrics $0.30 (10 free); alarms $0.10 (10 free).
- **Bedrock Haiku-class:** ~$1/M input and $5/M output tokens.

Accounts created after mid-2025 receive a credit-based free plan; the always-free allowances above should not be assumed until checked in the account.

| Item | A — Minimal (5 employers @15 min) | B — Personal production (100: 20 @5 min, 80 @15 min) | C — Expanded (500: 50 @5 min, 450 @15 min) |
|---|---|---|---|
| Polls/month | 14,400 | 403,200 | 1,728,000 |
| Lambda | $0 (≈23k GB-s) | $0–3.40 (listing-first ≈1 s vs. 3 s per poll) | $8–36 |
| Scheduler | $0 | $0 | $0 |
| SQS | not used | $0–0.40 | ~$2 |
| DynamoDB | ~$0.10 | $1.30–2.30 | $5–10 |
| S3 | ~$0.10 | $0.40 (change-only writes); ~$5 if every poll rewrites | ~$1.60 (change-only) |
| CloudWatch logs/metrics/alarms | $0 | $0–1 | $1–4 |
| Hosted dashboard (C3: CloudFront, API Gateway, Cognito) | n/a | $0.20–0.50 | $1–2 |
| Secrets (only if cloud mail approved) | $0 | $0–0.80 | $0.80 |
| NAT / VPC / always-on compute | $0 (avoided) | $0 (avoided) | $0 (avoided) |
| **Infrastructure subtotal** | **≈ $0.20–1** | **≈ $3–12** | **≈ $20–55** |
| AI matching (optional, filtered postings only) | $0 | $3–11 (≈1,500 postings × 4.6k tokens) | $25–56 (≈8,000 postings; batching/caching lowers) |
| **Suggested budget alert** | **$5** | **$25** | **$100** |

Hidden costs avoided by design:
- NAT Gateway: ~$33/mo plus $0.045/GB.
- Idle RDS: ~$12–15/mo.
- Always-on Fargate or EC2: ~$9+/mo.
- Public IPv4: $3.65/mo each.
- Per-source metric dimensions: $0.30 per metric per source.
- Never-expiring log groups.
- Non-current S3 versions from rewriting partitions every poll.
- Unused Secrets Manager entries: $0.40 each.

Budgets alert; they do not stop spend. The runbook action at 100% of budget is to disable the Scheduler.

## 12. Scalability

- Sequential tick (C1) → SQS fan-out with capped concurrency (C2). Source-level rate limits stay in control records, so scaling workers never raises any employer's request rate.
- Keys are partitioned by source, so there are no hot partitions at personal scale. Scheduler and control queries are per key, and a GSI on `nextDueAt` is added only beyond ~200 sources.
- Listing-first fetch: the cheap title-only listing endpoint already exists for Greenhouse (`fetchListing`). The full-content fetch runs only when the listing changed.
- Backpressure: a per-tick poll budget, the queue age alarm, and graceful degradation that drops 5-minute sources to 15 minutes when lag rises.
- Reliable for one user first; multi-tenant concerns are out of scope.

## 13. Incremental roadmap

| Stage | Scope | Independently useful/testable | Reversible by |
|---|---|---|---|
| **C0 (local, no AWS)** | Approved local `migrate-store`; scoped store port with file and in-memory adapters plus contract tests; unchanged-snapshot fast path; eligibility projection exporter with forbidden-field tests; redacted EMF/log formatter; Lambda handler wrapper; dev-only fixture provider. | Yes: all offline tests; local tick still works. | `rollback-store`; git revert. |
| **C1 (AWS dev → prod)** | CDK stack: DynamoDB, S3, tick Lambda, Scheduler, logs/alarms, Budget, OIDC deploy role. Push 1–3 approved sources; local `monitor pull` mirror into the dashboard. | Monitoring while the PC is off; local dashboard shows results after pull. | Disable Scheduler; `cloud-pull`; `cdk destroy` (data retained). |
| **C2** | SQS fan-out + DLQ, listing-first fetch, more employers, expiry archive. | Scale to 20–100 sources. | Feature flag back to sequential tick. |
| **C3** | Cognito, API Gateway, Lambda API, static dashboard (read-only first). | Phone/desktop access with the PC off. | Remove distribution; data unaffected. |
| **C4** | Outbound local browser worker, task records, approvals, receipts, emergency stop. | Approved preparation/submission coordination. | Kill switches; worker revocation. |
| **C5** | Email-driven updates, mobile notifications, optional AI matching, cloud mail token custody. | Each separately. | Per-feature flags. |
| **C6 (conditional)** | Ephemeral cloud browser workers for unauthenticated or approved preparation steps (§16). | Only after measured need, a cost model and an approved session/credential design. | Disable the worker type; tasks fall back to the local worker. |

## 14. First cloud milestone

[CC-017](tasks/CC-017.md): C0 local readiness, then C1 cloud monitoring in a dev account with one to three approved sources. It lists acceptance criteria and tests.

## 15. Decisions requiring your approval before any deployment

1. Apply the local `migrate-store --apply` (backup taken; exact operation in [STATUS](STATUS.md)).
2. AWS account structure (new Organization with dev/prod accounts, or an existing account) and region (us-east-1 recommended for price and service coverage).
3. Monthly budget and alert thresholds, plus the email address that receives AWS Budget alerts.
4. Adding `infra/` with dev dependencies (`aws-cdk-lib`, `constructs`, `cdk-nag`) and the infra CI workflow.
5. Creating the GitHub OIDC roles (read-only diff role; deploy role) and protected GitHub environments.
6. Which employers move to cloud ownership, their intervals, the polls-per-tick budget and the authorization duration.
7. Exactly which eligibility-projection fields may be stored in AWS.
8. Retention periods (logs 14 days, versions 30 days, alerts 180 days) and backup/PITR enablement.
9. Alert delivery for C1: local pull only (recommended), or a separately approved channel.
10. The first `cdk deploy` to dev, and later promotion to prod.
11. Later: SQS (C2), hosted dashboard (C3), worker enrollment (C4), Bedrock and cloud mail (C5), each with its own budget.

## 16. Browser execution model

The hybrid execution model is unchanged: serverless monitoring and orchestration in the cloud, and browser work local first.

| Workload | Default placement | When to move | Constraints |
|---|---|---|---|
| Feed polling, normalization, deduplication, eligibility, ranking | Lambda (C1/C2) | — | API-first; no browser |
| Authenticated employer sessions, account logins, CAPTCHA or human-verification handoffs, résumé uploads | **Local Chromium worker** (C4, outbound-only) | Not planned for the cloud while credentials and human verification are involved | Credentials and cookies never leave the local vault; human handoff for challenges |
| Unauthenticated page reads (JD capture or liveness when no API exists), form-schema inspection | Local first; candidate for an **ephemeral cloud browser** (C6) | When the local worker's offline time measurably delays high-priority preparation | A Lambda container with Chromium (bounded duration and memory) or a short-lived Fargate task; per-task timeout, quota and cost metric |
| Long or heavy browser sessions | Local | EC2 only if sustained measured load makes it cheaper than ephemeral tasks | Justify with a cost comparison |

Common requirements for any cloud browser worker:
- Worker leases and idempotency keys, as for the monitor.
- Per-task timeouts and safe cancellation at defined boundaries.
- Concurrency and daily quotas.
- Cost and execution metrics with budget alarms.
- Outbound-only networking without a NAT Gateway unless a private resource requires one.
- No persisted cookies or credentials.
- Results stored as artifacts in S3 with hashes.
- Every external effect still governed by the [unified approval framework](design/APPROVALS_AND_AUTONOMY.md).

SQS is introduced only when distributed durable task execution needs it (C2 for polling fan-out, C4 for worker wake-ups), never as an empty day-one component.
