# Career Central — Phase 0 repository audit and architecture design

Audit date: 2026-11-06. Updated with the user’s hybrid AWS hosting preference and long-term AI context-continuity requirements. Scope: the existing `career-ops` checkout inside `JobScraper`, including its uncommitted application/email extensions. This is a source audit and design proposal, not an implementation or release certification.

Only this document was created during Phase 0. No application feature, dependency, configuration, credential, résumé, profile, record, approval gate or kill-switch setting was changed. No browser, scheduler, application submission, Microsoft authentication or mailbox retrieval was launched. Public Microsoft/standards documentation was researched without accessing a personal account.

## 1. Executive summary

Career Central should reuse the existing local-first engine within a hybrid AWS platform rather than replace working components. The confirmed long-term target is an AWS-hosted desktop/mobile dashboard and data plane, with local Windows/WSL automation workers; the dashboard must remain usable when that computer is off. Sections 15–16 extend and qualify the initial local-first assessment below. This repository is substantially more than a scraper: it contains broad public-source discovery, canonical tracker writers, a derived SQLite index, document generation, interview protocols, assessment/outcome logging, a Next.js dashboard, scheduled scan workers, analytics, browser-assisted application preparation, and a new read-only Microsoft Graph adapter.

The largest gap is **integration and trustworthy identity**, not a missing frontend. The established system treats Markdown/TSV as canonical, while recent application automation maintains a separate JSON ledger and structured profile. The web dashboard primarily reads the established tracker and reports; the JSON discovery shortlist, verification failures, application approvals and Outlook observations are not uniformly represented there. Adding another independent database or a new React application now would increase drift.

Recommended direction:

1. Define a versioned, read-only canonical projection over existing sources, with stable job/application identities, source references, explicit uncertainty and state-vocabulary mappings.
2. Extend the existing Next.js/React components around that projection, then separate cloud-safe queries/commands from filesystem/CLI operations. Use a staged AWS data authority transition, not simultaneous unrestricted local/cloud writers (§15).
3. Treat Microsoft Graph communications as a core subsystem: read-only retrieval → matching/evidence → human review → approved state transition. Keep authentication secrets and verification-code material outside analytics and model prompts.
4. Build durable email synchronization and safe verification-session recovery before considering another submission pilot. The existing single approved real application attempt received HTTP 428, not a confirmed receipt. A successfully attached résumé is not an end-to-end submission validation.
5. Add structured preparation/task/time models gradually. Prioritize fewer useful decisions, bounded daily work, quiet hours and interruption control over maximizing activity.

No new implementation is authorized by this report. Autonomous submission remains disabled; the observed policy has submission disabled and the kill switch engaged.

### Evidence and maturity labels

- **Implemented:** concrete executable behavior exists in inspected source. This is not a claim it works on every live employer site.
- **Partial:** code exists but lacks integration, complete lifecycle support or relevant live validation.
- **Protocol:** an agent instruction/template describes a workflow; it is not a deterministic backend service.
- **Proposed/missing:** no complete implementation found in the inspected paths.

The existing logs from the preceding development phase report 66 focused Outlook/application checks and six reply-watch tests passing. Those logs were read, not rerun. The earlier full-suite result is historical evidence, not a Phase 0 test result. No tests, builds or doctor/update commands were run in this audit because they can write caches, alter files or launch browsers. Current declarations count 1,061 core `*.test.mjs` files and 266 web test files; counts are file inventory, not passing-test counts.

## 2. Existing repository structure and dependencies

Paths below are relative to the `career-ops` root.

| Area | Actual contents and role |
|---|---|
| Root `*.mjs` | CLI engine: discovery, tracker, reports, PDF generation, interview/assessment/outcome utilities, analytics and maintenance. See [ARCHITECTURE.md](../../ARCHITECTURE.md). |
| `providers/` | Public-source adapters and HTTP/security helpers; 131 non-underscore `.mjs` adapter files plus shared helpers. Adapter presence does not establish current live coverage. |
| `lib/` | Shared parsing, profile, locking, privacy, bounded processes, output schemas and worker support. |
| `lib/applications/`, `scripts/*application*.mjs` | Recent discovery/ranking, JSON application ledger, Greenhouse preparation, upload policy and reviewed-submission extensions. |
| `lib/email/`, `scripts/outlook-email.mjs` | Recent personal Microsoft OAuth and Graph read-only integration. |
| `web/` | Existing local Next.js app, TypeScript/React components, API routes, scheduled scan worker and a separate test suite. |
| `dashboard/` | Go Bubble Tea terminal dashboard; another view over career files, not a replacement web backend. |
| `modes/` | Agent workflows, including interview plan/practice/debrief, evaluation, email drafts, upskilling and profile rules. Procedures are not all executable services. |
| `config/`, `cv.md`, `modes/_profile.md`, `modes/_custom.md` | Candidate configuration, primary facts and standing rules; protect the user/system boundary. |
| `data/`, `reports/`, `jds/`, `output/`, `documents/`, `interview-prep/`, `writing-samples/` | Private runtime state, source documents and generated artifacts. See [DATA_CONTRACT.md](../../DATA_CONTRACT.md). |
| `templates/`, `examples/` | Document templates, canonical tracker states and example profiles. |
| `plugins/`, `plugins-registry/`, `seeds/` | Extensible providers/ingest/export and company-source discovery. Registry metadata alone is not installed functionality. |
| `tests/`, `web/tests/`, `evals/`, `.github/workflows/` | Core tests, separate web tests/browser tests, evaluation material and CI/security workflows. |

**Declared stack, not a claim about latest upstream releases:** [root package.json](../../package.json) declares version 1.39.0, Node `^22.13.0 || >=23.4.0`, Playwright 1.64.1, `@azure/msal-node ^3.8.10`, js-yaml, undici, dotenv and the Google generative-AI SDK. [web/package.json](../../web/package.json) declares web 0.17.0, Next 16.4.1, React 19.2.5, TypeScript 7.0.2, Tailwind 4.2.2, Playwright Core, PDF.js, Markdown rendering and UI helpers. [dashboard/go.mod](../../dashboard/go.mod) declares Go 1.26.0, Bubble Tea and Lip Gloss. Installed compiler/runtime compatibility was not exercised here. Root and web have separate dependency/version surfaces.

Existing application/email additions and architecture documents are uncommitted in this checkout. A feature can exist locally without being part of a published upstream release. Preserve those changes; do not overwrite them during future upstream updates.

## 3. Verified capability inventory

### 3.1 Job intelligence and discovery

| Component and actual source | Current functionality | Maturity, dependencies and integration points |
|---|---|---|
| [scan.mjs](../../scan.mjs), [provider registry](../../providers/_registry.mjs) | Loads configured employers/providers; title/location/experience/date filters; seen/blacklist handling; histories and pipeline output; optional liveness verification. | Implemented CLI. HTTP/JSON, YAML configuration and locks. The optional verification path can launch Playwright; do not invoke it in a read-only audit. |
| [scan-ats-full.mjs](../../scan-ats-full.mjs), [seeds/README.md](../../seeds/README.md) | Wider reverse-ATS discovery beyond an individually configured short employer list. | Implemented; source coverage and partial results must remain visible. Reuse for broad-market sampling rather than hardcoding the personal shortlist. |
| [Greenhouse](../../providers/greenhouse.mjs), [Lever](../../providers/lever.mjs), [Ashby](../../providers/ashby.mjs), [Workday](../../providers/workday.mjs), [SmartRecruiters](../../providers/smartrecruiters.mjs), [iCIMS](../../providers/icims.mjs) | Discovery adapters for relevant ATS families, among many others. | Discovery support is not application-submission support. Network access/individual employer behavior require separate validation. |
| [admission gate](../../lib/admission-gate.mjs), [title-keywords.mjs](../../title-keywords.mjs), [jd-years.mjs](../../jd-years.mjs) | Shared deterministic filters and rejection reasons. | Reusable policy boundary; new ingestion paths should reuse it rather than copy only selected checks. |
| [url-key.mjs](../../url-key.mjs), [fingerprint-core.mjs](../../fingerprint-core.mjs), [listing-fingerprint.mjs](../../listing-fingerprint.mjs), [dedup-tracker.mjs](../../dedup-tracker.mjs) | URL/requisition/content identity signals, cross-listing detection and tracker deduplication. | Implemented but different layers have different identity contracts. Fuzzy/content signals must not silently merge separate requisitions. |
| [liveness-api.mjs](../../liveness-api.mjs), [liveness-core.mjs](../../liveness-core.mjs), [liveness-browser.mjs](../../liveness-browser.mjs) | API-first active/expired/uncertain checks with optional browser fallback. | Implemented. An active feed listing does not prove that all application fields can be completed or that eligibility is known. |
| [discover-ranked.mjs](../../scripts/discover-ranked.mjs), [discovery evaluator](../../lib/applications/discovery.mjs) | Recent 50-job shortlist pipeline; collects Greenhouse/Lever/Ashby feeds, URL-hash deduplication, heuristics, explanations and optional API liveness checks. | Partial integration. This script deliberately supports a narrower provider set than the mature scanner, and does not simply call the shared admission gate. Regex heuristics are not exhaustive requirement parsing; score is capped at 95. |
| [reevaluate-shortlist.mjs](../../scripts/reevaluate-shortlist.mjs) | Re-scores existing identities; supports description-hash-bound review overrides and writes revised discovery/ledger evidence. | Implemented for the current extension. Review overrides are a different evidence class from automated scores. Must preserve method, profile and description versions. |
| [rank-pipeline.mjs](../../rank-pipeline.mjs), [evaluation prompts](../../web/src/lib/run-prompts.mjs), [Machine Summary reader](../../web/src/lib/machine-summary.mjs) | AI-assisted evaluation/reporting, structured reasons, gaps, evidence states and confidence hints. | Implemented with report/CLI contracts; not one canonical JSON analysis schema across every producer. Model-generated claims still need source validation. |

### 3.2 Application Studio, automation and tracking

| Component and actual source | Current functionality | Maturity, dependencies and integration points |
|---|---|---|
| [prepare-application.mjs](../../prepare-application.mjs) | Detects Greenhouse/Ashby/Lever, reads candidate configuration and prints a prefill summary; validates PDF location. | Implemented summary tool, not a submission transport. Do not describe all three platforms as live-validated form adapters. |
| [web apply session](../../web/src/lib/apply/session.ts), [planner](../../web/src/lib/apply/planner.ts), [submit guard](../../web/src/lib/apply/submit-guard.mjs) | Opens/extracts forms, plans/fills fields, handles files and human handoff. | Implemented assisted web flow; sessions are held in process memory. It follows web's no-auto-submit contract and is separate from the recent native Greenhouse runner. |
| [greenhouse.mjs](../../lib/applications/greenhouse.mjs), [browser.mjs](../../lib/applications/browser.mjs), [application-workflow.mjs](../../scripts/application-workflow.mjs) | Verified-fact mapping, standard/custom answers, form inspection, required-field validation, approved résumé checks and preparation results. | Partial platform implementation, with synthetic browser tests and recorded live preparation. Unknown/compound questions fail closed. Conditional/custom forms still need coverage. |
| [upload-policy.mjs](../../lib/applications/upload-policy.mjs) | Strict approved-PDF bytes/hash, bounded multipart envelope, signed storage/CSRF constraints and expiry checks. | Implemented policy. Recorded résumé upload succeeded; this does not prove application acceptance. Reuse unchanged integrity checks. |
| [reviewed-submission.mjs](../../lib/applications/reviewed-submission.mjs), [review-first-application.mjs](../../scripts/review-first-application.mjs) | Exact one-application approval binding; profile/plan/PDF integrity checks; durable dispatch reservation; native request validation; receipt capture and reconciliation. | Partial, safety-critical. One real authorized attempt returned HTTP 428 and no verified receipt; runner closed after timeout. There is no completed live verification-code continuation. Do not call this production-ready submission automation. |
| [store.mjs](../../lib/applications/store.mjs) | Locked atomic JSON ledger, state graph, preparation ownership/recovery, duplicate/ambiguous-dispatch/verification retry blocks and event history. | Implemented extension. Rewrites the JSON aggregate under a lock; lacks a general transactional relationship to the Markdown tracker. |
| [confirmed-tracker.mjs](../../lib/applications/confirmed-tracker.mjs) | Idempotently mirrors a confirmed JSON-ledger submission into the legacy tracker using shared tracker transactions. | Narrow bridge, locally tested. It directly handles tracker rows rather than using the documented TSV-addition flow, a contract discrepancy to resolve deliberately. It is not general bidirectional synchronization. |
| [pilot.mjs](../../lib/applications/pilot.mjs), [prepare-application-pilot.mjs](../../scripts/prepare-application-pilot.mjs) | Bounded eligibility/readiness planning with policy/authorization hashes, approved document and duplicate checks. | Preparation only. A plan is not an autonomous executor. No validated unattended five-application submission transport exists. |
| [tracker.mjs](../../tracker.mjs), [tracker-utils.mjs](../../tracker-utils.mjs), [set-status.mjs](../../set-status.mjs), [merge-tracker.mjs](../../merge-tracker.mjs) | Canonical Markdown tracker, shared locks, status histories, derived SQLite query index and controlled updates/imports. | Established reusable engine. Existing web status route delegates here. Keep these write paths authoritative while introducing read models. |
| [application-answers.mjs](../../application-answers.mjs), [application-artifacts.mjs](../../application-artifacts.mjs) | Application answer snapshots and artifact/bundle handling. | Implemented but separate from the newer verified standard-answer profile; unify through adapters and explicit provenance, not destructive migration. |

