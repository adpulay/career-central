# M3B — Operational persistence and recovery

Later additive owner extension (2026-11-10): [job monitor v1](JOB_MONITOR.md)
uses the existing application-ledger lock/atomic writer for `jobMonitor` source
checkpoints, shortlist dispositions, alerts and local preparation proposals.
It does not change the v2 worker/mailbox health contracts, application records,
receipt authority or scheduler behavior. Explicit polling is not recurring activation.

Implemented locally: typed worker/mailbox publishers, owned-store metadata preservation, revision/idempotency checks, atomic replacement/recovery, canonical projection and minimal health-card integration. No publisher loop, OAuth, Graph synchronization, cursor backend, browser workflow or task execution is enabled.

## Storage and authority

| Data | Existing authoritative owner | Supported storage |
|---|---|---|
| Worker observations | `data/scheduled-jobs.json`, existing scheduler lock/writer | Optional `workerHealth` v1 (legacy) or v2 |
| Mailbox operational metadata | `data/application-automation/ledger.json`, existing `updateLedger` lock/writer | Optional `mailboxHealth` v2; v1 remains readable, not silently rebound |
| Applications, attempts, approval and receipts | Existing ledger/tracker owners | Unchanged; health publication changes neither jobs nor events |
| Protected cursor/token material | Future private credential backend | Interface proposal only; no plaintext fallback |

No second tracker or database is introduced. Source paths remain fixed under the existing resolved data root. Reads never initialize, migrate, clean temp files, execute retries or publish health. The existing scheduler preserves only explicitly supported `workerHealth`; arbitrary top-level properties retain their legacy exclusion behavior. Malformed/unsupported supported metadata is rejected by the owned scheduler writer instead of being overwritten. The canonical read adapter can still show valid base schedule records alongside an invalid-health diagnostic.

[operational-storage.schema.json](../../web/src/lib/core/operational-storage.schema.json), ID `urn:career-central:operational-storage:v2`, defines v2 snapshots and typed command definitions. [operational-storage-contract.mjs](../../web/src/lib/core/operational-storage-contract.mjs) is shared by engine and Next scheduler to avoid a second implementation. The small generic schema-validator mirror has an exact parity test with the core validator, as do reused legacy schema definitions. No package dependency was added.

The M3A `operationalEvidence` output remains version 1 with optional v2 persistence/quality fields. Old snapshots still validate. Frozen older strict validators need the updated schema; current Next presentation accepts the new additive fields. Health evidence never grants submission or worker capabilities.

## Typed local API

[operational-store.mjs](operational-store.mjs) exports:

```js
await recordWorkerHeartbeat(dataRoot, command);
await recordMailboxHealth(dataRoot, command);
await recoverOperationalTemps(dataRoot, 'worker'); // or 'mailbox'
```

These are explicitly invoked local functions, not HTTP mutation routes or automatic producers. Root defaults use the existing resolver if omitted. For tests, the optional third argument provides an injected receiver clock and commit-phase hook; future external adapters must never accept these options from an untrusted request.

Worker command:

```text
operationId: bounded opaque ID (generate a fresh UUID; reuse only for exact replay)
expectedRevision: current envelope revision, or 0 when absent/legacy v1
previousSessionId: null, or exact prior session for an explicit session change
worker: {
  workerId, sessionId, sequence, kind, capabilities,
  lastHeartbeatAt: instant | null,
  heartbeatTtlSeconds: 15..3600,
  availability: online | offline | unknown
}
```

The receiver supplies `observedAt`; caller-supplied receiver fields are rejected. A v2 envelope persists schema version, revision, updatedAt, bounded operation history and observations. Each worker retains identity/session/sequence, capabilities, last heartbeat, derived heartbeat expiry, observed status, state revision and provenance. State revision is the envelope revision at which that worker last changed. Other workers remain intact. Explicit publication can migrate valid v1 worker metadata under expected revision 0; unchanged imported observations have revision 0 and `legacy_import` provenance. Routine reads/scheduler updates never migrate.

