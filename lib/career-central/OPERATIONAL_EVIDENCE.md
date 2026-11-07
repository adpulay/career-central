# M3A — Durable evidence and health contract v1

M3A implementation: validated metadata readers and deterministic projection. At M3A completion, proposed only: producers, persistence integration, receipt artifact revalidation and live health probes. No owned writer, canonical record, authentication flow, submission gate or dashboard component is changed by M3A.

Current M3B persistence, scheduler preservation and health-card integration are documented in [PERSISTENCE.md](PERSISTENCE.md). The source-recorded receipt boundary below is unchanged; live producers and protected cursor storage remain unimplemented.

## Interface and versioning

The existing `readCareerProjection()` / `projectCareer()` interface adds optional `operationalEvidence`, with its own `schemaVersion: 1` and the projection's normalized `asOf`. The parent remains projection v1. Old v1 snapshots without this extension still validate; current M2 presentation code ignores unknown extensions and stays conservative. Frozen older validators with `additionalProperties: false` must load the updated schema before accepting new outputs.

[operational-evidence.schema.json](operational-evidence.schema.json) is the explicit JSON Schema contract, ID `urn:career-central:operational-evidence:v1`. It defines both the output and three reserved input envelopes in `$defs`. [operational-contract.mjs](operational-contract.mjs) exports `operationalSchema`, `validateOperationalInput(kind, value)` (`mailbox`, `workers`, `receiptReview`), `validateOperationalEvidence(value, projection?)`, and fixed v1 freshness limits. `validateProjection` also validates the extension, references, attempt identities and semantic invariants. External schema users must register both schema IDs locally; no network schema resolution is needed or performed. The dependency-free validator implements only the keyword subset used by these schemas, not arbitrary JSON Schema.

All instants require a real calendar date, seconds and UTC/explicit offset; output is UTC. Missing timestamps stay null, missing IDs stay null, unsupported versions are rejected. Errors expose static paths/categories rather than source values. Unknown fields (including raw token/cursor/error payload fields and prototype-like keys) are rejected.

## Ownership and reserved inputs

| Contract | Existing source/owner | M3A read behavior | Producer status |
|---|---|---|---|
| Existing preparation, approval, dispatch, response, receipt | `data/application-automation/ledger.json`, `jobs` summaries plus append-only `events`; application store/reviewed-submission writer | Preserve exact existing application/attempt links; collect all matching summaries and durable events | Existing legacy producer unchanged |
| `ReceiptReconciled` v1 event | Same ledger `events`, existing transactional application writer | Strict binding and conflict detection; never executes reconciliation | Proposed; no new producer |
| `mailboxHealth` v1 envelope | Same ledger, existing email-observation writer via `updateLedger` | Validate health metadata independently of base ledger; no mail/cache reads | Proposed; no new producer |
| `workerHealth` v1 envelope | Existing `data/scheduled-jobs.json`, scheduler store owner | Read raw validated store metadata; never derive availability from run history | Reserved proposal; persistence preservation must be fixed before a producer |

There are no new source paths or authoritative trackers. Existing bounded source reads, symlink/path refusal and optimistic consistency checks apply. An invalid extension produces a fixed diagnostic and unknown health without discarding valid applications/schedules. Missing optional envelopes are not initialized. Receipt/artifact paths, delta/nextLink URLs and OAuth caches are never followed.

**Historical M3A scheduler blocker (resolved by M3B):** `web/src/lib/scheduled-jobs-store.mjs:readScheduledStore` rebuilds only `jobs`, `runs`, and `queue`. A normal read/write cycle would drop reserved heartbeat metadata. M3A deliberately does not implement a writer against that unsafe round trip. M3B must extend the owned reader/writer together, under the existing lock, before persisting heartbeats. Simply writing a JSON key elsewhere would not be durable.

## Application attempt evidence

`operationalEvidence.applicationAttempts` has one entry per existing canonical attempt. It retains `applicationId`, `attemptId`, `kind`, exact safe `sourceApplicationKey` / `sourceAttemptId`, state, review status, observations, issues and source references. Existing canonical IDs are reused, never replaced by posting/title guesses. Source IDs must be bounded opaque identifiers; unsupported/missing IDs remain null rather than being truncated or replaced with a field name. Original byte provenance remains in source references.

