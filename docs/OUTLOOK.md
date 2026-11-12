# Controlled read-only Outlook integration

The personal-account path uses the existing Microsoft MSAL public client,
consumers authority, authorization code flow with PKCE/state, Graph GET adapter,
application-mail analyzer, bounded coordinator and locked observation writer.
MSN, Outlook.com, Hotmail and Live personal accounts are supported by Microsoft.
No live sign-in or mailbox read has been performed for the current acceptance.

## Recommended first use: session-only WSL

A protected vault is not required for an interactive session whose tokens remain
in process memory. `first-sync` signs in and reads within that same process;
exiting discards the token cache. A standalone session-mode `connect` cannot
supply credentials to a later CLI invocation. Use the combined command below.
This uses Microsoft's normal sign-in and consent; it does not bypass either.

Current preflight: WSL/Linux Node 24.20.0; native Windows Node 22.21.0 is available.
The WSL native MSAL extension cannot load, no acquired Secret Service is present,
and `pkg-config --exists libsecret-1` fails. Persistent WSL credentials remain
unavailable. Native Windows ACL/DPAPI behavior has not been validated here.
`node scripts/outlook-readiness.mjs` is a capability check, not vault acceptance;
exit 2 is expected until the relevant prerequisites and real validation exist.

## Register or verify your Microsoft application

