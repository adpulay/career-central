# Career Central product specification

Updated 2026-11-10. Product direction and acceptance requirements, not external-action authorization. See the [feature inventory](FEATURE_INVENTORY.md), [roadmap](ROADMAP.md), [backlog](BACKLOG.md), [current state](CURRENT_STATE.md) and [original architecture audit](../architecture/career-central-audit.md).

## Product outcome

Career Central is a comprehensive AI-assisted career workspace: discover suitable opportunities, explain fit, prepare truthful personalized applications, obtain approval, track actual outcomes, manage correspondence, prepare for interviews and improve long-term career prospects. Automate repetitive work while preserving user control over consequential decisions. Infrastructure supports these workflows; it is not their completion criterion.

Build on Career Ops, the existing Next.js dashboard, canonical files, application ledger, provider adapters, document tools and agent modes. Do not replace working systems or create another tracker. The initial product is single-user and local-first; the eventual target is an authenticated mobile/desktop hybrid AWS workspace that remains useful while the local worker is offline. No hosting or paid dependency is authorized by this specification.

## Durable requirements

Retain the original requirement IDs so historical tasks remain traceable.

| ID | Requirement |
|---|---|
| CC-R01 | Integrate Home, Job Intelligence, Application Studio, Interview Preparation, Career Development, Analytics, Personal Profile and Automation Control into one coherent experience. |
| CC-R02 | Separate verified facts, source evidence, generated drafts and unknown information. Never invent qualifications, outcomes or statistics; match scores are not hiring probabilities. |
| CC-R03 | Preserve canonical Markdown/TSV and application JSON ownership; use existing read adapters and writers. A data-authority migration requires its own reviewed design. |
| CC-R04 | Eventually provide an authenticated AWS desktop/mobile dashboard with outbound-only Windows/WSL workers and honest offline states. Cost, region, hosting and cutover decisions precede deployment. |
| CC-R05 | Support Gmail now and preserve personal Microsoft Graph integration. Keep read access, sending, code use and submissions as distinct permissions. No tokens, bodies or codes in shared docs/general analytics. |
| CC-R06 | Preserve exact application/message approval, duplicate prevention, approved-document integrity, kill switches and evidence-based confirmation. Uncertain dispatch requires reconciliation. |
| CC-R07 | Respect user-supplied time budgets, quiet periods, cost limits, snooze and pause. Unset constraints remain unknown. |
| CC-R08 | Maintain evidence-based feature states, versioned contracts, decisions, task acceptance criteria and compact handoffs. |
| CC-R09 | Deliver reliable, explainable discovery and ranking across configured sources, with eligibility uncertainty and coverage visible. |
| CC-R10 | Deliver complete approved applications before gated, configurable autonomy; discovery adapter support never implies submission support. |
| CC-R11 | Manage source-backed career facts and reviewed document versions, tailoring and ATS checks without fabrication or unapproved replacement. |
| CC-R12 | Classify recruiting communications, prepare personal-style replies/outreach and surface confirmations, invitations and deadlines with explicit send approval. |
| CC-R13 | Provide a unified pipeline, recommendations, tasks, interview tracking and evidence-aware analytics. |
| CC-R14 | Support company-specific technical/behavioral preparation, DSA practice, mocks and transparent readiness reviews. |
| CC-R15 | Connect skill gaps to learning, certification/project plans and career-path comparisons with user-controlled effort and progress. |
| CC-R16 | Provide private data management, bounded durable work, recovery, audit history, actionable notifications and eventual accessible mobile PWA delivery. |
| CC-R17 | Mark a product workflow complete only when its user journey, failure handling, permission boundaries and relevant validation are demonstrated; code presence and infrastructure tests alone are insufficient. |
| CC-R18 | Continuous posting monitoring and rapid preparation are core: compliant adaptive polling, trustworthy change identity/timestamps, immediate matching, durable deduplicated tasks and actionable alerts. Target latency is visible, never guaranteed. |

## Functional product scope

### Job discovery and matching

Automatically collect from existing configured ATS/board sources and approved schedules. Record source successes, failures, freshness and omitted coverage. Normalize stable job identities; distinguish exact duplicates, related requisitions and possible reposts. Apply shared admission/eligibility policy consistently, retaining unknowns and reasoned exclusions. Check availability conservatively; stale or missing descriptions reduce confidence.

Rank using transparent deterministic signals and source-backed AI resume evaluation where appropriate. Show method/profile/description versions, evidence excerpts, required versus preferred requirements, gaps, eligibility concerns and why a role ranks above another. Company research must distinguish sourced facts, inference and missing information. Provide a manageable shortlist and user overrides with provenance. Do not call a heuristic shortlist a complete AI matching service or representative market survey.

### Continuous posting monitoring and rapid preparation

