# Verified project state

## Five-employer baselines complete; CC-017 C0 integrated — 2026-11-11

- **Stripe:** its single scheduled retry ran at 23:27:42 UTC and succeeded: 785 postings, all `baseline`, first-seen equal to the live checkpoint (ETag recorded), 0 alerts and 0 proposals.
  - Locations are complete: no work-model-only or empty locations.
  - The retry used the inline `offices[]` path, which a same-moment live comparison on Cloudflare had proven identical to the `/offices` endpoint (478/478).
- **All five pilot baselines:** Cloudflare 491, Palantir 304, Scale AI 169, Databricks 912, Stripe 785. Datadog (421) and MongoDB (395) stay configured, outside the pilot.
- **Partition sizes:** the largest is Databricks at 1.64 MiB compact, 55 % of the per-source budget.
- **First-seen preserved:** unchanged against the pre-pilot backup for Cloudflare, Datadog and MongoDB, and a single baseline time for each new employer.
- **Integration:** CC-017 C0 and the C1 preparation were fast-forwarded into `career-central/pre-m3d-stabilization`, from `a5848d68` to `3b45c549` (7 commits, no merge commit, no history rewrite). The temporary worktree was removed after verification; branch `career-central/cc-017-c0` is kept.
- **Validation in the integrated checkout:**
  - 460 related Node tests passed (storage contract across file, memory and cloud-shaped stores; cloud concurrency; scheduler including the simulated 7-day run; privacy/redaction; eligibility equivalence), plus lint, typecheck, production build and the job-monitor, job-monitor-cache and career-central browser suites.
  - Read-only comparison: the pre-integration and integrated code produce an identical paginated dashboard view and health for all 181 reviewable postings.
  - Unchanged: application jobs/events, the three email records, profile, policy, CV, tracker and `config/profile.yml`.
- **State:** recurring monitoring is not authorized and no scheduled task is installed. AWS: nothing provisioned, and the cloud adapter has been tested only against fake clients.

## Product vision and documentation alignment — 2026-11-11

This was a documentation-only update; no runtime behavior changed. Added the [ADR 0004](decisions/0004-product-vision-expansion.md) product direction (single-user first, with commercialization out of the near-term roadmap), requirements CC-R19–CC-R24, and authoritative designs in `design/`:
- [Career Identity](design/CAREER_IDENTITY.md)
- [Job Sources](design/JOB_SOURCES.md)
- [Document Intelligence](design/DOCUMENT_INTELLIGENCE.md)
- [Approvals and Autonomy](design/APPROVALS_AND_AUTONOMY.md)
- [Networking and Communications](design/NETWORKING_AND_COMMUNICATIONS.md)
- [Frontend Design System](design/FRONTEND_DESIGN_SYSTEM.md)

It also added the roadmap's 10-step sequence with milestones P1c, P5a and P11, inventory rows F60–F79 (all planned or partial), and the cloud plan's browser execution model (§16, conditional stage C6).

Verified monitoring state when the docs were written:
- Local per-employer store active since migration commit `37b8c6cd`.
- Pilot preparation commits `5f9b6077` and `9c32f8b8`.
- Live baselines: Cloudflare (earlier), Palantir 304, Scale AI 169, and Databricks 912 (a retry succeeded after the response cap was raised).
- Stripe: still pending, recorded as `enrichment_response_too_large`. The inline-offices fix is committed, and a single retry is scheduled after its backoff.
- Reviewable postings: 140 across all configured sources, with two potentially eligible (Databricks new-grad). This supersedes the earlier 133 figure.
- Recurring monitoring not authorized; no Windows task installed.
- 416 related regressions and three browser suites passed at `9c32f8b8`.

## Local recurring-monitoring pilot configured (not activated) — 2026-11-11

Configured Databricks (Greenhouse), Palantir (Lever), Stripe (Greenhouse) and Scale AI (Greenhouse) at 30 minutes, and moved Cloudflare to 30 minutes. Datadog and MongoDB stay configured, outside the pilot. The configured-source cap was raised from 5 to 8, since storage is per source. A pre-pilot backup is at `data/backups/job-monitor-prepilot-20261111T005246Z/` (SHA256SUMS verified).

