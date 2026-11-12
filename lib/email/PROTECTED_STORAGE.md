# Protected Microsoft credential and cursor storage (M3C)

No Microsoft account was authenticated and no Outlook configuration or cache was read during M3C.

## Credential mode

`createOutlookAuth` has two explicit modes. `session` is the default: MSAL uses its built-in in-memory token cache and the process exit discards it. `protected` initializes the Microsoft Authentication Extensions persistence plugin and fails closed if the native protected backend cannot be loaded, validated or used. Linux plaintext fallback is explicitly disabled. The existing legacy `msal-cache.json` path is neither opened nor deleted; `disconnect` clears only the active cache instance. Any old cache needs a separate user-reviewed removal/revocation plan.

The repository pins `@azure/msal-node-extensions` 1.5.27, selected for the existing MSAL Node 3 / MSAL Common 15 line. Microsoft documents its supported mechanisms as Windows DPAPI (current user) and Linux Secret Service via LibSecret. The package has native platform components. A runtime package/backend failure is reported only as `PROTECTED_BACKEND_UNAVAILABLE`; no provider exception or token is relayed. The library configuration sets `usePlaintextFileOnLinux: false` and disables PII logging. Microsoft documents Windows/Linux protected cache access as scoped to the current user session; this does not protect against other code running as the same user.

Persistent authentication is opt-in with `CAREER_OPS_OUTLOOK_CREDENTIAL_MODE=protected`. New private Outlook configuration records now receive a cryptographically random opaque `accountId`; it is used as the credential-store account label. Existing configurations without that identity cannot use protected mode until deliberately migrated. The human email address is used only for the OAuth account-selection and verification check, not as the keyring account label. Do not place `accountId` in shared documentation.

On Linux/WSL, the extension requires a working user Secret Service and native dependencies; a D-Bus address alone does not prove the service exists. WSL Secret Service is not assumed. If unavailable, use `session` mode or install/configure a supported user vault before selecting persistent mode. There is no custom encryption, environment-variable token cache, plaintext file fallback or automatic cache migration.

## Protected Graph cursor store

`createOsProtectedCursorStore` uses the same Microsoft OS protection implementation, separated by fixed service name and opaque account/scope/checkpoint-derived key labels. The cursor record schema v1 is validated inside the protected store and contains `accountId`, `scopeFingerprint` (SHA-256 of canonical scope configuration), `checkpointId`, `revision`, `revoked`, and cursor material plus an integrity digest. Record values are persisted only through the OS-protected persistence provider. The cursor is returned only within the trusted `withCursor` callback; metadata inspection returns revision/presence only. Do not call this from a dashboard/API reader, log callback arguments, or include them in AI prompts.

Every write is compare-and-swap under a cooperating cross-process owner lock. Replaying the current cursor is idempotent; stale revisions fail. Revocation replaces the record with a versioned tombstone so an old update cannot silently restore it. Account switching uses a different random opaque account identity; folder/scope and checkpoint identities also partition the protected key. Reinitializing an account/scope or rotating the cursor means explicitly revoking the old checkpoint and establishing a new checkpoint identity. There is no silent reset or claim of full mailbox coverage.

This is a local synchronous-worker capability, not a Graph sync implementation. A future producer must first verify the mailbox identity through MSAL, map it to the configured random opaque ID, and coordinate the cursor CAS with M3B mailbox evidence. A crash after Graph returns but before cursor/evidence commit remains incomplete/uncertain and must reconcile through bounded replay; never infer successful coverage from an HTTP response alone.

## Platform validation

Current execution environment: Node 24.20.0 in WSL2/Linux (`Ubuntu`), with `wsl.exe` and `powershell.exe` interop. Native Windows Node execution was not performed. A user D-Bus is reachable, but `org.freedesktop.secrets` is unavailable (`busctl --user status org.freedesktop.secrets` reports no service). The extension package is present, but its native `keytar` binding was not built in this sandbox (`--ignore-scripts` was used to avoid package install side effects), so protected persistence cannot be exercised here and must fail closed. No test has claimed DPAPI or LibSecret success.

Native Windows validation remains required on the intended Windows account: run a clean Node session with the persistence mode selected, validate a save/load/delete round trip through the current-user DPAPI-backed extension, restart Node and verify same-user recovery, verify a different Windows user cannot decrypt, interrupt a write, and confirm no plaintext token/cursor file appears. On WSL/Linux, configure a real Secret Service for the same Linux user, verify service presence and native binding, run the equivalent round-trip/restart/interruption tests, then repeat with the service stopped to prove fail-closed behavior. Do not use Windows DPAPI from WSL via PowerShell as a fallback; that would create an unreviewed cross-identity credential boundary.

M3C automated tests use in-memory fictional secret providers and real local M3B operational writers. They establish contracts and redaction, not OS-vault encryption or native filesystem behavior.

## Local readiness diagnostic

Run `node scripts/outlook-readiness.mjs` from the repository. It emits bounded,
redacted JSON and exits 2 while prerequisites or real vault validation remain
incomplete. It loads the native extension and lists acquired Linux user bus names
with a three-second subprocess timeout; it does not construct persistence or open
configuration/cache files. A present service and loadable extension are only
prerequisites. The command deliberately cannot certify a save/restart/load,
interruption or cross-user isolation test, and never authorizes live sign-in.

## Interrupted bounded sync recovery

`node scripts/outlook-sync-recovery.mjs status` reads only bounded owner metadata
and reports a redacted recovery candidate. It does not open credentials, message
content or configuration, and does not independently verify worker liveness.
After stopping the original worker, explicit `abandon --run-id ID
--expected-revision N --acknowledge-worker-stopped` records failed/incomplete
through the existing mailbox writer, preserving the successful checkpoint.
It never replays mail inspection or observation persistence. A fresh sync is a
separate invocation. See [CC-007](../../docs/career-central/tasks/CC-007.md).

## First-live preparation (CC-008)

The session-only path now signs in and inspects within the same `first-sync`
process; no persistent-vault prerequisite is needed for that path. See the
[runbook](../../docs/OUTLOOK.md) for one-hour/10-message acceptance and optional
native Windows setup. The protected factory precreates its cache owner-only,
refuses unsafe existing aliases/permissions and vendor scratch files, and
serializes cooperating validation in one directory. Native Windows uses explicit
DACL checks for owner and current-user/SYSTEM-only allow rules, rather than
POSIX mode assumptions. These checks do not defeat malicious same-user races or
administrators with takeover privileges, and their native acceptance is unrun.

`outlook-vault-test.mjs` uses isolated synthetic labels and a separate subdirectory
for save/restart/verify/delete. It does not open real OAuth config or caches.
A round-trip does not certify power-loss/interrupted-write durability or cross-user
isolation. Linux still requires real Secret Service and native bindings; there
is no plaintext or WSL-to-Windows DPAPI fallback. MSAL account removal now uses
`removeAccount` with persistence callbacks; it does not revoke remote consent.
