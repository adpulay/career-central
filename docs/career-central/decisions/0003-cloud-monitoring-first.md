# ADR 0003 — Cloud monitoring first; S3 partition documents plus a DynamoDB control table

Date: 2026-11-11. Status: accepted direction. The user's agreed product sequence ([ADR 0004](0004-product-vision-expansion.md)) places minimal always-on AWS monitoring at step 3. Every provisioning action still requires the explicit approvals in the plan's §15. Refines the stage order of [ADR 0001](0001-development-and-deployment.md) and [audit §15.8](../../architecture/career-central-audit.md#158-incremental-hybrid-deployment-plan-and-acceptance-gates); it does not change their security or worker principles.

Context: continuous employer monitoring is the highest-value capability that needs the PC to be off. It uses only public ATS feeds, needs no credentials and no inbound endpoint, and is already implemented locally with leases, backoff, deduplication, per-source partitions and a gated scheduler. The earlier plan put a read-only hosted dashboard first, which requires authentication, an API and a data split before delivering unattended value.

Decision:
- First cloud stage (C1): EventBridge Scheduler → one Lambda tick (reserved concurrency 1, no VPC) running the existing poll code.
- Per-source partition documents go to private S3 with `If-Match` conditional writes. Scheduling, lease, authorization and alert-projection records go to DynamoDB with conditional writes.
- No SQS until fan-out is measured as needed (C2). No secrets, no inbound API, no browser in the cloud.
- The local dashboard reads cloud results through an outbound `pull`. A hosted dashboard (C3) and hybrid workers (C4) follow.
- IaC with AWS CDK v2 in TypeScript; separate dev/prod; GitHub OIDC deploys behind protected environments.

Alternatives:
- Per-posting DynamoDB items: rejected for C1. Each poll would rewrite `lastSeen` for hundreds of postings, and the documents exceed the 400 KB item limit as single items.
- An always-on VM, Fargate or RDS: idle cost and patching.
- SQS from day one: adds visibility-timeout and DLQ handling with no benefit at five sources.
- Terraform: a credible alternative, but adds a second language and state backend.

Consequences: C0 local work (scoped store port, unchanged-snapshot fast path, minimized eligibility projection, redacted telemetry, handler wrapper) must land and be tested offline first. Single-writer ownership per source prevents split-brain between local and cloud ticks. Estimated C1 cost is under about $1/month at five sources, with a $5 budget alert. See [CLOUD_DEPLOYMENT_PLAN](../CLOUD_DEPLOYMENT_PLAN.md) and [CC-017](../tasks/CC-017.md). No provisioning, push, recurring activation, email or application action is authorized by this ADR.
