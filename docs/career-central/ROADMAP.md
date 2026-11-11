# Milestones, product delivery and dependencies

Updated 2026-11-10. [Product specification](PRODUCT.md) · [feature inventory/status legend](FEATURE_INVENTORY.md) · [backlog](BACKLOG.md) · [sequencing decision](decisions/0002-product-workflow-priorities.md). This plan does not authorize external execution, monitoring, sending, applications, paid services or deployment.

## Preserved delivery history

Historical task records retain their original scope/test runs and contemporaneous pending states. Their old “no commit” wording is historical; Git and the latest handoff establish current commit state. Local completion never means a full user-facing product is done.

| Milestone / task | Current evidence level | Delivered scope and remaining boundary |
|---|---|---|
| M0 Phase 0 audit | Reviewed design | [Original audit](../architecture/career-central-audit.md); design proposals are not implemented features. |
| M0.5 context bootstrap | Validated locally | Durable context, original instruction hierarchy preserved. |
| M1 canonical read projection | Validated locally | [CC-001](tasks/CC-001.md); bounded read contract, identity/conflict/source evidence, no new authority. |
| M2 dashboard read slice | Validated locally, historical UI/build evidence | [CC-002](tasks/CC-002.md); overview/Home/API, not all product modules or an action dashboard. |
| M3A health/evidence contracts | Validated locally | [CC-003](tasks/CC-003.md); contracts/read models, not activated producers or independent receipt verification. |
| M3B persistence/recovery | Validated locally | [CC-004](tasks/CC-004.md); owned CAS/replay/atomic recovery, no general background automation. |
| M3C platform/secure Microsoft storage | Implemented/local fixture validation | [CC-005](tasks/CC-005.md); native protected-vault/live Graph acceptance remains pending. |
| Local M3D preparation | Validated offline | [CC-006](tasks/CC-006.md) bounded coordinator; [CC-007](tasks/CC-007.md) explicit interrupted-run recovery. |
| M3D controlled Outlook command | Implemented, not live-validated | [CC-008](tasks/CC-008.md); optional future provider path, not a blocker for Gmail-based product delivery. |
| Dedicated Gmail receiver/diagnostics | Bounded live list user-validated | [CC-009](tasks/CC-009.md), [CC-010](tasks/CC-010.md), [CC-011](tasks/CC-011.md); real recruiting classification still pending. |
| Reviewed Gmail sending/reply context | Controlled live round trip user-reported | [CC-012](tasks/CC-012.md), [CC-013](tasks/CC-013.md); exact approval and same-thread test succeeded. No autonomous replies or universal deliverability claim. |
| Product alignment | Documentation audit completed locally | [CC-014](tasks/CC-014.md); broad vision, inventory and delivery priorities, including core monitoring. No runtime feature added by planning. |

## Product milestones in delivery order

P identifiers are new product milestones; they do not renumber historical M milestones. P1/P1b have a minimum implemented local slice with synthetic/UI acceptance and cached-data use; their live acceptance and broader scope remain pending. Later milestones are planned, with reusable components classified in the feature inventory. Delivery order is not execution permission or an estimated completion date.

| Order / milestone | User outcome and acceptance | Dependencies / reuse | Authority / readiness |
|---|---|---|---|
| P1 Reliable discovery and ranked shortlist | User reviews one current, deduplicated, explainable shortlist with eligibility unknowns, source failures/freshness, verified preferences and stable job links. Reviewed fixture corpus catches consequential filter/rank errors. | Existing providers/admission/liveness, heuristic and AI reports, M1 identity; [CC-015](tasks/CC-015.md). | Minimum local slice implemented; controlled live quality validation pending. No recurring scans or applications. |
| P1b Continuous monitoring and rapid preparation | A few high-priority employers produce durable new/changed posting events, one qualified alert and one local preparation task per relevant event, with honest publication/discovery times and restart recovery. Desired 5/15/30–60 minute targets adapt to source limits. | P1 minimum shared eligibility/identity contract, existing scheduler/providers, M3B owner contracts; [CC-016](tasks/CC-016.md). Can follow a small P1 slice without waiting for every source/AI feature. | Core early capability: local fixture/UI slice implemented; live acceptance and ongoing worker installation pending. Explicit activation for allowlisted sources/cadence/alerts. No employer browser/upload/submit side effects. |
| P2 Complete one approval-based application | Select job → verified answers/approved document → exact review → one supported dispatch → receipt or explicit verification/reconciliation → correct canonical tracking. Live acceptance must confirm a real approved submission, not just an upload. | Existing narrow Greenhouse transport/guards, P1 identity, source-backed facts; normal human verification/session retention where needed. P1b is useful but not a hard blocker. | Implementation planned; exact application and final action approval separately required. Autonomy remains off. |
| P3 Application confirmations and accepted updates | Match one real recruiting receipt to exact application/attempt, review disposition, reconcile uncertainty and update the intended owner through approved rules without duplicates. | P2 attempt evidence, Gmail analyzer/sync, M1/M3 contracts; reviewed live category fixtures and state bridge. | Automated collection/association goal; no automatic status promotion until separately authorized evidence policy is validated. |
| P4 Additional ATS application platforms | Add the next platform by measured opportunity coverage, with field/question/upload/review/receipt/error conformance equal to baseline. | P2 reusable transport contract and recovery; discovery provider availability does not satisfy this dependency. | Platform-by-platform acceptance and action consent; no blanket compatibility claim. |
| P5 Resume tailoring and application personalization | User approves a truthful job-specific version, cover letter/answers and exact document binding; can inspect version/source/history and reuse approved artifacts. | Existing CV Studio/generators/fact gates/master profile; P1 evidence, P2 document contracts. Basic approved resume selection needed earlier; full tailoring need not block P2. | Draft/approval workflow first; canonical facts and approved bytes preserved. |
| P6 Unified dashboard and approval/task inbox | Recommendations/monitor alerts → job → preparation/review → confirmations/interviews are navigable with source freshness, readiness, clear next actions, cancel/snooze and recovery. | Existing Next.js views/M1/M2; P1–P3 IDs/events. Small UI increments belong in each earlier milestone. | Local first; authenticated public/cloud commands remain separate. |
| P7 Recruiter communication and networking | Real recruiting message → fact/style-backed draft → exact approve/send → evidence/history; contact/LinkedIn recommendations and outreach drafts in the same workflow. | Gmail tested transport + real recruiting classification, private style sources, P3/P6 identities/approvals. | No automatic replies or LinkedIn sending/scraping; any new channel separately scoped. |
| P8a Interview preparation and career analytics | Real round/deadline → company/DSA/behavioral plan → mock/practice/debrief → rubric-based readiness; cohort-aware response/funnel/source metrics. | Existing prep modes, story provenance, assessment logs/analytics; P3 confirmed events, user time constraints. Can develop independently of P4–P7 after minimum identity links. | No assessment solving or invented readiness/hiring probabilities. |
| P8b Career development and learning | Skill gaps → compared paths/certifications/projects → capacity-aware plan → actual progress/artifact evidence. | Existing gap/training/project protocols, P8a tasks, canonical profile and actual user goals/time. | No paid enrollment, publishing or fabricated completed skills. |
| P9 Configurable autonomous applications | Explicit allowlist/policy/caps and approved fact/document versions execute proven eligible cases with receipts, uncertainty stops, audit and emergency stop. | Repeated successful P2/P3 live acceptance, applicable P4 conformance, robust P1b queue/recovery, P5 approval binding and P6 controls. | Not authorized. Policy flags or this roadmap cannot enable autonomy; separate scoped pilot required. |
| P10 Mobile PWA and hybrid AWS delivery | Accessible responsive journeys → private-safe install/offline/notifications → authenticated cloud dashboard/outbound worker → backup/recovery/cost acceptance. | Validated local workflows, ADR 0001 plus new auth/data-authority/transport decisions, budget/retention and operations plan. | No provisioning, paid dependency or public exposure now. PWA can precede cloud; cloud does not require autonomy. |