The automation ledger has Discovered, Evaluated, Shortlisted, Application Started, Awaiting Approval, Submitted, Interviewing, Offer, Rejected, Failed, Skipped and Needs Information. The established tracker additionally distinguishes Responded, Assessment, Hired and Discarded and uses Applied/Interview/SKIP terminology. No single status vocabulary currently covers every consumer.

### 3.3 Profile, writing, preparation and career development

| Component and actual source | Current functionality | Maturity, dependencies and integration points |
|---|---|---|
| [profile validation](../../validate-profile.mjs), [profile examples](../../config/profile.example.yml), [path-resolver.mjs](../../path-resolver.mjs) | Candidate preferences, environment/data-root overrides and validation. | Implemented. YAML/profile/primary CV and application JSON have overlapping facts; precedence needs an explicit cross-model contract. |
| [career-profile.mjs](../../career-profile.mjs), [profile validator](../../lib/career-profile.mjs), [intake.mjs](../../intake.mjs) | Source-backed master profile and reviewed intake/import workflows with evidence/review states. | Implemented knowledge-bank foundation. It is not yet the universal source for every form answer or dashboard card. |
| [verify-cv-facts.mjs](../../verify-cv-facts.mjs), [story-provenance-check.mjs](../../story-provenance-check.mjs), [AGENTS.md](../../AGENTS.md) | Fact checks and primary-vs-derived provenance rules; unverified narrative must not become a qualification. | Important existing controls, not a mathematical guarantee against every semantic fabrication. Reuse source-backed facts and review. |
| [generate-pdf.mjs](../../generate-pdf.mjs), [cv-templates.mjs](../../cv-templates.mjs), [CV payload schema](../../lib/cv-payload-schema.mjs), [generate-cover-letter.mjs](../../generate-cover-letter.mjs) | Template-driven CV/cover PDFs, payload validation, formatting and fact checks. | Implemented; PDF rendering uses Playwright. Approved unchanged résumés must remain immutable even though generation is available. |
| [CV Studio](../../web/src/lib/cv-studio/studio.mjs), [CV rewrite](../../web/src/lib/cv-studio/rewrite.mjs), [cover brief](../../web/src/lib/cover-brief.mjs) | Existing document-editing/generation UI and AI orchestration. | Reusable Application Studio surface. Generated writing and candidate-verified facts are still distinct approval products. |
| [interview-prep mode](../../modes/interview-prep.md), [plan](../../modes/interview/plan.md), [practice](../../modes/interview/practice.md), [debrief](../../modes/interview/debrief.md) | Role/company research, sourced-vs-inferred questions, time-blocked plans, behavioral practice, feedback and question-bank updates. | Substantial agent protocols. They do not establish a scheduled adaptive study engine, standardized readiness measurements or a built-in code judge. |
| [session format](../../interview-prep/sessions/README.md), [story-bank helpers](../../lib/story-bank.mjs) | Markdown/front-matter interview sessions, practice-vs-real source markers and story support. | Existing storage/protocol. No populated personal question bank or measured performance should be presumed from the protocol alone. |
| [assessment-log.mjs](../../assessment-log.mjs), [outcome.mjs](../../outcome.mjs), [outcome types](../../lib/outcome-types.mjs) | Append-only skill-test/take-home observations, deadlines, submissions-as-records, outcome journals and document snapshots. | Implemented CLI. The assessment tool records information; it does not take or submit assessments. Useful inputs for a preparation planner. |
| [ics-interview.mjs](../../ics-interview.mjs), [invite-match.mjs](../../invite-match.mjs) | Import/match supplied calendar/invite/rejection content and disambiguate applications. | Implemented local utilities; not a live Microsoft calendar connector and not authorization to modify a mailbox/calendar. |
| [skill-extract.mjs](../../skill-extract.mjs), [jd-skill-gap.mjs](../../jd-skill-gap.mjs), [upskill.mjs](../../upskill.mjs), [skill-gap UI model](../../web/src/lib/skill-gaps.mjs) | Skill normalization; named/prose-supported/missing-skill comparison; recurring report-gap analysis and web presentation. | Implemented personal-corpus analysis. Not a representative market-wide skill-demand service or a project/certification completion ledger. |

### 3.4 Dashboards, workers, analytics, security and notifications

| Component and actual source | Current functionality | Maturity and integration points |
|---|---|---|
| [web README](../../web/README.md), [app pages](../../web/src/app/page.tsx), [pipeline page](../../web/src/app/pipeline/page.tsx), [Explore](../../web/src/app/explore/page.tsx) | Existing Today, pipeline filters/sort, role detail/compare, discovery, apply, CV/documents, follow-ups, config, portals, worker jobs and scheduled-scans pages. | Functional alpha, not a missing frontend. Source inventory found 17 page files and 52 API route files. No first-class interview-study or Outlook review page found. |
| [status API](../../web/src/app/api/status/route.ts), [run API](../../web/src/app/api/run/route.ts), [scheduled API](../../web/src/app/api/scheduled-jobs/route.ts) | Controlled core commands and worker orchestration; streaming progress/results and schedule management. | Reuse routes/services, do not create a second CLI engine. Existing API groups also cover stats/patterns/upskill, documents/CV, assistant, profile and follow-ups. |
| [analytics page](../../web/src/app/analytics/page.tsx), [analytics metrics](../../web/src/lib/analytics-metrics.mjs), [Sankey](../../web/src/components/analytics/pipeline-sankey.tsx), [stats.mjs](../../stats.mjs), [analyze-patterns.mjs](../../analyze-patterns.mjs), [calibrate.mjs](../../calibrate.mjs) | Funnels, pipeline flows, response/outcome summaries, role/source patterns, skill gaps and score/outcome comparisons. | Implemented. Cohort/evidence semantics and sparse samples matter; missing denominator is not a measured zero. No causal résumé-version experiment or comprehensive human-time accounting exists. |
| [scheduled worker](../../web/scripts/scheduled-jobs-runner.mjs), [scheduled store](../../web/src/lib/scheduled-jobs-store.mjs), [schedule model](../../web/src/lib/scheduled-jobs.ts) | File-backed durable scan definitions/queue/history, claim tokens, stale recovery, retries and bounded scan processes. OS installers cover cron/launchd/Task Scheduler. | Implemented for discovery scans, not a general mail/study/application queue. Worker declares bounded attempts/timeouts/history; installer cadence is 15 minutes. Installation/enabled state was not checked by executing it. |
| [run registry](../../web/src/lib/core/run-registry.ts), [job persistence](../../web/src/lib/jobs-persist.mjs), [batch runner](../../batch/batch-runner.sh), [bounded process](../../lib/run-bounded.mjs) | In-process run ownership, UI progress persistence, headless CLI workers and bounded child execution. | Mixed durability. In-memory registry cannot substitute for a cross-process file lock; UI persistence is not durable external-workflow recovery. |
| [worker capabilities](../../web/src/lib/worker-capabilities.mjs), [report envelope](../../web/src/lib/report-envelope.mjs), [CV envelope](../../web/src/lib/cv-envelope.mjs) | Worker capability declarations and backend-persisted generated output envelopes. | Useful boundaries, but tool fencing differs by CLI. Do not assume every runtime enforces identical permissions. |
| [web proxy](../../web/src/proxy.ts), [origin guard](../../web/src/lib/origin-guard.mjs), [server](../../web/server.mjs), [privacy guard](../../lib/privacy-guard.mjs), [provider HTTP](../../providers/_http.mjs), [safe URLs](../../providers/_safe-url.mjs) | Loopback/same-origin guards, outbound privacy/URL restrictions, bounded HTTP/retry helpers. | Existing local security; not multi-user identity/RBAC or a public-hosting security model. Old helpers do not automatically secure every new adapter. |
| [apply-scope.mjs](../../apply-scope.mjs), [application browser](../../lib/applications/browser.mjs), [submission controller](../../lib/applications/reviewed-submission.mjs) | Fresh Playwright scope, pre-submit network controls, approved upload exception, kill/STOP checks and strict native dispatch gate. | Retain separate capability gates for discovery, preparation, uploads, code entry and submission. Never attach to ordinary personal browser sessions or bypass challenges. |
| [agent inbox](../../agent-inbox.mjs), [follow-up sweep](../../scripts/followup-sweep.sh), [reply-watch](../../reply-watch.mjs), [Notion plugin](../../plugins/notion/index.mjs) | Local request/proposal queues, draft follow-ups, limited OS notification behavior and optional integration/export. | Some notifications/integrations exist; no unified notification center, quiet-hours dispatcher or durable notification acknowledgment system found. No unsolicited outgoing recruiter messaging is authorized. |
| [context budget](../../lib/context-budget.mjs), [usage API](../../web/src/app/api/usage/route.ts), [run estimates](../../web/src/lib/run-cost-estimate.mjs), [OpenRouter runner](../../openrouter-runner.mjs) | Token/context estimates, some usage/cost display and provider/CLI execution controls. | Reuse, but not one global enforced daily monetary/human-time budget across all tools. Estimates are not bills. |

## 4. Existing architecture and data flow

```text
Public ATS/boards/seeds + portals.yml
       | providers + shared HTTP/filter/liveness/dedup helpers
       v
pipeline.md + scan-history.tsv + scan-runs.tsv + archived JDs
       | human/AI evaluation, report envelope, backend persistence
       v
reports/*.md (including Machine Summary) + tracker-additions TSV
       | merge-tracker / set-status + shared file locks
       v
applications.md + status-log.tsv --> tracker.mjs --> applications.db
       |                                   (derived query index)
       +--> stats / patterns / upskill / follow-ups / outcome journals
       +--> Next.js dashboard + Go terminal dashboard

Recent extension (parallel data path):
ATS feeds --> discover-ranked --> data/discovery/*.json
       --> application-automation/ledger.json + profile.json + policy.json
       --> Greenhouse plan --> fresh browser --> approved PDF upload
       --> exact approval --> native dispatch --> verified receipt required
                                             --> narrow tracker mirror

MSAL OAuth (external cache) --> GET-only Graph messages
       --> exact sender/recipient/time/context filters
       --> redacted classifications --> JSON-ledger email observations
                                      (review only; no automatic transition)
```

### Actual storage and state ownership

- `data/applications.md` is the established tracker source of truth; `data/status-log.tsv` supplies historical transitions. Row numbers and report numbers are not universal job IDs.
- `tracker.mjs` already uses built-in `node:sqlite`. Tables include `applications` (id, pos, date, company, role, score, status, pdf, report, notes, extras), `status_events` (id, app_id, status, date, source), and `meta`; indexes cover status/company/event application. This is a derived query index, not an authoritative relational jobs/profile database.
- `data/application-automation/ledger.json` is authoritative for the recent preparation/dispatch records; it has jobs, events, preparation/submission ownership and retry/confirmation evidence. Email observations now reside there too.
- `data/scheduled-jobs.json` owns scheduled scan definitions, queue and bounded histories. It is distinct from web AI-run state and the application ledger.
- Profile facts are spread across primary CV/YAML, source-backed master profile, standard application JSON answers and employer-specific answers. Generated prose does not become a primary fact merely by being saved.
- Human-readable files are intentional architecture, not a temporary database accident. An unplanned database-first migration would contradict [web/AGENTS.md](../../web/AGENTS.md) and the existing data contract unless explicitly approved. The user’s cloud-hosted-data requirement establishes a future migration need; its field ownership, compatibility and cutover remain design/implementation approval decisions (§15).

