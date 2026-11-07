# Read-only Outlook integration

This implementation supports personal Microsoft accounts (Outlook.com, Hotmail, Live and MSN) using Microsoft Graph and Microsoft's free `@azure/msal-node` OAuth library. Existing Gmail lead ingestion is independent and unchanged. There was no existing Microsoft Graph integration. Application messages are correlated into the existing application ledger through its locked, atomic writer. No paid service was added.

## Connect your account

Run these commands from the `career-ops` directory, with a browser on the same computer as Node. If Node runs on a remote machine/container, run the connection there with a browser that can reach its loopback callback, or establish a local port forward; do not paste OAuth codes into chat. No password or client secret belongs in Career Ops.

1. Open [Microsoft Entra app registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade). Create an app named Career Ops. Select **Personal Microsoft accounts only**, or **Accounts in any organizational directory and personal Microsoft accounts**. The runtime deliberately uses the `consumers` authority. Do not select organizational accounts only. If your account cannot create an app registration, resolve registration access first; a paid service is not required by this implementation.
2. In Authentication, add the **Mobile and desktop applications** platform with custom redirect URI **`http://localhost/callback`**. This is a public/native application, not a Web app or SPA. The runtime uses a random loopback port; Microsoft ignores the port for registered localhost redirects while matching the path. No implicit grants, client secret, or password flow is needed.
3. In API permissions, select Microsoft Graph → **Delegated permissions → Mail.Read**. Remove the default User.Read permission if present. Do not add Mail.Send, Mail.ReadWrite, application permissions, or shared-mailbox permissions. MSAL also requests its standard OpenID/profile/offline-access scopes for sign-in and refresh; these do not grant email modification. Mail.Read can read the entire signed-in mailbox, not only employer messages. Application-side filters minimize what is retrieved and retained. Mail.ReadBasic lacks the message bodies needed for verification/confirmation analysis.
4. Copy the **Application (client) ID**, then run:

   ```bash
   node scripts/outlook-email.mjs init --client-id YOUR_CLIENT_ID --account YOUR_EMAIL
   node scripts/outlook-email.mjs connect
   ```

5. `connect` defaults to **session-only credentials**. The MSAL cache stays in memory and is discarded when the process exits. This is deliberate where a protected vault is unavailable. Do not select persistent mode until the OS backend is installed and validated. Persistent mode is opt-in:

   ```bash
   CAREER_OPS_OUTLOOK_CREDENTIAL_MODE=protected node scripts/outlook-email.mjs connect
   ```

   The protected mode fails closed if the Microsoft native persistence extension or OS vault is unavailable. On Windows it uses current-user DPAPI; on Linux it requires Secret Service/LibSecret with plaintext fallback disabled. The current WSL environment does not expose `org.freedesktop.secrets`, so protected mode is not presently usable there. No OAuth consent is needed to test the storage layer. See [protected storage contract](../lib/email/PROTECTED_STORAGE.md).

6. Open the printed Microsoft URL in your browser. Sign in directly to Microsoft with the configured personal account and consent to read mail. Career Ops checks the returned account identity and granted scopes. The state-checked PKCE callback expires after five minutes. Keep the terminal running. Never share the callback URL, cache file, access/refresh tokens, or employer verification codes. Session-only mode will not retain tokens for a later CLI process.
7. Independently verify an employer/ATS sender address from a genuine message or employer documentation. Add it for an existing application job key (found in `data/application-automation/ledger.json`):

   ```bash
   node scripts/outlook-email.mjs trust-sender --job-key EXISTING_JOB_KEY --sender VERIFIED_SENDER_EMAIL
   node scripts/outlook-email.mjs preview
   node scripts/outlook-email.mjs sync
   ```

   No sender is preapproved or guessed, including Greenhouse/Affirm senders. Preview retrieves read-only messages and prints redacted classifications without writing observations. Sync records the same classifications as review-only ledger evidence. An empty sender configuration produces no matched observations. The trust-sender command adds a sender filter, not proof against spoofing.

8. Review observations before any future authorization of code entry or status changes. Until then, neither operation is supported. To clear the current in-memory/protected cache:

   ```bash
   node scripts/outlook-email.mjs disconnect
   ```

   Also remove the app's consent through your Microsoft account's app-permissions settings to revoke remote access.

## Storage and read boundaries

