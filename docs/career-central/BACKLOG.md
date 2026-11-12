# Product backlog and task routing

Updated 2026-11-11. Planning index and local implementation status; no new external execution authority. [Inventory](FEATURE_INVENTORY.md) gives evidence/state; [roadmap](ROADMAP.md) gives dependencies and outcomes. Historical CC-001–CC-013 remain intact. CC-014 is this documentation audit, not a runtime milestone.

| Work item | State | Requirement / features | Ready when / next acceptance |
|---|---|---|---|
| [CC-015 Reliable shortlist](tasks/CC-015.md) / P1 | Minimum local slice implemented; live quality pending | R09; F01–F07 | Existing two discovery paths compared; reviewed fixture corpus/shared policy/identity/explanation contract; bounded ranked result. |
| [CC-016 Priority monitor](tasks/CC-016.md) / P1b | Local fixture/UI slice implemented; recurring/live pending | R18; F55–F59 | Minimal P1 matching, source-budget/owner contract, crash-safe baseline/change/alert/task fixture acceptance; separately approved source activation. |
| [CC-017 Cloud-ready monitor](tasks/CC-017.md) / C0–C1 | Planned; C1 needs deployment approvals | R04/R18/R24; F55/F59/F79 | Scoped store port, unchanged-snapshot path, eligibility projection, telemetry, handler; then dev deployment. |
| Expanded discovery sources / P1c | Planned | R20; F63–F68 | [Source register](design/JOB_SOURCES.md): USAJOBS API, Gmail-label alerts, more ATS boards; discovery only. |
| Career Identity interface / P5a | Planned | R19; F60–F62 | I1 read adapter and conflict report ([design](design/CAREER_IDENTITY.md)). |
| Calm frontend rollout / P11 | Planned; parallelizable | R23; F75–F77 | Career-Central-scoped tokens and components, then Home and Opportunities ([design](design/FRONTEND_DESIGN_SYSTEM.md)). |
| Approval-based application / P2 | Planned; reuse partial Greenhouse | R06/R10; F08–F15/F31 | Prepare/approve/dispatch/verify or reconcile one exact application with real receipt acceptance. Never resubmit unresolved prior attempts. |
| Confirmation bridge / P3 | Planned; collection partial | R05/R12/R13; F14/F25/F26 | One real matched category, exact attempt identity, review disposition and owned-state write/undo contract; no automatic status change by default. |
| Additional ATS transports / P4 | Planned | R10; F16 | Choose by actual opportunity coverage after baseline conformance; distinguish sourcing from submitting. |
| Resume version/tailoring workflow / P5 | Planned integration | R02/R11; F17–F23 | Reviewed sources, version/hash/history and exact application attribution. |
| Dashboard/Approval Center / P6 | Planned integration, existing views | R01/R13/R16/R21; F33–F37/F51/F69–F71 | Thin earlier UI slices, then connected recommendation/application/mail/interview views and recovery actions. |
| Recruiting replies/networking / P7 | Planned integration, controlled mail transport validated | R12/R22; F25–F30/F72–F74 | Real recruiting eligibility and source/style-backed draft; per-message approval/history; no LinkedIn connection assumed. |
| Interview/DSA/mock/readiness / P8a | Planned integration, agent protocols exist | R14; F35/F38–F42 | Structured rounds/tasks/attempts/rubric; practice versus real evidence; user capacity. |
| Career progress/certs/projects/path comparison / P8b | Planned integration | R15; F37/F43–F47 | Evidence-backed goals, comparison/effort/prerequisites and actual completion tracking. |
| Cohort/latency/source analytics / P1b/P3/P8a | Planned incremental integration | R13/R18; F34/F54/F59 | Defined denominators, event time/provenance, unknowns/censoring and attribution; no causal claims. |
| Notification channels/quiet hours | Planned after dashboard inbox | R07/R16/R18; F51/F58 | Dedup/outbox/disposition/consent; desktop first where useful, then PWA push, optional email. No unsolicited send. |
| Persistent email/worker operations | Conditional supporting work | R05/R16; F49/F52/F54 | Measured need, validated protected custody and bounded recovery; not a prerequisite for every session-driven workflow. |
| Autonomous applications / P9 | Planned; unauthorized | R06/R10; F13 | Proven transports/receipts, explicit policy/limits and separately authorized pilot. |
| Mobile PWA/cloud/backup / P10 | Planned; deployment unauthorized | R04/R16; F49/F50/F53 | Private caching/accessibility/notification design, auth/single-writer migration/outbound transport, budget and recovery validation. |
| Outlook live/native vault acceptance | Deferred optional provider work | R05; F32/F49 | User chooses provider/storage and supplies scoped consent; Gmail product work does not wait for this. |

Before opening each implementation task, specify exact existing modules/owners, user entry point, no-effect and effect boundaries, failure/recovery cases, evidence level and acceptance tests. Create new numbered task files when scoped; rows without links are intentionally unstarted work packages, not missing completed tickets. Do not implement a general infrastructure layer when a bounded existing module satisfies the next user journey.