No single atomic transaction spans all these files. A future unified read view must expose conflicts/freshness rather than silently choose whichever source was read last.

## 5. Microsoft Graph / Outlook as a first-class subsystem

### 5.1 What already exists versus what does not

| Item | Verified implementation | Remaining development/validation |
|---|---|---|
| Personal-account OAuth | [outlook-auth.mjs](../../lib/email/outlook-auth.mjs): official MSAL PublicClientApplication, `consumers` authority, state, PKCE, loopback callback, exact configured-account check, scope allowlist, silent refresh. | No live account consent/authentication validated. Alias/username behavior, remote/WSL callback reachability and renewal/revocation need live tests with permission. |
| Credential persistence | External MSAL cache, Git-path/symlink rejection, owner-only file/directory checks, atomic replacement; CLI serializes cache access. | Cache is plaintext, not encrypted at rest; Windows ACL/OS-vault integration is not implemented. No credentials were opened in this audit. |
| Read-only retrieval | [outlook-client.mjs](../../lib/email/outlook-client.mjs): GET-only exact Graph origin/path allowlist; metadata first, selected detail, immutable IDs, bounded pages/time window, no redirect following. | No delta cursor, folder traversal, webhook, mailbox scheduler or Graph Retry-After scheduling. HTTP errors stop rather than auto-retry. |
| Matching/classification | [application-mail.mjs](../../lib/email/application-mail.mjs): exact configured From/Sender/recipient, received-time bounds, company plus requisition/posting context; confirmations, assessments, interviews, rejection, recruiter updates; account-scoped ID-hash dedup. | Strict matching misses generic ATS receipts, aliases/Bcc/forwards and unlinked recruiter contacts. Sender authentication is explicitly not live-validated. Classification/template coverage is synthetic. |
| Verification-code detection | Numeric candidates recognized transiently only with a fresh exact `activeVerification` application context; unrelated account-auth messages excluded. Outputs never expose a usable code. | Nothing creates a complete native verification-session lifecycle or delivers a code to the browser. `codeUseAllowed` is always false. No safe code-entry continuation is implemented. |
| Ledger evidence | Locked/idempotent `EmailObservation` events and proposed statuses; no persisted subject/body/code/token. | No automatic Submitted/Interviewing/Rejected transition, review UI or accepted-evidence bridge to the legacy tracker. |
| CLI | [outlook-email.mjs](../../scripts/outlook-email.mjs): init/connect/trust-sender/preview/sync/disconnect; observe-only mode. [Setup guide](../OUTLOOK.md). | No account connection configured in the inspected checkout; no sender should be guessed. The audit did not run these commands. |
| Other email support | Gmail lead importer and [reply-proposals.mjs](../../lib/reply-proposals.mjs), pasted invite matching and ICS handling. | The existing reply-proposal source validator accepts `kind: gmail`, not Microsoft Graph. A Graph bridge needs an explicit contract change, not a relabeled Gmail event. |
| Outlook registry plugin | [outlook-interviews.json](../../plugins-registry/outlook-interviews.json) advertises an external Graph ingest plugin and required environment variables. | Registry listing only; its external implementation was not installed, fetched or validated. Do not confuse it with the local MSAL implementation or enable both without dedup/ownership rules. |

### 5.2 Authentication and least privilege

Keep delegated user sign-in for the personal Microsoft/MSN account. Use the existing public client and `consumers` authority; never collect a password or introduce service-account/client-credentials access. The mailbox scope is **Mail.Read**, with MSAL's sign-in/refresh scopes (`openid`, `profile`, `offline_access`) as applicable. Do not request Mail.Send, Mail.ReadWrite, shared-mailbox or calendar permissions for this phase.

