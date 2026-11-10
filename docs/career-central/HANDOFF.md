# Latest handoff

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
