# Latest handoff

## C1 ready for the fixture-only dev-test approval — 2026-11-12 (evening)

- **State:** the C1 branch is reviewed for deployment and still unmerged. Do **not** merge it into the live pilot checkout until the user approves; the pilot runs that checkout every 10 minutes.
- **Proposal:** [AWS_C1 → First deployment](../AWS_C1.md#first-deployment-fixture-only-dev-test-proposal-every-step-needs-approval) covers the account and region, operator permission sets, resources (18 plus bootstrap), budget, a 17-step test with success criteria, emergency stop, rollback, teardown and data retention.
- **Approvals needed before step 1:**
  - The dev account and region.
  - Identity Center permission sets (bootstrap once; dev operator).
  - The budget amount and alert address.
  - `cdk bootstrap` (accepting the default `AdministratorAccess` execution role in that account).
  - `cdk deploy` of the fixture config.
  - Running `seed-dev-fixture.mjs --apply`, `probe`, and the manual invocations.
- **Not part of this test (separate approvals):** schedule, live reads, real-source hand-over, alarm notifications, GitHub OIDC, prod, and merging C1 into the live checkout.
- **Known unrelated failures**, documented and not changed: the `career-central` web route's missing `loading.tsx`, and amber contrast in `overview.tsx:37`.

## C1 synth-only stack validated; ready for dev-account approvals — 2026-11-12 (afternoon)

- **C1 branch** `career-central/cc-017-c1` now holds the CDK stack, IAM, alarms and budget, validated by synth, cdk-nag and 20 infra tests; the Lambda asset privacy scan is clean. Three IAM/alarm defects were fixed in this review (see [STATUS](STATUS.md)). The branch is still unmerged and needs review before a fast-forward.
- **Supersedes the entry below:**
  - The Windows task already runs with the headless `conhost.exe` action (observed, last result 0).
  - The network-error classification is implemented on the C1 branch (`19b5eed2`, `dns_failure` / `network_unavailable` / …). The live checkout gets it only after the merge.
- **Browser suites** need Google Chrome installed in WSL (`npx playwright install chrome`, a system change); they were not run this session.
- **Next:** the approvals in [CLOUD_DEPLOYMENT_PLAN §15](CLOUD_DEPLOYMENT_PLAN.md#15-decisions-requiring-your-approval-before-any-deployment), then the dev-account integration test in [AWS_C1](../AWS_C1.md). It must also confirm real 404-on-missing-key behavior with the new `s3:ListBucket` grant.

## Pilot running; C1 on its branch; one pilot fix pending approval — 2026-11-12

- **C1 work** lives on `career-central/cc-017-c1` (worktree `../career-ops-c1`), kept apart because the live task executes the main checkout every 10 minutes. Merge by fast-forward once reviewed; it changes `loadMatchingContext` to async and adds source ownership, both covered by tests.
- **Pilot fix awaiting approval:** re-register the task action to run without a console window, so a closed window cannot kill a tick mid-poll. Proposed: `conhost.exe --headless wsl.exe -d Ubuntu -u root -- <repo>/scripts/job-monitor-tick.sh`, with every other setting unchanged.
- **Diagnostic improvement (not done):** classify network errors such as DNS failure, connection refused or `fetch failed` as `network_unavailable` instead of `provider_unavailable`.
- **Next C1 work:** IAM least-privilege policies and the CDK stack (DynamoDB, S3, Lambda, Scheduler disabled by default, log retention), alarms and the budget, all synth/test-only. Then a dev-account integration test after the account, region, budget and OIDC approvals.

## Pilot ready for authorization; C0 integrated; C1 next — 2026-11-11

- **Main:** `career-central/pre-m3d-stabilization` at `3b45c549` includes C0 (storage port, eligibility projection, telemetry, handler) and the C1 preparation (cloud-shaped store with authoritative `load()`, distributed leases, concurrency tests). See [STATUS](STATUS.md) and [CC-017](tasks/CC-017.md).
- **Pilot:** all five baselines are established. The activation package (authorization plus the `Register-ScheduledTask` setup) is in the [runbook](../JOB_MONITOR.md#pilot-databricks-palantir-stripe-scale-ai-cloudflare-configured-2026-11-11-not-activated) and **requires the user's approval**. Nothing is activated.
- **Next engineering after activation approval:** the CC-017 C1 steps that need no resources, then the approvals in the [cloud plan §15](CLOUD_DEPLOYMENT_PLAN.md#15-decisions-requiring-your-approval-before-any-deployment): AWS SDK dependencies, `infra/` (CDK), account, region, budget, OIDC.
- **Smallest real-cloud test:** in a dev account, one fixture source driven through the deployed handler, proving baseline quiet, one alert for a controlled change, no duplicate on repeat, and a 412 on a stale concurrent write.

## Product vision documented — 2026-11-11

Start here for product direction: [PRODUCT](PRODUCT.md) (motivation, scope, CC-R19–R24), then the subsystem designs linked from it, [ADR 0004](decisions/0004-product-vision-expansion.md) and the [roadmap's agreed sequence](ROADMAP.md#agreed-development-sequence-2026-11-11).

Immediate engineering priority is unchanged:
1. Finish the local pilot: the Stripe baseline, then activation approval.
2. [CC-017](tasks/CC-017.md) C0.
3. C1 after the deployment approvals.

Design work (identity I1 spec, frontend tokens) may proceed in parallel without changing data contracts. Open questions are listed in each design document; none blocks the next step.

## Recurring-monitoring pilot ready for activation approval — 2026-11-11

The five pilot sources are configured at 30 minutes, with Palantir and Scale AI baselined. Databricks and Stripe baselines are pending after a safe failure; the fixes are in. Eligibility, deduplication, scheduler recovery and the dashboard were verified (see [STATUS](STATUS.md)).

The activation package (two pending `first-poll`s, a 168-hour authorization, and one Windows Task Scheduler trigger every 10 minutes running `scripts/job-monitor-tick.sh`), plus the pause, revoke and stop commands, is in the [runbook](../JOB_MONITOR.md#pilot-databricks-palantir-stripe-scale-ai-cloudflare-configured-2026-11-11-not-activated). **Nothing in it has been run.**

Decisions for the user:
1. Approve activation as written.
2. Keep adaptive stretching on quiet feeds (up to 120 minutes) or pin 30 minutes.
3. Record "never applied" answers for the pilot employers in the private profile. This is the main remaining blocker for potentially-eligible/high-priority status.

Next milestone after a week of pilot observation: [CC-017](tasks/CC-017.md) C0.

## Monitoring storage migrated locally — 2026-11-11

The real monitor state now lives in `data/job-monitor/` (per-employer partitions); polls no longer rewrite the application ledger. Results and validation evidence are in [STATUS](STATUS.md). Recovery: `npm run monitor -- rollback-store --apply` (keeps any newer state); fallback is the backup at `data/backups/job-monitor-premigration-20261111T003329Z/` per its manifest.

Remaining blockers (approvals):
- recurring activation (sources, intervals, authorization length, one OS trigger);
- the proposed employer set, each starting with one `first-poll`;
- "never applied" confirmations in the private profile;
- the cloud-plan §15 decisions;
- review of the career-ops v1.40.0 release notes before updating.

Next milestone: [CC-017](tasks/CC-017.md) C0, local cloud-readiness on top of the migrated store. Optionally run in parallel: a controlled local activation for one or two approved sources.

## Ready for approvals: migration, monitor activation, employer set, cloud C0 — 2026-11-11

- **Migration:** validated and backed up; awaiting approval of `migrate-store --apply` (exact operation, backup and rollback in [STATUS](STATUS.md)).
- **Scheduler:** offline-validated end to end with a simulated clock; not authorized or installed.
- **Employers:** the current three have no US new-grad openings. The proposed monitor set is Databricks, Palantir, Stripe, Scale AI and Cloudflare, with a daily-scan tier ([EMPLOYER_COVERAGE](EMPLOYER_COVERAGE.md)). The user can unlock many new-employer postings by confirming "never applied" per employer in the private profile.
- **Cloud:** run monitoring first on EventBridge Scheduler → Lambda, with S3 partition documents (`If-Match`) and DynamoDB control records; no SQS, VPC or secrets in C1. Estimated about $0.20–1/month for 5 employers, $3–12 for 100 (plus optional AI), $20–55 for 500.

Blockers, all approvals:
1. Local migration.
2. Activation details (sources, intervals, duration, OS trigger).
3. Adding new sources (`first-poll` each).
4. AWS account, region and budget.
5. CDK `infra/` workspace and dependencies.
6. OIDC roles and protected environments.
7. Cloud data allowlist and retention.

The upstream career-ops v1.40.0 release notes are not yet reviewed against the customizations, so don't update until they are.

Next milestone: [CC-017](tasks/CC-017.md) C0, local cloud-readiness (scoped store port with contract tests, unchanged-snapshot fast path, minimized eligibility projection, redacted telemetry, Lambda handler wrapper, dev fixture provider), together with the approved local migration and activation. C1 deployment follows only after the plan's §15 approvals.

## Recurring-monitoring readiness and local scheduler prepared — 2026-11-11

Readiness gaps found and closed locally: monitor state shared the application ledger under one 3 MiB cap (a fourth employer would fail, and every poll rewrote application/email history), and there was no tick, activation record or health model. Added the split per-source store with a verified migration, a gated scheduler tick and distinct health states; see [STATUS](STATUS.md) and the [runbook](../JOB_MONITOR.md).

The user's real data was not migrated; it remains in legacy mode and works as before. Recurring monitoring is neither authorized nor installed.

Next milestone: controlled activation, with each step needing explicit user approval.

1. `migrate-store --apply` on real data, after a backup.
2. One `first-poll` per approved source.
3. Choose sources, interval (15 minutes or more), authorization duration and polls per tick.
4. Install one OS trigger for `tick --authorize-live-read`.
5. Accept after observing the first ticks via `health`: no duplicate alerts, honest overdue/failure states, and revocation works.

After that: more employers within the five-source limit, and quiet-hours/snooze.

A cloud infrastructure audit requested earlier in this session was paused in favor of this work. Its main early finding (the storage cliff) is resolved here, and the per-source partition maps directly onto a future cloud partition key. The full cloud deliverables remain to be written.

## Role classification and potentially-eligible start state — 2026-11-11

Fixed "Infrastructure Business Operations Associate" passing the technical filter: `infrastructure` matched the role family and nothing caught the business function. The non-technical rule now excludes a business-function title only when it has no engineering noun. Unstated employer start dates stay unresolved but are no longer conflated with candidate-side gaps or ineligibility. A posting whose only gap is the employer start date becomes `potentially_eligible`: it is shortlisted first after qualified postings and can alert and receive a preparation proposal, but it is never submission-ready. Details and validation are in [STATUS](STATUS.md). The current 27-posting shortlist has no start-only cases.

## Eligibility classification and cached-evidence fixes — 2026-11-10

State at start: the interrupted session had left uncommitted, passing hardening for the first live baseline after cache seeding: `first-poll`, pause/resume CLI, a dashboard cache warning and a cache browser suite. Saved sources already had live-feed checkpoints. This was validated and committed separately before the eligibility fixes. No eligibility code had been started.

Fixed in `lib/applications/discovery.mjs` (shared title filter) and `lib/career-central/job-monitor.mjs` (monitor eligibility):

- **Optional skills:** a negated or optional skill mention is no longer mandatory. The negation check is scoped to each mention, and "Go" no longer matches "good".
- **Citizenship:** verified `authorization.citizenship` is recognized; work authorization alone still is not.
- **Title filter:** executive titles (VP/president/chief) and business-function titles (finance, GTM, sales, marketing, recruiting, legal) are excluded, and `\bcloud\b` no longer matches employer names.
- **Graduation windows:** an explicit window that excludes the verified graduation month is an exclusion. Upper-bound, winter and year-only wording falls back to the earlier logic.
- **Start dates:** compared at month precision. Unstated, month-less and internship starts stay unresolved.
- **Evidence labels:** `evidence.description` labels cached snapshots and stored excerpts as review-only.
- **Rerun command:** new offline `reevaluate` command and `reevaluatePostings` owner function.

The real-data rerun and validation results are in [STATUS](STATUS.md). Résumés, application history, monitor checkpoints and email state are unchanged by fingerprint.

Next safe action: the user reviews the 28 needs-review postings. Live content counts as current for 24 hours: re-running `reevaluate` after that labels every posting a cached snapshot until an authorized bounded `poll-once` refreshes it. A business-operations associate title is still admitted as infrastructure-family. It was left unchanged because it wasn't one of the reported issues; tighten it only if the user wants. Recurring monitoring, live polling, emails and applications remain unauthorized by this work.

## Minimum shortlist-to-alert implementation — 2026-11-10

Implemented [CC-015](tasks/CC-015.md)/[CC-016](tasks/CC-016.md) local vertical slice;
[runbook](../JOB_MONITOR.md), [owner extension](../../lib/career-central/JOB_MONITOR.md).
Reuses existing ATS parsers/HTTP, scanner filters/blacklist and evaluator, saved
verified application profile/private role emphasis, canonical URL/tracker history
and application-ledger writer. Derived operational data is `ledger.jobMonitor`,
not jobs/events or a competing canonical tracker. Existing scheduler is unchanged.

CLI: `npm run monitor -- status`; configure/cache seed/schedule are local; only
`poll-once --source ID --authorize-live-read` can do a due bounded live cycle.
No recurring runner is installed/activated. Source claims fence stale workers;
source snapshot, versioned alerts/proposals and checkpoint publish atomically.
Baseline/unknown dates/reposts/expiry, conditional unchanged reads, adaptive
schedules, Retry-After/backoff, pause and bounded stop/restart are covered.
Application tasks are local proposals with approval/missing-info lists, no browser.

Existing dashboard `/career-central` now displays saved qualified/reviewable jobs,
source health, alerts and tasks. Interested/dismissed/awaiting-application choices
and alert dismissal survive reload; POST cannot configure/poll/submit. Cached real
observations were seeded offline for three proposed sources; no private job lists
or candidate facts are included here. Canonical application jobs/events and mail
health/send history were checked unchanged. The cache is labeled, not live evidence.

Proposed employers: Cloudflare, Datadog, MongoDB on existing Greenhouse feeds,
15-minute desired interval pending user source/budget/activation consent. No live
feed request was made by the implementation. Obtain approval for one bounded
cycle per source (at most two allowlisted GETs each), evaluate board completeness/
policy and sample matches, then separately scope recurring worker installation.
Do not install cron/Task Scheduler or claim five-minute guarantees from this work.

Validation: 339 relevant synthetic regressions passed, zero failures/skips (three unrelated browser-launching cases excluded by name), including 34 monitor cases. Final focused monitor rerun passed 34/34. The existing Career Central and new monitor production-browser suites each passed on fictional data; typecheck/build and 282 local documentation targets passed. Production browser
fixture checks saved decisions, alert dismissal, proposals, 375/1440px layouts,
CSRF/body/command guards and unchanged application state. Typecheck/build passed;
only the pre-existing CV Studio tracing warning remains. Rich analytics, quiet-hour
snooze/dispatch, archival, semantic matching and end-to-end applications remain
partial; live monitoring is not accepted. No emails/applications/cloud/push.

## Product vision, priorities and core monitoring aligned — 2026-11-10

[CC-014](tasks/CC-014.md) is a documentation-only source audit and planning slice.
The broad vision existed in the original architecture audit but was compressed
out of PRODUCT/ROADMAP. Expanded [PRODUCT](PRODUCT.md), [FEATURE_INVENTORY](FEATURE_INVENTORY.md)
(F01–F59), [ROADMAP](ROADMAP.md), [BACKLOG](BACKLOG.md) and [ADR 0002](decisions/0002-product-workflow-priorities.md)
now distinguish executable components, partial workflows, validation level and
execution authority. Completed M milestones/contracts remain intact. Historical
M4–M8 proposals are cross-referenced, not silently renumbered or marked complete.

Core continuous monitoring/rapid preparation is early P1b: supported priority
feeds, desired adaptive 5/15/30–60 minute cadence under rate limits, distinct
first-seen/publication/change identities, durable checkpoints/leases, one alert/
preparation proposal per relevant event, pause/restart and evidence-aware latency
metrics. Baseline feeds cannot create “just published” claims. No recurring
operation or external channel/application action is activated by planning.

Recommend [CC-015](tasks/CC-015.md) next: minimal reliable shortlist/shared filter/
identity/explanation and reviewed fixtures, then [CC-016](tasks/CC-016.md): 3–5
approved employers, durable dashboard alerts and local preparation proposals.
Do not wait for broad infrastructure, every provider or full AI matching before
that useful monitor slice. P2 closes one complete approved application with
required human verification/receipt reconciliation; P3 broadens confirmations.
Existing source owners, gates and approved documents are preserved.

Live acceptance update from the conversation: user confirmed the reviewed Gmail
reply was delivered in the same conversation. Record this as user-reported
controlled round-trip success, not independent agent verification or accepted
recruiting classification. Prior entries below preserve pending states at the
time. No mailbox/application/cloud action occurred during this audit.

Personal preferences, writing samples, account identities and raw records remain
outside shared docs. Existing role weights/target graduation policy are consumed
from private configuration, not copied into monitor constants.

Validation passed: 13 changed/new Markdown files, 415 local link/anchor targets,
unique F01–F59 feature IDs and R01–R18 requirement IDs; docs-only scope and
whitespace checks passed. Original architecture audit body is preserved beneath
the dated addendum; earlier task files and operational contracts are unchanged.
No runtime tests/builds/live probes required or run for this documentation slice.
Local commit requested; no push authorized.

## Send callback connection-refused follow-up — 2026-11-10

User's bounded reply-context command completed successfully with one body read
and context_ready/incomplete=false. This is user-supplied live context acceptance;
no agent mailbox request. The subsequent send browser callback reported localhost
connection refused while the user recalls the terminal waiting. No Gmail auth
process remained at inspection. Exact cause remains unconfirmed; do not assume
timeout or silently resend. A new synthetic Windows-to-WSL probe passed locally
and from Windows, without OAuth or private configuration access.

Added -d/--diagnostics to the separate send CLI using the existing sanitized
OAuth reporter, plus explicit fresh-URL/five-minute instructions. No binding,
PKCE/state/scope, lifetime, duplicate or approval protections were changed.
43 focused send/reply/OAuth tests pass. Next is a user-controlled fresh
`npm run gmail:send -- --test-reply -d`, exact preview/SEND and current Google URL;
same-thread send acceptance remains pending. Share diagnostics, never URLs/codes.

## Bounded reply context and personal writing guide — 2026-11-10

User reports the first reviewed send reached the original mailbox (in Junk).
This confirms user-observed delivery, not universal inbox placement. [CC-013](tasks/CC-013.md)
adds a readonly, interactive latest-hour/ten-metadata/one-page reply-context command
with one selected detail read. Test mode accepts only the known test acknowledgment;
job mode reuses exact sender/envelope/application analysis. Thread headers come from
the selected response, alternate Reply-To is refused, and sensitive code/security
content cannot become a recruiter draft. No checkpoint/job/observation writes.

Private context/drafts remain outside Git. The new `--test-reply` sending option
requires the separately prepared matching private test context, preview and SEND.
Real drafting remains assistant-operated, source-backed and reviewed; no autonomous
responder or model API is enabled. User-provided samples and the requested personal
writing guide were saved in the user layer and linked from custom instructions.
The guide draws carefully from Wikipedia and the supplied fiction research without
claiming an email detector or copying private writing into shared files.

Next user step: reply to the original test with Test received, then run
`npm run gmail:reply -- -a`. Live context/thread acceptance is not yet verified.
Validation: 308 full relevant checks passed, zero failures/skips (three browser
cases excluded); final focused reply suite passed 15/15 including the subsequently
added private-preview binding test. Syntax/diff checks pass. No agent mailbox call.
Earlier entries describe previous acceptance states.

## Reviewed Gmail sending prepared — 2026-11-10

See [CC-012](tasks/CC-012.md) and [sending setup](../GMAIL_SENDING.md).
User authorized a separate send flow and supplied personal email-style samples;
personal records remain in the user layer, never shared source or this handoff.
Default sync remains exact readonly, one hour/10 messages/one page. The separate
command requests readonly + gmail.send, verifies account/audience/scopes, previews
one exact plain-text message and requires literal SEND before OAuth and dispatch.
No background responder, model API, application submission or status change.

Hashed attempts are reserved with the existing ledger owner writer before POST.
Accepted/uncertain attempts block duplicate dispatch, including after restart.
No retries or automatic reconciliation. Replies require a private reviewed file,
existing job/exact sender rule and manually verified thread headers; they do not
yet have automatic incoming-thread provenance or reply orchestration.

294 relevant offline tests pass, zero failures/skips; three browser-launching
cases excluded by name. Includes 16 new sending/style/CLI/OAuth regressions.
No live send or mailbox access during development. User must add only gmail.send
in the existing Google project, preview with `npm run gmail:send -- --preview`,
then run `npm run gmail:send`, review, type SEND and complete fresh browser consent.
First acceptance is a clearly marked test to the configured original address;
actual Gmail send receipt and recipient delivery remain unverified.

## Gmail provider failure fixed; controlled live list verified — 2026-11-10

See [CC-011](tasks/CC-011.md). Safe diagnostics identified the actual failure:
a user-operated Gmail message-list GET returned HTTP 204 No Content, and the
adapter tried to JSON-decode its empty body. The generic provider error was a
response parsing failure, not OAuth/permissions/WSL forwarding. The list now
includes resultSizeEstimate; 204/ambiguous empty JSON is incomplete without
checkpoint advancement, while explicit zero-result JSON can complete a window.

The user's subsequent real message-list GET returned HTTP 200 with validated
response and idle/incomplete=false. A sanitized local health read corroborated
the complete checkpoint. This verifies actual bounded list access, not live
sender provenance, forwarding/classification or application outcomes. No private
messages, addresses, IDs, times, codes or credentials are reproduced here.

Added safe sync-stage/reason diagnostics and one-hour maximum enforcement;
10-ID/one-page limits, exact readonly OAuth, CAS/replay/dedup, Outlook state and
all submission/code-use/status gates remain. Short retry command:
`npm run gmail -- -a -d`. Diagnostics alone never authorize; -a is explicit.
278 offline tests pass, including 17 new provider regressions. No new dependency,
permission, cloud/billing, browser automation or message modification occurred.
Agent work used local sanitized health and fictional tests; actual mailbox
requests were initiated by the user in their terminal under explicit flags.
Next work can validate selective redirected-message matching with user-selected
sender/job rules; that remains separate from the now-passing list acceptance.
Earlier entries below describe historical pending states.

## Gmail post-callback diagnostics — 2026-11-10

See [CC-010](tasks/CC-010.md) and [Gmail troubleshooting](../GMAIL.md).
User's old callback page confirms state/code acceptance by WSL. Current synthetic
Windows-to-WSL forwarding passed, and credential-free public Google HTTPS checks
succeeded. No private config/credentials, live code exchange, Gmail profile or
messages were accessed; user prohibited mailbox access during diagnosis.

Added sanitized per-stage diagnostics and a --diagnostics flag. Callback success
no longer implies authentication success in the browser page. Listener lifetime
and IPv4-only binding are verified through pending verification and cleanup.
Fixed SDK auth retry overrides with explicit retryConfig.retry=0/no retries;
one-time code exchange cannot silently replay after uncertain outcome. A closed
API-disabled error signal is recognized without logging provider text. PKCE,
state, exact Gmail readonly/audience/account checks and private storage remain.
261 offline checks pass, including 12 actual-SDK/synthetic-response regressions.
No Windows network settings, OAuth permissions, credentials or mailbox changed.

The exact downstream historical error was discarded by the old generic handler;
do not invent its cause or claim live sign-in is fixed/verified. Next step is the
user's fresh authorized one-hour/10-ID retry with --diagnostics using existing
private config. Ask only for sanitized failure JSON if needed, never callback
parameters or credentials. No agent live connection or mailbox read is authorized
by the diagnostic request. Older entries below are historical.

## Dedicated Gmail receiver — 2026-11-10

See [CC-009](tasks/CC-009.md) and [Gmail setup/runbook](../GMAIL.md).
User authorized a dedicated Gmail receiver/original MSN mapping and code work,
but explicitly withheld connection access. Actual addresses belong only in
private local config, not shared project docs. No actual OAuth client config,
account, token cache or mailbox was opened or changed. Initial HEAD `92b7e0d9`
was clean. Google registration and connection acceptance remain pending.

Implemented a Google SDK desktop OAuth/PKCE session-only flow with strict
`gmail.readonly`, audience and receiving-profile checks. CLI `init` is offline;
`first-sync` and `preview` require explicit `--authorize-connection` plus normal
browser consent. No refresh-token persistence, app password or billing service.
Use Outlook Redirect to for original headers; ordinary inline/attached forwards
are deliberately skipped. Original application recipient and original Date are
validated independently from receiving account/internalDate. All observations
remain review-only, with security-mail exclusions and no usable code output.

Gmail reuses the coordinator, analyzer, ledger writer and recovery. Provider-safe
health is `gmailMailboxHealth`, independent of Outlook's unchanged `mailboxHealth`
under the same lock. Setup nonce/receiving/original-address binding protects
checkpoints and dedup namespaces. No second tracker or application status writer.
The initial read defaults to one hour, one page/10 IDs, up to 10 envelopes and
10 matched bodies; no continuation/retry. Current UI mailbox cards remain Outlook.

Validation: 249 offline tests pass, 0 fail/skip (three browser cases excluded),
including 26 Gmail cases and existing Outlook/application safety/projection/
persistence tests. Added exact Google SDK 11.3.4 and email-addresses 5.0.0 with
install scripts disabled. npm audit's two moderate existing MSAL/uuid findings
were recorded without a forced major upgrade. No private data/deployment/push.

Next requires the user: create a no-billing Google project, enable Gmail API,
External/Testing audience with dedicated test user, Desktop client, exact read-only
scope, download JSON to a private Linux path outside Git, then offline init with
the user-provided addresses. Do not initiate any sign-in/profile/mailbox request
until explicit connection permission arrives. No Microsoft password/tenant is
needed for this Gmail path. Keep all submission/code-use/status gates disabled.
Earlier entries below describe historical scopes and checkpoints.

## Controlled personal Outlook first-sync — 2026-11-10

See [CC-008](tasks/CC-008.md) and the rewritten [Outlook runbook](../OUTLOOK.md).
Initial Git verification: HEAD `a97b6249`, clean tree, both previous commits
completed. New code wires `first-sync --hours 1` through normal Microsoft
sign-in, the existing Graph adapter/analyzer/coordinator and owner writers in
one process. Default session-only credentials now work for a complete invocation;
tokens are not serialized. Every CLI read is capped at 24 hours, one page and
10 metadata messages, with at most 10 matched detail reads. No auto pagination,
status transition, code use, submission or retry. Output contains bounded counts.

Fixed missing lock options, unsupported MSAL cache clearing, scope/account
rejection, initial protected-file permissions, native Windows ACL checks and
provider-window/duplicate/detail validation. Added an isolated synthetic native
vault test for user execution. 223 offline tests pass, 0 fail, 0 skip (three
browser cases explicitly excluded). The task lists exact acceptance commands.

Preflight confirms WSL lacks a loadable native extension, acquired Secret Service
and LibSecret build metadata. Native Windows Node exists; actual DPAPI/ACL and
restart/interruption/cross-user acceptance remains unrun. Recommended immediate
path: user-run session-only WSL first read after a personal-account public-client
registration and Microsoft consent. Windows protected persistence remains opt-in
and requires documented setup/testing; it uses a separate explicit data root.

Next requires user participation: app registration/client ID, Microsoft sign-in
and consent, localhost callback, optional native vault setup. No account/config,
cache contents or mailbox were accessed during development. No package install,
cloud provisioning, submission, remote push or autonomous behavior occurred.
Do not claim live acceptance from mock tests. Earlier handoff entries below are
historical; they describe their original checkpoints and authorization scope.

## Interrupted sync reconciliation — 2026-11-10

Readiness and bounded sync are committed at `7ca248e4` (local only; no push).
Added [CC-007](tasks/CC-007.md): local redacted recovery inspection plus explicit
abandonment of a recorded syncing run. CLI is
`node scripts/outlook-sync-recovery.mjs status` or `abandon` with run ID,
expected revision and `--acknowledge-worker-stopped`. No command was run against
actual private data; CLI tests use temporary fictional data roots.

Recovery uses the existing mailbox owner writer/CAS and preserves observations,
application states, account/scope and the last successful checkpoint. It never
replays inspection or claims completed coverage. Worker-stop acknowledgment is
human supplied, not a verified lease. Repeated/stale/wrong-run requests refuse
writes. Legacy mailbox metadata remains untouched for review. No live command,
OAuth, mailbox read, dependency installation, deployment or submission is enabled.

Final verification: 98 focused tests passed, 0 failed; whitespace check passed.
Next local work: provider-record and bounded-coverage validation in inspection,
using fictional provider responses before live entry-point integration. Native
vault/account-binding validation and live M3D acceptance remain unrun. Older
uncommitted-state notes below describe their original session checkpoints.

## Bounded sync continuation — 2026-11-10

Implemented the local bounded sync coordinator; see [CC-006](tasks/CC-006.md).
It uses the existing mailbox health owner writer and injected inspection and
observation-persistence capabilities. Tests connect the real analyzer and
observation writer using fictional messages. No live entry point/polling loop is
wired. Successful complete windows publish a checkpoint only after observation
persistence; partial/failing/uncertain runs retain the previous checkpoint.
Replays require reconciliation without repeating inspection, and active backoff
blocks inspection. Scope is explicitly `all_messages`, matching the existing
Graph endpoint. Authentication/identity validation remains the future caller's
responsibility; the coordinator never declares a connection authenticated.

Final focused regression: 90 passed, 0 failed (sync/readiness/platform/persistence/
Outlook suites). No dependency installation, live authentication, Graph read,
private record write, submission, staging, commit or push occurred. Changes from
both local continuations remain uncommitted. Next: review the coordinator's local
contract and design explicit interrupted-run reconciliation before wiring any
live command. Vault validation and bounded live sync acceptance remain unrun.

## Local continuation — 2026-11-10

The cumulative foundation checkpoint is committed as `e7ce36f9` on
`career-central/pre-m3d-stabilization`, and the private `personal` remote branch
was verified at the same commit. The working tree was clean before this session.
The older staging, missing-author and missing-GitHub-CLI notes below are historical,
not current blockers. This session has not staged, committed or pushed changes.

Added `node scripts/outlook-readiness.mjs`: a bounded local capability diagnostic,
with redacted JSON and exit 2 when readiness is incomplete. It imports the native
extension and, on Linux, lists acquired user bus names with a three-second timeout.
It never constructs persistence, opens configuration/token/cursor files, activates
a vault, signs in or contacts Graph. Installation/service presence never proves
vault validation or grants permission. No dependency or credential changes.

Current preflight: WSL/Linux Node 24.20.0; Microsoft extension 1.5.27 cannot load its
native backend; the user Secret Service could not be confirmed; LibSecret build
metadata is absent. Native Windows Node 22.21.0 is available, but DPAPI remains
unvalidated. No Windows dependency installation or vault round trip was performed.

Validation: `node --test tests/outlook-readiness.test.mjs
 tests/career-central-platform-recovery.test.mjs tests/outlook-email.test.mjs`
passed 36/36. The live diagnostic is expected to exit 2 in this environment.

Next local work: use the diagnostic alongside the platform-validation procedure
in PROTECTED_STORAGE.md; mocked contract tests remain distinct from real vault
acceptance. Live sign-in/sync, legacy-cache removal, submissions and deployment
remain separately gated. User authorized continued local project development.

## Historical M3C and stabilization handoff

2026-11-06 — M3C complete locally; pre-M3D stabilization complete. Named branch `career-central/pre-m3d-stabilization` is based on `d3fc7d1`. M3D live OAuth/Graph connection, browser automation, submissions and AWS remain unauthorized.

Start with [CURRENT_STATE](CURRENT_STATE.md), authoritative [STATUS](STATUS.md), [CC-005](tasks/CC-005.md), [CC-004](tasks/CC-004.md), [PERSISTENCE](../../lib/career-central/PERSISTENCE.md), and [protected Microsoft storage](../../lib/email/PROTECTED_STORAGE.md). Read applicable original/scoped AGENTS instructions; none were changed. Preserve all prior uncommitted M0.5/M1/M2/M3A/M3B/application/email work.

Implemented: validated worker metadata survives existing scheduler cycles; typed v2 worker/mailbox publication uses the existing scheduler/ledger owner locks and files. Revision CAS, exact idempotent replay, monotonic worker sequences/explicit sessions, checkpoint/account/scope/backoff guards and provenance are enforced. Shared bounded safe IO flushes temps, checks source/temp integrity and atomically replaces; uncertain commits remain explicit. Recovery only removes recognized dead-owner temps under the existing lock, never promotes them or repeats an action. Canonical health consumes v1/v2 metadata; existing cards display bounded recorded state/quality without new action endpoints.

No producer loops, cursor backend, receipt artifact verifier, live probes or application actions are enabled. New functions are explicitly invoked local APIs only. Actual canonical/private records, approved documents, submission policies/gates, credential caches and instructions remain unchanged. Application-ledger IO was hardened but status transitions, approval binding and duplicate prevention were not changed. No new dependency.

Verified on Node v24.20.0/Linux: **323 focused tests passed, 0 failed/skipped**, including 44 new persistence cases and scheduler/approval regressions. Three browser-launching tests were explicitly excluded by name, not counted as passes/skips. **1 HTTP-only production smoke passed, 0 failed/skipped**; Next starts directly with temporary fictional data, without server.mjs/PDF-worker/browser/client execution. Typecheck/build exited 0; only the pre-existing CV Studio broad-filesystem-tracing warning remains. Exact commands in CC-004. Full repository/browser/native Windows/WSL suites not run. Initial fixture conflict and retry prevalidation ordering were corrected before the final passing run.

Preservation: 598-file initial baseline checked; only documented core/web/context edits differ, no new private-source files. Nothing staged/committed. Do not indiscriminately stage/reset the dirty tree or publish local build artifacts.

Important limits:

- Recorded connected/online is source metadata, not independent/live authentication or execution authority. Application independent-confirmation counts stay null.
- Owner locks coordinate trusted local writers; portable path checks cannot sandbox malicious same-user filesystem races. Real local paths required; symlink/junction/hard-link aliases are rejected.
- Files are bounded to 8 MiB; exact replay history is 128 operations. Evicted old commands fail stale revision. Directory fsync is best effort when unsupported; power-loss behavior across Windows/network filesystems is not certified.
- Existing account/scope and successful checkpoints cannot be silently rebound/reset. Legacy v1 mailbox metadata without an account identity requires explicit future migration.
- Cursor storage is interface-only; no plaintext fallback. No remote producer authentication or signed replay protocol is implemented.

M3C added session-only-by-default OAuth storage, an opt-in Microsoft OS-protected cache, a protected cursor contract/store, and fictional producer integration against M3B writers. Actual environment was WSL2/Linux; D-Bus existed but `org.freedesktop.secrets` and the native keytar binding were unavailable. Persistent mode failed closed. No native Windows DPAPI run, real Secret Service persistence, OAuth, Graph read, mail or submission was exercised.

Recommended next separately approved milestone M3D: prepare the pre-existing legacy token cache safely (identify its location without reading contents, revoke/remove only after explicit user approval), establish and verify one supported OS vault, then request authorization for a bounded read-only Microsoft sign-in and first sync. Keep code use and application submission separately disabled. Do not start M3D from this handoff alone.

## Pre-M3D stabilization

Git inventory: 6 modified tracked files and 77 untracked paths, all classified as Career Central/application/Outlook/web project code, tests or documentation. No unrelated path or private runtime-data path was identified. A path-only scan found no candidate name, phone or email in these files; fictional test credentials remain test-only. Exact inventory is in [PRE_M3D_INVENTORY](PRE_M3D_INVENTORY.md). No blanket stage/clean operation was used.

Checkpoint: the 84 explicitly enumerated paths in that inventory are staged for review; no private/runtime files are staged. `git diff --cached --check` passed. A commit was not created because this repository has no configured `user.name` or `user.email`; do not invent an author identity. Once the user configures/approves the commit identity, review the staged diff and commit this checkpoint. Branch remains `career-central/pre-m3d-stabilization` at base `d3fc7d1` until that commit.

OAuth review: session mode supplies MSAL an empty cache configuration, so MSAL keeps tokens in process memory and they disappear on exit. Protected mode is explicitly opt-in; the Microsoft persistence extension sets Linux plaintext fallback false and errors fail closed. Automatic legacy `msal-cache.json` reading/writing is absent. The legacy path is checked only with `existsSync`; `disconnect` leaves any legacy file untouched and warns. The focused M3C + Outlook suite passes 32/32, including a synthetic legacy file byte-preservation test and persistent-backend fail-closed test. No real configuration/cache or account was opened.

Dependency policy: root package manager remains npm with no `packageManager` field. The root `package-lock.json` is ignored by existing `.gitignore`; the web app's `web/package-lock.json` is tracked and unchanged. MSAL extensions is pinned directly at 1.5.27 to match the existing MSAL Node 3 line, but transitive root dependencies are not reproducibly locked. `keytar` 7.9.0 has a native install script (`prebuild-install || node-gyp rebuild`); Linux source builds need `libsecret-1-dev` and an active user Secret Service. The previous install used `--ignore-scripts`, so this WSL environment has no native binding. No package manager or lock policy was changed.

Required before persistent mode/M3D: validate native Windows Node under the intended Windows user with DPAPI save/restart/load, permissions under another user, interrupted-write recovery and no plaintext cache; separately validate WSL/Linux only after an actual Secret Service and native binding are present. Do not substitute Windows PowerShell DPAPI from WSL. Current WSL D-Bus lacks `org.freedesktop.secrets`; native Windows Node was not run.

## Private GitHub backup preflight

Local `origin` is still the upstream `https://github.com/career-ops-hq/career-ops.git`; it was not changed. The upstream repository is public and MIT-licensed; preserve the root LICENSE and existing attribution. The checkout is shallow, so fetch the complete upstream history before creating an independent private backup repository. Recommended future setup: create an empty private `adpulay/career-central` repository, add it as a separate `personal` remote, retain `origin`, then push only after a separate explicit approval. Do not mirror private runtime data or credentials.

`gh` is not installed, so GitHub CLI authentication as `adpulay` could not be checked. Local Git author name is set to the user-provided `adpulay`; email remains unset because no verified GitHub noreply address is available. No commit was made. The user must install/authenticate `gh` and provide/verify the noreply address in GitHub account settings before the staged checkpoint can be committed.

The staged content scan found zero AWS keys, GitHub tokens, private-key blocks, bearer credentials, phone numbers or candidate identifiers. Email-like strings are limited to reserved `.invalid`/`.test` test addresses and the upstream package maintainer's public `santifer.io` attribution. Credential-field matches are redaction test fixtures only. The test fixture formerly using a real mail-provider domain was changed to `example.invalid`. The 84-file staged project checkpoint passes the focused Career Central/Outlook/projection tests (73/73 before this scan; 32/32 after the fixture correction) and cached diff checks.
