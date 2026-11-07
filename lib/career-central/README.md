# Canonical read-only career projection v1

M1 is a private read model, not a new authoritative store or an execution API. It does not write canonical records, dereference documents/receipts, authenticate, read mail, run a browser, start workers or submit applications. Future local CLI and remote APIs can consume the same contract; M2 consumes this interface locally; no cloud deployment or live integration is included.

## Interfaces

```js
import {readCareerProjection} from './sources.mjs';
const view = readCareerProjection({asOf: '2026-11-06T20:00:00Z'});
// Default: existing data-root, tracker and profile resolvers/overrides.
// Optional root explicitly selects a workspace; core getProfilePath(root)
// intentionally takes precedence over CAREER_OPS_PROFILE in that case.
```

```js
import {projectCareer} from './projection.mjs';
import {assertProjection} from './contract.mjs';
const view = assertProjection(projectCareer({sources, asOf}));
```

`projectCareer` is pure over parsed source descriptors: `{id, state, revision, ownership, observedAt?, coverage?, data?}`. Parse source content with `parseSource(id, content)` first. The file adapter produces these descriptors, validates source versions and asserts the output contract. Missing/invalid/unreadable/refused sources have no usable data. `asOf` is explicit in the pure API; the adapter captures current time once if omitted. The optional adapter `reader` is a synchronous test seam for snapshot-race tests, not a configurable filesystem traversal facility.

CLI:

```sh
node scripts/career-central.mjs --as-of 2026-11-06T20:00:00Z
```

JSON goes only to stdout; errors use generic diagnostics without source values. Output contains private job/application data and is **not** a public/export-safe artifact. Do not redirect it into shared documentation, commit it, send it to AI or expose it as an unauthenticated API. Existing `CAREER_OPS_ROOT`, `CAREER_OPS_DATA_DIR`, `CAREER_OPS_TRACKER`, `CAREER_OPS_PROFILE` resolution applies; relative overrides follow the core resolver, not an invented new precedence.

## Source authority matrix

| Source ID | Fixed read path (under resolved data root unless overridden) | Authority and use |
|---|---|---|
| states | Code-root `templates/states.yml` | Canonical labels/aliases; reused via existing state resolver |
| tracker | Core-resolved applications Markdown | Current legacy state, URL, score and row identity; core table parser, including legacy headerless layout |
| statusHistory | `status-log.tsv` beside real resolved tracker | Append-only history; core parser and replay apply corrections/retractions in file order |
| discovery | `data/discovery/latest.json` | Derived snapshot, not a list of submitted applications |
| ledger | `data/application-automation/ledger.json` | Preparation/dispatch state, attempts, durable events and redacted email observations |
| policy | `data/application-automation/policy.json` | Observed safety flags only; never a grant to execute |
| profile | Core-selected profile YAML | Source metadata and overlap comparison; no private field values emitted |
| applicationProfile | `data/application-automation/profile.json` | Verified/unverified fact counts and overlap metadata; no answer/value export |
| careerProfile | `data/career-profile.yml` | Existing source-backed profile validator; metadata only |
| schedule | `data/scheduled-jobs.json` | Existing scheduled-store validator; counts only; no scheduler execution |
| outlook | `data/application-automation/outlook.json` | Regular-file metadata only, content never parsed/read; does not prove consent or connectivity |

No `.env`, approved PDF, OAuth cache, token store, receipt file, arbitrary report link, raw mail or external URL is opened. Non-override data files cannot escape the real data root through symlinks. The core-selected external tracker/history and explicit profile override remain allowed; known credential paths and wrong file types are refused. A tracker symlink's history follows the core real-path sibling semantics. Unusual profile extensions outside `.yml/.yaml` are intentionally refused. Do not treat the test seam as permission to add arbitrary external paths.

## Output and semantic rules

[projection.schema.json](projection.schema.json) is the versioned JSON Schema 2020-12 contract (`urn:career-central:projection:v1`). [contract.mjs](contract.mjs) implements only the schema keyword subset used by this contract, plus ID uniqueness, foreign-key/source-reference and count checks. It is **not** a general JSON Schema engine; unknown external schemas must not be passed to it. No new validator dependency was installed.