## Cloud stage order (proposed 2026-11-11)

[ADR 0003](decisions/0003-cloud-monitoring-first.md) proposes delivering P10 in stages, starting with unattended monitoring rather than a hosted dashboard:

- **C0:** local cloud-readiness work.
- **C1:** scheduled Lambda monitor on S3/DynamoDB.
- **C2:** SQS fan-out.
- **C3:** authenticated hosted dashboard.
- **C4:** outbound browser worker.
- **C5:** email, notifications and AI.

See the [plan](CLOUD_DEPLOYMENT_PLAN.md), [CC-017](tasks/CC-017.md) and the [employer coverage review](EMPLOYER_COVERAGE.md). Nothing is provisioned; every stage needs its own approval.

## Dependency rationale and scope discipline

The user's priority order is preserved, with continuous monitoring inserted immediately after the smallest reliable discovery slice. Bad matching multiplied by a fast poller creates noise and unsafe preparation; minimum identity/filter consistency must precede activation. A small approved-employer monitor should not wait for a general AI matching platform or every provider.

P2 includes only the receipt/verification/reconciliation work needed to complete one approved application. P3 then broadens evidence collection and tracking. Do not require a general delta-sync service, protected long-lived email credentials or live Outlook acceptance before completing this journey; an honest session/manual handoff may be sufficient for the first accepted application.

Keep basic approved document selection and review UX in P2; defer the complete document product to P5. Add minimal UI/alerts with P1/P1b rather than postponing all usability to P6. Interview/learning development can run alongside later ATS/document work when useful. Desktop/mobile/email alert channels follow a useful durable dashboard inbox; webhook infrastructure is conditional on measured need. Deliver safety-critical recovery alongside each side effect, not as an unrelated platform program.

P9 remains late and gated. P10 is late for implementation cost/security reasons, but does not depend on enabling autonomous applications. No dates, latency SLA, hiring outcomes or cost commitment are promised.

## Original proposed milestone crosswalk

The architecture audit's unimplemented M4 mail evidence maps to P3; proposed M5 verification continuation is the bounded dependency inside P2/P3; proposed M6 interview planning maps to P8a; proposed M7 career development/analytics maps to P8a/P8b; proposed M8 webhook ingress remains conditional within P10/communication delivery. Their original proposals remain preserved in the audit, not silently relabeled completed. The accepted sequencing is documented in [ADR 0002](decisions/0002-product-workflow-priorities.md).

## Smallest useful monitoring release

Choose 3–5 user-approved employers from Greenhouse/Lever/Ashby supported feeds, not a broad crawl. Use a reviewed private source allowlist/priority schedule, durable checkpoints/change IDs, minimal shared eligibility/ranking, one dashboard alert and a local preparation proposal. First snapshot establishes a baseline, not a flood of “just published” alerts. Injected-clock fixtures prove restart/dedup/backoff/unchanged handling before one bounded live acceptance; only then separately authorize recurring cadence. Workday/iCIMS/SmartRecruiters and permitted official-page adapters follow as source-specific coverage tasks, without blocking the first useful release.

Measure actual poll lag and publication-timestamp coverage; firstSeenAt is never relabeled publishedAt. A target five-minute interval is not a publication-to-alert guarantee. Preparation tasks must stop for unknown facts, missing approval or unsupported platforms. No background employer-site actions, notifications outside the dashboard or submissions are activated by a high match score.
