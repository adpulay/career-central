# M2 dashboard read boundary

`/career-central` renders the bounded canonical overview; Home retains Today/onboarding and adds a link/card. `GET /api/career-central` returns presentation `schemaVersion: 1` and the source `projectionSchemaVersion`. It is dynamic, private/no-store, node-only and covered by the existing origin/loopback guard. No mutation handler is exposed (POST is unsupported; Next may serve HEAD/OPTIONS automatically). A missing/invalid engine produces unknown values and API HTTP 503; missing optional sources produce HTTP 200 with explicit source health.

`server.ts` enforces the Next server boundary. `read.mjs` loads the existing engine with native runtime import, preserving core `import.meta.url`, path overrides and data-root semantics. This matches the existing code-root adapter pattern; the engine checkout must remain available on the server (`CAREER_OPS_CODE_ROOT` when needed). A standalone static export or remote deployment without an engine is not supported by M2.

`view-model.mjs` is presentation only: it consumes the validated M1 projection, never parses/normalizes jobs or accesses files. It allowlists output fields and caps actions at 6, application rows at 12, deadlines at 5 and displayed conflicts at 6. Counts describe source coverage, not all external applications. Core confirmation is deliberately unknown; receipt records and Submitted/Applied source claims are unverified. Unknown is never rendered as measured zero.

The original M2 view used configuration presence only. M3B additionally renders validated recorded mailbox/heartbeat metadata when available; absent observations remain unknown. Authentication is never live-checked by this view. Recorded schedules remain separate from worker availability. Deadlines cover open take-home assessments only; interview/calendar dates are unavailable. Report numbers are linked through the tracker parser to unique tracker row IDs, never used directly as route IDs. Ambiguity falls back to `/pipeline`.

No new dependency, database, action endpoint, browser controller, mail client, token refresh or initialization/write path is added. Server reads do not authorize execution. Existing detailed views retain their existing capabilities when explicitly visited; this overview contains inspection links only.

## Tests

`web/tests/lib/career-central.test.mjs` exercises fixture-backed presentation, uncertainty, redaction and reader failures. `web/tests/fixtures/career-central-no-effects.mjs` installs write/network/child-process/credential-read tripwires before importing the reader and uses an absent disposable data root. Core tests verify assessment folding, unique report-to-tracker resolution, schema validation and scheduler aggregates.

After `npm run build --prefix web`, run `node web/tests/browser-suites.mjs career-central`. It starts the production server on loopback with fictional temporary files. It verifies API counts/redaction/cache policy, POST 405, cross-origin rejection, Home navigation, 375/1440px rendering, no client exceptions, no non-GET or off-origin client requests, and unchanged fixture bytes. The existing shared shell polls unrelated APIs; these are stubbed in this isolated browser test. Consequently this test certifies the new read slice, not every existing global shell endpoint or browser-storage persistence. Default browser is existing harness Chrome; `CAREER_CENTRAL_CHROME_EXECUTABLE` can select an already-installed Chromium executable without downloading one.

M2 intentionally does not validate live mail, employer applications, browser submission sessions, AWS or autonomous execution.


## M3B recorded health

The existing worker/mail cards consume the canonical `operationalEvidence` health projection and optional v2 persistence metadata. Up to six worker observations are shown with explicit availability/expiry; connection/sync, incomplete results, checkpoint time, scope, retry observation, state revisions and quality remain separate. Account/checkpoint/operation IDs and request hashes are not exposed by the presentation model. No new action endpoint exists. Health attention items link to the existing page section only. Auth is still not live-checked, retry metadata executes nothing, and all read-side safety/confirmation rules remain intact.

`node --test web/tests/career-central-http.mjs` is an explicit post-build HTTP-only production smoke test. It starts Next directly on loopback with disposable fictional metadata (no server.mjs PDF worker or browser), checks the rendered page/API, redaction, method/origin/cache rules and unchanged source bytes. It does not test hydration, browser interaction or viewport layout. See the core [persistence contract](../../../../lib/career-central/PERSISTENCE.md) for ownership and recovery limits.