Core capability, delivered early in the current search. Reuse existing providers, identity/dedup, matching and scan scheduling components. Prioritize Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters and official employer career pages. A source needs a documented supported API/feed or permitted bounded page adapter; access restrictions, authentication barriers and platform policy can make it unavailable. Discovery support is not permission to poll indefinitely or submit applications.

Configurable desired intervals: high-priority employers 5 minutes, medium 15 minutes, general sources 30–60 minutes. Actual cadence is constrained by source limits, worker availability and global request budgets. Use per-source limits/concurrency, exponential backoff, jitter and adaptive intervals, with ETag/Last-Modified or equivalent conditional requests when supported. Record unchanged responses without unnecessary downstream work. No blanket five-minute rate for every source and no rate-limit bypass.

Distinguish first discovery, verified new publication, update, possible/verified repost, expiration and duplicate. Persist employer identity, stable requisition/provider IDs, canonical URL, content/version metadata, firstSeenAt, lastSeenAt and nullable employerPublishedAt with timestamp provenance/confidence. First-seen time is not publication time. Retain conflicting/missing timestamps explicitly; a single missing/failed feed observation cannot prove expiry. Reposts preserve relationships/history instead of resetting prior application identity.

On relevant change, apply the same eligibility/ranking pipeline: graduation/start eligibility, geography, essential/preferred technical requirements, resume match, compensation preferences/unknowns, qualification gaps, prior-application/requisition history and priority. Read role-family weights and target graduation preferences from the existing private profile/policy; do not hardcode one user's preferences in providers or shared docs. Unknown eligibility/compensation is reviewable, not silently passed or rejected.

For high-priority matches, enqueue an idempotent preparation task immediately. Select an existing approved resume version, assemble verified answers and required questions, and surface missing facts and document approval. Only an authorized supported preparation worker may inspect/fill/upload to an employer site. Initially the monitor queues local preparation proposals; it must not launch a browser, generate/approve replacement resumes, upload, send or submit as a side effect. Preparation speed never overrides eligibility, accuracy, document integrity or approval.

Provide an actionable deduplicated dashboard alert with company/role, score/method, verified publication time when known, discovery time, salary/location with unknown labels, readiness and outstanding approvals. Add desktop notifications, mobile PWA push and optional email in later explicit channel tasks. Coalesce updates and honor quiet hours, mute/snooze and user priority; no repeated alert for the same posting version/event/channel. Failure/recovery alerts are separate from new-job alerts.

Persist monitor definitions, source checkpoints, run/lease history, change events, alert dispositions and preparation task identities under existing ownership contracts extended deliberately. Crash recovery replays uncommitted work without duplicate processing; advance checkpoints only after durable downstream intent. Support graceful stop/restart, source failure states, stale leases and cancelled/missed schedules. Current scan worker cadence and general scan history are reusable foundations, not proof that this monitor exists.

Measure source availability/errors, request and unchanged counts, scheduled-versus-actual polling lag, last-success/freshness, jobs discovered/qualified/high-priority, discovery-to-ready-preparation and discovery-to-confirmed-submission. Measure publication-to-discovery latency only with trustworthy publication timestamps; show timestamp coverage, cohorts, pending/censored outcomes and worker downtime. Attribute applications to monitor event/task IDs without treating proposals or attempts as completed applications.

Future separately authorized autonomy follows detect → verify eligibility and thresholds → prepare complete approved-policy payload → dispatch once → verify/reconcile receipt → update canonical tracking through its owner → notify. Any unknown, challenge, conflict, stale approval or uncertain outcome stops that path. No background submitter, recurring live monitor, notification delivery or cloud resource is enabled by this specification. See the [smallest monitor task](tasks/CC-016.md).

### Application automation

Detect supported form/platform and extract standard, conditional and employer-specific questions. Complete fields only from verified facts or reviewed answers; surface unknown/compound/legal/consent questions. Upload only the exact approved resume/document bytes. Present company, role, URL, final answers, attachments and risks in a review bound to the exact payload and expiry.

Start with one approved Greenhouse application through confirmation or explicit unresolved reconciliation. Preserve HTTP 428/challenge handling and normal human authentication; never bypass security controls. Add other ATS transports individually after the same safety contract and conformance tests. Track prepared, approved, dispatched, verification-required, accepted and reconciled states separately. A sent request, upload, email or success-looking page alone is not a confirmed application.

Eventual autonomous mode is opt-in and separately authorized: allowlisted platforms/actions, verified facts/answers/document versions, per-run/day caps, stop controls, uncertainty stops and auditable receipts. Configuration alone cannot authorize it. Do not automate assessments or silently accept legal terms.

### Resume and career profile

