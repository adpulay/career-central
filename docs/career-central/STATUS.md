# Verified project state

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