Within a session, sequence must increase and heartbeat time cannot regress. A null heartbeat preserves an existing same-session heartbeat rather than erasing known history. Session changes require an exact prior-session acknowledgment and the current store revision. Receiver clock regression rejects the update. Future client clocks are retained as source evidence but project to unknown; correcting a regressed client clock may require an explicit session change. A historical successful task never establishes online availability.

Mailbox command:

```text
operationId, expectedRevision
health: {
  accountId: opaque nonidentifying ID,
  connection: M3A connection observation | null,
  synchronization: M3A sync observation | null,
  folderScope: nonempty subset of inbox, junkemail, archive, sentitems,
               deleteditems, or all_messages alone,
  checkpoint: null | {id, completedAt, coverage:{from,through,complete:true},folderScope},
  retry: {attempt:0..8,delaySeconds:0..86400,nextAttemptAt:instant|null}
}
```

V2 adds state revision, updatedAt, operation history and fixed provenance (`local_metadata`, operation ID, receiver time). The checkpoint represents the last successful **bounded window**, not the whole mailbox. It must match lastSuccessfulSyncAt and folder scope; a complete idle result must match its successful coverage. Incomplete, failed, syncing or unknown results cannot advance/erase the checkpoint. Checkpoints cannot regress or reuse an ID with changed content. A future successful checkpoint is rejected. Account/scope switches and legacy v1 health without an account binding require future explicit migration; they are never inferred from a profile/email address.

Retry fields are observations, not a scheduler. Attempt counters cannot regress/increase by more than one on incomplete runs; successful complete sync resets retries. At most eight attempts are represented; exhausted metadata cannot declare another scheduled retry. Delays are bounded to one day; a recorded next attempt equals receiver time plus delay. No actual retry, Graph request, message processing or application action follows.

IDs must not contain email addresses, cursor URLs, tokens or codes. Generate pseudonymous identifiers deliberately. Validation cannot detect a secret deliberately mislabeled as an otherwise valid opaque ID; publishers remain a trusted local boundary. Health schemas reject subjects, bodies, codes, token/cursor fields, arbitrary properties and raw provider errors. Errors are category-only. The dashboard excludes account/checkpoint/operation IDs and operation hashes.

## Concurrency and replay

Both publishers acquire the existing owner lock, reread/validate current state inside it, and compare `expectedRevision`. Worker and normal scheduler updates use the same lock; mailbox and application-ledger updates use the same ledger lock. Task ownership, lease/retry algorithms and submission gates remain unchanged.

An exact known operation ID/payload replay returns its recorded revision and current revision without writing. Reusing the ID for changed data fails. Payload digests canonicalize object keys; arrays remain ordered. The last 128 operations are retained with consecutive revisions. An evicted old command fails its stale revision rather than reexecuting; this is bounded replay protection, not an unlimited historical journal. Use unique operation IDs and retain the exact command until its outcome is resolved. Session/sequence rules independently protect worker updates.

Before replacement, source-byte hashes detect intervening edits even outside the shared writer API. This is not an atomic compare-and-swap against malicious noncooperating filesystem actors; the protocol assumes trusted local code and cooperating owner locks.

## Atomicity and recovery

The shared owned JSON writer bounds reads/writes to 8 MiB, opens unique temps exclusively with owner-only mode, flushes file contents, checks source revision and temp inode/content integrity, and atomically renames on the same filesystem. Parent directory fsync is attempted. Unsupported Windows/filesystem directory-sync operations are tolerated; power-loss durability on every Windows/network filesystem is not certified. Source data is never unlinked to make rename succeed.