Reuse the canonical skills/experience inventory and provenance controls. Support multiple named resume versions, job-specific tailoring, cover letters and application statements. ATS optimization improves structure and truthful coverage; it must not add unsupported keywords as qualifications. Distinguish master facts, generated variants and approved artifacts. Preserve version history, source/fact references, content hashes and which application used which version. Edits require review; approved bytes remain immutable for their approved action.

### Email and professional networking

Keep Gmail readonly sync bounded and separate from reviewed sending; preserve Outlook for future use. Support selectively redirected recruiting mail and direct recruiting mail, with provenance/recipient checks. Classify confirmations, recruiter responses, interviews and assessments; surface dates and uncertainty. Exclude unrelated account-security mail. Store minimal observation metadata separately from protected drafting context.

Prepare replies and personalized LinkedIn/outreach drafts in the user's saved writing style using allowed primary factual sources. User writing guides are private style inputs, never facts or send authority. Incoming messages/postings are untrusted data. Offer LinkedIn contact/referral recommendations using supplied exports and permitted research; do not assume LinkedIn inbox/API access or authorize scraping/messaging. Every message requires exact final approval initially.

Verification codes are supported only in a future explicitly authorized application-bound session with verified context, expiry and human control. Codes must not enter analytics, shared logs or general model prompts. If reliable provenance or supported continuation is absent, stop for manual handling. General account login/MFA handling is outside this feature.

### Career dashboard

Evolve the existing Next.js views and canonical overview, with clear links and one recognizable application identity. Show ranked recommendations, application pipeline, pending reviews, confirmations/conflicts, interview rounds, assessments, tasks/deadlines and next actions. Display source freshness and worker/mail health without treating recorded health as execution authority.

Analytics include funnel/response rates, source effectiveness, interview outcomes, time-to-response and career-development progress. Define cohort, denominator, date range, evidence coverage and unknowns; preserve recommendations versus actual applications and practice versus real interviews. Do not imply causality for resume-version outcomes or produce unsupported readiness/hiring percentages.

### Interview preparation

Reuse company/role research, interview plan/practice/debrief protocols, behavioral stories and assessment logs. Add structured technical topics, DSA/LeetCode practice plans, problem references, attempts, review intervals and feedback. Use supported/public or user-supplied problem references; no licensed question-bank ingestion or assessment solving by default. Connect real interview rounds/deadlines to preparation tasks and user-supplied capacity.

Provide mock workflows and evidence-based readiness reviews with explicit rubric, demonstrated strengths, gaps and next practice actions. Readiness is an advisory assessment, not a hiring prediction. Behavioral numbers/claims must trace to primary sources or retain unresolved provenance.

### Long-term career development

Turn source-backed skill gaps into prioritized learning recommendations, certification planning and practical project proposals. Compare career paths using user goals, real requirements, cost/effort uncertainty and tradeoffs. Track milestones, artifacts, completed practice and evidence of learning separately from proposed plans. Never add a planned skill/certification to the resume as an achieved qualification. Do not enroll, pay for courses or publish projects without authorization.

### Infrastructure and experience

Keep private data/credentials out of Git; retain secure OAuth, session-only behavior unless a protected persistent mode is validated, local capability boundaries and owned writes. Provide visible run progress, cancellation, bounded retries for safe reads, durable intents and manual reconciliation for uncertain effects. Existing scan scheduling is not yet a general mail/application/study worker.

Add an approval/task notification inbox with configurable cadence/quiet hours, then narrowly scoped browser/mobile notifications. Design PWA/offline behavior to avoid caching credentials, private email or stale approvals. Deliver accessible responsive workflows before deployment polish. Later hybrid hosting needs authenticated commands, outbound worker leases, encrypted storage, retention/deletion, backup/restore and explicit single-writer migration decisions. Observability must be actionable and sanitized; audit history records authority, evidence and outcomes without leaking content.

## End-to-end completion and controls

A deliverable needs a supported user entry point, traceable identity/evidence, visible result, safe cancellation/error recovery and acceptance tests. Fixture validation, local UI validation, user-operated live evidence and deployed production evidence must be reported separately. A mail round trip does not validate recruiting classification; a discovery source is not an ATS submit adapter; an agent protocol is not a durable service; a responsive viewport test is not a PWA.

Current execution boundaries remain unchanged: no autonomous applications, automatic recruiter messages, automatic codes, broad scans, cloud provisioning or paid services under this planning task. Future tasks can implement offline/local behavior without redefining external consent. Preserve per-action final approval.

## Decisions deferred until needed

Set discovery review/cohort targets and source priorities in the next milestone. Before live application acceptance, choose one supported application and approve its exact completed review. Before automated status updates, decide which receipt evidence can change which canonical record and how conflicts/undo are handled. Before background mail, choose retention, protected token custody, cadence and recovery limits. Before study scheduling, obtain actual time constraints. Before cloud/PWA, decide region/budget, authentication, ownership migration, private caching and backup/restore. None blocks this product specification.