The private configuration is `data/application-automation/outlook.json` under the resolved Career Ops data root. New configurations contain a random opaque mailbox ID and private sender rules. Account information and sender rules must never be committed. OAuth persistence is session-only by default. Persistent token storage uses the Microsoft Authentication Extensions library, current-user DPAPI on Windows, or LibSecret/Secret Service on Linux, with plaintext fallback explicitly disabled. `CAREER_OPS_OUTLOOK_AUTH_DIR` selects only the private lock/state directory and may not point inside Git or through a symlink. See [PROTECTED_STORAGE.md](../lib/email/PROTECTED_STORAGE.md) for platform limits and validation steps.

The prior implementation used a plaintext `msal-cache.json`; the revised code neither reads nor deletes that legacy file. If one already exists, the CLI warns and leaves it for user-reviewed revocation/removal. The private Outlook configuration can still contain the email address and client ID, but it is not a token cache and remains subject to the existing private-file rules.

The CLI holds the existing directory-lock protocol across OAuth operations, including refresh-token rotation. Protected cache writes are delegated to the OS store. No token/error-response bodies or verification codes are logged. The authentication URL contains public client/PKCE metadata and a login hint, not access tokens. Disconnect does not delete email or private audit history.

Graph calls are restricted to GET `/v1.0/me/messages` and individual message detail endpoints, HTTPS on the exact Graph origin, with redirects refused. No mail send/delete/archive/move/mark-read API exists in this adapter. No attachments, remote images, links or embedded instructions are opened. Message content is untrusted data. Metadata is fetched first; bodies are requested only for configured senders, exact recipients and application time windows. Default lookback is seven days (`--since ISO_TIMESTAMP` overrides it), with at most five pages of 50 messages (`maxPages` in private configuration can be 1–20). `hasMore: true` means the bounded scan is incomplete; no claim of full mailbox coverage is made. HTTP 401/429/network errors stop the operation without logging provider response content or automatically retrying.

Immutable message identifiers are requested on every Graph call. Only account-scoped hashes of IDs, category, job key, timestamps, review flags and proposed status are persisted in `ledger.emailInbox`/`ledger.events`; message bodies, subjects, tokens and codes are not retained. Duplicate/concurrent runs append each observation once. Repeated preview runs deliberately do not persist processing state. Unmatched/excluded messages are not retained. Review observations can be removed through a future explicit retention/purge workflow; no purge scheduler is enabled.

## Matching and limitations

Matching requires an independently configured exact sender, consistent From/Sender, exact To/Cc recipient, a valid received timestamp after the application's recorded start (or discovery), and employer plus requisition/posting context. Shared senders and ambiguous requisitions fail closed. Forwarded/aliased/Bcc messages and subjects lacking context may be missed; missing data is never inferred. Email-only recruiter contacts without a ledger job are currently excluded. Templates and localization may require additional tested classifiers.

Verification detection additionally requires an explicit fresh `activeVerification` record with purpose `application_email_verification`, job key, expected sender, requestedAt and expiresAt, lasting at most 15 minutes. Only one uniquely matched numeric code is recognized in memory; output exposes only `hasUniqueCode`, never the code itself. No runtime path returns a usable code or enters it into a browser. Account login, password reset, recovery, MFA/enrollment and unrelated authentication messages are excluded. Negative matching is intentionally conservative.

**Sender authenticity is not live-validated.** An address allowlist alone does not prove sender identity. Microsoft authentication headers and actual employer templates still need inspection after connection; forwarded/spoofed headers must not become trusted self-assertions. All observations therefore carry `requiresReview: true`, `senderAuthentication: not-live-validated`, and `codeUseAllowed: false`. Even a convincing confirmation only proposes Submitted; it never changes the application state automatically. Interview/assessment/rejection updates are likewise review-only. This preserves the existing confirmation/approval boundary and prevents an email from authorizing a submission, resetting a verification retry block, or enabling autonomy.

Before future code use: validate live sender authentication provenance and templates, preserve a live native verification session, verify exact session/time/recipient binding and code expiry, add explicit scoped authorization, then test native code entry and receipt recovery. Email integration alone does not repair the earlier browser-session timeout. Before automatic status transitions: approve a confirmation-evidence contract and use the canonical ledger/tracker transition paths. No submission functionality is imported or called by this CLI; submission policy, approval gates and emergency kill switch remain unchanged.

## Validation

Run `node --test tests/outlook-email.test.mjs` for synthetic OAuth loopback/PKCE/state, private storage, GET-only Graph pagination, exclusions, time/context/recipient checks, code redaction and ledger deduplication. These tests use a fake Microsoft client/Graph responses; they do not connect a mailbox or validate a live Microsoft consent screen. Complete connect/preview and inspect real matched templates before describing retrieval or sender authentication as live-validated.

References: [Microsoft OAuth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [Graph personal-account mail permissions](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0), [localhost redirect rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url), [immutable Outlook IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).