**Baselines:**
- Palantir and Scale AI: established quietly by one bounded `first-poll` each (≤ 2 GETs): 304 and 169 postings, all `baseline`, 0 alerts and 0 proposals.
- Databricks and Stripe: failed safely, with no checkpoint and backoff. Causes and fixes are in the [runbook](../JOB_MONITOR.md#pilot-databricks-palantir-stripe-scale-ai-cloudflare-configured-2026-11-11-not-activated).

**Eligibility.** The pilot review found two leaks, now fixed with tests: "Team/Tech Lead" titles weren't treated as senior, and Doha/Vilnius and other non-US cities weren't excluded. An offline re-evaluation used the hash-verified baseline text. The shortlist now has 133 reviewable postings (Palantir 73, Cloudflare 18, Scale AI 8, plus the rest); the top 10 are all new-grad roles, with the best score 72 (Palantir Forward Deployed Software Engineer, New Grad – Commercial). None is qualified or high priority: every pilot posting still lacks a verified "never applied" answer for that employer, and most lack an employer start date.

**Deduplication and recovery (rehearsal on a disposable copy of the real data, with replayed real responses).** Fourteen of 14 checks passed:
- Only the five pilot sources were polled.
- Identical feeds produced 0 new, 0 updated and 0 alerts; a 304 was recorded as unchanged.
- An oversized response was recorded as `response_too_large` and backed off for 120 minutes; it was skipped while not due, and the first success afterwards was a quiet baseline.
- One new reviewable posting produced exactly one alert, and none on repeat.
- A crashed worker's lease was respected, then reclaimed after it expired.
- A paused source was never polled, and revoke stopped all polling.

The real data was byte-identical afterwards, and the copy was deleted.

**Health on real data:** scheduler `not_authorized`. Databricks and Stripe are `failing` (`provider_unavailable`, recorded before the new categories). Palantir and Scale AI show `ok_changes` until their next poll, because their baselines were recorded before the baseline flag existed.

**Validation:** 413 related Node regressions passed (72 monitor/scheduler cases). Typecheck/build and the job-monitor, job-monitor-cache and career-central browser suites passed. A read-only real-data dashboard check at 375/1440px showed 100 cards (81 from pilot employers), "Recurring monitoring: not authorized", per-source health, and no writes, external requests, errors or byte changes. The tick wrapper refused without authorization on a copy. No recurring authorization, OS trigger, application, email, push or cloud action.

## Local monitoring-storage migration applied — 2026-11-11

Applied with the user's approval: `npm run monitor -- migrate-store --apply` at 2026-11-11T00:42:24Z, from commit `9e7622c6`.

Pre-flight:
- Clean tree.
- The backup `data/backups/job-monitor-premigration-20261111T003329Z/` matched the live ledger SHA-256 (`fa427de7…`), re-verified immediately before applying.
- No leases, locks, recurring authorization or OS scheduler entries. No process held ledger or monitor files open; leftover PDF-server processes don't reference the ledger.

Result:
- 3 per-employer partitions: Cloudflare 491, Datadog 421 and MongoDB 395 postings (1,307 total), plus an index recording the legacy content hash.
- Ledger 3,610,459 → 242,200 bytes (−93.3%).
- Files are 0600 and directories 0700.

Validation (26/26 checks):
- Monitor content canonically identical.
- Every first-seen timestamp and all three live-feed checkpoints identical.
- No cross-source postings; alerts, proposals and decisions preserved.
- Ledger keeps only `schemaVersion, jobs, events, gmailMailboxHealth, emailInbox, reviewedMailSends`, each identical (56 jobs, 204 events).
- Dashboard read model and health identical (27 needs-review; scheduler `not_authorized`; all sources `ok_no_changes`).
- CV, profile, tracker and discovery cache unchanged.
- 408 related regressions passed.
- A read-only production dashboard check on the real data (375/1440px) showed 27 cards, with no writes, no external requests, no errors and no byte changes.

Recovery remains available: a `rollback-store` dry run reports the full state; the backup is intact.

## Migration readiness, scheduler validation, coverage review, cloud plan — 2026-11-11

**Monitoring storage migration: validated, backed up, awaiting approval (not applied).**

- **Backup:** `data/backups/job-monitor-premigration-20261111T003329Z/` (current; it matches the live ledger SHA-256). An earlier 00:22Z backup predates an offline re-evaluation; first-seen timestamps, checkpoints and counts are identical between them. If any monitor command runs before the approved apply, take a fresh backup first. It contains a byte-exact copy of the ledger plus `manifest.json` (SHA-256, counts, checkpoints, first-seen digest). Permissions are 0700/0600 and the location is git-ignored.
- **Real dry run:** 3 partitions (0.96/0.79/0.73 MB compact), 1,307 postings, 0 alerts/proposals; the ledger stayed byte-identical.
- **Rehearsal on a disposable copy:** migrate then rollback. Monitor content, first-seen timestamps, checkpoints, the dashboard view and every application/email ledger field were identical in both directions. The copy was deleted.
- **Operation to approve:** `npm run monitor -- migrate-store --apply`.
- **Expected file changes:** `data/application-automation/ledger.json` is rewritten without its `jobMonitor` section (≈3.6 MB → ≈0.24 MB; jobs, events and email state unchanged). New files: `data/job-monitor/index.json` and `data/job-monitor/sources/{cloudflare,datadog,mongodb}.json`. A transient `data/job-monitor.lock`.
- **Rollback:** `npm run monitor -- rollback-store --apply` (new). It folds the split store back into the ledger, verifies, then removes `data/job-monitor/`. Unlike a backup restore, it keeps state recorded after migration. Fallback: restore the backup ledger per its manifest.

**Scheduler validation (offline, simulated clock):** a new 8-hour scenario checks:
- per-employer intervals (5/15/60 minutes; no source ever polled faster than its interval);
- respected foreign lease, then exactly one reclaim after expiry (crash recovery);
- outage backoff limiting retries;
- a 40-minute Retry-After honored over a 5-minute interval;
- pause/resume;
- authorization expiry stopping all polls;
- quiet baselines across restart;
- exactly one alert per posting version.

Plus migration/rollback round trips, interruption resume in both directions, and conflict fail-closed checks.

**Employer coverage:** see [EMPLOYER_COVERAGE](EMPLOYER_COVERAGE.md). The 1,242 live postings at the three monitored employers contain no full-time US new-grad engineering role. Projecting the evaluator onto other employers' cached new-grad postings exposed three false exclusions, now fixed with tests: graduation ranges, a benefits-date sentence read as a job start, and clearance "or eligibility to obtain". The monitor also now recognizes "Early Career" and "University Graduate" titles. The real 27-posting shortlist is unchanged (no qualifying postings at the current employers) and protected state is identical.

**Cloud plan:** [CLOUD_DEPLOYMENT_PLAN](CLOUD_DEPLOYMENT_PLAN.md), [ADR 0003](decisions/0003-cloud-monitoring-first.md) (proposed), [CC-017](tasks/CC-017.md). Nothing provisioned.

Validation: 408 related Node regressions passed, zero failures/skips (54 monitor and 12 scheduler/store cases). Typecheck/build and the job-monitor, job-monitor-cache and career-central browser suites passed. No live request, migration of real data, recurring authorization, OS trigger, email, application, push or cloud action.

## Recurring-monitoring readiness and local scheduler — 2026-11-11

Readiness audit findings:

- **Storage cliff.** All monitor state lived in the application ledger under a single 3 MiB budget. Three employers already used 2.37 MB, so a fourth or fifth would fail with `MONITOR_CAPACITY_REVIEW_REQUIRED`. Every poll also rewrote the whole ~2.5 MB ledger holding application history and email state.
- **No scheduler trigger.** Only per-source `poll-once` existed; there was no tick, no activation record and no operational health classification.

Implemented locally (nothing activated):

- **Split monitor store** (`lib/career-central/monitor-store.mjs`): per-source partitions under `data/job-monitor/`, one atomic file per source, with the index written last. Polls never touch the application ledger. Fresh roots use it; existing in-ledger state stays in legacy mode until an explicit `migrate-store --apply`. Migration verifies a canonical lossless round trip, records the legacy hash, removes only the ledger's `jobMonitor` section, and resumes or fails closed after an interruption.
- **Scheduler tick** (`lib/career-central/monitor-scheduler.mjs`): one non-overlapping pass over due, authorized, unpaused sources with a per-tick poll budget. It requires `--authorize-live-read` plus a persisted authorization naming exact sources that expires within 30 days and can be revoked. It reuses the existing leases, backoff/Retry-After, adaptive intervals, jitter, conditional reads and per-version alert/proposal deduplication.
- **Health:** distinct per-source states (no changes, changes, failing, rate limited, overdue, polling, worker lost, paused, never polled, cached only) and scheduler states (not authorized, expired, never ran, running, running with failures, stale). They appear in `health`, `monitorView` and on the dashboard.

Real data: still in legacy mode, deliberately not migrated. A dry run passed (3 partitions of 0.96, 0.79 and 0.73 MB; 1,307 postings) with the ledger byte-identical. Its first attempt failed closed because posting key order differed across interleaved sources; verification now compares canonically, and a regression test reproduces the case. A rehearsal on a disposable copy of the real data migrated successfully: the dashboard view, counts and health were identical, the ledger minus its monitor section was identical, and the ledger shrank from 3.4 MB to 242 KB. The copy was deleted. Health on real data: scheduler `not_authorized`; all three sources `ok_no_changes`.

Validation: 403 related Node regressions passed, zero failures/skips (52 monitor and 10 new store/scheduler cases). Typecheck/build and the job-monitor, job-monitor-cache and career-central browser suites passed, including scheduler/source health labels and checks that no ledger or monitor bytes are written by viewing. No live feed request, OS trigger, recurring authorization, email, application, push or cloud action occurred.

## Role classification and start-date state — 2026-11-11

- **Role classification:** business-function titles (now including business operations, strategy & operations, procurement and supply chain) are excluded only when the title has no engineering function noun (engineer, developer, SRE, DevOps, architect, administrator). "Infrastructure Business Operations Associate" is excluded; cloud, platform, DevOps, backend and SRE engineering titles, and engineering roles in business domains ("Software Engineer, Finance Platform"), still pass. The previous rule would have wrongly excluded that last kind of title.
- **Start dates:** the employer side and the candidate side are separate. An unstated, month-less or internship employer start is `Employer start date unconfirmed` (`match.startDate`: `employer_unspecified`, `employer_month_unparsed` or `internship_not_compared`). Missing or provisional verified availability is a separate candidate-side unknown, and a stated start before verified availability is still an exclusion.
- **`potentially_eligible` state:** used only when the employer start date is the sole open item. These postings rank between qualified and needs-review, can be high priority, alert and receive a local preparation proposal, and show "Potentially eligible — start date unconfirmed" on the dashboard. `match.submissionReady` is always false: the monitor never grants submission readiness. `submissionBlockers` lists every open item, and submission gates remain in the application workflow, which doesn't read monitor status.

Real-data offline re-evaluation: the Business Operations posting is now excluded, leaving a 27-posting review list. None are potentially eligible: all 27 also lack an explicit graduation window and an explicit entry-level title, so the state applies only to future clearly new-grad postings. Protected-state fingerprints are unchanged.

Validation: 393 related Node regressions passed with zero failures or skips (52 monitor cases). Typecheck/build and the job-monitor (now including a potentially-eligible label case), job-monitor-cache and career-central browser suites passed. A read-only real-data dashboard check at 375/1440px found 27 cards, the expected labels and no writes, external requests or errors.

## Eligibility classification and evidence fixes — 2026-11-10

Monitor eligibility now:

- Treats a skill as required only when a requirement excerpt names it without a nearby negation.
- Reads verified citizenship from `authorization.citizenship`, the field the Greenhouse mapper already uses.
- Excludes executive titles and non-technical business-function titles; employer names containing "cloud" no longer count as a role family.
- Excludes explicit season/month graduation windows that exclude the verified graduation month.
- Compares employer start dates at month precision, independent of timezone. Unstated, month-less and internship starts stay unresolved.
- Labels description evidence. Cached snapshots and stored excerpts cannot count as current eligibility evidence.

A new offline `npm run monitor -- reevaluate` re-applies the evaluator to stored postings. It uses full text only when the text's hash equals the latest observed content hash; see the [runbook](../JOB_MONITOR.md).

Real-data rerun (offline, no network): 1,204 postings re-evaluated and 103 kept unchanged with no verifiable text. The reviewable shortlist went from 31 to 28. The three wrongly admitted postings (an executive go-to-market title, a cloud-finance analyst title and an internship with a later graduation window) are now excluded. A citizenship-requirement posting no longer asks for a verified answer, and a posting stating that Rust experience isn't required no longer flags Rust as mandatory. All 28 still show the employer start as unresolved. One posting is flagged as having only a stored excerpt. Zero qualified; scores remain heuristic. Fingerprints confirmed unchanged: application jobs/events, email inbox/health/sends, monitor sources/checkpoints/alerts/tasks/decisions, tracker, CV, profile/policy, output résumés and the discovery cache.

Validation: 391 relevant Node regressions passed, zero failures/skips (50 monitor cases, 14 new for these issues). Typecheck/build and the job-monitor, job-monitor-cache and career-central production-browser suites passed on fictional data. A read-only production dashboard check on the real data root (GET-only, off-origin blocked) at 375/1440px found 28 cards, each showing incomplete eligibility, none of the three excluded postings, no writes, no external requests and no page errors. No live feed request, email, application, recurring monitor or cloud action occurred.

## Current implementation — shortlist and local monitor, 2026-11-10

[CC-015](tasks/CC-015.md)/[CC-016](tasks/CC-016.md) now deliver a minimum local
source → match → shortlist → dashboard alert → preparation-proposal workflow.
See [runbook](../JOB_MONITOR.md) and [owner contract](../../lib/career-central/JOB_MONITOR.md).
The existing `/career-central` UI persists interested/dismissed/awaiting-application
monitor decisions, alert dismissal and source pause without touching application
statuses. The CLI supports local configuration/cache seeding/status/schedule and
one explicitly authorized due live cycle, not an activated recurring worker.

Reuses existing providers/HTTP, admission/ranking, verified private profile/role
weights, canonical history parsers and ledger lock/atomic writer. Unknown essential
eligibility/start/history cannot be presented as ready; scores remain heuristic.
Checkpoints, content versions, first-seen versus publication evidence, deduplicated
alerts/proposals, conditional reads, adaptive cadence/backoff, leases and crash
recovery are implemented locally. Cached private discovery data was seeded without
live feed requests; application jobs/events and email state remained unchanged.

Cloudflare/Datadog/MongoDB feeds are proposed, locally configured at conservative
15-minute targets but unapproved for recurring use. Live feed reliability, policy,
current eligibility and latency are not certified. Five-minute targets are possible
only when separately appropriate/authorized, never a guaranteed detection rate.
No recurring monitoring, employer form access/upload/submission, external
notification/email, verification-code entry, paid service or cloud was activated.

Validation: 339 relevant synthetic regressions passed, zero failures/skips (three unrelated browser-launching cases excluded by name), including 34 monitor cases. Final focused monitor rerun passed 34/34. The existing Career Central and new monitor production-browser suites each passed on fictional data; typecheck/build and 282 local documentation targets passed. Earlier evidence below
is retained as historical state. Remaining product work includes live bounded
source acceptance, ongoing worker installation, rich monitoring analytics,
quiet-hour/snooze delivery and full application/document workflows.

## Current summary — product alignment, 2026-11-10

The [feature inventory](FEATURE_INVENTORY.md) is the detailed capability/status map.
M0.5–M3C are completed local foundation slices, not a completed career platform.
Existing discovery/documents/analytics/interview code is substantial but fragmented;
agent protocols are not general background services or validated product journeys.
The [roadmap](ROADMAP.md) now prioritizes reliable shortlist → small core priority
monitor/rapid preparation → one complete approved application → confirmations,
then ATS breadth, documents, dashboard, communication, interview/learning, gated
autonomy and mobile/cloud. See [CC-014](tasks/CC-014.md).

Current live evidence: user-operated bounded Gmail list/context succeeded, Gmail
accepted the reviewed reply, and the user confirmed delivery in the same thread.
This completes the controlled test round trip only. Generic recruiting-message
classification, mail-to-status bridge and background sync are still partial.
The narrow Greenhouse preparation/review transport lacks a confirmed real
end-to-end application; HTTP 428/uncertain prior attempts require reconciliation.
No new live action was performed to prepare this summary.

[CC-015](tasks/CC-015.md) and [CC-016](tasks/CC-016.md) are planned, not implemented.
Continuous adaptive monitoring, deduplicated alert/preparation lifecycle and PWA/
cloud are not delivered. Autonomous submissions, recurring monitoring, automatic
codes/replies, new notification sends and provisioning remain unauthorized.
Existing per-action approval and security controls are unchanged.

Validation for this documentation-only audit is link/reference/consistency and
diff review; no runtime test/build/scan/mailbox/browser action was run. Historical
test counts below apply to their original source snapshots and scopes.

## Historical milestone acceptance records

Earlier entries preserve contemporaneous statements (including pending live tests
and uncommitted working trees); Git and the summary above establish current state.

## Bounded reply context — 2026-11-10

[CC-013](tasks/CC-013.md): user reports test send/delivery succeeded, initially
in Junk. Readonly reply review now selects one message from a one-hour/ten-message/
one-page bound and captures conservative thread headers. Separate send approval
remains required; live incoming reply/threading acceptance is pending. Personal
writing samples/guide stay in the user layer. No autonomous replies/submissions.

## Reviewed Gmail sending — 2026-11-10

[CC-012](tasks/CC-012.md): separate session OAuth with exact readonly + send,
interactive content approval, durable duplicate/uncertain-outcome protection and
private reviewed replies. 294 relevant offline checks pass; no live send or
delivery verification. Default readonly bounded sync and application gates stay
unchanged. See [setup](../GMAIL_SENDING.md).

Latest Gmail provider slice (2026-11-10): [CC-011](tasks/CC-011.md) fixes JSON
parsing of HTTP 204 and retains explicit zero-result list metadata. A subsequent
user-operated actual Gmail message-list GET passed with HTTP 200, validated
response, idle/incomplete=false and a corroborated complete local checkpoint.
278 offline checks pass. This is bounded list acceptance; live forwarded-message
classification and sender provenance remain unvalidated. No autonomous actions.

Latest Gmail diagnostic slice (2026-11-10): [CC-010](tasks/CC-010.md) adds safe
stage/category diagnostics, synthetic localhost checking and explicit no-retry
SDK transport. 261 offline checks pass; current Windows-to-WSL/public HTTPS probes
passed without OAuth or mailbox requests. Historical post-callback provider cause
remains unknown until the user's sanitized retry. No private account was accessed.

Latest dedicated Gmail slice (2026-11-10): [CC-009](tasks/CC-009.md) adds a
consent-gated, session-only Gmail readonly adapter alongside Outlook. 249 offline
checks pass; no actual account/config/credential/mailbox was accessed. User
explicitly withheld connection authorization. [Gmail runbook](../GMAIL.md) covers
no-billing OAuth configuration and the pending controlled first read.

Latest Outlook readiness slice (2026-11-10): [CC-008](tasks/CC-008.md) wires an
explicit same-process first sign-in/sync with a one-page/10-message/24-hour cap,
strict delegated read scopes and review-only observations. 223 offline checks
pass; native vault and live Microsoft acceptance remain unrun. Exact user steps:
[Outlook runbook](../OUTLOOK.md). Prior checkpoint `a97b6249` verified complete.

Latest reconciliation slice (2026-11-10): [CC-007](tasks/CC-007.md) adds explicit
interrupted-sync inspection/abandonment using existing owner-store CAS. 98 focused
tests pass, 0 fail; no live integration. CC-006 is committed as `7ca248e4`.

Latest local continuation (2026-11-10): foundation checkpoint `e7ce36f9` is committed
and verified on the private remote. New uncommitted readiness and bounded sync
work is documented in [CC-006](tasks/CC-006.md) and [HANDOFF](HANDOFF.md): 90
focused tests passed, 0 failed. No live Microsoft integration is enabled. Earlier
base/dirty-tree statements below describe their original milestone runs.

Updated 2026-11-06. Local detached HEAD base `d3fc7d1`, uncommitted working tree; no milestone commit/release. Runtime tested: Node v24.20.0. Source/tests outrank summaries.

| Area | Implementation | Validation/deployment | Limits |
|---|---|---|---|
| M0.5 context | Complete: early root pointer, entry point, product/state/roadmap, ADR, task and handoffs | Eight document links checked; original 94,638 AGENTS bytes hash-identical; bootstrap regression passes | Root instructions still exceed typical default budget; explicit focused loading remains necessary; upstream may replace pointer |
| M1 canonical read projection | Complete: pure model, bounded source adapter, v1 schema/semantic validator, CLI and interface contract | Fictional fixtures plus relevant existing offline regressions: 51 passed, 0 failed, 0 skipped; guarded real-source read: zero forbidden calls | Private local read view; web consumer added by M2; no cloud integration, independently verified receipts or new data authority |
| M2 unified dashboard read slice | Complete locally: `/career-central`, Home card, server-only reader and GET API | 131 focused tests + 1 production browser fixture passed; typecheck and build passed | No live confirmation verification, worker heartbeat, Graph auth/sync or cloud deployment; bounded source coverage |
| M3A durable evidence and health | Complete locally: optional operational evidence v1, validators and pure readers | 206 focused checks pass, including 40 new M3A cases; typecheck/build pass | Source-recorded receipt reconciliation only; live producers remain absent; M3B resolves owned persistence and metadata retention |
| M3B operational persistence/recovery | Complete locally: supported metadata preservation, typed worker/mailbox stores, CAS/replay, atomic/recovery helpers and health cards | 323 focused + 1 HTTP-only production test pass; typecheck/build pass | No live producers, cursor backend, remote authentication or native Windows/WSL certification |
| M3C platform recovery and secure Microsoft Graph storage | Complete locally: session-only default, opt-in protected MSAL cache, protected cursor store, mocked worker/mailbox writers | 331 focused pass; 1 HTTP-only production test, typecheck/build pass | WSL2/Linux only; no Secret Service or native keytar binding; native Windows DPAPI and live OAuth/Graph unvalidated |
| Existing discovery/tracker/documents/web | Existing code; inventory in audit | Historical validation only, except relevant parser/pilot regressions above | Local filesystem/CLI architecture |
| Existing application automation | Partial Greenhouse preparation and reviewed transport | No new real application actions; pilot-policy tests above | Native verification/session recovery remains incomplete; no autonomy enabled |
| Existing Outlook adapter | Read-only MSAL/Graph and review observations; session-only credentials by default; explicit OS-protected persistent mode | Fictional OAuth/Graph tests; no live mailbox authentication/retrieval | Persistent vault unavailable in current WSL; sender authentication, durable live sync and code continuation remain incomplete |
| Hybrid AWS / later dashboard modules | Design only beyond M2 read slice | Not deployed | Requires a new approved task |

Exact validation command (five suites):

```sh
node --test tests/career-central-projection.test.mjs tests/application-pilot.test.mjs tests/tracker-parse-score.test.mjs tests/url-key.test.mjs tests/funnel-velocity-reapply.test.mjs
```

The new suite has 38 cases including one bootstrap case; the combined Node runner reports 51. Legacy helper-style URL/history suites are also folded as passing test files; this is not a count of every individual helper assertion. No full suite/build/browser test was run, because this milestone excludes browser/network effects. The write/network/process/auth-cache tripwire fixture was also run against current source files without emitting private record contents.

Preservation: 338 pre-existing files hashed before work; all except the intentionally prefixed AGENTS remain byte-identical, including existing uncommitted code, canonical records and approved-PDF sources. Original AGENTS content is preserved exactly below the added pointer. OAuth caches were not opened. No dependency, safety configuration, credential, source record or approved document was changed. `git diff --check` passes.

See [projection interface](../../lib/career-central/README.md) and [CC-001 acceptance](tasks/CC-001.md). Private operational facts remain in private records; shared docs do not certify candidate qualifications or submission status.

## M2 verification — 2026-11-06

Focused command (131 passed, 0 failed, 0 skipped):

```sh
node --test tests/career-central-projection.test.mjs web/tests/lib/career-central.test.mjs web/tests/lib/home-lead.test.mjs web/tests/lib/pipeline-navigation.test.mjs web/tests/lib/pipeline-labels.test.mjs web/tests/lib/pipeline-views.test.mjs web/tests/lib/analytics-view-model.test.mjs web/tests/lib/origin-guard.test.mjs
```

`npm run typecheck --prefix web` and `npm run build --prefix web` both exited 0. Build emitted one warning in pre-existing `web/src/lib/cv-studio/server.ts:88` about broad filesystem tracing; not changed in M2. Do not publish local build artifacts as a cloud deployment.

Production localhost test: `CAREER_CENTRAL_CHROME_EXECUTABLE=/path/to/already-installed/chromium node web/tests/browser-suites.mjs career-central`: 1 passed, 0 failed, 0 skipped. Tested Home link, JSON/cache contract, rejected POST/cross-origin request, HTTP 428 attention, secret exclusion, 375/1440px layouts, no runtime exceptions, no client writes/off-origin requests, and unchanged fictional source bytes. Existing unrelated shell polls are stubbed; this does not certify every old shell endpoint. Initial system-Chrome launch failed because Chrome was absent; installed Chromium was used. A request-recorder assertion in the test was corrected before the final passing run.

Projection tests include assessment folding, report-to-tracker identity separation, invalid/ambiguous deadlines and recorded schedule summaries. Reader import/execution passed write/network/process/credential tripwires. No actual email, employer site or browser application session was accessed. Full repository/all-browser suites were not run.

All 354 pre-existing preservation-baseline files were compared: changes are limited to explicitly intended M1 extensions, Home/harness, and milestone documentation. Private records, approved PDFs, submission policy, original instructions and unrelated work remain unchanged. No commit or release. See [CC-002](tasks/CC-002.md) for scope and interface decisions.

## M3A verification — 2026-11-06

Implemented contracts/readers only. [CC-003](tasks/CC-003.md) lists every changed file; [operational schema documentation](../../lib/career-central/OPERATIONAL_EVIDENCE.md) defines ownership, input/output versions, evidence confidence and proposed write/recovery rules.

Final command (206 passed, 0 failed, 0 skipped; 40 new M3A cases):

```sh
node --test tests/career-central-operational.test.mjs tests/career-central-projection.test.mjs tests/application-pilot.test.mjs tests/application-upload-policy.test.mjs tests/outlook-email.test.mjs web/tests/lib/career-central.test.mjs web/tests/lib/home-lead.test.mjs web/tests/lib/pipeline-navigation.test.mjs web/tests/lib/pipeline-labels.test.mjs web/tests/lib/pipeline-views.test.mjs web/tests/lib/analytics-view-model.test.mjs web/tests/lib/origin-guard.test.mjs
npm run typecheck --prefix web
npm run build --prefix web
```

Typecheck/build exited 0. Build retains one pre-existing CV Studio broad-filesystem-tracing warning. Outlook tests use fictional messages, injected Microsoft clients and a localhost callback, never real OAuth/Graph/mailbox access. No browser test or live application flow was run in M3A; M2's browser results above are historical. No new dependency/infrastructure, permission changes or real source writes.

Read behavior: HTTP 428 stays verification-required; contradictory or incomplete acceptance stays reviewable. Exact existing application/attempt IDs and event provenance survive; durable Submitted events retain historical receipts. Only an exact human reconciliation chain yields `confirmed_receipt` in the new source-evidence view. It is explicitly not independent artifact validation; legacy independently confirmed counts remain null. Configuration/connection and synchronization are separate; absent, expired, partial, failed and skewed records remain explicit. Run completion never establishes worker availability.

Producers are not implemented. Reserved mailbox health lives under the existing application ledger; reserved worker metadata belongs to the scheduler store. Its current `readScheduledStore` drops unknown top-level fields: safe metadata preservation and owned writers are M3B prerequisites. Health records do not authorize tasks or submissions. Existing M2 rendering remains compatible and intentionally conservative; it does not yet render new operational health details.

Preservation: a 365-file starting hash baseline was compared; only documented projection/context edits differ. Existing application/email code, scheduling writers, approved documents, private records, root instructions and unrelated dirty work were preserved. Guarded populated-fictional-source reads reported zero write/network/process/auth-cache calls; fixture hashes remained unchanged. `git diff --check` passes. No commit/release; M3B requires new approval.

## M3B verification — 2026-11-06

[CC-004](tasks/CC-004.md) contains the exact commands and full changed-file inventory. [Persistence contract](../../lib/career-central/PERSISTENCE.md) specifies v2 schemas, ownership, revision/idempotency guarantees, recovery and the protected-cursor interface proposal.

Final focused suite: **323 passed, 0 failed, 0 skipped**, including 44 new persistence cases, M1/M2/M3A, existing scheduler and application approval/duplicate/kill-switch regressions. Three browser-launching cases were excluded by explicit name filter and are not counted as executed/skipped. Typecheck and production build exited 0. Build retains one pre-existing CV Studio filesystem-tracing warning. Separate HTTP-only production smoke: **1 passed, 0 failed, 0 skipped**, checking page/API health, redaction, method/origin/cache controls and unchanged fictional source bytes. It bypasses server.mjs/PDF/browser startup. Full repository, browser/hydration/viewport and native Windows/WSL suites were not run.

Scheduler metadata loss is resolved for validated workerHealth v1/v2. New publishers use existing owner locks and records; normal task scheduling/leases/retry policy and application gates are unchanged. Receipt reconciliation remains source-recorded, with independently confirmed application counts unknown. No actual private record, policy, approved document, credentials or OAuth permissions changed; no live mailbox/Graph/application action or deployment occurred.

A 598-file starting preservation baseline showed only explicitly authorized core/web/context edits, no unrelated differences and no new private-source files. Read-side populated-fixture tripwires still pass. No new dependency, staging, commit or release.

M3C completed the local protected-storage contract and mocked writer integration. Native Windows/DPAPI and a real Linux Secret Service still need platform validation. Legacy unbound mailbox v1 metadata requires explicit migration review; there is no insecure cursor fallback or automatic sensitive-action retry. See CC-004/PERSISTENCE and CC-005 for bounded replay, local-trust, file-size and durability limits.

## M3C verification — 2026-11-06

See [CC-005](tasks/CC-005.md) and [protected Microsoft storage contract](../../lib/email/PROTECTED_STORAGE.md). Outlook token storage now defaults to process memory; optional persistence uses Microsoft's authentication extension with Windows current-user DPAPI / Linux Secret Service and explicitly disables Linux plaintext fallback. Protected Graph cursor schema v1 has opaque account/scope/checkpoint partitioning, revision CAS, idempotent replay and revocation tombstones. Mocked worker and mailbox events use the actual M3B owner writers. Existing legacy `msal-cache.json` is not read or deleted.

Focused regression command: **331 passed, 0 failed, 0 skipped**; three Chromium-launching test cases were excluded by `--test-skip-pattern` and are not included in those counts. Typecheck and production build exit 0. Build retains the pre-existing CV Studio filesystem-tracing warning. HTTP-only production test: **1 passed, 0 failed, 0 skipped**. No live OAuth, Graph/mailbox, submission, cloud, or browser action was part of the final run. An earlier invocation used the wrong Node test flag and did run three synthetic local Chromium fixture tests; one documentation-link check failed because CC-005 had not yet been created. No live site/data was accessed, and the corrected final run excluded those browser tests.

Environment was WSL2/Linux Ubuntu, Node v24.20.0. D-Bus and Windows interop were present, but `org.freedesktop.secrets` was unavailable and the native keytar binding was not built. Persistent storage therefore failed closed. Native Windows Node/DPAPI and a working Secret Service test remain unrun. The repository remains detached at `d3fc7d1` with the prior large dirty/untracked milestone set; no staging or commits occurred. M3D live read-only Outlook connection is proposed only and requires separate authorization and a validated vault.