Each observation has a stable opaque identity, exact source event ID when available, kind, `occurredAt`, source ID/JSON pointer/revision, and recorded review status. Event-backed observation IDs survive ledger revision changes and array reordering; legacy observations without event IDs have only locator-based identity. Summary and durable transition receipts both survive in the read view. Old attempts can use durable Submitted transition evidence after latest summaries have been replaced.

| State | Required recorded evidence / interpretation |
|---|---|
| `prepared` | Preparation summary/transition; no submission implied |
| `authorized` | Recorded approval observation; not permission to execute now |
| `dispatched` | Recorded dispatch, with acceptance still undetermined |
| `verification_required` | HTTP 428 or explicit verification observation; identity/time gaps remain review issues |
| `acceptance_uncertain` | Dispatched 2xx without reconciled receipt, uncertain dispatch, contradictory/unbound receipt evidence or unresolved acceptance |
| `confirmed_receipt` | Exact source-recorded receipt reconciliation chain described below |
| `unknown` | No supported traceable phase or invalid/incomplete evidence |

A source-recorded `confirmed_receipt` requires all of:

1. Browser receipt metadata: confirmed status/source, native-request acceptance and confirmation-page flags, nonempty reference, timestamp and SHA-256 text digest.
2. Recorded authorization bound to the exact review hash, followed by dispatch on the same exact attempt.
3. Native 2xx response timestamp between dispatch and receipt.
4. A valid `ReceiptReconciled` event from a human review, bound to the exact job/attempt, review hash, receipt digest and receipt observation time; review occurs at/after receipt.
5. No verification/response/authorization/receipt contradictions, identity/time gaps, future timestamps or unresolved acceptance flags.

A review label alone, upload, source Submitted/Applied label, HTTP 2xx or verification request never meets this chain. Conflicting receipts, decisions, event identities and native responses stay visible and require review; there is no implicit last-writer-wins or supersession. An unmatched/unsupported review remains diagnostic. Rejected receipt evidence is not an employer rejection.

`reviewStatus` is `unreviewed`, `needs_review`, `confirmed`, or `rejected`. The schema for the **proposed** event is:

```json
{
  "type": "ReceiptReconciled", "schemaVersion": 1,
  "id": "opaque-event-id", "jobKey": "existing-ledger-job-key",
  "submissionAttemptId": "existing-attempt-id",
  "reviewHash": "<64 lowercase hexadecimal characters>",
  "receiptTextHash": "<64 lowercase hexadecimal characters>",
  "receiptObservedAt": "2026-11-06T19:02:00Z",
  "at": "2026-11-06T19:03:00Z", "decision": "confirmed", "reviewer": "human"
}
```

This example is illustrative; digest placeholders are not valid input. Other decisions: `rejected` / `needs_review`.

**Confirmation boundary:** the state means a validated, source-recorded human reconciliation, not independent artifact verification by this reader. `independentlyVerified` remains false; legacy `counts.confirmedSubmissions` remains null, and no application status, duplicate-prevention policy or submission permission is upgraded. Existing receipt-count fields remain legacy summary counts, not a count of every historic operational receipt. Conflicts may conservatively downgrade the *read view* to uncertain and add review items; nothing is written back. An owned verifier/approved reconciliation writer is still required before operational confirmation can govern future actions.

## Microsoft Graph health

Reserved `ledger.mailboxHealth` shape (every displayed field is required; nullable fields use null):

```text
schemaVersion: 1
connection: null | {
  state: configured | disconnected | connected | authentication_required | failed | unknown,
  observedAt, expiresAt, errorCategory
}
synchronization: null | {
  state: idle | syncing | failed | unknown,
  observedAt, lastSuccessfulSyncAt: instant | null,
  coverage: null | {from, through, complete: boolean},
  incomplete: boolean | null, errorCategory
}
```

Connection and synchronization are independent. Current configuration-file presence establishes only `configured`; absence of a health checkpoint never establishes a login or sync. Connection observations expire at their stated lease (positive, at most 24 hours); expired observations become `stale`. Every `connected` result has `liveValidated: false`: no account was probed. A connected claim conflicting with a known missing configuration becomes unknown with a source conflict.