- Exact core-normalized URLs identify jobs; meaningful queries/fragments survive core normalization. Different known requisitions sharing one URL split into conflict-bearing jobs. No company/title fuzzy merge, automatic employer alias assumption or content-based merge is performed. ATS host aliases that the core does not equate remain separate.
- Application IDs are separate from job IDs. Ledger application IDs are tied to ledger keys; unique tracker IDs combine row number and posting identity. Ambiguous/duplicate row numbers remain visible. Report IDs are not tracker IDs. Source locators are JSON pointers or source/effective-history locations, with raw-byte revision hashes.
- Evaluated/shortlisted/discovery-only records remain job inventory. An application view requires an engaged source state, preparation/submission data or surviving historical engagement evidence. These views still represent source claims, not proof of an application sent.
- Original status/score claims retain source and scale; there is no blended score. Conflicting states yield `conflicted`, with separate score/eligibility/availability/profile conflict metadata. Unknown statuses are preserved as unknown, not defaulted to Evaluated.
- Attempts include latest summary/active records and durable event-derived earlier attempts. Approval, dispatch, response, verification-required and transition evidence are distinct. Historic attempts lack receipt guarantees; summaries do not erase older evidence.
- `receipt_recorded` means the ledger records a browser receipt with native HTTP acceptance, timestamp and integrity markers. **No receipt is independently verified by M1.** `independentlyVerified` is always false and `confirmedSubmissions` is null. A Submitted/Applied label, email proposal, HTTP 2xx alone, HTTP 428 or uncertain dispatch never becomes independently confirmed. Actual receipt capture/reconciliation remains owned by the application workflow.
- Counts describe the records visible in this bounded source set, not the whole job market or all outside-ledger applications. Empty response denominators and unmeasured time remain null. Missing data never produces invented outcome/rate/readiness information.
- Email evidence is deduplicated from existing ledger observations, never fetched. Only category, opaque identity, linkage, timestamps and review flags survive. No raw subjects, bodies, sender addresses, codes, native payloads, answer text, receipt links or token material is copied. Review proposals never change source application states or permit code use.
- `automation` reports actual source flags, including unsafe values if present, while `readOnly: true` and `executionSupported: false` remain invariant. No projection field authorizes an action. Cloud policy/worker fields are not fabricated before those systems exist.

## Freshness and failures

Read up to 8 MiB per source, with bounded input collection counts. Capture two complete passes, retry once after changes (at most three passes), comparing content revisions/state; persistent changes return `consistency: changed` and a warning. This is optimistic consistency detection, **not an atomic multi-file snapshot**. No locks or initialization writes occur. Fixed bytes plus fixed `asOf` produce deterministic output; file mtime is not represented as job liveness proof. Source `generatedAt`/`updatedAt` determine available freshness, with a default 24-hour stale label; otherwise freshness remains unknown. Discovery coverage remains `bounded_snapshot`.

Missing optional files, invalid structure/version, refused paths/size and unreadable files are distinct source states. Partial bad tracker/history rows create diagnostics without exposing their raw contents. A caller must inspect consistency, warnings and conflicts; the view cannot safely enable submission or imply live eligibility.

## Validation and next boundary

`tests/career-central-projection.test.mjs` uses fictional data. The guarded subprocess fixture installs write/network/child-process/auth-cache tripwires **before imports**, then verifies zero calls and unchanged fixture bytes. Existing URL, score, history and pilot policy suites are run separately with M1 tests. Real credential caches and employer endpoints are not used.

Next milestone is an explicitly approved dashboard read slice/hosting compatibility task using this interface. Broader requirement extraction, report-link enrichment, all profile-field reconciliation, receipt revalidation, cloud adapters, durable mailbox sync and verification automation remain separate work. Do not import submission/mail/browser modules into the read layer.

## M2 additive v1 fields

M2 adds optional `application.trackerNumber`, top-level nullable `deadlines`, and optional schedule state/count/time fields to the v1 contract. Old v1 snapshots remain accepted; consumers must treat absent extensions as unknown. `assessments` is a fixed bounded read of canonical `data/assessments.tsv`, parsed/folded by the existing assessment module. Only open take-home deadline metadata, hashed IDs and provenance survive. Subjects, proof and requirement URLs are excluded. Missing assessment source gives null, while a successfully read empty log gives `[]`. A malformed deadline remains null with a warning. Report numbers resolve through existing tracker report links and unique row IDs; ambiguity never becomes a guessed detail link.

Recorded active/paused definitions and running/failed runs use the validated schedule store. Next scheduled time and last recorded run are source timestamps, not observed worker health. The [M2 web adapter contract](../../web/src/lib/career-central/README.md) documents the bounded presentation view. No source ownership or confirmation semantics changed.

## M3A durable evidence and health

The optional versioned `operationalEvidence` extension is documented in [OPERATIONAL_EVIDENCE.md](OPERATIONAL_EVIDENCE.md), including source ownership, strict schemas, lifecycle/health derivation and proposed write contracts. It reads only metadata already present in existing ledger/scheduler sources; no new files or producers are initialized. Legacy independently verified submission counts stay unknown. Existing M2 presentation remains compatible and conservative; it does not yet display the new health detail. That M3A scheduler blocker is resolved by the explicitly supported metadata preservation and typed publishers in M3B; see [PERSISTENCE.md](PERSISTENCE.md).


## M3B owned operational persistence

[operational-store.mjs](operational-store.mjs) supplies explicitly invoked, revision-checked worker/mailbox metadata publication and dead-temp recovery. Existing owner locks and JSON stores are reused; no live producer or action endpoint is enabled. [PERSISTENCE.md](PERSISTENCE.md) documents v2 storage schemas, legacy compatibility, bounded replay, source/temp integrity, uncertain commits, dashboard integration and the proposed protected-cursor interface. Core reads remain deterministic and side-effect-free; health never certifies an application or grants execution permission.