Mail.Read is supported for personal accounts and permits body access; Mail.ReadBasic cannot supply the body content required for verification/receipt analysis. Application filtering narrows actual processing but does not technically narrow Mail.Read consent to selected employers. Calendar meeting extraction from supplied email/ICS does not require granting calendar management. [Microsoft mail API permission table](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0), [OAuth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

Proposed token design: retain MSAL-managed renewal, keep access tokens in worker memory, serialize the cache under one cross-process lock, and store refresh-capable cache material in an OS-backed secret store outside Git. Microsoft's Node persistence extension supports DPAPI, Keychain and Linux LibSecret. **It is not currently installed or verified in this environment**; assess desktop/keyring availability and approval for this optional dependency first. If no usable vault is available, fail closed or offer an explicitly approved session-only mode; do not silently downgrade encryption. A headless host may require a user-unlocked external key arrangement. Disconnect removes local access material; remote consent revocation is a separate user action. [Microsoft persistence documentation](https://learn.microsoft.com/en-us/entra/identity-platform/msal-node-extensions).

Use a stable opaque mailbox/account identity plus explicitly verified recipient aliases; do not use a mutable email address as the permanent primary key. Cache/delta tokens, OAuth callback parameters, subscription clientState and any token-bearing diagnostic need secret treatment even if they are not message bodies.

### 5.3 Matching, receipts and correspondence

Proposed deterministic evidence pipeline:

1. Fetch minimal envelope metadata within a bounded window; reject drafts, unrelated accounts and unexpected sender delegations. Request immutable IDs consistently.
2. Correlate exact approved sender/domain information, verified recipients/aliases and received timestamps to applications, submission attempts or active authorized verification sessions. Display-name matches are insufficient.
3. Use requisition/posting IDs first; then exact company/role context and previously confirmed conversation links. Generic same-company messages produce candidate matches, never a silent assignment. A thread is evidence, not proof of application identity.
4. Fetch selected content only when necessary; never follow external links/images or execute instructions from messages. Start with deterministic classifiers for receipt, assessment, interview, rejection and recruiter follow-up.
5. Record an immutable minimal observation and a separate proposed application update. Human acceptance must bind the exact application, evidence digest and expected current revision. Preserve rejected/unmatched/ambiguous reasons without retaining raw content unnecessarily.
6. An accepted genuine receipt may support Submitted only through an approved confirmation-evidence policy. A code request is not a receipt. A 2xx alone, an inbox hit, or an AI summary does not establish successful submission. Link known dispatches; unexpected receipts may represent outside-ledger applications and need reconciliation before further attempts.
7. Accepted interview/assessment/rejection evidence goes through the canonical state writer; don't create a second direct Markdown writer. Where a state lacks an equivalent in the automation ledger, use a domain event and explicit mapped projection until a schema migration is approved.

Proposed event taxonomy: `ApplicationReceiptDetected`, `AssessmentInvitationDetected`, `InterviewInvitationDetected`, `RejectionDetected`, `RecruiterFollowupDetected`, `VerificationRequested`, plus `EmailMatchNeedsReview` and accepted/dismissed dispositions. Record source, time, matching signals, evidence confidence and actual reviewer decisions separately.

### 5.4 Secure human-approved verification workflow

This is proposed, not functioning code:

```text
Authorized application / immutable plan + approved document
  -> native verification-required response
  -> VerificationRequested (exact app, attempt, browser lease, nonce, TTL)
  -> read-only email search within request/expiry window
  -> sender-authenticity + recipient + context checks
  -> excluded if login/reset/MFA/enrollment/unrelated/ambiguous/stale
  -> candidate detected (secret stays memory-only)
  -> human approves use for this exact application/session
  -> native page code-entry/verification action, within scoped network policy
  -> employer receipt validation OR stop/reconciliation required
```

A sender allowlist is not cryptographic authentication. Before code use, validate the provenance of Microsoft's receiving authentication verdicts and actual templates; do not trust sender-supplied Authentication-Results or a model's opinion. When authenticity cannot be established, require manual entry through the genuine form. Neither generic security-code language nor a recently arrived message is adequate authorization.

Keep code values out of disk, traces, DOM snapshots, screenshots, exception messages, worker stdout and model prompts. Show a masked human review card, not the code. Expire a candidate on use, browser loss, timeout, question change or new request. Record only that a code was used, purpose/session/reviewer and outcome; avoid hashes of low-entropy codes. Code-use approval is separate from final application submission permission. If native verification performs final submission, the original exact submission approval must still be valid and cover that action.

Crash recovery must preserve uncertainty: if the request might have been accepted, reconcile receipts before any retry. Do not reopen an old session and assume a previous code remains valid, replay an application POST, clear the verification block merely because email is connected, solve CAPTCHAs or bypass an employer's security controls. The existing runner's timeout/closed-browser behavior is a release blocker for this flow.

### 5.5 Periodic synchronization versus webhooks

**Recommendation: periodic read-only synchronization first, then optional webhooks as wake-up hints.** Neither durable mail sync nor webhooks currently exists. Graph message delta is per folder; folder scope and moves must be modeled explicitly. [Message delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0).

| Design | Fit and proposed operation | Failure recovery and limits |
|---|---|---|
| Current bounded list | Existing manual preview/sync; metadata first and selective bodies. | Recent-window/page cap can miss older or high-volume messages. `hasMore` means incomplete. No durable scan frontier. |
| Periodic delta sync | Best initial local-first worker: per-account/folder checkpoints, serialized claims, no public server. Begin with chosen folders and an explicitly bounded initial backfill. | Process every nextLink before checkpointing a completed deltaLink; commit evidence idempotently. On crash, replay the uncommitted page. On invalid/expired delta state, reset with bounded backfill and dedup; display a coverage warning until recovered. Protect opaque cursor URLs and revalidate host/path before requests. |
| Webhook notifications | Optional later: delegated personal-account message subscriptions are supported. Basic notifications minimize payload; fetch authoritative messages through the same sync pipeline. | Requires public HTTPS, endpoint validation, clientState checks, durable acknowledgment, subscription renewal and lifecycle handling. This changes the local security/deployment boundary and requires approval. Never expose the whole local dashboard to receive events. |

Use Graph's documented `Retry-After` for throttling, bounded backoff with jitter for transient reads, and an explicit reconnect state for revoked consent/interaction-required refresh failures. Delta state recovery needs its own error classification; a generic GET exception is insufficient. Reuse immutable IDs and observation idempotency so retries do not duplicate updates. [Delta recovery overview](https://learn.microsoft.com/en-us/graph/delta-query-overview), [throttling guidance](https://learn.microsoft.com/en-us/graph/throttling).

Proposed normal background cadence is configurable and subject to quiet hours; the existing 15-minute scan scheduler is a reusable pattern, not automatically an acceptable OTP timer. During an explicitly approved active verification session, a short bounded polling window may be needed, with a separate quota/TTL. Do not claim guaranteed email delivery latency.

For future webhooks, answer the endpoint validation challenge as required, check notification ownership/clientState, durably enqueue minimal notification IDs before acknowledgment, and tolerate duplicate/out-of-order delivery. Current documentation requires prompt acknowledgment; do not run AI or parse a mailbox in the callback. [Webhook delivery](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks).

Graph currently documents Outlook basic subscription lifetimes up to 10,080 minutes and rich notifications up to 1,440 minutes; use the returned `expirationDateTime`, schedule early renewal and recheck limits at implementation. Do not assume a subscription lasts indefinitely. [Subscription resource](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0).

Handle `reauthorizationRequired`, `subscriptionRemoved` and `missed`: reauthorize/renew or recreate as appropriate, then use delta/backfill to recover changes. A notification is a hint to synchronize, never authoritative evidence that an application changed state. [Lifecycle notifications](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events). Personal-account message subscription support is documented, but not live-tested against this account. [Outlook subscriptions](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview).

### 5.6 Privacy boundaries

Keep raw email/token/code material out of the general event bus, analytics, browser traces and ordinary AI context. Permit only typed redacted metadata across boundaries. The default classifier is deterministic; optional future AI receives an explicitly approved minimal excerpt with secrets removed, not an entire inbox or message thread. Email text is untrusted data and cannot grant permissions.

Retain hashed message identity, application linkage, classification, source timestamps, match reasons and review disposition. If audit evidence needs a protected raw message reference, keep it in a separate access-controlled store with a finite retention policy; re-fetch and verify before review where possible. Derived indexes may never include secrets. Raw subjects and provider exception bodies can contain codes too. Retention, export, backups and deletion must cover caches and screenshots as well as the main ledger.

## 6. Reusable components and integration gaps

Reuse the provider registry, admission gate, URL/requisition identity utilities, liveness adapters, path resolvers, existing canonical tracker writers, file locks, profile provenance checks, PDF/template pipeline, web route/worker framework, scheduled-scan state pattern, skill vocabulary and interview protocols. Reuse the local Graph adapter after hardening; do not install the registry Outlook plugin merely because it has a matching name.

Main gaps:

- No canonical cross-source identity map or consistent job/application/attempt separation.
- Separate profiles, score scales, statuses and histories; narrow tracker mirroring and no Graph review bridge.
- No shared explicit AI-analysis schema with source-bound requirements and deterministic eligibility validation across producers.
- No robust native verification continuation or live-confirmed end-to-end application receipt path.
- No first-class account/sync/subscription/email review UI or durable mail cursor.
- No actual-performance-driven study scheduler, normalized practice/feedback records, coding execution sandbox or completion ledger.
- Existing skill-gap analysis reflects the personal evaluated corpus; it cannot honestly stand in for market-wide demand.
- No comprehensive human-time/quiet-hours budget, unified notification dispositions or globally enforced cost budget.
- No production multi-user/authenticated public deployment model. Local-first is a strength to preserve, not permission to publish private endpoints.

## 7. Recommended canonical data models and contracts

### 7.1 Ownership and compatibility strategy

Use **one logical domain model, initially as a read-only projection**, not a new competing source of truth. Preserve Markdown/TSV as canonical where established, the JSON application ledger for its operational events, and source-backed profile facts in their existing user-layer files. Give every projected value a source locator/revision and surface conflicts.

Keep the existing SQLite tracker index rebuildable. If later query volume justifies a richer Career Central projection index, extend/version a derived index with explicit migrations and a rebuild command; do not silently add authoritative tables to `applications.db` that `tracker sync` could discard. Built-in `node:sqlite` already fits the stack. Avoid Postgres, Redis, a new ORM or vector store until a demonstrated requirement exists. SQLite fits local low-writer workloads; it is not a database file to share directly across networked clients. [SQLite deployment guidance](https://www.sqlite.org/whentouse.html).

Define single-writer ownership per command/resource. Cross-file commands need an idempotency key, durable intent/outcome and reconciliation/outbox pattern rather than pretending that two atomic renames form a transaction. New records should use approved canonical creation paths; document any intentional alternative. Do not automatically migrate or overwrite records to make sources appear consistent.

### 7.2 Entity inventory — proposed, not new tables implemented here

| Entity | Minimum fields and invariants |
|---|---|
| `Employer` | Opaque ID, canonical name, verified domains/aliases with sources; acquisitions/brands remain explicit, not fuzzy facts. |
| `Job` / `PostingIdentity` | Stable ID; employer; ATS board/provider/posting IDs; requisition aliases; source URLs; location/remote scope; lifecycle and first/last observed timestamps. Several source listings may refer to one job, but distinct requisitions remain separate. |
| `JobSnapshot` / `SourceObservation` | Job/source ID, fetch/posted timestamps, immutable description hash/reference, availability verdict and check time, parser version; retain lineage for changed requirements. |
| `Requirement` | Kind, essential/preferred/unclear, exact source excerpt/locator, extracted value/range, applicability and confidence; unknown is explicit. |
| `CandidateFact` / `QualificationEvidence` | Stable fact ID, typed value, source locator/quote/hash, verified/needs-review/retracted/unknown state, verifier/time, validity interval and sensitivity. |
| `CandidatePreferences` / `TimePolicy` | Role weights, geography/relocation/work arrangement, salary preference vs hard floor, earliest start precision, available study/job-search minutes, quiet/protected periods and priorities. Unprovided budgets remain unset. |
| `Skill` / `SkillEvidence` | Canonical name/aliases, fact links, proficiency claim only if verified; named skill, demonstrated usage and learning intent remain distinct. |
| `MatchAssessment` | Job snapshot/profile/policy versions, requirement judgments, score components, exclusions, concerns, evidence confidence, reviewer override/provenance and creation time. No hiring-probability field. |
| `DocumentVersion` / `GeneratedDraft` | Immutable artifact hash/path, template/version, source fact IDs, application/job binding and explicit approval state. A draft cannot edit facts or replace an approved PDF. |
| `Application` | Separate ID from Job, exact target/requisition, applicant/profile version, external-history state, current projected lifecycle and source mappings. No company-title-only identity. |
| `ApplicationAttempt` / `SubmissionReceipt` | Attempt and idempotency IDs, owner/lease, approved plan/PDF/policy hashes, dispatch time, server result, uncertain acceptance flag, confirmed receipt provenance and artifact reference. No automatic re-dispatch after uncertainty. |
| `ApplicationAnswer` / `ApprovalGrant` | Verified answer or explicit scoped approval; employer/application/question/version scope, expiry/revocation and action capability. Submission and code-use grants are different. |
| `MailboxConnection` | Opaque MSAL account/cache reference, expected verified recipients, authority/client reference, scopes, connection state and last successful refresh/sync; never serialized tokens. |
| `MailboxSyncState` | Account/folder, protected cursor reference, pending page checkpoint, coverage window, latest success/error, backoff, generation and lease. Raw cursor URLs stay out of UI/analytics. |
| `EmailObservation` / `EmailMatch` | Account-scoped immutable-message hash, received/observed times, category, possible applications, matching signals, authenticity verdict/provenance, review disposition and classification version. No raw subject/body/code. |
| `VerificationSession` | Purpose, application/attempt/browser lease, expected recipient/sender, request/expiry times, request generation/nonce, candidate-use state and approval reference; code value transient only. |
| `GraphSubscription` | Protected subscription/account/resource reference, returned expiry, renewal state, clientState secret reference, lifecycle error and recovery checkpoint. Future webhook phase only. |
| `InterviewRound` / `Assessment` | Application linkage, format, deadline/timezone, status, evidence; differentiate actual employer feedback, candidate recall and generated suggestions. |
| `Question` / `PracticeAttempt` | Source/license, topic/difficulty, actual question/answer references, real/practice marker, rubric version, self-report vs assessed result, measured duration and feedback provenance. |
| `StudyTask` / `LearningGoal` | Required topics/skill links, estimate, deadline, priority, prerequisites, scheduled/actual minutes, completion evidence and review date. Completion never inferred from a generated plan. |
| `AutomationRun` / `Task` / `Notification` | Typed capability, state, claim/lease, retries/idempotency, timestamps, sanitized error class, parent IDs, cost/time estimates vs actuals; notification delivery/dismissal status. |
| `DomainEvent` / `SourceIdentityMap` | Immutable ID, type/version, aggregate/source IDs, occurrence/observation times, actor/evidence/causation and redacted payload; explicit mappings to legacy row/report keys and aliases. |

### 7.3 AI structured output and fact separation

Adopt versioned JSON Schema contracts for new analyses, then adapt existing Machine Summary YAML/report formats. Initially keep existing validators where appropriate; selection of a schema-validator dependency requires a later review. Parsing valid JSON is not schema or factual validation. [JSON Schema object constraints](https://json-schema.org/understanding-json-schema/reference/object).

Every analysis envelope should include `schemaVersion`, analysis kind, source snapshot hashes, profile/policy versions, generator/model/prompt version, required typed results, warnings and evidence references. Specify required fields, enums, bounded arrays/strings, nullability and unknown-key rejection. Include explicit `unknown`/`not_applicable` states rather than defaulting a missing boolean to false. Bound source excerpts and reject references to facts/snapshots not supplied to the analysis.

Suggested requirement judgment shape:

```text
requirementId -> essential/preferred/unclear
             -> satisfied / partial / not_met / unknown / not_applicable
             -> sourceEvidenceIds + candidateFactIds
             -> deterministic explanation + evidenceConfidence
```

Eligibility is a separate gate: a strong score cannot outweigh a confirmed mandatory conflict, expired posting, missing work authorization evidence, unsuitable start date or uncertain required answer. Unknown eligibility is a review state, not a pass. AI may propose extraction/writing; deterministic validators and humans authorize facts/actions. Confidence concerns evidence quality, not probability of being hired.

### 7.4 Explainable matching and demand analytics

Preserve existing scores/methods and scales; never silently reinterpret legacy 0–5 as 0–100 or blend reviewed scores with regex scores. A new versioned score may combine technical evidence, experience/seniority, role alignment, geography, compensation and growth, showing each contribution and missing evidence. Search emphasis weights are allocation preferences, not proof of qualification. Compensation must retain currency/interval and base/bonus/equity distinctions; cost-of-living adjustment needs a named dated dataset and cannot be invented.

For market skill demand, count each canonical job once per defined observation window, keep all source provenance and group uncertain duplicate clusters separately. Record the denominator, date range, geography/role/seniority filters, sample coverage and missing-description rates. Count essential and preferred mentions separately; one job counts at most once per skill. A repost or multiple mirrors must not multiply demand. Existing upskill results remain labeled as the personal evaluated corpus, not the US market. Reuse vocabulary normalization while retaining unmapped terms for review.

## 8. Proposed dashboard architecture and stack

Extend `web/`: Next.js App Router, existing React/TypeScript/Tailwind components, server-only data adapters and plain `.mjs` domain functions that can be tested without a frontend build. Keep existing interactive tables and SVG/Sankey/chart components; no new chart library is justified yet. Keep the Go TUI as a compatible optional client. Do not create a replacement SPA or microservice fleet. A hosted slice is now part of the target MVP; §15 describes the required API/data separation before cloud deployment. The present server cannot simply be exposed publicly or copied to S3.

Separate read queries from capability-scoped commands. Proposed `/api/career-central/*` contracts are **new designs**, not endpoints currently present. Server queries join existing files through the canonical projection; writes delegate to established commands. Read pages never initiate a scan, token refresh, browser launch or sync merely because they render. Expensive jobs run through typed worker commands with observable status, not inside a React render/request lifetime.

| Target module | Reuse and proposed additions |
|---|---|
| Home | Existing Today/action queue and funnel tiles; add deadlines, limited daily priorities, study progress, mailbox freshness and automation/kill-switch status. Show actionable work, not a large unbounded feed. |
| Job Intelligence | Explore/pipeline/job details/compare, requirement/gap display and filters; add consistent synopsis/eligibility evidence, provenance, snapshot freshness and cross-source identity. |
| Application Studio | Existing CV Studio/templates/cover tools; add fact-review knowledge bank, immutable approved document versions, scoped answer approvals and one coherent preparation view. |
| Interview Preparation | New first-class view over existing prep/session/assessment artifacts; questions, tasks, measured practice attempts, deadline-aware time blocks and actual feedback. |
| Career Development | Existing skill-gap panel; add deduplicated demand views, learning/project/certification goals with evidence of completion. |
| Analytics | Existing funnels/Sankey/outcome reports; add explicit cohorts, source coverage, documented résumé-version attribution and user-entered time. Observational comparisons are not causal proof. |
| Personal Profile | Existing config/CV/source-backed profile tools; add fact provenance and approval review, goals/preferences/time constraints without changing primary facts automatically. |
| Automation Control | Existing jobs/schedules/run views; add unified typed run history, mailbox sync health, recovery/reconciliation tasks, approvals and explicit capability status. A kill switch stops new sensitive actions; it cannot undo a request already dispatched. |
| Communications, cross-cutting | Connection status, last sync/coverage, matched receipts/invites/rejections, ambiguous matches and review decisions; show masked verification requests with expiry and live-session status. No code/token in frontend telemetry or default payloads. |

Loopback and origin guards remain mandatory. A publicly reachable webhook receiver must be a separately approved narrow ingress, not an excuse to expose all private web routes. Multi-device access is an explicit target requirement; use the proposed authentication/authorization/backups design in §15 before deployment.

## 9. Proposed architecture and data-flow diagrams

```text
                          Career Central local web / CLI / TUI
                              | queries         | reviewed commands
                              v                 v
                  Canonical read projection   Capability/policy command layer
                  + source/conflict metadata   + approved plan/document/fact IDs
                              |                 |
                 Existing source adapters       +--> existing tracker/profile writers
                 /          |           \       +--> typed task runner / claims
        Markdown+TSV    JSON ledger    documents +--> human-approved browser workflow
                 \          |           /
                  rebuildable SQLite read index (only if needed)

Public job sources -> provider/filter/liveness -> normalized job snapshots
                                             -> schema-validated analyses
                                             -> match explanations + review queue
```

```text
Personal Microsoft account
   -> delegated OAuth / MSAL <-> external encrypted cache (proposed upgrade)
   -> GET-only Graph sync worker <-> protected per-folder checkpoints
       -> minimal metadata -> exact/context match -> selected content in memory
       -> redacted EmailObservation -> application review / deadline suggestion
       -> separately approved canonical state update

Future optional webhook -> validate + enqueue hint -> same Graph sync worker
                                                (not a second classifier)

Authorized browser session -> VerificationSession <- matched verification candidate
                           -> human code-use approval -> native verification
                           -> separate submission gate -> confirmed receipt or stop
```

```text
Verified facts + job requirements + actual practice/debrief results
       + interview deadlines + user time policy
       -> deterministic task priorities / capacity checks
       -> optional AI explanation or bounded draft
       -> human-adjustable daily plan
       -> measured completion/feedback -> updated readiness evidence

Protected personal time / quiet hours / budgets bound every background plan.
```

## 10. Minimum viable product definition

MVP should deliver one trustworthy daily workspace, not full autonomy across all eight modules. M1 is a local contract/compatibility milestone; the target hosted MVP additionally includes the hybrid vertical slice in §15, available while the local worker is offline.

- Unified read view of discovered jobs, application stages and attempts, with stable identity, explicit uncertainty, explainable fit, source links and freshness.
- Home with a small daily decision queue, real deadlines and automation/mail health; dashboard must not imply a prepared application was submitted.
- Application detail with verified-fact and document provenance, existing prep artifacts and approval/reconciliation blockers.
- Outlook connection/consent status, authorized read-only sync, matched communications and human-reviewed ledger updates. Manual verification remains the default until the session workflow is validated and separately authorized.
- Basic interview task board using actual deadlines, existing question/session artifacts and user-supplied available time; no code judge or unsupported readiness percentage.
- Existing funnel/response analytics over confirmed/cohort-aware data, plus clearly labeled source coverage and personal-corpus skill gaps.
- Typed run history, bounded retries for idempotent reads, cancellation and readable recovery states. No additional automatic submissions.

Out of MVP: autonomous application pilot, public exposure of the existing local server, multi-user tenancy, webhooks, mass automatic résumé rewriting, licensed question-bank ingestion, automated assessment solving, causal résumé A/B claims, predictive hiring probabilities and comprehensive US market statistics.

## 11. Prioritized roadmap and dependencies

These are proposed milestones, not implementation commitments or time estimates.

| Priority / milestone | Deliverable and dependency | Exit condition |
|---|---|---|
| P0 / M1 — canonical read contract | Versioned schemas, source adapters, identity mappings, status/score provenance and conflict reporting. Depends on approval of this design. | Fixture-based projection reconciles existing representations without mutating any source; acceptance criteria in §14. |
| P0 / M2 — unified dashboard slice | Extend existing Home and job/application detail queries using M1; display safety, freshness, pending verification and mailbox status. | UI matches CLI projection and handles partial/malformed sources honestly; no network/browser work during render. |
| P0 / M3 — Outlook hardening and read-only validation | OS-protected token storage decision, minimal review UI, authentication/template test plan, protected checkpoints and typed sync task. Depends on M1 and user-controlled app registration/consent approval. | Live retrieval only after permission; matched synthetic/live-redacted fixtures verified; no mailbox mutation/code use/submission. |
| P1 / M4 — durable mail evidence and accepted updates | Folder delta sync, throttling/revocation/backfill recovery, review dispositions and canonical state transition bridge. Depends on M3 and a source-kind/state contract update. | Crash/replay tests produce no duplicates or skipped checkpoints; explicit receipt evidence review changes only the intended application. |
| P1 / M5 — verification-session recovery | Retain native browser lease, explicit VerificationSession events, scoped human code-use authorization and redaction of browser diagnostics. Depends on M3/M4, validated sender provenance and specific new test authorization. | Real authorized verification path completes without a bypass, duplicate request or false Submitted state; ambiguous acceptance blocks retries. |
| P1 / M6 — structured interview preparation | Import existing protocols/artifacts into questions, rounds, tasks and feedback; capacity-aware plans and user-entered time. Depends on M1 and time-budget decisions. | Plan fits available time, preserves protected periods and distinguishes actual/practice/generated outcomes. |
| P2 / M7 — career development and richer analytics | Deduplicated job-skill corpus, completion goals, document-version attribution and time/source effectiveness. Depends on reliable job/event identity, M4/M6 and adequate real data. | Every metric exposes cohort/coverage/denominator; no made-up market or causal claims. |
| P2 / M8 — optional notification ingress | Evaluate webhooks only if polling latency or availability becomes a measured problem. Depends on approved hosting/security/cost model. | Renewal/lifecycle/outage/replay tests pass; periodic delta remains recovery source. |
| Gated later — application autonomy | Independently reviewed execution policy, budget/cap, approved facts/answers/documents, proven receipt/recovery and explicit new authorization. Depends on successful M5 and real approved end-to-end validation. | Current requirements do not authorize this. Policy flags alone cannot enable it. |

## 12. Risks, constraints and unresolved decisions

| Risk / constraint | Consequence and architectural response |
|---|---|
| Conflicting sources/status vocabularies | Show source-specific state and conflicts; do not choose by latest filesystem mtime or call a recommendation an application. Legacy Rejected may lack proof of when a submission occurred. |
| Duplicate identity drift | Same titles can be different requisitions; reposts/ATS IDs can change. Preserve alias evidence and manual resolution; separate semantic duplicate hints from submission identity. |
| Multi-file consistency and ephemeral sessions | Current locks protect individual resources, not whole workflows. Use durable intents/claims/reconciliation, and refuse retry after uncertain dispatch. |
| Verification/receipt gap | Native submission and human code entry are not live-validated as one flow. Keep the current verification retry block and kill switch; require new scoped testing approval. |
| Plaintext cache and headless hosts | Current owner-only cache is not an encrypted vault. OS-keystore availability and multi-OS requirements must be verified before selecting a persistence upgrade. |
| Sender spoofing/forwarding/aliases | Header/address heuristics cannot authorize security actions. Validate receiving-authentication provenance, recipient aliases and exact active context; unresolved cases require manual handling. |
| Privacy through side channels | OAuth URLs, cursors, subjects, exception bodies and screenshots can leak secrets. Redacted typed events and separate protected evidence stores; no raw email/OTP in AI or analytics. |
| Mailbox sync incompleteness | Bounded recent-window reads can miss messages; delta state can expire and moves cross folders. Visible coverage, durable per-folder checkpoints and bounded rebuilds. |
| Public webhook ingress | Public HTTPS and renewal add operational load and attack surface. Keep polling first; no public dashboard exposure or new hosting costs without approval. |
| Broad read consent | Mail.Read covers more than employer mail. Minimize fetched bodies and retention, and make scope/revocation transparent. No silent escalation to write/send/calendar scopes. |
| AI fabrication or prompt injection | All external postings/emails/transcripts are untrusted data. Validate schemas/references, separate facts from generated prose and keep action authority outside model output. |
| Sparse/biased analytics | Personal shortlist is not the market, selected résumé versions are confounded, unknown dates are not zeros. Publish denominators, cohort rules, evidence coverage and limitations. |
| Rate limits, model costs and user time | Use existing HTTP/worker controls, add global quotas and task priorities. Avoid retrying non-idempotent actions; AI work needs explicit budget estimates/caps. |
| Upstream/local fork drift | Recent code is uncommitted and docs may lag it. Existing architecture notes still describe some transports as unimplemented despite a narrow reviewed transport now existing. Update contracts deliberately in a later approved milestone. |
| Runtime/dependency compatibility | Separate root/web Node/dependency surfaces and Go tooling require verification. Installed source declarations are not a tested production build; no new stack choice is justified by version numbers alone. |
| Quiet-hours/time constraints unknown | Do not invent a daily study duration or consume every free hour. Keep capacity unset until the user supplies it; allow skip/snooze/pause without automatically refilling all time. |

Decisions requiring user input before their dependent milestones:

1. Hybrid AWS hosting and desktop/mobile access are confirmed preferences. Still decide the AWS region, initial monthly budget, domain and initial deployment cutover scope; retain single-user access unless explicitly expanded.
2. Set weekly/daily job-search and study budgets, protected activities/quiet hours, desired digest cadence and which alerts may interrupt.
3. Select authorized mailbox folders/backfill window, permitted raw-evidence retention and acceptable OS-vault/session-only behavior. Do not request new consent during this audit.
4. Decide whether a reviewed employer email receipt may become canonical submission evidence, and whether interview/assessment/rejection updates should always require review. Initial recommendation: explicit review for all.
5. Approve the logical status/identity mapping and continued Markdown authority; a database-first migration is not assumed.
6. Specify optional AI provider/cost ceiling and whether any redacted correspondence may ever be processed by a model. Default: no raw email or verification material sent to AI.
7. If/when webhooks are justified, separately approve ingress hosting, deployment responsibility and any costs.

## 13. Recommended first implementation task

**M1: build a versioned, read-only Career Central overview projection with identity/state provenance and fixture tests.**

Proposed scope: a small shared domain/read-adapter module and explicit schema contract that reads discovery snapshots, the established tracker/history, JSON application ledger, redacted email observations, schedule summaries and source-backed profile metadata. Produce normalized jobs/applications, pending reviews, availability/freshness, automation safety and mailbox connection/sync-status metadata. Do not read OAuth caches, message bodies or verification codes. Do not authenticate or synchronize email as a side effect.

Start with pure functions over parsed input and a read-only file adapter honoring existing data-root/tracker overrides. Proposed future module/schema paths are design choices to review, not files created in this audit. Reuse existing parsers and resolvers rather than regex-copying them. Preserve original source IDs, scales, states, overrides and evidence; unresolved links stay explicit. Surface the current verification-required attempt as a blocker, not an open browser or a submitted application.

Why first: every proposed module needs consistent identity and evidence, and the most immediate dashboard defect is incomplete visibility across the current two data paths. This task improves integration without risking submissions, migrations or credentials. It also gives Outlook observations a safe place in the platform before adding more automation.

Deliverable for review: schema, source-authority matrix, mapping fixtures, deterministic projection and documented query contract. A dashboard route/UI and the hybrid cloud vertical slice follow this contract milestone; see §15. The lightweight continuity files in §16 should be bootstrapped alongside M1 only after explicit approval, not created during this audit. No new dependency or infrastructure should be needed for the initial projection; a future schema-validation package needs its own evaluation.

## 14. Testing and acceptance criteria for M1

Tests must use fictional fixtures or disposable scratch data and must not invoke live ATS, Graph, OAuth, AI or Playwright. Do not run migration/sync commands against personal sources.

| Acceptance area | Required evidence |
|---|---|
| Read-only behavior | Snapshot inputs before/after and prove byte-identical sources. Assert no profile/résumé/history/policy/credential writes and no directory creation by read queries. No child-process/network/browser/token-refresh capability in the adapter. |
| Identity | Tracking-query variants map consistently; meaningful `gh_jid` and different requisitions remain separate; mirrors/reposts retain provenance. Company-title collisions and multiple legacy rows remain unresolved rather than guessed. |
| State/proof | Prepared/Awaiting Approval/Needs Information never count as Submitted/Applied. HTTP 428 and uncertain dispatch remain blocked. A source's Submitted label without adequate receipt is not upgraded to confirmed. Assessment/Hired/Discarded mappings preserve original meaning. |
| Source precedence/conflicts | Contradictory profile values, reviewed vs automatic scores and tracker/JSON status discrepancies produce warnings with locators, not silent overwrites. Unknown facts stay unknown. |
| Schemas | Valid and invalid fixtures cover required fields, schema versions, enums, null/unknown distinctions, bounded outputs and forbidden secret-bearing fields. Reject malformed sources distinctly from absent optional files. |
| Paths/security | Honor CAREER_OPS_ROOT/DATA_DIR/TRACKER/profile overrides and symlink semantics already defined by core; no reading outside allowed source paths or secret-cache directories. Test filenames/Markdown/URLs as untrusted content. |
| Email | Fixtures include receipt/interview/assessment/rejection/follow-up observations and unresolved/duplicate matches. Codes, raw subjects/bodies, token/cursor material and sender-sensitive diagnostics must be absent from projection and logs. No code-use action or status change is inferred. |
| Freshness/consistency | Report source revisions/observed times and incomplete scan/sync windows. Detect a source changing during a multi-file read using a bounded retry or explicit inconsistent-snapshot warning. Output ordering and identity are deterministic. |
| Counts/analytics | Count unique jobs and applications separately. Preserve score scale/method. Empty denominators return unknown/not-applicable; no invented response rate, interview outcome or readiness percentage. |
| Safety/time | Kill-switch and submission-permission values are observed unchanged. Missing time budgets remain unset. The projection cannot enable autonomy or launch overdue tasks. |
| Integration | Reuse/parity tests for tracker parsing, URL/state mapping, legacy layouts and data-root overrides. Both CLI consumers and later web adapters must consume the same contract. |
| Regression gate | After implementation approval, run relevant core/projection tests; later web work adds typecheck/build, API contract and fixture-only browser tests. Record exact results and skips at that time. Do not treat historical pass counts as acceptance of new code. |

M1 is accepted only when the same fixture corpus produces one deterministic, source-explainable overview across CLI and future web consumers without changing any canonical record or making an external call. Implementation, mailbox connection and all further application actions await explicit approval.

## 15. Hybrid AWS hosting evaluation and deployment design

### 15.1 Confirmed target and observed compatibility constraints

The user has specified an AWS-hosted responsive dashboard/PWA, authenticated APIs and cloud-hosted career data/analytics, paired with local Windows/WSL workers for Codex, browser automation and document generation. The dashboard must remain available while the computer is off; local-only tasks may wait for reconnection. Lightweight jobs may move to AWS later. These requirements supersede a local-only deployment preference; they do not authorize provisioning or submission automation.

**Existing implementation:** the local web app and file/CLI engine described above. **Not implemented:** AWS deployment, Cognito login, cloud API/data adapters, worker enrollment/transport, cloud task authority, cloud Graph cache, or a PWA lifecycle. No manifest/service-worker implementation was found in the checked conventional web paths. Existing responsive components are reusable, but mobile/offline/installability still need testing.

Important source constraints:

- [Home](../../web/src/app/page.tsx) is force-dynamic and reads local applications/reports; [career-ops.ts](../../web/src/lib/career-ops.ts) imports filesystem readers/writers.
- [Run route](../../web/src/app/api/run/route.ts) and [stats route](../../web/src/app/api/stats/route.ts) launch local processes. Local apply sessions own live browser objects in memory.
- [next.config.mjs](../../web/next.config.mjs) does not configure a static export. A static Next.js build cannot preserve runtime filesystem access, server routes and dynamic server behavior unchanged. Reuse components and pure logic while replacing the data boundary for a cloud-capable slice. [Next.js static-export limitations](https://nextjs.org/docs/app/guides/static-exports).
- The existing same-origin/loopback guard is appropriate for the local application; it is not authentication for a public AWS service. Keep the local worker/CLI endpoints private.

### 15.2 Comparison with simpler alternatives

Costs below are planning scenarios for a single-user low-traffic application, not vendor quotes or a reason to skip security work. See §15.7 for assumptions and exclusions.

| Alternative | Availability and reuse | Cost/operations trade-off | Recommendation |
|---|---|---|---|
| Existing local app with VPN/tunnel | Maximum current reuse; remote access only while computer and local server run. | Lowest new infrastructure, but does not satisfy always-available dashboard/data. A tunnel also needs an authentication review. | Retain as development/worker UI, not the target hosted dashboard. |
| One Lightsail VM, existing Node app and file/SQLite storage | Cloud dashboard can run continuously; fewer application-boundary changes initially. Browser/Codex work can remain local. | A 2 GB Linux/IPv4 bundle is listed at $12/month; 4 GB at $24, before backups/optional services. Patching, process supervision, HTTPS, identity and restore are owner responsibilities. The $5 0.5 GB plan is not a validated fit for this Next.js app. [Bundle pricing](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html). | Reasonable fallback if minimizing initial refactoring outweighs ongoing server maintenance. Do not expose current command routes as-is. |
| Managed Next.js hosting, e.g. Amplify, plus cloud data and local worker | Preserves more server-rendered UI; managed build/deploy and no VM patching. Local filesystem/process features still require adapters. | At illustrative 200 build minutes and 5 GB delivery, build/delivery alone are about $2.75 gross, plus storage/SSR/backend. A small deployment might be roughly $5–15/month, but cannot be quoted until compatible. [Amplify prices](https://aws.amazon.com/amplify/pricing/). | Evaluate in the hosting spike. AWS currently explicitly documents native Next.js 15 support, while this repo declares 16.4.1; support for this exact version/features is unverified. Do not silently downgrade or claim compatibility. [AWS SSR support](https://docs.aws.amazon.com/amplify/latest/userguide/server-side-rendering-amplify.html). |
| AWS static dashboard shell + authenticated HTTP API/Lambda + DynamoDB/S3; local worker via API | Dashboard/data stay available independently of worker. Reuses React components, pure models, parsers and local engine through adapters; requires an explicit data/API split. | Very low idle infrastructure cost and no VM patching. More initial integration than lifting a server. Modelled base services approximately $2–7/month; budget $5–10 with headroom, before custom domain/AI (§15.7). | **Preferred long-term target**, provided a small hosted read-only slice passes compatibility/security tests. Do not convert every existing page at once. |

Recommendation weighs human maintenance time as well as the bill. First deliver a cloud read-only overview, reusing the existing component/design system and M1 contract; continue using the local app for complex editing/workflows until their command interfaces are safely adapted. If a small managed-SSR compatibility spike proves less effort without introducing unsupported adapters, it can replace only the dashboard-hosting layer. The API, event/identity contracts, security boundaries and worker design remain the same.

### 15.3 Evaluate the requested AWS services individually

| Service | Proposed use | Necessity / reason |
|---|---|---|
| S3 | Private document artifacts and versioned exports; static app build if static hosting selected. Separate public shell from private career data. | Good fit. No public bucket, no credentials or personal JSON in frontend assets. Large documents/descriptions belong here rather than in database rows/queue messages. |
| CloudFront | TLS/CDN for static shell and optionally routed API paths. Restrict S3 origin with OAC. | Appropriate for S3-hosted dashboard; may be managed by hosting alternative. OAC protects the origin, not end-user access to a public distribution. [OAC documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html). |
| Cognito user pool | Owner sign-in, MFA/passkey options where supported, access-token issuance and controlled session renewal. Separate dashboard and worker app clients/scopes. | Recommended rather than writing an auth system. Do not add an identity pool merely to give the browser database or queue credentials. Graph consent remains separate. |
| API Gateway HTTP API | Authenticated queries/commands and worker claim/report endpoints; JWT authorizer plus application-level authorization. | Good fit. Prefer HTTP API over REST API unless a required capability justifies REST's different cost/features. [JWT authorizer guidance](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html). |
| Lambda | Short API handlers, projections, bounded parsing, mail sync/renewal and small scheduled tasks. | Recommended for lightweight work. Do not transplant long CLI/browser sessions into request handlers. Standard functions have a 900-second timeout; specialized managed-instance features are not needed for this design. [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html). |
| DynamoDB on-demand | Cloud job/application projections, cloud-owned task/review records, events/idempotency and worker state with conditional version updates. | Fits low-traffic operational queries and no managed-server overhead. Do not presume it replaces all Markdown or relational analytics. Define access patterns before keys/indexes; avoid whole-table scans per page. |
| SQS Standard + DLQ | Optional cloud-owned work dispatch/wake-up hints, especially after multiple workers or cloud task consumers exist. | **Defer initially.** One worker can claim durable tasks through the API/database with equivalent lease/idempotency semantics. Add SQS only when it simplifies measured scheduling/fan-out needs. Queue ordering/delivery cannot establish exactly-once employer submission. |

Support services only when justified: AWS-managed encryption defaults, Secrets Manager for a future cloud MSAL cache, optional customer-managed KMS key, CloudWatch with short retention/alarms, and EventBridge Scheduler for short cloud tasks. Avoid NAT Gateway, load balancers, RDS/OpenSearch, Redis, always-on containers, Step Functions and WAF subscriptions by default; assess actual requirements and current CloudFront-plan inclusions first. Adding all available services is not the objective.

### 15.4 Target architecture diagram and ownership

```text
Desktop / mobile browser (responsive dashboard; optional installable PWA)
   | HTTPS shell                       | OAuth authorization code + PKCE
   v                                   v
CloudFront -> private S3 app build    Cognito owner authentication
   |
   +-- authenticated access-token requests --> API Gateway HTTP API
                                                |
                                     Lambda query/command handlers
                                       |          |              |
                                  DynamoDB     private S3     task claim/result API
                               cloud records   documents             ^
                               events/tasks    + exports             | outbound HTTPS
                                       |                             |
                            [optional SQS/DLQ hints]          Windows/WSL local worker
                                       |                     - existing CLI/Codex
                          optional scheduled Lambda          - fresh Playwright sessions
                          - bounded public discovery         - PDF/document generation
                          - read-only Graph sync             - local fact/document approval
                                       |
                          MSAL cache in Secrets Manager
                                       |
                          Microsoft Graph, delegated Mail.Read

Local worker offline: dashboard/API/data remain available;
local-capability tasks remain durably pending, with last heartbeat shown.
No inbound connection, open browser debug port or public local server required.
```

The cloud data requirement needs a deliberate authority transition:

1. **Read-only cloud slice:** existing local canonical files/ledger remain authoritative. Publish versioned, redacted snapshots/events to cloud storage through an authenticated exporter; show last sync and revision. Cloud records are hosted read models, never a fake claim of fresh local results. Do not enable cloud editing of the same fields yet.
2. **Cloud command introduction:** cloud owns task intents, review requests and owner preferences explicitly assigned to it. Local workers own execution evidence/artifacts. Every command names an expected aggregate revision and idempotency key; no unrestricted bidirectional file mirroring.
3. **Selective cloud authority:** only after an approved migration, cloud becomes canonical for selected jobs/applications/events. Local Markdown/TSV become compatibility projections for those fields, while verified career facts/documents keep their explicit approval path. Read/write adapters feed existing engine commands; direct edits that conflict are quarantined for reconciliation.
4. **Offline operation:** allow queued local evidence/events with durable outbox IDs and source revisions. Reconnect uploads idempotently; stale cloud/local edits produce conflicts, not last-write-wins or automatic overwrite. A cloud-only dashboard cannot fabricate the result of offline local work.

Logical storage design: use owner-scoped job/application/task/event keys and status/due-date indexes chosen from actual query needs; use conditional writes/transactions for claim/version changes. Keep immutable snapshot/document hashes in references. Store large artifacts in S3, build queryable summaries separately, and recompute funnels from accepted events with cohort rules. No PII or message bodies in static builds or indexes. SQLite remains useful locally and for rebuildable analysis; do not synchronize SQLite files over S3 as the live multi-device database.

### 15.5 Secure outbound worker protocol and approval invariants

Proposed task lifecycle:

```text
queued -> leased -> running -> waiting_for_information / waiting_for_approval
                           -> succeeded / failed / cancelled
                           -> reconciliation_required (uncertain external effect)
```

The task state is distinct from application lifecycle; a successful prepare task is not a submitted application.

- Enroll a worker through owner approval. Authenticate through a dedicated public OAuth client with PKCE, narrow API scopes, revocable device registration and short-lived tokens. Store renewal material in Windows Credential Manager or an approved WSL/Linux vault. No hardcoded AWS access keys, Cognito client secret or Graph refresh token in worker source. Any direct SQS access later needs a separately justified short-lived IAM credential design; the initial API broker avoids it.
- API handlers verify token issuer/audience/scopes, permitted owner and worker registration; scopes alone do not establish resource ownership. Dashboard users cannot submit arbitrary shell strings, filesystem paths or code. Tasks reference a fixed allowlist of typed commands and approved input/artifact hashes; worker grants capabilities independently.
- Claim with conditional version updates and an opaque lease token; heartbeat and renew within bounds. On reconnect, reconcile previous attempts before accepting new sensitive work. Process shutdown/sleep/WSL termination are expected failure cases.
- Offline tasks remain in DynamoDB until cancellation/expiry by domain policy, even if queue hints expire. SQS retains messages for at most 14 days, so SQS must not be the only durable task ledger. Visibility timeout is bounded (up to 12 hours); long waits for human approval should release the task lease into a waiting state, not keep extending forever. [SQS retention](https://aws.amazon.com/sqs/faqs/), [visibility limits](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/best-practices-processing-messages-timely-manner.html).
- Standard delivery, API retries and lease recovery are at-least-once. Enforce idempotency and duplicate requisition checks in the durable ledger immediately before external actions. A dispatch with uncertain acceptance enters reconciliation_required; no retry merely because a queue message is redelivered. FIFO deduplication would not make employer submissions exactly once.
- Final approval grants bind owner, application/requisition, plan/profile/policy/document hashes, exact capability, expiry and task generation. A queue record or mobile tap is not itself permission for an altered application. Revalidate job liveness and required answers when executing, because a task can wait days offline.
- Effective permission is the intersection of cloud policy, local policy and exact grant. Either kill switch blocks new sensitive actions. Loss of connectivity/policy freshness before dispatch fails closed. Revocation cannot undo a request already sent; display that limit. Do not re-enable current switches during transport development.
- Mobile approval of an expired/closed browser preparation should request fresh preparation rather than execute stale session tokens. Preserve CAPTCHA/security restrictions and résumé integrity checks.

Use adaptive outbound polling for one worker with a quiet idle cadence and immediate checks after user-triggered work; do not keep a Lambda request open waiting for a PC to appear. Add server-side SQS dispatch only with durable task/outbox publication and tested duplicate/recovery handling. Broker-owned queue message bodies contain task IDs, not private answers, codes or credential payloads.

### 15.6 Graph integration, PWA and cloud security

**Graph placement:** start by retaining the existing local delegated OAuth cache and syncing only redacted observations; this does not process new email while the PC is off. When independent mail freshness becomes required, add a cloud-only MSAL token-cache owner with explicit new consent/setup. Its OAuth callback is an exact authenticated HTTPS server flow with state/PKCE, not the existing loopback callback copied into Lambda. A server-client credential, if required by the chosen registration, also stays in Secrets Manager. Evaluate registration/flow behavior before selecting a final scheme.

Do not allow local and cloud processes to refresh the same cache concurrently. Give the Graph sync service sole cache ownership and serialized renewal. Store encrypted refresh-capable MSAL cache material in Secrets Manager (or a reviewed envelope-encrypted alternative), restrict decrypt/read access to the mail worker role and suppress cache/provider contents in logs. The browser/normal local task worker receives neither access nor refresh tokens. Cognito app login is not Microsoft Mail.Read authorization.

Cloud mail sync can populate receipt/interview/assessment/rejection evidence while local automation is offline. It must not use a verification code if no current approved browser/attempt context exists. Keep code values transient and outside DynamoDB, S3, SQS, CloudWatch and normal task result payloads. Initially retain human entry; any future cloud-to-local code handoff needs an explicitly approved, authenticated short-lived session channel and human code-use approval. Never enqueue an OTP for later use when a sleeping PC reconnects. Polling remains the default until webhook latency/operations are justified; a future Graph webhook is a narrowly validated public route, not an unauthenticated career API.

**PWA:** reuse responsive React views and add manifest/install metadata later. Cache only the app shell by default; no personal API responses, profiles, PDFs, email, signed URLs or tokens in service-worker caches. Serve personal data with no-store, clear in-memory state on logout and mark stale data/worker offline states. A cloud-connected phone can browse current cloud data while the PC is off. True phone-offline personal-data storage is a separate opt-in encryption/retention design, not assumed PWA behavior. Background sync must never silently replay submission approvals or applications.

**Identity/API:** private single-owner sign-up policy, MFA as supported, scoped access tokens, short sessions and refresh rotation. Authorize every record/artifact server-side; private S3 and OAC do not replace user authorization. Avoid long-lived browser localStorage tokens where practical; choose and threat-model in-memory/managed-session renewal or a BFF with HttpOnly Secure SameSite cookies. A BFF needs CSRF protection and changes the static-hosting/auth shape; settle it in the auth spike. Never use an ID token as a general API capability. [Cognito security guidance](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-security-best-practices.html).

**Data/deployment:** encrypt at rest and in transit, least-privilege roles, owner-prefixed object access, short-lived signed artifact URLs, file-type/size/hash validation and safe content-disposition. Avoid CDN caching private responses. Redact request bodies, authorization headers, signed URLs, source messages and browser diagnostics. Apply finite log/artifact retention, private backups, restore tests and deletion/export rules. Use separate deployment credentials/roles from runtime workers; a later Git-based deploy pipeline should use short-lived identity rather than committed keys. Do not publish personal checkout files in a build artifact. Retain existing tests and add cloud auth/ownership/negative tests before exposure.

**Operational scope:** reserve Lambda/API concurrency, throttle API routes, cap scans/mail pages and model calls, set cost alerts and observe sanitized run/lease/error metrics. Billing alerts are not spending hard stops; no $0 guarantee follows from free tiers. Avoid a VPC/NAT unless access to a genuinely private resource requires it. A DynamoDB/S3/Graph Lambda can ordinarily use managed public endpoints without an always-on NAT.

### 15.7 Estimated operating-cost model

Planning date: 2026-11-06. Reference region: **US East (N. Virginia)** for regional services; user region/account/discounts are not selected or verified. USD/month, taxes excluded. This is a transparent workload model, not an AWS account quote. No AWS account or resource was accessed. AWS pricing pages include dynamic regional tables; allowances marked as estimates below must be re-priced in the AWS calculator before any deployment approval.

Assumed light personal workload: one monthly active owner; 100,000 authenticated API/worker checks per month; 100,000 short Lambda calls at 256 MB and 200 ms (5,000 GB-seconds); 200,000 DynamoDB read units and 50,000 write units including expected index amplification; 1 GB database data; 2 GB artifacts/versions in S3; 5 GB frontend delivery and 100,000 CDN requests; limited logs/backups; at most two secrets. These are assumed utilization volumes, not observed project metrics. Larger items, transactional reads/writes and indexes consume more units; full-table scans and frequent polling can invalidate them.

| Component | Calculation or planning allowance | Estimated monthly cost |
|---|---|---|
| API Gateway HTTP API | 0.1 million × $1.00/million at the published first tier. [Pricing](https://aws.amazon.com/api-gateway/pricing/). | $0.10 gross |
| Lambda | 0.1 million × $0.20/million + 5,000 GB-s × $0.0000166667. No provisioned concurrency. [Pricing](https://aws.amazon.com/lambda/pricing/). | About $0.10 gross; eligible recurring allowances may lower this |
| DynamoDB Standard on-demand | 0.2 million read units × $0.125/million + 0.05 million write units × $0.625/million + 1 GB × $0.25. [Pricing examples](https://aws.amazon.com/dynamodb/pricing/). | About $0.31 gross; no transactional overages included |
| S3 artifacts, versions and requests | Small storage/GET/PUT allowance; exact operation mix/region still to price. [Pricing](https://aws.amazon.com/s3/pricing/). | $0.10–0.30 planning allowance |
| CloudFront | Current pay-as-you-go FAQ includes 1 TB transfer and 10 million HTTP/S requests monthly across the account; model fits if allowance available. Distinguish this from the separate $0 flat-rate plan and its own quotas/features. [FAQ](https://aws.amazon.com/cloudfront/faqs/), [flat-rate plan](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html). | $0 under that recurring allowance; reserve up to $1 for unpriced delivery/plan differences |
| Cognito owner login | Current Essentials direct/social free tier covers 10,000 MAU; single-owner direct login fits if applicable. Published overage $0.015/MAU is not an SMS, M2M or enterprise-federation quote. [Pricing](https://aws.amazon.com/cognito/pricing/). | $0 under applicable allowance; exclude SMS/M2M/advanced extras |
| Secrets Manager | One–two secrets × $0.40 + a few API reads; cloud Graph-cache phase only. [Pricing](https://aws.amazon.com/secrets-manager/pricing/). | $0.40–0.85 when enabled |
| KMS | Managed service defaults may avoid a separate key fee; an optional initial customer-managed key adds about $1/month plus requests/rotation costs. [Pricing](https://aws.amazon.com/kms/pricing/). | $0–1.05 baseline allowance; re-price rotation/history |
| Logs/alarms | Low-volume sanitized logs, short retention and a few simple metrics/alarms. No full browser/network trace ingestion. [Pricing](https://aws.amazon.com/cloudwatch/pricing/). | $0.30–1.00 planning allowance |
| Backup, scheduler, API/worker egress and miscellaneous requests | Explicit reserve; exact retention, schedule cadence and network volumes unresolved. | $0.40–1.20 planning allowance |
| SQS | Not required initially. Standard receive/send/delete/visibility/empty receives are billable operations; current recurring free allowance is 1 million requests, shared account conditions apply. [Pricing](https://aws.amazon.com/sqs/pricing/). | $0 if deferred/within allowance; model after enabling |

The combined illustration is approximately **$2–7/month**, depending on optional secrets/keys and actual allowances; **budget $5–10/month** for an initial low-volume deployment rather than promising a zero bill. This excludes custom domain registration/DNS where not bundled, AI/API subscriptions, paid question content, local electricity/Internet, Git build-minute overages, taxes and any future public webhook hosting arrangement. Optional domain/DNS can push a small bill into roughly $7–15/month; exact domain quote is unresolved. Initial read-only cloud hosting without cloud mail/cache should be cheaper than the full model.

No temporary new-account credits are needed for the estimate. Recurring service allowances are shown explicitly and may already be consumed elsewhere in the account. CloudFront's current flat-rate Free plan may bundle additional features/credits; verify its limits and origin/security compatibility rather than mixing that plan with pay-as-you-go allowances. Model Amazon API Gateway/Lambda/DynamoDB gross amounts even when discounts could reduce them. Reassess at 10× traffic: request/compute charges remain modest at these short durations, but model calls, scans, artifacts, logs and uncontrolled unauthenticated traffic can dominate.

Before provisioning: choose region/retention/account plan, produce a calculator estimate with item sizes/indexes/backup/egress/build assumptions, decide monthly budget alerts and test negative API authorization. Model the simpler Lightsail and compatible managed-SSR alternatives with the same data/auth/backups; service count alone is not cost. Cost ceilings and task controls must also protect the user's time, not just AWS spend.

### 15.8 Incremental hybrid deployment plan and acceptance gates

| Stage | Proposed work after explicit approval | Acceptance before advancing |
|---|---|---|
| H0 — contracts and hosting spike | M1 projection plus §16 continuity bootstrap; inventory filesystem/process coupling; compare a reused static overview against compatible managed SSR in a disposable fixture build. | No personal data in assets; schema parity; supported runtime/hosting path documented. No automatic cloud provisioning during this audit. |
| H1 — always-available read-only dashboard | Approved minimal AWS shell/auth/API/cloud projection; versioned local exports and last-sync status. Choose IaC/deployment tool later; CloudFormation fits existing skills but is not selected/created here. | Phone/desktop login and authorization tests; PC-off read access; backup/restore and cost visibility; public cannot read records/artifacts; local controls unchanged. |
| H2 — outbound worker task slice | Enroll one Windows/WSL worker; durable API-claimed tasks, leases and result/outbox upload. Begin with harmless fixture/pure discovery tasks; no submission capability. | Offline queued tasks survive more than queue retention; sleep/crash/replay/duplicate/version tests; revoke worker and prove it cannot claim. |
| H3 — controlled cloud writes | Select field/domain ownership and migrate a small command path with expected-version checks and compatibility projections. | Local/cloud conflict and rollback tests; no last-write-wins facts or double writes. Cloud dashboard useful with PC off, writes either accepted cloud commands or clearly queued local intents. |
| H4 — cloud lightweight jobs / Graph | Move bounded discovery or read-only mail delta sync only after deterministic tests and explicit mailbox consent/storage decision. | Token renew/revocation/backfill/throttle tests, no mailbox mutation/code leak; fresh mail evidence available while PC off. Local verification sessions still require a running worker. |
| H5 — native verification workflow | Session preservation and human-approved code handling from M5; evaluate safe ephemeral transport only if needed. | Exact app/recipient/sender/time/session proof, no persisted codes, manual/security-challenge fallback and verified receipt recovery. No autonomous submissions implied. |
| H6 — optional simplification/expansion | Add SQS, webhook wakeups or additional cloud jobs only if operational evidence justifies them. | New service reduces measured complexity or latency; limits, costs and failure recovery documented in an approved ADR. |

Still requiring user decisions: region, desired budget, optional domain, acceptable cloud storage of career documents and raw evidence, cloud Graph cache vs local-only cache at first, and supported Windows/WSL credential-vault behavior. The user has already chosen hybrid/cloud availability; do not ask again whether the target should simply remain local-only. Implementation and provisioning remain gated by a separate approval.

## 16. Long-term AI development and context continuity

### 16.1 Observed starting point and gaps

The repository already has extensive [AGENTS.md](../../AGENTS.md), a scoped [web/AGENTS.md](../../web/AGENTS.md), thin `@AGENTS.md` wrappers in [CODEX.md](../../CODEX.md)/[CLAUDE.md](../../CLAUDE.md), [ARCHITECTURE.md](../../ARCHITECTURE.md), the data contract, mode documents, tests and this audit. These are useful foundations, not a durable Career Central product/backlog/handoff system. No dedicated Career Central product specification, ADR series, active-task contract or compact session-state entry point was found in the inspected documentation inventory.

A concrete context issue: current root AGENTS.md is **94,638 bytes**. Current official Codex guidance documents a default combined project-instruction budget of 32 KiB, with instructions gathered along the project-to-working-directory chain. Thus a fresh session may not receive the entire existing root file under default settings; actual configured limits were not inspected. Appending important project rules at the end is not a reliable fix, and nested files alone do not solve an already exhausted root budget. [Official OpenAI AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

`plan/` is gitignored, and private `modes/_custom.md` preserves personal house rules. Neither is a suitable sole home for a version-controlled shared product roadmap. The updater classifies root AGENTS.md as system-owned, so fork-specific pointers or instructions can be overwritten during an upstream update; continuity design must account for that explicitly. See [update manifest](../../lib/update-manifest.mjs) and [data contract](../../DATA_CONTRACT.md).

### 16.2 Proposed lightweight documentation map

All paths in this table are **proposed**, not created by this audit. Use ordinary Markdown and Git in this repository; no external knowledge-management service or automatic vector-memory store is needed.

| Proposed artifact | Purpose, owner and update trigger |
|---|---|
| `docs/career-central/README.md` | Central start-here page: product summary, reading order, relevant module links, active task and recent verified state. Keep it small enough to load every new session. |
| `docs/career-central/PRODUCT.md` | Stable vision, users, module requirements with IDs, non-goals, privacy/time/automation constraints and measurable outcomes. Record the hybrid hosting/always-available requirement explicitly. User approves material product changes. |
| `docs/career-central/ARCHITECTURE.md` | Concise accepted architecture/data ownership/interface overview and links to ADRs. Link this audit as discovery evidence; do not require every session to read the full audit or treat proposals as accepted decisions. |
| `docs/career-central/STATUS.md` | Verified feature-state table with source/test evidence, environment/commit/date, limitations and next validation. One factual current-state authority, separate from aspirations. |
| `docs/career-central/ROADMAP.md` | Milestone order/dependencies and small prioritized backlog with task IDs, links, status and owner. Not a copy of every task's implementation notes. |
| `docs/career-central/tasks/CC-###.md` | One active-task specification per meaningful slice: problem, scope/non-goals, dependencies, allowed files/resources, interface/security impacts, acceptance tests, approval boundaries and completion evidence. |
| `docs/career-central/decisions/####-topic.md` | ADRs: context, alternatives, chosen/proposed decision, rationale, consequences, status and links. Supersede decisions explicitly; do not edit history to imply a discarded choice never existed. |
| `docs/career-central/HANDOFF.md` | Compact latest session handoff, updated in place; Git keeps prior versions. Include task/commit, changes, test results, blockers, pending permissions and precise safe next step. No endless chat transcript. |
| Module README/interface contracts beside actual modules | Only where useful: responsibilities, data ownership, input/output schemas, failure/retry/idempotency/privacy rules and tests for email, application, worker, data adapter and web boundaries. Link to shared invariants rather than duplicate them. |

Start with the entry point, PRODUCT/STATUS, one active task, a short roadmap and handoff; add an ADR for each consequential decision and module docs when those interfaces are touched. This map defines responsibilities, not a requirement to generate a large empty documentation tree. The first approved documentation task should seed it from verified source evidence and user decisions, not conversational guesses.

### 16.3 AGENTS.md strategy without instruction duplication

- Keep a single root instruction authority and the existing wrappers; do not fork separate competing Codex/ChatGPT/Claude rulebooks. An `@AGENTS.md` wrapper in a file does not prove every external chat automatically loads it.
- In a later approved edit, put critical safety/data-contract rules and the Career Central start-here pointer near the top. Carefully modularize the long root document into linked operational references and scoped instructions while preserving enforceable safety rules. Do not blindly truncate it, create an override that shadows it, or remove upstream rules to fit a budget.
- Root instructions should describe development behavior: inspect source/state first; honor task scope; preserve user work; do not invent facts/test outcomes; use real contracts; protect secrets; keep approval/kill gates; update STATUS/HANDOFF with evidence. They should not contain the résumé, mailbox address, real codes, production tokens, long product history or the task backlog.
- Preserve scoped web instructions. Add module-specific AGENTS files only when instructions truly differ, with clear inheritance and no duplicated product narrative. Explicitly read a module's referenced contracts when working there; automatic discovery depends on invocation directory/tool behavior.
- Treat project AGENTS changes as version-controlled fork changes with review. Before upstream updates, preserve/rebase the small project-entry patch or adopt a deliberately tested overlay strategy; validate afterward that the root still links the correct entry point and critical rules remain early. Do not put new project documentation under updater-owned paths without deciding ownership. Personal procedural overrides may remain in the private user layer, but cannot be the only shared project instructions.
- Add future CI checks for broken start-here/task/ADR links and instruction-size/read-order risks; code/policy tests enforce security invariants. Documentation is guidance, not a substitute for runtime authorization or proof that a submission is permitted.

### 16.4 Verified current state, task specifications and ADRs

Use independent evidence dimensions instead of a single misleading done checkbox:

```text
Feature ID | implementation: absent / partial / implemented
           | validation: untested / fixture / integration / live
           | deployment: local / staging / production / not deployed
           | source paths + test command/result + tested commit/date
           | limitations + next action + review/approval requirement
```

Example wording for existing Outlook functionality: implemented read-only adapter; synthetic OAuth/Graph tests; no live mailbox consent/retrieval validated; not deployed; sender authenticity/code entry/delta sync incomplete. Do not promote a planned API to implemented because an architecture paragraph or endpoint name exists. A test at commit A does not automatically certify later commit B; record relevant source revisions and distinguish not-run, skipped, failed and passed. Use synthetic examples rather than private message/application content in shared STATUS.

Task spec minimum: requirement IDs; objective; current source evidence; dependencies; precise in/out scope; allowed data/resources and side effects; interface/schema changes; privacy/security/duplicate/recovery constraints; test and acceptance criteria; rollback/reconciliation plan where needed; status and evidence. `ready`, `in_progress`, `blocked`, `review`, `done` describe development work, not user application states. Approval to develop/provision/read email/use a code/submit are separate actions and cannot be bundled implicitly into a task label.

Initial proposed ADR topics: hybrid hosting vs simpler options; local/cloud data authority and migration; API-brokered worker identity/lease protocol; static shell vs supported SSR host; read-only Graph sync/credential custody; confirmation and verification approval boundaries. Mark them Proposed until the user approves the actual decision. The user's hybrid preference is a confirmed requirement, not blanket approval of every AWS service or cost.

### 16.5 Compact session handoff and ChatGPT/Codex coordination

Recommended fresh-session reading order:

```text
AGENTS.md + applicable scoped instructions
  -> docs/career-central/README.md
  -> STATUS.md + HANDOFF.md
  -> active CC-### task + only its relevant ADRs/contracts
  -> git status/diff + actual affected code/tests
  -> continue the authorized task; ask only for genuinely missing decisions
```

Target handoff is roughly one screen to two screens, not a hard token-dependent limit. Record:

- UTC date, branch/base commit and working-tree state, including uncommitted work belonging to the user or another session.
- Active task and the concrete changes/source paths; separate implemented, tested, live-validated and merely planned.
- Exact validation commands, pass/fail/skip counts, commit/environment and remaining coverage. Never claim tests ran from a remembered prior chat.
- Current blocker/error class and recovery status; safe next action, required input and pending explicit approvals. Do not paste tokens, codes, real email bodies, application answers or private logs.
- Decisions changed/ADRs proposed and anything the next session must avoid repeating, especially external actions with uncertain outcomes. Reference the private operational ledger by path; do not copy its contents into public development notes.

ChatGPT can help clarify product requirements, compare designs, draft task specs and review sanitized diffs/evidence. Codex works from the same task and repository sources to inspect, implement and test when authorized, then updates STATUS/HANDOFF/task evidence. Neither should infer the other's unsaved chat context. When ChatGPT has no repository access, provide the compact entry point/status/handoff/task and relevant sanitized contracts/diff explicitly; do not assume automatic access, shared memory or background synchronization.

The coordination loop is requirement/decision -> task contract -> inspected implementation/test -> reviewed diff/evidence -> current state/handoff. Persist consequential approved decisions promptly in Git; a speculative discussion remains a proposal. Do not let a generated handoff launder an unverified personal fact or unsupported test claim into source truth. Avoid simultaneous edits of the same module/task from independent sessions; if concurrent work is explicitly authorized, use separate branches/worktrees, file ownership and a reviewed merge with refreshed tests.

### 16.6 Version control, privacy and documentation freshness

Keep project code, sanitized fixtures, schemas, requirements, ADRs, task specs and handoffs version-controlled. Keep personal career records, résumés, live job/application answers, mailbox content, production observations and OAuth/worker credentials in their existing private data/secret layers. A private repository still does not justify committing secrets. The public/shared documentation may describe field names, protected paths and general failure modes; real evidence stays in an access-controlled store with references redacted as needed.

Use task IDs in focused commits/PRs; pair behavior changes with the affected STATUS/interface/handoff changes. Record milestone acceptance against a commit/PR and tag only a reviewed milestone when authorized; no automatic commit/push/release is implied. Git history stores past handoffs/ADRs without a separate transcript archive. Use ordinary Git diffs, not a synchronization bot or new knowledge platform.

A later lightweight documentation check should validate local links and task/ADR references, ensure active tasks have acceptance criteria, and flag changes to module contracts without matching state/docs review. Treat these as review aids, not brittle requirements to edit every document on every commit. Source/tests and actual runtime evidence outrank stale summaries; conflicting documentation becomes a recorded repair task, not authority to overwrite working code or user facts.

### 16.7 Revised first milestone and approval boundary

Keep M1's read-only canonical projection as the first code milestone, with a small **documentation bootstrap** immediately before or alongside it after approval. Add hybrid worker/cloud ownership fields to the contract without provisioning anything. Seed the active task from §13–14; document the hosting compatibility spike and Graph-hardening prerequisites as subsequent tasks. Validate that a fresh session with only the committed start-here/state/task material can identify the correct repository, current limitations, safe next step and approval boundaries without previous chat history.

Only this audit document has been updated for these requirements. No proposed continuity files, AGENTS restructuring, ADRs, cloud resources, dependencies, worker transport, mailbox access or application features were created. The next action is user review and explicit approval of a bounded implementation task.
