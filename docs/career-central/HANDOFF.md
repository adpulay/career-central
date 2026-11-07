# Latest handoff

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