- Before rename: failures leave the previous committed snapshot intact. Temps are best-effort removed.
- After rename with lost acknowledgement/fsync error: `OPERATION_COMMIT_UNCERTAIN` prevents claiming rollback. Inspect state or explicitly replay the exact metadata command. The stored operation record identifies a completed commit without executing it again.
- A crash leaves the normal owner lock recoverable through the existing PID/token protocol. Explicit `recoverOperationalTemps` acquires that same lock and deletes only recognized v4-UUID temp names whose owner PID is dead. It never promotes temp contents. Live, unrecognized, unsafe or unverifiable files remain untouched. Older legacy temp naming is not automatically adopted or removed.
- A persisted syncing observation followed by interruption can be explicitly recorded failed/incomplete with the same last success. A read never invents completion or recovery. Eventually an abandoned syncing observation becomes stale.
- Metadata replay/recovery must never be used to repeat application submission or any other sensitive non-idempotent action. Receipt/application reconciliation and approval are still required separately.

Path checks reject traversal, symlink/junction ancestors/targets/locks, hard-linked targets, credential-named locations and unsafe temps. JSON diagnostics do not echo source contents. Use real local data-root paths, not symlink aliases. These portable path checks do not isolate malicious same-user filesystem races. No credential cache permissions or OAuth scopes are changed.

## Projection and dashboard

Canonical health includes persistence revisions/provenance and evidence quality: fresh, incomplete, conflicting, unavailable, stale or unknown. Connection and synchronization stay separate; recorded connected is explicitly not a live probe. Workers expose online/offline/stale/unknown from current heartbeat/observation expiry, not runs. Missing record counts remain unknown.

Existing cards now show up to six worker observations, connection/sync states, checkpoint time, incomplete flag, folder scope, retry observation, revisions and quality. Attention links inspect existing health sections only. No Connect/Sync/Retry/Submit action or mutation endpoint is added. `GET /api/career-central` remains private/no-store and side-effect-free. Independent application confirmation counts remain unknown.

## Protected cursor interface — design only

Future trusted sync-worker code needs an interface like:

```ts
type CursorKey = { accountId: string; scopeFingerprint: string; checkpointId: string };
interface ProtectedSyncCursorStore {
  withCursor<T>(key: CursorKey, use: (cursor: string | null) => Promise<T>): Promise<T>;
  compareAndSwap(key: CursorKey, expectedRevision: number, cursor: string):
    Promise<{ revision: number }>;
}
```

No backend is implemented and no raw cursor belongs in the ledger, scheduler, dashboard, logs or AI prompts. Only a trusted worker may receive that capability; dashboard readers must not import it. Backend selection, OS-bound encryption/ACLs, Windows/WSL access boundaries, account binding, retention and redacted error handling require separate M3C work. There must be no plaintext JSON/env fallback or silent cursor recovery/reset that claims complete coverage.

## Validation and limits

See [CC-004](../../docs/career-central/tasks/CC-004.md) and [STATUS](../../docs/career-central/STATUS.md) for exact commands/results. Fixtures exercise real process contention/crashes and ordinary owner writes, not live services. HTTP-only production rendering bypasses `server.mjs` (and its PDF worker), uses disposable data and executes no browser/client JavaScript. It verifies HTML/API health, redaction, cache/origin/method controls and unchanged source bytes.

Remaining limits: Linux validation only; no native Windows/WSL/network-disk certification, authenticated remote producer or cursor backend; no live OAuth/Graph/mailbox/application validation, automatic producer, receipt-artifact verifier or cloud transport. The existing CV Studio build tracing warning remains. Do not publish local build artifacts or treat health metadata as execution authorization.

## Gmail provider extension (CC-009)

`recordMailboxHealth(root, command, {provider: 'gmail'})` uses the same validated
v2 health contract, owner ledger lock, CAS/replay and recovery semantics in the
separate `gmailMailboxHealth` field. The default remains Outlook's
`mailboxHealth`, unchanged. Only `outlook` and `gmail` provider selectors are
accepted. Account/scope bindings and revision history never cross provider slots.
No second application tracker or credential store is introduced. Gmail mailbox
status is not yet added to the canonical dashboard's Outlook mailbox card.
The Gmail CLI's read-only recovery path selects its provider explicitly. See
[the Gmail runbook](../../docs/GMAIL.md) for authorization and bounded-read limits.
