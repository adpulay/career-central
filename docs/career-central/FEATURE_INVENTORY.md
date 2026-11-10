# Product feature inventory

Source audit: 2026-11-10. This inventory classifies the intended product capability, not merely its helper code. Source and historical tests were inspected; no product tests, live scans, browser applications or mailbox requests were run for this documentation audit. Paths are evidence entry points, not assertions of universal provider compatibility. [Product requirements](PRODUCT.md) · [delivery roadmap](ROADMAP.md).

## Latest local slice — 2026-11-10

[CC-015](tasks/CC-015.md)/[CC-016](tasks/CC-016.md) now implement a minimum shared
shortlist, durable source cycle, dashboard alerts/decisions and local preparation
proposals using existing components. [Runbook](../JOB_MONITOR.md). Synthetic and
production-UI acceptance does not certify live feeds or recurring operation.
Existing private cache seeding is explicitly cached evidence. Earlier broad feature
rows remain partial where their full lifecycle is not delivered.

## Status and evidence rules

- **V — Implemented and validated:** bounded behavior demonstrated at the stated level. “Local/fixture” never means production; user-reported live evidence is labeled explicitly.
- **I — Implemented, not live-validated:** executable local behavior exists; the relevant target workflow/platform acceptance is not established here.
- **P — Partially implemented:** useful components or agent protocols exist, but integration/lifecycle/product acceptance is incomplete.
- **N — Planned:** no complete implementation found in inspected paths; a design/protocol is not a delivered service.

Execution authority is independent of maturity. “Approval required” means exact per-action/user consent, not permission granted by this table. Autonomy, code entry, public deployment and paid services remain unauthorized. Older task test counts are historical evidence, not new audit test results.

## Discovery and matching — CC-R09

| ID / capability | State | Evidence | Remaining product acceptance / execution boundary |
|---|---|---|---|
| F01 Automated discovery/scheduling | P | [scan](../../scan.mjs), [scan runner](../../web/scripts/scheduled-jobs-runner.mjs) | Scan scheduling exists; unified ranked workflow and current source reliability need acceptance. No scheduler activation here. |
| F02 Multi-platform sourcing | I | [provider registry](../../providers/_registry.mjs), [broad ATS scan](../../scan-ats-full.mjs) | Many source adapters; current live coverage not certified. Ranked extension supports only Greenhouse/Lever/Ashby. Discovery is not submission support. |
| F03 Duplicate/repost detection | P | [URL identity](../../url-key.mjs), [fingerprints](../../listing-fingerprint.mjs), [application identity](../../lib/applications/discovery.mjs) | Reuse exact identity; align divergent pipelines, retain ambiguous related openings and prevent false merges. |
| F04 Eligibility and availability filtering | P | [admission gate](../../lib/admission-gate.mjs), [liveness](../../liveness-core.mjs), [rank evaluator](../../lib/applications/discovery.mjs) | Shared filtering and newer heuristic path differ; unknown location/start/requirements need consistent review. No false eligibility guarantees. |
| F05 AI resume matching | P | [evaluation mode](../../modes/oferta.md), [report reader](../../web/src/lib/machine-summary.mjs), [ranked shortlist](../../scripts/discover-ranked.mjs) | Agent/AI reports exist; shortlist score is heuristic. Need one versioned evidence/explanation contract and reviewed quality sample. |
| F06 Company research | P | [deep mode](../../modes/deep.md), [company history](../../company-history.mjs) | Existing research protocol/local history; no unified sourced company research product acceptance. External research remains scoped. |
| F07 Rankings and explanations | P | [rank pipeline](../../rank-pipeline.mjs), [shortlist reranking](../../scripts/reevaluate-shortlist.mjs) | Surface exclusions, gaps, method, overrides and partial coverage in one usable shortlist. Fit is not hiring probability. |

## Applications — CC-R06/R10

