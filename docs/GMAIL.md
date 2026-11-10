# Dedicated Gmail receiver for forwarded recruiting mail

The Gmail receiver is an opt-in local CLI alongside the preserved Outlook/Graph
integration. Keep the existing application email as the original recipient;
configure a separate receiving Gmail account. Personal addresses belong only in
private runtime configuration, never this runbook or shared project docs.

Initial development used fictional responses. The user-run controlled message-list
acceptance now passed with HTTP 200 and a complete bounded checkpoint; see
[CC-011](career-central/tasks/CC-011.md). This does not validate live sender
provenance or forwarded-message classification. Local setup remains offline.
Live commands require an explicit `--authorize-connection` flag in addition to
normal Google browser sign-in and consent. An agent must separately obtain the
user's explicit connection authorization before invoking those commands.

## Google Cloud configuration (no billing)

Use the dedicated receiving Google account in the browser:

1. Open [Google Cloud Console](https://console.cloud.google.com/), create a project
   named **Career Ops Mail**, and choose **No organization** if prompted. Do not
   activate the paid/free-trial billing workflow or attach a billing account.
2. Open **APIs & Services → Library**, find **Gmail API**, and click **Enable**.
3. Open **Google Auth Platform → Branding** and choose **Get started**, if shown.
   App name: **Career Ops Mail**. Use your dedicated account for support/contact.
4. Under **Audience**, choose **External**, keep publishing status **Testing**,
   and add only your dedicated receiving Gmail address as a test user.
   Personal accounts cannot use an organization's Internal audience.
5. Under **Data Access → Add or remove scopes**, select only:

   ```text
   https://www.googleapis.com/auth/gmail.readonly
   ```

   Do not add `gmail.modify`, `gmail.send`, `mail.google.com`, Drive or other
   account permissions. No extra OpenID/profile scope is needed: account binding
   uses Gmail's read-only profile endpoint after validating the token's audience
   and exact scope. The MSN account is never authenticated by this adapter.
6. Under **Clients → Create client**, choose **Desktop app**, name it **Career Ops
   local**, and download the client JSON. It must have an `installed` section;
   a Web client, API key, service account or app password is not supported.

Google's [Workspace setup documentation](https://developers.google.com/workspace/guides/get-started)
explicitly says supported Workspace APIs do not require Cloud Billing.
See the [desktop OAuth guide](https://developers.google.com/identity/protocols/oauth2/native-app),
[Gmail scope reference](https://developers.google.com/workspace/gmail/api/auth/scopes)
and [Gmail profile endpoint](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile).
If a page asks for payment information, stop; that is not part of this setup.

Testing-mode authorizations expire after seven days. This initial implementation
requests online access and signs in afresh for each invocation; it does not save
or refresh tokens. Personal-use verification exceptions exist, but publishing,
background refresh and wider distribution are separate future decisions. See
[Google's audience rules](https://support.google.com/cloud/answer/15549945?hl=en).
Do not bypass a Google block or use another application's client ID.

## Private local setup in WSL (no mailbox access)

Place the downloaded JSON on the Linux filesystem in a private directory outside
all Git repositories. For example, from the repository root:

```sh
mkdir -p "$HOME/.local/state/career-ops/gmail"
chmod 700 "$HOME/.local/state/career-ops/gmail"
install -m 600 /PATH/TO/DOWNLOADED_CLIENT.json "$HOME/.local/state/career-ops/gmail/client.json"
node scripts/gmail-email.mjs init \
  --client-file "$HOME/.local/state/career-ops/gmail/client.json" \
  --account YOUR_DEDICATED_GMAIL_ADDRESS \
  --application-email YOUR_ORIGINAL_MSN_ADDRESS
```

Replace `/PATH/TO/DOWNLOADED_CLIENT.json` with the actual download path (a quoted
`/mnt/c/Users/.../Downloads/...json` path works for a Windows browser download).
Do not paste the JSON/client secret, callback code or tokens into chat. Remove
unneeded downloaded copies yourself once the protected local copy is confirmed.

`init` validates local file type/permissions and writes only private config. It
does not authenticate, issue a request or create application records. Existing
configuration cannot be overwritten silently. Default config path is
`~/.local/state/career-ops/gmail/config.json`; `CAREER_OPS_GMAIL_AUTH_DIR` can select
another private directory outside Git. Symlinks/hard-linked client files, broad
POSIX permissions and credentials inside Git are rejected. Native Windows uses
the existing explicit DACL checks; WSL is the initial recommended runtime.

Client configuration stays outside Git. Access/refresh tokens are never written
to disk, environment variables or the application ledger. Even if Google returns
a refresh token unexpectedly, it is discarded. No vault fallback, plaintext
token cache, browser-password collection or app password is used. Microsoft
configuration and caches are not opened or changed.

## Selective MSN delivery

In Outlook.com, sign in yourself and use **Settings → Mail → Rules → Add new
rule**. Start with one independently verified employer/ATS sender and job-specific
subject context. Set action **Redirect to** the dedicated Gmail address, retain
the original in MSN, and do not add delete or mark-read actions. Avoid global
forwarding and broad rules for the words "code", "security" or "verification".

Microsoft distinguishes [redirection from ordinary forwarding](https://support.microsoft.com/en-gb/outlook/mail/use-rules-to-automatically-forward-messages?nochrome=true):
redirection retains the apparent original sender. This adapter requires intact
original From/To/Cc and Date headers. It checks the original application mailbox,
exact configured employer sender, consistent Sender/From, job timing and
company/requisition context. It does not trust From/To/Date text pasted into a
forwarded body. Ordinary inline forwards and attached `.eml` forwards are skipped;
use **Redirect to** for initial testing. Live redirected header preservation and
sender provenance still need acceptance on the actual messages.

For a known job in the existing application ledger, save a narrowly scoped sender
filter (this edits local config only, without connecting either mailbox):

```sh
node scripts/gmail-email.mjs trust-sender --job-key EXISTING_JOB_KEY --sender VERIFIED_EMPLOYER_SENDER
```

No sender or job association is guessed. Without sender rules, the first read is
metadata-only and produces zero matched observations. A sender filter is not
proof of authenticity. Do not use the dedicated account for unrelated services
or account recovery. Google/MSN account-security mail arriving there is excluded
from application classification, not treated as a recruiting verification.

## First controlled sync — only after explicit connection authorization

The following short command starts Google OAuth and then a bounded mailbox read.
`-a` explicitly authorizes the connection; `-d` enables sanitized diagnostics.
Do not invoke it as an agent until the user explicitly authorizes that connection:

```sh
npm run gmail -- -a -d
```

Open the printed Google URL in a local browser, select only the dedicated Gmail
account, and complete Google's required sign-in/MFA and read-only consent. Keep
the terminal running. The state-checked PKCE callback binds only `127.0.0.1`, has
a random port and expires after five minutes. WSL localhost forwarding must allow
the browser to reach it; never expose it on a public interface. Review an
unverified/testing notice only for the app you created and the exact read-only
permission. Denial stops the operation. Account mismatch or extra granted scopes
fails before any message listing; a read-only profile request verifies identity.

Default window: one hour ending when the command starts; maximum permitted
lookback: one hour. Limits: one ID-list page of at most 10 distinct message IDs,
up to 10 metadata GETs, and up to 10 detail GETs for approved application-envelope
matches. One identity-only profile GET also occurs after scope validation. The
adapter never follows a next-page token or automatically retries mailbox reads.
Gmail search uses epoch-second boundaries; internalDate filtering enforces the
exact window before body requests. A metadata search superset can include a
boundary message that is subsequently excluded. Spam/Trash are included in this
small bounded search; draft messages are never analyzed.

For a read that writes no application observations/health, use a separately
explicitly authorized preview:

```sh
node scripts/gmail-email.mjs preview --hours 1 --authorize-connection
```

Both paths are GET-only for Gmail profile/list/detail resources. No sending,
deleting, labels/settings changes, mark-read, attachment fetching or forwarding
rule modification exists. The read-only OAuth grant also denies mailbox writes.
Neither path can update a job's status, enter a code or submit an application.

Output is counts and coverage flags, never subjects, bodies, recipient addresses,
tokens, codes or page tokens. Exit 0 means the bounded invocation completed;
exit 2 means coverage is incomplete/failed, and exit 1 is a command/auth/config
error. `incomplete: true` never advances the successful checkpoint. It is not a
request to expand the window or fetch more pages. No matches does not prove no
recruiting mail exists; sender rules/header preservation determine coverage.

## Evidence, recovery and limits

Recognized categories reuse the existing analyzer: application confirmation,
assessment, interview, recruiter update, rejection and application-specific
verification. Password-reset, account-login, MFA, recovery and unrelated security
messages are excluded; clear security subjects are skipped before detail reads.
Verification detection needs a fresh, exact application session and original Date
within that session. Codes stay in memory, are never exposed in output, and
`codeUseAllowed` remains false. Forwarding delays can cause expired/missed codes.

The decoder supports bounded UTF-8 plain-text and HTML MIME bodies; HTML is passed
only to the existing text classifier, never rendered. Attachments, nested email
payloads, ambiguous headers, missing original dates and unsupported encodings
require manual review. Existing English-oriented classification can miss other
templates/languages. Raw messages and embedded instructions remain untrusted.

Applications and observations remain in the existing resolved data-root ledger.
Evidence uses `source: gmail_api` and provider/account-scoped message hashes;
requiresReview is always true, and source authentication remains not-live-validated.
Only fixed redacted evidence fields are persisted. No new tracker is introduced.
Gmail operational metadata lives in `gmailMailboxHealth`; its opaque account
identity derives from a private nonce and both configured addresses, so edits
cannot silently reuse an old checkpoint. It has independent v2
account binding/revision/checkpoint/replay history under the same ledger lock.
Outlook's `mailboxHealth` is preserved; neither provider can rebind the other.
Current dashboard mailbox cards still describe Outlook; Gmail status is local
CLI metadata pending a separate presentation change.

If a sync stops with a recorded syncing state, stop its worker before explicit
local recovery. Neither command below connects to a mailbox or retries reads:

```sh
node scripts/gmail-email.mjs recovery-status
node scripts/gmail-email.mjs abandon --run-id RUN_ID --expected-revision REVISION --acknowledge-worker-stopped
```

A new sync must be separately invoked and authorized. Recovery preserves existing
observations and the last complete checkpoint. Observation commit and health
commit are separate; do not infer rollback or exactly-once processing after an
uncertain outcome. There is no background loop or persistent authentication.
Revoke Google-side access in your Google Account's third-party connections if
needed; process exit alone clears local tokens, not Google's consent record.

## Diagnose a browser-success / CLI-sign-in failure safely

The old callback page said "Sign-in received" immediately after valid state/code
receipt, before Google's code exchange or account verification. That page proved
the callback reached WSL, not that authentication completed. The revised page
explicitly says verification is still in progress. Keep the terminal open.
The listener binds only 127.0.0.1 and stays active until verification finishes,
then closes. Never reuse an old callback URL or share its query parameters.

A no-OAuth Windows-to-WSL connectivity probe is available:

```sh
node scripts/gmail-loopback-check.mjs
```

It starts a temporary IPv4 loopback-only HTTP listener, verifies it from WSL and
native Windows PowerShell, and emits only pass/fail plus the nonsecret local port.
It reads no config/credential/account and changes no WSL or Windows networking.
It does not authenticate, access a mailbox or relax TLS/forwarding security.
Native Windows interop is required for its Windows leg. It is separate from the
OAuth listener, so never use a real callback URL/code for this check.

After explicit authorization, retry the same controlled one-hour read with:

```sh
node scripts/gmail-email.mjs first-sync --hours 1 --authorize-connection --diagnostics
```

Use the newly printed Google authorization URL. Existing private setup remains;
do not rerun init or replace credentials just to retry. Diagnostic output goes
to stderr and contains only closed-vocabulary events/stages/categories, fixed
messages, optional HTTP status, allow-listed network codes and the local listener
port. No logs are saved automatically. Authorization URL display remains only
for local sign-in; do not share it or a callback URL with diagnostic output.

Relevant events, in order: listener_ready, callback_received,
code_exchange_started/succeeded, token_info_started/succeeded,
account_verification_started, account_verified, listener_closed. A rejected
state/malformed request logs no request data and cannot start code exchange.
Failure summaries include a sanitized `oauthDiagnostic` even without the flag.
The flag does not authorize a connection by itself.

| Stage/category | Meaning / safe next action |
|---|---|
| callback_wait / callback_timeout | No valid callback arrived in five minutes. Run the synthetic probe; keep the terminal open; use a fresh sign-in. |
| code_exchange / invalid_client | Google rejected client credentials. Verify your private JSON is the intended Desktop client from the correct project. |
| code_exchange / invalid_grant | Google rejected the one-time grant. Start fresh; never replay a saved callback URL/code. |
| code_exchange / redirect_mismatch | Verify Desktop app client type and use the current generated loopback redirect. Do not disable PKCE/state. |
| token_info / authentication_required | Google rejected the access token during independent token verification. Start a fresh sign-in. |
| account_verification / api_disabled | Enable Gmail API under APIs & Services in the same project as this Desktop client. No billing is needed. Retry fresh. |
| account_verification / permission_denied | Check API enablement and readonly consent; add no broader scope. |
| account_verification / account_mismatch | Choose the configured receiving Gmail account; no address appears in diagnostics. |
| any / tls_trust | Repair trusted CA/proxy configuration. Never set NODE_TLS_REJECT_UNAUTHORIZED=0 or use insecure TLS flags. |
| any / network_dns or network_timeout | Repair WSL DNS/connectivity and start a fresh sign-in. |

Only two closed Google API-disabled reason strings are recognized from error
JSON. Raw provider error messages/descriptions, metadata and request configuration
are never logged. Unknown errors remain redacted but retain the failed stage.
Share only the sanitized failure JSON if further help is needed.

The Google SDK's auth methods set their own retry configuration. The adapter now
explicitly sets both retry=false and retryConfig.retry=0, with no network retries,
so a one-time code is not silently replayed after an uncertain exchange. OAuth
requests retain verified TLS, a timeout and redirect refusal. No actual live
exchange/profile/message request was performed while diagnosing the reported
failure; a sanitized user-run retry is required to identify its exact discarded
historical provider error.

## Provider synchronization diagnostics and HTTP 204 fix

A user-run message-list request completed with HTTP 204 No Content. The old
adapter called response.json() on that empty body and mislabeled the JSON parse
failure as a generic provider error. This was after successful OAuth/profile
verification, so changing scope, credentials or WSL forwarding was unnecessary.

The list field selection now includes resultSizeEstimate alongside message IDs
and nextPageToken, preserving the explicit zero-result indicator. In the live
user retry, Google returned HTTP 200, the response validated, synchronization
finished idle/incomplete=false, and the local provider checkpoint was confirmed
complete. No message content or credentials were logged. Live classification of
redirected recruiting mail remains separate acceptance; an empty-window list
success is not sender-authentication or classification proof.

HTTP 204 is never JSON-decoded. If Google returns it again, the adapter reports
response_empty and keeps coverage incomplete without advancing a successful
checkpoint. An uninformative {} response is also incomplete. A valid JSON list
with resultSizeEstimate=0 can complete an empty window; a positive estimate with
no IDs, null collection, malformed response, permission error or parser failure
cannot fabricate coverage. There is no automatic retry or second-page request.

Optional syncDiagnostic lines identify message_list, message_metadata,
metadata_parse, message_detail, detail_parse, observation_persistence and
checkpoint_publication. They use only fixed categories/reason codes and optional
HTTP status. They never contain IDs, query values, addresses, selected headers,
subjects, body text, codes or tokens. HTTP request_succeeded is distinct from
response_validated and the final synchronization result. API 400, 401, 403,
429/5xx, JSON failures and local publication conflicts remain distinguishable.

Use this short command as one shell line from the repository root:

```sh
npm run gmail -- -a -d
```

It still requires explicit authorization, defaults to one hour, permits at most
one hour, caps at 10 message IDs and one page, and keeps every application action
disabled. Do not paste wrapped fragments of a filename or flags as separate shell
commands. The direct CLI supports the equivalent -a/-d aliases if desired.
