# ADR 0004 — Expanded product vision: identity, sources, approvals, networking, calm frontend

Date: 2026-11-11. Status: accepted product direction from the user's vision request. Each subsystem's technical design remains **proposed** until its implementation task is accepted. Builds on [ADR 0001](0001-development-and-deployment.md), [ADR 0002](0002-product-workflow-priorities.md) and [ADR 0003](0003-cloud-monitoring-first.md); it changes none of them except where noted under Consequences.

**Context.** Career Central is the owner's personal AI career platform, guided by *"I need more of me, but I also need to maintain me."* Discovery, monitoring, application safety and Gmail foundations exist. Identity data, approval rules and communication workflows are scattered across files and mechanisms. Future use by others is possible but not a near-term goal.

**Decisions**

1. **Single-user product first.** The near-term roadmap excludes billing, subscriptions, organizations and production multi-tenancy. Records reserve `ownerId` and stay per data root, so later isolation needs no rewrite.
2. **Career Identity** ([design](../design/CAREER_IDENTITY.md)) is a versioned read interface over the existing user-layer files, with claim classes `verified_fact` / `user_claim` / `preference` / `ai_inference` / `unknown`. Generated claims must trace to records or explicit approval. No credentials are stored in identity records. Consumers migrate one at a time; the first is the CC-017 eligibility projection.
3. **Job sources** ([register](../design/JOB_SOURCES.md)) track discovery, preparation and submission-with-receipt as **independent capabilities per provider**. Integration order is API/feed/email alerts first, browser second; aggregators are confirmed at the employer.
4. **Unified Approvals and Autonomy** ([design](../design/APPROVALS_AND_AUTONOMY.md)) defines action classes A–E and one grant model (scope, expiry, revocation, audit, idempotency, receipts, no automatic retry of ambiguous submissions). Defaults: discovery and drafting automatic; preparation scoped; every external send or submit requires explicit approval. Existing mechanisms map onto it without behavior change.
5. **Networking and Communications** ([design](../design/NETWORKING_AND_COMMUNICATIONS.md)) builds on Gmail. LinkedIn is limited to drafts with manual sending; relationships are never invented.
6. **Document Intelligence** ([design](../design/DOCUMENT_INTELLIGENCE.md)) is an evidence-checked tailoring pipeline that binds exact artifacts to each application. Not yet implemented as an integrated workflow.
7. **Frontend Design System** ([design](../design/FRONTEND_DESIGN_SYSTEM.md)): a calm, Wii Fit-*inspired* aesthetic using original assets only, scoped to Career Central routes so upstream career-ops pages and theme are unaffected. Rolled out incrementally; PWA later.
8. **Execution model** (extends [ADR 0003](0003-cloud-monitoring-first.md)): serverless monitoring and orchestration; local Chromium first for authenticated browser work; ephemeral cloud browser workers (a Lambda container with Chromium, or short-lived Fargate tasks) only when a measured workload justifies them. No always-on EC2 by default, and SQS only when distributed durable execution needs it ([plan §16](../CLOUD_DEPLOYMENT_PLAN.md#16-browser-execution-model)).

**Consequences**

- The roadmap gains a dependency-ordered product sequence (pilot → C0 → C1 → source expansion → identity and tailoring → application workflows → Approval Center → networking → frontend rollout → advanced tools and bounded autonomy).
- The sequence moves identity and tailoring **ahead of** completing P2 in the recommended order. P2 may still proceed with a basic approved résumé base, so this is an ordering recommendation, not a hard dependency.
- New requirements CC-R19–CC-R24 are added and existing IDs are kept.
- No feature becomes operational by this ADR. No provisioning, monitoring activation, sending or submission is authorized.

**Alternatives rejected:** keeping identity data in each consumer (it drifts and can't be traced); separate approval systems per feature (inconsistent guarantees); a global UI restyle (conflicts with upstream updates); always-on EC2 for browsers (idle cost before a measured need); early multi-tenant SaaS (delays a working personal product).