| ID / capability | State | Evidence | Remaining product acceptance / execution boundary |
|---|---|---|---|
| F08 Form/platform detection | P | [prefill summary](../../prepare-application.mjs), [form extraction](../../web/src/lib/apply/extract.ts) | Detection/assisted extraction exists; detection does not imply complete conditional-form transport. |
| F09 Automated field completion | P | [Greenhouse planner/fill](../../lib/applications/greenhouse.mjs), [web fill](../../web/src/lib/apply/drive.ts) | Unknown/conditional/custom questions still block; validate final answers on one approved application. |
| F10 Resume/document uploads | P | [upload policy](../../lib/applications/upload-policy.mjs), [upload tests](../../tests/application-upload-policy.test.mjs) | Integrity controls tested and upload previously observed; complete application/document lifecycle remains partial. Upload needs scoped approval. |
| F11 Employer-specific questions | P | [verified answer mapping](../../lib/applications/greenhouse.mjs), [answer prompts](../../web/src/lib/apply/answer-prompt.mjs) | Required/compound/legal/consent answers need explicit user resolution; no invented defaults. |
| F12 Approval-based submission | P | [reviewed transport](../../lib/applications/reviewed-submission.mjs), [one-application runner](../../scripts/review-first-application.mjs) | Narrow Greenhouse path exists; previous live attempt required HTTP 428 verification, no confirmed end-to-end application. Exact new approval required. |
| F13 Configurable autonomous applications | N | [pilot policy](../../lib/applications/pilot.mjs), [submission guard](../../lib/applications/store.mjs) | Planning/guards exist, not validated autonomy. Unauthorized; flags cannot activate a generic submitter. |
| F14 Confirmation/reconciliation | P | [operational evidence](../../lib/career-central/OPERATIONAL_EVIDENCE.md), [reviewed outcomes](../../lib/applications/reviewed-submission.mjs) | Source-recorded receipt review exists; complete live receipt verification and mailbox-to-status bridge missing. Uncertain outcomes block replay. |
| F15 Application tracking | V (local scope) | [M1](tasks/CC-001.md), [M2](tasks/CC-002.md), [ledger](../../lib/applications/store.mjs) | Local projections/owners tested. Legacy tracker and ledger are distinct; not one automatic bidirectional lifecycle. |
| F16 Additional ATS submissions | N (beyond narrow Greenhouse path) | [web assisted flow](../../web/src/lib/apply/session.ts), [provider registry](../../providers/_registry.mjs) | Other platform discovery/assistance does not supply a validated native submit adapter. Add individually after baseline conformance. |

## Resume/profile — CC-R02/R11

| ID / capability | State | Evidence | Remaining product acceptance / execution boundary |
|---|---|---|---|
| F17 Canonical skills/experience inventory | P | [career profile](../../career-profile.mjs), [profile contract](../../lib/career-profile.mjs) | Source-backed inventory exists; precedence across CV/YAML/application JSON is not universally integrated. |
| F18 Multiple resume versions | P | [version selection](../../lib/profile-cv-selection.mjs), [CV Studio](../../web/src/lib/cv-studio/studio.mjs) | Selection/generated files exist; full named-version/history/application attribution UI incomplete. |
| F19 ATS optimization | I | [keyword checks](../../keyword-match.mjs), [ATS transform](../../ats-payload.mjs) | Local transforms/lints exist; no guarantee of employer ATS behavior or ranking. |
| F20 Job-specific tailoring | P | [PDF mode](../../modes/pdf.md), [CV rewrite](../../web/src/lib/cv-studio/rewrite.mjs) | Reusable workflow/UI; needs integrated source-backed review and approved-version binding for each application. |
| F21 Cover letters/personalization | P | [cover mode](../../modes/cover.md), [cover generator](../../generate-cover-letter.mjs) | Draft/render available; not automatic approval or full application integration. |
| F22 Truthful claim validation | I | [CV fact checks](../../verify-cv-facts.mjs), [story provenance](../../story-provenance-check.mjs) | Controls/protocols exist; semantic truth is not guaranteed. Require primary-source traceability and unresolved-claim review. |
| F23 Version history/approval controls | P | [outcome snapshots](../../outcome.mjs), [approved upload policy](../../lib/applications/upload-policy.mjs) | Hash/approval/snapshot pieces exist; unified document lifecycle/history and invalidation UX remains partial. |

## Communications/networking — CC-R05/R12

| ID / capability | State | Evidence | Remaining product acceptance / execution boundary |
|---|---|---|---|
| F24 Gmail connection/bounded reads | V (user-operated live list/context) | [CC-011](tasks/CC-011.md), [CC-013](tasks/CC-013.md), [adapter](../../lib/email/gmail-client.mjs) | Real bounded list and selected test reply succeeded. No unrestricted/durable background sync certified. |
| F25 Recruiting classification | P | [mail analyzer](../../lib/email/application-mail.mjs), [Gmail tests](../../tests/gmail-email.test.mjs) | Fictional category/forwarding/security tests pass historically; real recruiting sender/job/recipient classification still pending. |
| F26 Confirmations/invitations/deadlines | P | [analyzer](../../lib/email/application-mail.mjs), [invite matching](../../invite-match.mjs), [assessment log](../../assessment-log.mjs) | Categories/utilities exist; accepted canonical transitions, invitation extraction and dashboard task links need integration. |
| F27 Personal-style reply drafting | P | [reply context](../../lib/email/gmail-reply.mjs), [style notes](../../lib/email/gmail-send.mjs) | Private guide/samples and assistant workflow exist; test acknowledgment is fixed prose, not an autonomous AI generator. Real draft acceptance pending. |
| F28 Approved Gmail sending/thread replies | V (user-reported controlled round trip) | [send workflow](../../scripts/gmail-send.mjs), [reply workflow](../../scripts/gmail-reply.mjs), [runbook](../GMAIL_SENDING.md) | User confirmed receive/read/approve/send in same conversation. Not independent agent verification, recruiter deliverability or auto-response approval. |
| F29 LinkedIn networking recommendations | P | [connection join](../../linkedin-join.mjs), [contact lookup](../../contact-lookup.mjs) | Offline export/contact matching exists; integrated recommendations absent. No LinkedIn account access assumed. |
| F30 Personalized outreach drafts | P | [contacto](../../modes/contacto.md), [email mode](../../modes/email.md) | Agent draft protocols; no unified outreach/approval/history product. No automatic LinkedIn/email messaging. |
| F31 Verification code continuation | N (live workflow) | [mail analysis](../../lib/email/application-mail.mjs), [application guard](../../lib/applications/reviewed-submission.mjs) | Code-related detection/session metadata only; secure native continuation/provenance unvalidated and code entry unauthorized. |
| F32 Preserved Outlook integration | I | [CC-008](tasks/CC-008.md), [Outlook runbook](../OUTLOOK.md) | Controlled command and fixtures exist; live Microsoft connection and native vault acceptance remain unrun. Not a dependency for Gmail product delivery. |