1. Open [Microsoft Entra app registrations](https://entra.microsoft.com/).
   You need access to a tenant and permission to register applications. A personal
   mailbox alone does not guarantee app-registration access. If registration is
   blocked, resolve that Microsoft prerequisite or use an existing registration
   you control; do not borrow a client ID from another app. Microsoft's current
   [registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
   lists its Azure account/subscription, tenant and role prerequisites. No Azure
   resource or subscription is provisioned by Career Ops.
2. Create **Career Ops**, with sign-in audience **Personal Microsoft accounts
   only**, or an audience that also includes personal accounts. Organizational
   accounts only will not work with this integration's `consumers` authority.
3. Under **Authentication**, add **Mobile and desktop applications**, custom
   redirect URI **`http://localhost/callback`**. Use a public/native client, not
   Web or SPA. The code uses a random loopback port. Microsoft's
   [localhost redirect rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#localhost-exceptions)
   allow that port variation. Do not enable implicit grants or create a secret.
4. Under **API permissions**, retain only **Microsoft Graph → Delegated →
   Mail.Read** as the resource permission. Remove default `User.Read`, if present.
   Add no `Mail.Send`, `Mail.ReadWrite`, shared-mailbox or application permissions.
   MSAL adds standard `openid`, `profile`, `offline_access` sign-in/refresh scopes;
   these are allow-listed, and every unexpected returned resource scope is
   rejected before Graph access. Rejected accounts/scopes trigger MSAL account
   removal from this application's cache; provider failures remain redacted.
5. Copy the **Application (client) ID**. Do not share passwords, tokens, OAuth
   callback URLs, refresh tokens, or mailbox verification codes with the agent.

[Delegated Mail.Read](https://learn.microsoft.com/en-us/graph/permissions-reference#mailread)
is available to personal Microsoft accounts and permits reading their mailbox.
`Mail.ReadBasic` excludes bodies; the existing analyzer needs selected bodies for
confirmation/rejection/interview classification. Thus `Mail.Read` is the minimum
mailbox permission for this implementation. Consent covers the mailbox; the
small window is enforced by our code, not by Microsoft's permission grant.

## First controlled read (run yourself in WSL)

From the repository root, using Linux `node` (not `node.exe`):

```bash
node scripts/outlook-email.mjs init --client-id YOUR_APPLICATION_CLIENT_ID --account YOUR_ADDRESS@msn.com
CAREER_OPS_OUTLOOK_CREDENTIAL_MODE=session node scripts/outlook-email.mjs first-sync --hours 1
```

Skip `init` if private configuration already exists. If an older configuration
lacks an opaque mailbox identity, explicitly migrate only that field first:

```bash
node scripts/outlook-email.mjs migrate-identity
```

Open the authorization URL printed by `first-sync` in your browser on this same
computer. Keep the terminal running. Select the intended personal account and
review the read-mail/sign-in consent. Complete any MFA Microsoft requires. The
loopback callback expires after five minutes. WSL's localhost forwarding must
let the browser reach the callback. If it cannot, fix that local connectivity or
use a native Windows working copy; never bind the callback to a public interface
or paste an authorization code into chat.

The configured account must match the username MSAL returns. If Microsoft uses
a different primary alias, stop and review your account configuration/alias;
there is no automatic alias switch or acceptance of an unrelated account.

The command:

- Reads one metadata page of at most **10 messages** from the last **one hour**.
  All preview/sync CLI paths have a hard **24-hour** lookback ceiling, one page
  and 10-message cap, regardless of larger settings in old configuration.
- Fetches at most 10 details, only for configured exact sender/recipient/job-time
  matches. No sender rules means metadata-only inspection and zero matches.
- Uses only GET on the exact HTTPS Graph message collection/detail endpoints,
  with redirects refused. There is no send, delete, move, update or mark-read
  operation. No attachment, remote image, email link or instruction is executed.
- Prints bounded counts/coverage flags. It records only review observations and
  operational health, never raw subjects, bodies, tokens, cursor URLs or codes.
  A confirmation may propose a status; it cannot change job status or submit.

`incomplete: true` / exit 2 means the page cap or a failure prevented complete
window coverage. It will not fetch another page or retry automatically. A complete
result / exit 0 means only that explicitly bounded window, not all mail, was
processed. Exit 1 indicates a CLI/authentication/configuration failure. Check
recorded state after any uncertain publication instead of assuming rollback.

To inspect without writing observation/health records, with a separate explicit
sign-in in the same process:

```bash
CAREER_OPS_OUTLOOK_CREDENTIAL_MODE=session node scripts/outlook-email.mjs preview --interactive --hours 1
```

Only if you already have an application job and an independently verified sender:

```bash
node scripts/outlook-email.mjs trust-sender --job-key EXISTING_JOB_KEY --sender VERIFIED_SENDER_EMAIL
```

This adds a filter, not proof of authenticity. No address is preapproved or
guessed. All classifications retain `requiresReview: true`,
`senderAuthentication: not-live-validated`, and `codeUseAllowed: false`.
No generic or autonomous submission capability is imported by these commands.

## Optional native Windows protected credentials

Use this only if you want credentials to survive process exit. Run native Node
and PowerShell on the intended Windows account, in a Windows working copy with
its own Windows-installed dependencies. Do not reuse WSL `node_modules` or call
Windows DPAPI from WSL. Windows uses Microsoft's **CurrentUser DPAPI**, encrypted
files, and explicit DACL checks; POSIX chmod bits do not prove Windows privacy.
The validator accepts allow rules only for the current user and SYSTEM, requires
current-user ownership, and fails closed if ACL inspection is unavailable.

In a native Windows checkout, install the existing declared dependencies:

```powershell
npm install --ignore-scripts
npm rebuild keytar
node scripts/outlook-readiness.mjs
```

Rebuild downloads a compatible native binding or requires Microsoft's C++ build
tools/Python if no compatible prebuild exists. Readiness may load the extension
without proving its DPAPI component works. The synthetic restart test below is
required before selecting protected mode. These Windows operations were not run
in the current WSL session.

Create a **new** private Windows state directory, with inheritance removed and
current-user-only access. This setup refuses to replace an existing directory:

```powershell
$careerState = Join-Path $env:LOCALAPPDATA 'CareerOps-Outlook'
if (Test-Path -LiteralPath $careerState) { throw 'Directory exists; review its ACLs rather than replacing it.' }
New-Item -ItemType Directory -Path $careerState | Out-Null
$careerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$careerAcl = New-Object System.Security.AccessControl.DirectorySecurity
$careerAcl.SetOwner($careerSid)
$careerAcl.SetAccessRuleProtection($true, $false)
$careerRule = New-Object System.Security.AccessControl.FileSystemAccessRule($careerSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$careerAcl.AddAccessRule($careerRule)
Set-Acl -LiteralPath $careerState -AclObject $careerAcl
$env:CAREER_OPS_ROOT = Join-Path $careerState 'Data'
$env:CAREER_OPS_OUTLOOK_AUTH_DIR = Join-Path $careerState 'Auth'
New-Item -ItemType Directory -Path $env:CAREER_OPS_ROOT, $env:CAREER_OPS_OUTLOOK_AUTH_DIR | Out-Null
$careerTestId = [guid]::NewGuid().ToString('N')
node scripts/outlook-vault-test.mjs save --test-id $careerTestId
```

Note the test ID (it is synthetic, not a credential). Start a **new PowerShell
process under the same Windows user**, enter the same checkout, restore paths,
then verify decryption after the Node process restart and delete the test entry:

```powershell
$careerState = Join-Path $env:LOCALAPPDATA 'CareerOps-Outlook'
$env:CAREER_OPS_ROOT = Join-Path $careerState 'Data'
$env:CAREER_OPS_OUTLOOK_AUTH_DIR = Join-Path $careerState 'Auth'
node scripts/outlook-vault-test.mjs verify --test-id THE_TEST_ID_FROM_SAVE
```

Both commands must print `result: passed`. Verification also rejects a plaintext
synthetic value in the native cache file. No token/cache is opened by this test:
it uses a separate service/account label and `vault-tests` subdirectory. If a test
was interrupted, `delete --test-id THE_TEST_ID` removes only its synthetic entry.
A pass does not certify cross-user isolation or interrupted-write durability;
those native platform checks remain unrun. Test only with synthetic entries if
you perform those additional checks. Persistent mode remains opt-in.

After a successful storage test, initialize the Windows private configuration
using your client ID/account, then:

```powershell
$env:CAREER_OPS_OUTLOOK_CREDENTIAL_MODE = 'protected'
node scripts/outlook-email.mjs first-sync --hours 1
```

This Windows data root is separate from existing WSL application records; it
will have no sender/job matches unless deliberately populated. Do not copy or
merge trackers/ledgers casually. The current WSL session-only path uses your
existing data root and avoids this platform/data migration for the first read.

For WSL persistence instead, install the native build prerequisites
(`build-essential`, `pkg-config`, `libsecret-1-dev`) and configure a real,
password-protected, unlocked user Secret Service in your Linux session, then
rebuild `keytar` and run the synthetic save/restart/verify test. D-Bus alone is
insufficient. Never use an empty keyring password or plaintext fallback.

## Recovery, legacy storage and disconnect

Private config: `{DATA_ROOT}/data/application-automation/outlook.json`.
User-layer files must stay out of Git. Existing `msal-cache.json` is detected by
existence only, warned about, ignored and never migrated/deleted. Review its
revocation/removal separately. Do not open it in agent output.

The CLI holds its session lock over sign-in, refresh and bounded inspection.
The existing ledger lock/CAS protects health and evidence. The owner writer
cannot promote incomplete/failed windows to successful checkpoints. Interrupted
syncs require explicit recovery after stopping the original worker:

```bash
node scripts/outlook-sync-recovery.mjs status
node scripts/outlook-sync-recovery.mjs abandon --run-id RUN_ID --expected-revision REVISION --acknowledge-worker-stopped
```

Recovery never replays mail or changes application status. Failed runs with
uncertain observation writes remain reviewable; do not assume an exactly-once
transaction across observation and checkpoint commits.

In the credential mode used for the connection:

```bash
node scripts/outlook-email.mjs disconnect
```

For protected credentials set the same protected-mode environment variable and
private directory first. Disconnect uses MSAL's `getAllAccounts`/`removeAccount`
API to remove cached account credentials; it does not delete mail or revoke
Microsoft-side consent. Remove the app permission in your Microsoft account's
app-permissions settings to revoke remote access. Session-only tokens disappear
when their process exits, though the remote consent remains until revoked.

## Regression validation

```bash
node --test tests/outlook-controlled-sync.test.mjs tests/outlook-email.test.mjs tests/outlook-bounded-sync.test.mjs tests/outlook-sync-recovery.test.mjs tests/outlook-readiness.test.mjs tests/career-central-platform-recovery.test.mjs tests/career-central-persistence.test.mjs
```

All mailbox/OAuth tests use fictional data and injected Microsoft responses;
loopback OAuth tests contact only localhost. Native Windows ACL/DPAPI, a working
Linux Secret Service, real Microsoft consent, Graph retrieval and sender
provenance remain live acceptance steps, not claims established by mocks.