Sync freshness uses a fixed 24-hour v1 threshold for observation and last successful sync. A recent failed/partial run never refreshes the successful checkpoint. A fresh explicit `syncing`/`failed` observation remains such even if a previous success is old; checkpoint timestamps and issues are retained. No successful checkpoint yields unknown for idle state. Future observations/checkpoints yield unknown with `clock_skew`. A stale observation cannot claim a currently running sync.

Coverage describes one bounded query window, not the entire mailbox. `from <= through <= observedAt`. Complete coverage requires a successful checkpoint at/after `through`; it cannot be marked incomplete. Partial coverage remains incomplete, and a producer must not advance last-success time for a truncated/failed read. Missing coverage/completeness stays unknown and is flagged. Errors are category-only: authentication_required, permission_denied, rate_limited, network, provider, invalid_checkpoint, clock_skew, unknown, or null. No raw provider errors, addresses, subjects, bodies, codes, tokens, cursor URLs or OAuth-cache references belong here.

## Worker health

Reserved `schedule.workerHealth = {schemaVersion: 1, workers: [...]}`. Each observation contains:

```text
workerId, sessionId: bounded opaque identifiers
sequence: nonnegative safe integer
kind: local | remote | unknown
capabilities: subset of discovery, application_preparation, document_generation, mailbox_read
observedAt: receiver observation instant
lastHeartbeatAt: instant | null
heartbeatTtlSeconds: integer 15..3600
availability: online | offline | unknown
```

The output retains worker/session/sequence/kind/capabilities, source references, heartbeat time/expiry, availability observation/expiry, effective availability and issues. Heartbeat expiry is heartbeat + TTL; availability observation expires after the same TTL. Online requires both to be fresh. Expiry is inclusive: at the exact expiry instant the record is stale. Offline requires a fresh explicit offline observation, not inferred process death. Future heartbeats, observations or a heartbeat ahead of receiver observation are clock skew and yield unknown. Missing heartbeat cannot establish online. Duplicate worker identities produce unknown and a conflict; no record is chosen silently. An old completed run, PID or job queue never establishes availability.

Absent/invalid worker envelopes use `coverage: unknown` and an empty record list, not a measured zero workers. A valid envelope uses `reported_only`, even when empty. Capability metadata does not grant permission to run anything. No signed remote registration/replay enforcement is implemented; session IDs/sequences reserve that future contract.

## Historical M3B write and recovery proposal

M3B implements the metadata persistence/recovery subset in PERSISTENCE.md. Receipt artifact verification and live/cursor producers below remain proposed.

1. Add typed, idempotent metadata helpers through existing owned locks/atomic writers; validate before and inside the transaction. Preserve parent schemas, unknown supported fields and last-success checkpoints. Use expected revisions/session/sequence to reject stale writes; do not add a competing tracker.
2. Fix scheduler reader/writer preservation and test crash/round-trip/restart cases before any heartbeat publisher. Use authenticated receiver timestamps; enforce monotonic sequences within a session and explicit session changes. No remote task execution follows from health alone.
3. Add a bounded local receipt artifact verifier tied to existing review/attempt identities, approved scope and expected hashes. Explicit human review is required to append `ReceiptReconciled`; replay is idempotent, contradictory decisions stop for review. Do not change application status as a side effect of a projection read.
4. Add mailbox-health publication to the existing read-only observation path only after separately approved work. An incomplete result must persist its window/error while preserving last success. Tokens/cursors stay in the existing secure credential layer; neither checkpoints nor future dashboard responses contain them.
5. Keep kill switches, approval gates and code-use prohibitions independent. A health record never authorizes OAuth, email verification, application submission or remote execution. Live validation and any cloud transport remain separately approved work.

## Validation

`tests/career-central-operational.test.mjs` contains fictional fixtures for lifecycle phases, exact/stable identities, durable historical receipts, conflicts, unknown/expired checkpoints, partial coverage, heartbeat expiry/skew, malformed versions, strict redaction, source path safety and deterministic read-only behavior. It runs the existing subprocess write/network/process/auth-cache tripwires against fully populated fictional sources. M1/M2 and selected application-policy, upload-policy, mocked Outlook and dashboard regressions also pass; exact outcomes and commands are in [STATUS](../../docs/career-central/STATUS.md). No browser automation or live OAuth/Graph/application endpoints are exercised by M3A.