## Dashboard/analytics — CC-R01/R13

| ID / capability | State | Evidence | Remaining product acceptance / execution boundary |
|---|---|---|---|
| F33 Unified application/recommendation views | P | [canonical overview](../../web/src/app/career-central/page.tsx), [pipeline](../../web/src/app/pipeline/page.tsx) | M2 read slice locally validated; recommendations, new Gmail health/context and action approvals not uniformly integrated. |
| F34 Application and response analytics | P | [analytics](../../web/src/app/analytics/page.tsx), [metrics](../../web/src/lib/analytics-metrics.mjs), [funnel](../../funnel-velocity.mjs) | Existing analytics; unified ledger/mail cohorts, denominators and true event dates need acceptance. |
| F35 Interview rounds/tracking | P | [invite matching](../../invite-match.mjs), [ICS utility](../../ics-interview.mjs), [interview modes](../../modes/interview/README.md) | Artifacts/utilities exist; no complete structured round/calendar dashboard. |
| F36 Upcoming tasks/deadlines | P | [M2 overview](tasks/CC-002.md), [assessment log](../../assessment-log.mjs), [closing dates](../../closing-soon.mjs) | Take-home/deadline subset exists; unified tasks, reminders, snooze and capacity planning missing. |
| F37 Career-development progress | N (unified product) | [upskill](../../upskill.mjs), [training protocol](../../modes/training.md) | Gap reports/plans exist; durable goals/evidence/completion view absent. |

## Interview and long-term development — CC-R14/R15

| ID / capability | State | Evidence | Remaining product acceptance / execution boundary |
|---|---|---|---|
| F38 Company-specific technical preparation | P | [interview prep](../../modes/interview-prep.md) | Substantial agent research protocol; structured product/model and current company-specific acceptance absent. |
| F39 LeetCode/DSA plans and tracking | P | [prep protocol](../../modes/interview-prep.md), [practice](../../modes/interview/practice.md) | Problem-research/practice protocols exist; structured attempts, review intervals and progress board missing. No judge/account connector assumed. |
| F40 Behavioral preparation | P | [story helpers](../../lib/story-bank.mjs), [provenance](../../story-provenance-check.mjs) | Story/session/provenance foundation; integrated evidence review and learning loop incomplete. |
| F41 Mock interviews | P | [practice](../../modes/interview/practice.md), [debrief](../../modes/interview/debrief.md) | Agent workflows, not a continuously scheduled mock service or standardized assessment engine. |
| F42 Readiness assessments | N (standardized product) | [interview plan](../../modes/interview/plan.md) | Planning/feedback exists; transparent rubric and demonstrated readiness tracking needed, no unsupported percentage. |
| F43 Skill-gap analysis | I | [JD gap](../../jd-skill-gap.mjs), [upskill](../../upskill.mjs) | Local personal-corpus tools, not representative market demand; integrated goals pending. |
| F44 Certification planning | P | [training evaluation](../../modes/training.md) | Course/cert evaluation protocol; prerequisites, renewal/cost/time and completion ledger missing. No purchases. |
| F45 Project recommendations | P | [project mode](../../modes/project.md) | Evaluation/planning protocol; personalized project-progress/artifact product incomplete. No publishing authority. |
| F46 Career-path comparisons | N (unified product) | [profile foundation](../../career-profile.mjs), [training mode](../../modes/training.md) | Reusable inputs; no evidence-backed comparison workflow found. |
| F47 Personalized learning recommendations | P | [upskill mode](../../modes/upskill.md), [training mode](../../modes/training.md) | Draft recommendations exist; adaptive capacity-aware completion loop missing. |

