# Career Identity — design

Status: **proposed design; not implemented as a unified subsystem.** Authoritative definition for requirement CC-R19 ([PRODUCT](../PRODUCT.md)). Decision record: [ADR 0004](../decisions/0004-product-vision-expansion.md). The existing personal files and the [Source-of-Truth Boundary in AGENTS.md](../../../AGENTS.md#source-of-truth-boundary-critical) remain binding; this design adds a typed, versioned read interface over them. It does not replace them.

## Purpose

One configurable, evidence-aware description of the person whose career is being managed. Matching, eligibility, document generation, application preparation, networking and interview workflows read it through a versioned interface instead of scattered hard-coded values or ad-hoc file reads. The immediate user is the owner; the model reserves ownership fields so a later multi-user product would not require a rewrite. Multi-tenant infrastructure is out of scope.

## Scope

| Area | Examples of content (no real values in shared docs) |
|---|---|
| Personal and contact | Name, preferred name, email/phone references, location, time zone |
| Education | Institutions, degrees, majors, graduation month/precision, GPA if the user chooses to disclose it, coursework |
| Work authorization | Authorized countries, citizenship statement, current/future sponsorship needs, clearance status/eligibility |
| Employment history | Employers, titles, dates, locations, responsibilities |
| Verified achievements | Quantified outcomes with provenance; narrative stories with provenance markers |
| Skills, certifications, projects | Verified skill list with evidence, certifications with issue/expiry, projects with links |
| Résumé versions | Approved bases and tailored artifacts by reference (hash, path, approval), owned by [Document Intelligence](DOCUMENT_INTELLIGENCE.md) |
| Portfolio and links | Portfolio, GitHub, LinkedIn URL, publications |
| Career interests | Target roles, role-family weights, industries, seniority targets, employers to prioritize or avoid |
| Preferences | Salary range/currency, locations, relocation, work arrangement, earliest start, travel, schedule limits |
| Application history | Per-employer "never applied" / prior-application confirmations, linked to the canonical ledger and tracker (not copied) |
| Communication style | References to private voice/style guides and writing samples (style only, never facts) |
| Automation and approval preferences | Per-action autonomy defaults, owned by [Approvals and Autonomy](APPROVALS_AND_AUTONOMY.md) |
| Connected accounts | Provider, account label, granted scopes, credential **handle** (see Security). Never tokens or passwords. |

## Claim classes and provenance

Every identity value carries a class, and every class has fixed consumption rules:

| Class | Meaning | May appear in generated professional content? |
|---|---|---|
| `verified_fact` | Supported by a primary source (cv.md, article-digest, approved document, official record) or explicitly verified by the user, with `source` and `verifiedAt` | Yes, as stated |
| `user_claim` | Stated by the user but not yet tied to evidence | Only after explicit user approval for that use; never quantified beyond the user's words |
| `preference` | A choice, not a fact about the past (salary range, locations, target roles) | Used for filtering and ranking; never presented as an achievement |
| `ai_inference` | Derived by a model or heuristic (e.g. "likely strong in distributed systems") | **Never** as a claim. It may suggest a question to the user; promotion requires user confirmation, which re-classifies it |
| `unknown` / `user_cannot_confirm` | Explicitly unresolved | Narrative texture only; never quantified (matches the story-bank provenance invariant in AGENTS.md) |

Each record is `{id, path, value, class, provenance: {source, locator, recordedAt, verifiedAt?, approvedUses?}, sensitivity, schemaVersion}`. Sensitivity (`public`, `private`, `restricted`) controls which projections may include it, for example the cloud eligibility projection in [CLOUD_DEPLOYMENT_PLAN §7](../CLOUD_DEPLOYMENT_PLAN.md#7-persistence-data-minimization-and-migration).

**Traceability rule:** every professional claim in generated output (résumé, cover letter, form answer, outreach) cites identity record IDs or an explicit user approval recorded for that artifact. A claim with no citation is flagged as unsupported and blocks approval.

## Versioned interface

`CareerIdentity v1` is a read model. It resolves the current authoritative files into typed records and computes a content digest (the identity version). Consumers record which identity version they used. The monitor already records a `profileDigest` per evaluation, and document artifacts and approvals will bind to it too. A change to a fact a decision depended on invalidates that decision's approval for re-review.

Interface operations (planned): `snapshot()`, `get(path)`, `facts({area, class})`, `projection(name)` (named, allowlisted subsets such as `eligibility-v1` or `application-standard-answers-v1`), and `explain(recordId)` (provenance chain).

## Compatibility with current data (no migration now)

| Current source | Role in the interface |
|---|---|
| `cv.md`, `article-digest.md` | Primary evidence for employment, achievements, skills, projects |
| `config/profile.yml`, `modes/_profile.md` | Targeting, narrative, preferences |
| `data/career-profile.yml` ([`career-profile.mjs`](../../../career-profile.mjs)) | Source-backed Master Career Profile records (review status) |
| `data/application-automation/profile.json` | Verified application facts with `verified` flags (authorization, citizenship, education, start availability, application history, approved résumé hashes) |
| `data/application-automation/policy.json` | Role weights, thresholds, automation limits |
| `interview-prep/story-bank.md` + provenance markers | Narrative stories; quantified claims follow the provenance rules |
| `voice-dna.md`, `writing-samples/` | Style references only |

Phases:
- **I1:** a read adapter over these files, with no data movement, plus conflict reporting where sources disagree.
- **I2:** consumers migrate one at a time. The monitor's eligibility projection ([CC-017](../tasks/CC-017.md) C0 item 3) is the first.
- **I3:** an editing UI with provenance and verification prompts (the Career Identity workspace in the [Frontend Design System](FRONTEND_DESIGN_SYSTEM.md)).
- **I4:** consolidate storage only where duplication causes measured errors, through a reviewed migration.

No phase infers facts. In particular, per-employer "never applied" answers are recorded only from explicit user input.

## Security and isolation

- Credentials, OAuth refresh/access tokens, cookies and passwords are never identity values. Connected-account records hold a handle into the platform vault (Windows Credential Manager, an approved WSL/Linux vault, or later SSM/Secrets Manager under [CLOUD_DEPLOYMENT_PLAN §8](../CLOUD_DEPLOYMENT_PLAN.md#8-security-architecture)), plus scopes and status.
- All identity data stays in the git-ignored user layer. Shared docs, tests and fixtures use fictional values only.
- `ownerId` is reserved on every record and every derived artifact, and all paths resolve under one owner data root. Isolation is per data root today; no organizations, billing or multi-tenant service.

## Open questions (do not block I1)

- Which sources win when `cv.md` and `profile.json` disagree on a fact: prompt the user, or prefer `verified` records by default? The proposed default is to prompt.
- Whether GPA, demographic or voluntary-disclosure answers are stored at all (default: not stored unless the user opts in per field).
