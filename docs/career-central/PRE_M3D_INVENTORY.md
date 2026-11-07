# Pre-M3D stabilization inventory

Captured on `career-central/pre-m3d-stabilization` at base `d3fc7d1`, before checkpoint staging. The initial Git inventory showed **6 modified tracked paths and 77 untracked project paths** (83 total). This inventory document was then added as one more project path, so the staged checkpoint contains **6 modified tracked paths and 78 added paths** (84 total). All paths are Career Central, application, Outlook, web integration, tests or project documentation. There are **0 unrelated paths identified** and **0 private runtime-data paths** (`data/`, `documents/`, `output/`, `reports/`, `jds/`, résumé PDFs, OAuth/token/cache files). A path-only scan found no user's name, phone or email in these project paths. Tests contain clearly fictional token/code strings for redaction assertions.

## Modified tracked files (6)

- `.gitignore` — credential/PDF exclusions.
- `AGENTS.md` — additive Career Central context pointer.
- `package.json` — existing MSAL Node dependency and pinned MSAL extensions dependency.
- `web/src/app/page.tsx` — Home dashboard integration.
- `web/src/lib/scheduled-jobs-store.mjs` — supported worker metadata persistence and safe IO.
- `web/tests/browser-suites.mjs` — Career Central fixture-suite registration.

## Untracked project files (77)

**Documentation (17):**

- `docs/OUTLOOK.md`
- `docs/architecture/application-automation.md`
- `docs/architecture/career-central-audit.md`
- `docs/career-central/CURRENT_STATE.md`
- `docs/career-central/HANDOFF.md`
- `docs/career-central/HANDOFF.template.md`
- `docs/career-central/PRODUCT.md`
- `docs/career-central/README.md`
- `docs/career-central/ROADMAP.md`
- `docs/career-central/STATUS.md`
- `docs/career-central/PRE_M3D_INVENTORY.md` (this inventory)
- `docs/career-central/decisions/0001-development-and-deployment.md`
- `docs/career-central/tasks/CC-001.md` through `CC-005.md`

**Application automation (8):**

- `lib/applications/browser.mjs`
- `lib/applications/confirmed-tracker.mjs`
- `lib/applications/discovery.mjs`
- `lib/applications/greenhouse.mjs`
- `lib/applications/pilot.mjs`
- `lib/applications/reviewed-submission.mjs`
- `lib/applications/store.mjs`
- `lib/applications/upload-policy.mjs`

**Career Central projection/persistence (12):**

- `lib/career-central/OPERATIONAL_EVIDENCE.md`
- `lib/career-central/PERSISTENCE.md`
- `lib/career-central/README.md`
- `lib/career-central/contract.mjs`
- `lib/career-central/operational-contract.mjs`
- `lib/career-central/operational-evidence.schema.json`
- `lib/career-central/operational-projection.mjs`
- `lib/career-central/operational-store.mjs`
- `lib/career-central/projection.mjs`
- `lib/career-central/projection.schema.json`
- `lib/career-central/schema-validation.mjs`
- `lib/career-central/sources.mjs`

**Outlook / protected storage (7):**

- `lib/email/PROTECTED_STORAGE.md`
- `lib/email/application-mail.mjs`
- `lib/email/outlook-auth.mjs`
- `lib/email/outlook-client.mjs`
- `lib/email/private-storage.mjs`
- `lib/email/protected-cursor.schema.json`
- `lib/email/protected-persistence.mjs`

**Commands (7):**

- `scripts/application-workflow.mjs`
- `scripts/career-central.mjs`
- `scripts/discover-ranked.mjs`
- `scripts/outlook-email.mjs`
- `scripts/prepare-application-pilot.mjs`
- `scripts/reevaluate-shortlist.mjs`
- `scripts/review-first-application.mjs`

**Tests/fixtures (11):**

- `tests/application-automation.test.mjs`
- `tests/application-greenhouse-workflow.test.mjs`
- `tests/application-pilot.test.mjs`
- `tests/application-reviewed-submission.test.mjs`
- `tests/application-upload-policy.test.mjs`
- `tests/career-central-operational.test.mjs`
- `tests/career-central-persistence.test.mjs`
- `tests/career-central-platform-recovery.test.mjs`
- `tests/career-central-projection.test.mjs`
- `tests/fixtures/career-central-no-effects.mjs`
- `tests/outlook-email.test.mjs`

**Web integration/tests (16):**

- `web/src/app/api/career-central/route.ts`
- `web/src/app/career-central/page.tsx`
- `web/src/components/career-central/overview.tsx`
- `web/src/lib/career-central/README.md`
- `web/src/lib/career-central/read.mjs`
- `web/src/lib/career-central/server.ts`
- `web/src/lib/career-central/view-model.mjs`
- `web/src/lib/core/operational-files.mjs`
- `web/src/lib/core/operational-storage-contract.mjs`
- `web/src/lib/core/operational-storage.schema.json`
- `web/src/lib/core/schema-validation.mjs`
- `web/tests/career-central-http.mjs`
- `web/tests/fixtures/career-central-no-effects.mjs`
- `web/tests/fixtures/career-central.mjs`
- `web/tests/lib/career-central.browser.test.mjs`
- `web/tests/lib/career-central.test.mjs`

No `data/` records, résumé files, OAuth caches, mailbox content, application history, credentials, build output or unrelated user files are in the intended checkpoint.