## Infrastructure/experience — CC-R03/R04/R07/R08/R16

| ID / capability | State | Evidence | Remaining product acceptance / execution boundary |
|---|---|---|---|
| F48 Next.js dashboard | V (bounded local M2 slice) | [CC-002 acceptance](tasks/CC-002.md), [web](../../web/README.md) | Existing app and local UI/build evidence; not full product completion or cloud certification. |
| F49 Secure private data | P | [storage contract](../../lib/email/PROTECTED_STORAGE.md), [private paths](../../lib/email/private-storage.mjs) | Session OAuth/owner checks/locks tested; persistent vault, backup/restore/retention and public hosting security need acceptance. |
| F50 Mobile-friendly PWA | N (PWA); partial responsive UI | [M2 viewport evidence](tasks/CC-002.md), [layout](../../web/src/app/layout.tsx) | Responsive pages do not establish installability, private offline caching or push support. |
| F51 Notifications and approval inbox | P | [agent inbox](../../agent-inbox.mjs), [follow-up sweep](../../scripts/followup-sweep.sh), [application review](../../scripts/review-first-application.mjs) | Local proposals/reviews/limited notifications exist; unified approve/reject/expire/quiet-hours UX missing. |
| F52 Durable background execution | P | [scan queue](../../web/src/lib/scheduled-jobs-store.mjs), [owner contracts](../../lib/career-central/PERSISTENCE.md) | Durable scan queue/health and bounded mail coordinator exist; no general autonomous application/mail/study worker. |
| F53 Hybrid AWS deployment | N | [ADR 0001](decisions/0001-development-and-deployment.md), [audit](../architecture/career-central-audit.md) | Design only; auth/data authority/transport/budget/operations gates. Provisioning unauthorized. |
| F54 Observability/recovery/audit history | P | [operational store](../../lib/career-central/operational-store.mjs), [sync recovery](../../lib/email/sync-recovery.mjs), [send reservations](../../lib/email/gmail-send.mjs) | Local CAS/replay/recovery and sanitized diagnostics validated; unified user action history/run recovery and cloud observability incomplete. |

## Continuous monitoring/rapid preparation — CC-R18

| ID / capability | State | Evidence | Remaining product acceptance / execution boundary |
|---|---|---|---|
| F55 Continuous per-employer monitoring | P | [scan worker](../../web/scripts/scheduled-jobs-runner.mjs), [providers](../../providers/_registry.mjs) | Local priority/adaptive source cycle now fixture/UI validated; ongoing scheduler integration and live source acceptance pending. Desired 5/15/30–60 minute cadence requires source budgets and worker availability; no recurring activation. |
| F56 Publication/change lifecycle | P | [scan history](../../scan.mjs), [repost detection](../../detect-reposts.mjs), [listing identity](../../listing-fingerprint.mjs) | Durable posting versions, separate timestamps/provenance, duplicates, updates, related/reappearance and completeness-based expiry are locally implemented; live semantics remain pending. |
| F57 Rapid evaluation/preparation queue | P (local proposals validated) | [ranking](../../lib/applications/discovery.mjs), [application planning](../../lib/applications/greenhouse.mjs) | Durable local matching/shortlist/alert/proposal path implemented. Employer form execution and full approval-task lifecycle remain separate. No browser/upload/submit authority from a match. |
| F58 High-priority alert lifecycle | P (local dashboard validated) | [agent inbox](../../agent-inbox.mjs), [overview](../../web/src/app/career-central/page.tsx) | Deduplicated local alerts, readiness and dismiss/pause dispositions implemented. Quiet hours/snooze and rich delivery lifecycle remain partial. Desktop/push/email are later gated channels. |
| F59 Monitoring reliability/latency analytics | P (local recovery validated) | [scan logs](../../scan.mjs), [scheduler store](../../web/src/lib/scheduled-jobs-store.mjs) | Local checkpoints, leases/event/task dedup, crash recovery, health/backoff/poll lag implemented. Rich publication latency/cohorts/confirmed-outcome analytics remain pending. |

## Documentation gaps resolved by this alignment

The original audit already proposed much of the broad vision, but PRODUCT/ROADMAP omitted actionable resume/versioning, outreach, DSA practice, readiness, certification/projects/path comparison, notification and PWA milestones. They over-emphasized foundational infrastructure and Outlook sequencing. The new roadmap exposes these product gaps, preserves milestone history, records Gmail round-trip acceptance and makes discovery quality the next bounded deliverable. No inspection establishes that every listed helper is integrated, live reliable or authorized for external execution.

Continuous monitoring and rapid preparation are explicitly core requirements, not a synonym for running the existing scanner periodically. [CC-016](tasks/CC-016.md) defines the smallest useful implementation and authorization boundary.
