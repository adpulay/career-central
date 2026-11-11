# Local shortlist and posting monitor

Implemented local/synthetic vertical slice for [CC-015](career-central/tasks/CC-015.md) and [CC-016](career-central/tasks/CC-016.md). No recurring worker, employer application, outgoing message or cloud resource is activated. Open the existing `/career-central` dashboard to see saved monitor results.

## What is operational

Existing ATS provider → bounded source snapshot → shared admission/eligibility and saved-profile ranking → durable shortlist → dashboard alert → local preparation proposal. Baselines are quiet. Synthetic end-to-end and production-browser tests exercise this path; live monitoring acceptance remains separate.

The shortlist reads the existing verified application profile/policy and portals configuration. It reuses shared scanner filters/blacklist, the current ranking evaluator, canonical URL/requisition history, tracker parsing and the application ledger owner lock/atomic writer. Role emphasis is read from private policy. Scores are heuristic, not an AI evaluator or hiring probability. Source excerpts/digests and gaps remain distinct from verified profile facts. Missing graduation/start/geography/authorization/experience/history evidence stays reviewable; it cannot produce an automatically ready application.

Dashboard controls persist Interested, Dismissed and Awaiting application as monitor dispositions, never application status. Alerts can be dismissed, sources paused, and saved results refreshed. Local preparation tasks select an approved resume reference when available, flag missing approval/facts and mark employer questions not yet inspected. No form, upload or resume generation runs from a task. Resume bytes and answers must be revalidated before a separately authorized application workflow.

Existing cached discovery observations can seed a useful offline baseline. Cache provenance is visible as cached_baseline; it is not a successful live poll or a claim of current availability. It generates no new-job alert/task flood. First-seen reflects the retained snapshot time, not a reconstructed earliest historical discovery. Original cache/URLs/content hashes remain source evidence; current private job data does not belong in shared docs.

## Proposed first employers and feeds

These are proposals, not activation or a guarantee of an eligible opening. Existing supported Greenhouse feeds are configured locally at a conservative 15-minute desired interval, with no recurring runner. First verify one bounded cycle, board ownership/completeness and applicable source restrictions; adjust toward five minutes only for an explicitly approved high-priority source and request budget. Actual latency depends on source limits, adaptive cadence and worker availability.

| Employer | Why inspect this source | Proposed official ATS feed |
|---|---|---|
| Cloudflare | Infrastructure/network/cloud engineering relevance; individual entry-level/start eligibility still needs evidence | `https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs` |
| Datadog | Observability/infrastructure/backend relevance and an official early-career program | `https://boards-api.greenhouse.io/v1/boards/datadog/jobs` |
| MongoDB | Database/backend/platform relevance and official student/graduate programs | `https://boards-api.greenhouse.io/v1/boards/mongodb/jobs` |

Public reference pages inspected: [Cloudflare careers](https://www.cloudflare.com/careers/jobs/), [Datadog early careers](https://careers.datadoghq.com/early-careers/), [MongoDB students/graduates](https://www.mongodb.com/company/careers/students-and-graduates). Public pages/programs and existing cached provider data do not certify current feed reliability, polling policy, graduation compatibility or placement. No monitor live request was executed for implementation. Lever/Ashby adapters are wired; wider sources remain future work.

## Commands and consent

All commands resolve the user data root through `path-resolver.mjs`. Configuration/decisions/cache seeding are local. Status does not initialize absent storage. Use a scratch `CAREER_OPS_ROOT` for fixtures, never put fabricated jobs into actual history.

```sh
npm run monitor -- status
npm run monitor -- configure --file /absolute/path/source-proposals.json
npm run monitor -- seed-cache --source cloudflare
npm run monitor -- schedule --source cloudflare --minutes 15
```

`npm run monitor -- reevaluate` re-applies the current evaluator and saved profile to stored postings offline: no network, alerts, tasks, decisions, checkpoints or application records change. Stored postings keep only a description excerpt, so full text from `data/discovery/raw-latest.json` is used only when its content hash equals the posting's latest observed hash. Evidence is labeled per posting: `live_feed` (hash-verified live content from a check under 24 hours old), `cached_snapshot` (cache-seeded, no longer listed, or a live check over 24 hours old) or `stored_excerpt` (no verifiable full text). The last two always keep the posting in review; neither is current eligibility evidence. Postings with no verifiable text keep their previous result and are counted as `unavailable`.

Configuration file is an array; at most eight sources may be configured in total (only sources named in a recurring authorization are polled by `tick`). Example (not itself authorization):

```json
[
  {"id":"cloudflare","company":"Cloudflare","provider":"greenhouse","board":"cloudflare","intervalMinutes":15},
  {"id":"datadog","company":"Datadog","provider":"greenhouse","board":"datadog","intervalMinutes":15},
  {"id":"mongodb","company":"MongoDB","provider":"greenhouse","board":"mongodb","intervalMinutes":15}
]
```

Existing definitions cannot be silently rebound. Schedule changes preserve checkpoints and do not start a runner. Accepted intervals are 5–1440 minutes. Medium/general desired schedules can be set to 15 or 30–60 minutes. After four quiet cycles the due interval grows adaptively, up to four times the target (24-hour maximum); changes reset it. Jitter and failed-request exponential backoff/Retry-After can further delay polls. Desired cadence is not an SLA.

Only after the user authorizes one specific source/read, the controlled command is:

```sh
npm run monitor -- poll-once --source cloudflare --authorize-live-read
```

This performs one due source cycle, at most two allowlisted public GETs, with redirects refused, twenty-second request timeouts and an eight-MiB response cap. No following job URLs, per-job browser, private login or auto-pagination. Due/busy/paused checks can skip a call. Provider retry sleeps are deferred into persisted backoff, including Ashby. Conditional ETag/Last-Modified responses avoid repeated parsing/evaluation. Errors contain sanitized categories, not provider response text.

Before live acceptance obtain the exact employer/feed, two-request maximum, one-cycle scope and saved-alert behavior. Before recurring operation obtain separately the source allowlist, desired intervals, request budget, duration, retention and outage behavior. An ongoing worker/OS-scheduler integration is not installed by this release. Do not put this command into cron/Task Scheduler without that explicit authorization and subsequent worker acceptance. No five-minute blanket polling or guaranteed real-time detection.

## Recurring scheduler (prepared, not activated)

The scheduler is a single tick command for an external trigger. No cron, systemd, Task Scheduler or background loop is installed, and nothing activates by itself.

```sh
npm run monitor -- health                       # scheduler + per-source operational state (read-only)
npm run monitor -- migrate-store                # dry run: partition sizes and lossless round-trip check
npm run monitor -- migrate-store --apply        # move monitor state out of the application ledger
npm run monitor -- rollback-store [--apply]     # verified reverse: fold the split store back into the ledger
npm run monitor -- authorize-recurring --source cloudflare,datadog --hours 72 --max-polls 3
npm run monitor -- tick --authorize-live-read   # one pass; what the external trigger would run
npm run monitor -- revoke-recurring             # emergency stop for recurring polls
```

- **Activation gates.** `tick` refuses without `--authorize-live-read` and without an unexpired persisted authorization naming exact sources. Authorizations last at most 30 days, allow 1–5 polls per tick and can be revoked at any time. Paused or unauthorized sources are never polled and don't consume the tick budget.
- **Reliability.** Each source cycle reuses `poll-once`: per-source leases fence competing workers, Retry-After and exponential backoff persist across ticks, adaptive intervals add jitter, conditional reads skip unchanged feeds, and alerts and preparation proposals are keyed by posting and version, so redelivery or re-polling never duplicates them. Overlapping ticks skip (`tick_in_progress`) rather than queue.
- **Storage.** Recurring polls require the split store (`data/job-monitor/`), one partition per source with a 3 MiB budget each. Polls then never rewrite the application ledger. An existing in-ledger section keeps working in legacy mode until `migrate-store --apply`. That command verifies a lossless round trip, records the legacy content hash, and only then removes the section from the ledger. It can resume after an interruption, and a conflicting copy fails closed.
- **Health states**, which are deliberately distinct:
  - Per source: `ok_no_changes` (healthy, nothing new), `ok_changes`, `failing`, `rate_limited`, `overdue` (authorized and past due plus a grace of twice the interval, minimum 10 minutes), `polling`, `worker_lost` (expired lease, reclaimed on the next tick), `paused`, `never_polled`, `cached_only`.
  - Scheduler: `not_authorized`, `authorization_expired`, `authorized_never_ran`, `running`, `running_with_failures`, `stale` (no tick within twice the shortest interval, minimum 10 minutes).
  - A preparation proposal awaiting review is monitor state; failed or awaiting-approval applications remain application-workflow states.

Rollback keeps state recorded after migration; a restored pre-migration backup (`data/backups/job-monitor-premigration-*`, with `manifest.json` holding the hashes) is the fallback when the split store is unreadable. Both directions resume after an interruption only when the two copies are identical, and otherwise fail closed. A simulated 8-hour scheduler scenario (per-employer intervals, crash reclaim, outage backoff, Retry-After, pause/resume, expiry, quiet baselines, one alert per version) is in `tests/job-monitor-scheduler.test.mjs`.

Activation checklist (each step needs the user's explicit approval): apply the store migration; run one `first-poll` per source; choose sources, interval (15 minutes or more until a source's policy and budget support less), authorization duration and polls per tick; install one OS trigger at about the shortest interval; check `health` after the first ticks; revoke and remove the trigger to stop.

## Pilot: Databricks, Palantir, Stripe, Scale AI, Cloudflare (configured 2026-11-11, not activated)

Configured locally at a 30-minute target. Datadog and MongoDB stay configured (history preserved) but are outside the pilot authorization, so `tick` never polls them. At most eight sources may be configured.

**First-seen baselines — all five established (2026-11-11).** Cloudflare (earlier live baseline), Palantir (304 postings), Scale AI (169), Databricks (912, on a retry after the cap fix) and Stripe (785, on a retry after the inline-offices fix). Each was one bounded `first-poll`, quiet (every posting `baseline`, 0 alerts, 0 proposals), with first-seen equal to the live checkpoint. Stripe's 785 locations are complete (none work-model-only or empty). The earlier failures, both safe (no checkpoint, no postings, backoff respected):
- **Databricks:** most likely the old 8 MiB response cap. It is the largest board, and the failure came within about 1 s. The cap is now 24 MiB.
- **Stripe:** its optional `/offices` lookup timed out after the job list loaded. A cycle with a failed lookup is deliberately failed, because a partial snapshot would change remote postings' locations and trigger false "updated" alerts.

Failure categories are now precise and sanitized (`response_too_large`, `timeout`, `http_<status>`, `enrichment_*`, `rate_limit`), and health reports a failed first poll as `failing`, not `never_polled`.

**`--max-polls` semantics (verified).** `maxPollsPerTick` caps how many employer cycles **one tick invocation** starts (1–5). The counter is local to each tick, so there is no global, daily or cumulative poll budget, and nothing ends the authorization early. Expiry is purely time-based (`approvedAt + hours`). A simulated 168-hour run (a tick every 10 minutes, five sources) kept polling every source through hour 160 and beyond, and polled nothing at exactly 168 hours (`tests/job-monitor-scheduler.test.mjs`). With five pilot sources and `--max-polls 5`, every due source fits in one tick. Paused or unauthorized sources don't consume the budget.

**Greenhouse office data.** `content=true` list rows already carry each job's `offices[]`. The monitor's feed reader answers the provider's `/offices` lookup from that inline data, falling back to the endpoint only if any row lacks it. A same-moment live comparison on Cloudflare produced identical location strings for all 478 work-model-only jobs. This removed Stripe's oversized second download (> 24 MiB). `scan.mjs` still uses the endpoint; the same change would help it upstream.

**Dashboard paging.** The monitor API accepts `?offset=&limit=` (limit 1–100), and the dashboard pages 25 at a time with Previous/Next and a "Showing X–Y of N" summary. On the real data, all 140 reviewable postings were reached exactly once across 6 pages.

**Cadence note.** The 30-minute target is honored as a minimum. Quiet feeds stretch adaptively (60 → 90 → 120 minutes after 4/8/12 quiet cycles), and backoff and Retry-After can delay further. A trigger every 10 minutes keeps scheduling lag at 10 minutes or less while the PC is awake. Ticks don't run while Windows or WSL sleeps; health then reports `stale`/`overdue`.

**Activation package (requires separate approval; nothing below has been run):**

```sh
# 1. Pending baselines, after their backoff (≥ 01:53 UTC 2026-11-11); quiet by design
npm run monitor -- first-poll --source databricks --authorize-live-read
npm run monitor -- first-poll --source stripe --authorize-live-read
# 2. Seven-day recurring authorization for exactly the pilot sources
npm run monitor -- authorize-recurring --source databricks,palantir,stripe,scaleai,cloudflare --hours 168 --max-polls 5
```

```powershell
# 3. Windows Task Scheduler trigger (PowerShell, run as the normal Windows user; no admin rights needed)
$action   = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d <Distro> -u <user> -- <absolute-repo-path>/scripts/job-monitor-tick.sh"
$every10  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 8)
$atLogOn  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskPath "\CareerCentral\" -TaskName "MonitorTick" -Action $action -Trigger $every10,$atLogOn -Settings $settings -Description "Career Central local monitor tick (7-day pilot)"
```

Why these settings:
- **No overlap:** `-MultipleInstances IgnoreNew`, plus the tick lock (stale after 15 minutes) and per-source leases.
- **Restarts:** `-StartWhenAvailable` runs a missed tick after a restart or sleep, and the log-on trigger ticks at sign-in.
- **Bounded runs:** a 10-minute run limit; the repetition ends after 8 days, outliving the 7-day authorization.
- **Working directory:** the wrapper changes to its own repository and loads Node through nvm, so it doesn't depend on the task's working directory.
- **Session:** it runs only while the user is logged on, because `wsl.exe` needs the user session.

**User account.** Use `-u root` for now: the repository and data are root-owned (0600/0700), every development session runs as root, and the normal WSL user has no Node install. Running as a normal user needs a separate, approved change: `chown -R` the repository and data to that user, install Node for them, and run all agents as that user, so new files stay readable.

`scripts/job-monitor-tick.sh` runs one tick and appends a sanitized JSON line to `data/logs/job-monitor-tick.log` (0600, rotated at 5 MiB). Without an unexpired authorization it exits 1 with `MONITOR_RECURRING_NOT_AUTHORIZED` and polls nothing; this was verified on a copy of the data.

**Pause or stop at any time:**
- `npm run monitor -- pause --source <id>` and `resume` work per source.
- `npm run monitor -- revoke-recurring` stops all polling on the next tick.
- `Unregister-ScheduledTask -TaskPath "\CareerCentral\" -TaskName "MonitorTick" -Confirm:$false` removes the trigger. `Disable-ScheduledTask` pauses it.

The authorization expires after 168 hours; ticks then poll nothing and health shows `authorization_expired`.

## Storage port and cloud-readiness pieces (CC-017 C0)

Monitor functions accept either a data root (the local file store, with unchanged layout and behavior) or an injected store object.
- `updateSource` reads and writes one employer's control record and partition, compares them separately, and rejects stale writers with `MONITOR_STORE_CONFLICT`.
- An unchanged snapshot, including a 304, writes no partition content. The posting-level `lastSeenAt` moves only on a change or reappearance; `lastObservedAt` on the source records the latest complete observation, and the dashboard derives a listed posting's last-seen time from it.
- `monitor-memory-store.mjs` is the reference model of the cloud shape: separately versioned control and partition records, with the partition committed first.
- Also implemented: a minimized eligibility projection (`eligibility-projection.mjs`), redacted telemetry with EMF metrics (`monitor-telemetry.mjs`) and a Lambda-compatible handler (`monitor-handler.mjs`).

None of this deploys anything or adds an AWS dependency.

## Persistence and recovery contract

`ledger.jobMonitor` schemaVersion 1 is a derived operational namespace inside the existing application ledger, written only by `updateLedger`. Existing jobs/events/receipts/email health/sending reservations are untouched. It is not a second canonical application tracker. See [owner contract](../lib/career-central/JOB_MONITOR.md).

A source lease is durably claimed before fetching. Complete snapshot normalization, evaluation, alerts/proposals and checkpoint advance commit together under the owner lock. Exceptions before publication leave the previous snapshot/checkpoint intact; no partial alerts/tasks survive. Another worker may reclaim an expired 90-second lease; a stale token cannot publish. An uncertain atomic outcome is reported as uncertain, not a proven rollback. Restart never blindly repeats an external application effect because this worker has no such capability.

Stable provider/board/native posting identity retains employer requisition references and canonical-URL aliases. Same-title postings stay separate with a possible-related/repost hint. An absent row requires two complete successful omissions before inferred expiration; failed/partial responses cannot expire it. Returning expired IDs are labeled reappeared with a possible-repost warning, not proven reposts or assigned a fresh application identity. A first snapshot is baseline, not new publication. Provider publication fields are labeled; Lever createdAt is explicitly not verified publication. Unknown/future publication times remain null.

The monitor budget is three MiB of compact JSON within the existing eight-MiB owner ceiling; excluded postings keep minimal evidence, not full bodies. Capacity overflow stops the cycle for manual review rather than evicting history or expanding limits. Cache import is bounded to 128 MiB/30,000 rows and only selected supported boards. General archival/retention and cross-process OS certification remain future work.

## UI, metrics and remaining scope

The local same-origin/no-store API only reads saved state or writes monitor dispositions/pause state. Bounded POST input rejects unknown/action fields, cross-origin requests and attempts to invoke polling/submissions. React displays plain source text, not executable employer HTML. Page refresh never fetches employer feeds.

Basic stored metrics: cycles, failures, unchanged checks, last success/next due and scheduled poll lag; shortlist qualification/review/exclusion/high-priority counts and first-seen/event/task times. Rich daily/cohort dashboards, publication-latency summaries, task completion/confirmed-submission timing, notification snooze/quiet-hour dispatch, archival and a general worker service are not complete in this slice. No publication-to-discovery latency should be inferred from first-seen or Lever creation time.

Next acceptance: user-approved bounded live cycle for the proposed feeds, review representative eligibility/rank results and missing facts, then separately design/approve recurring worker installation. Keep pending applications in reconciliation and preserve all existing approval/kill-switch protections.

## Validation commands

Final relevant offline run: 339 tests passed, zero failures/skips; three unrelated browser-launching cases excluded by explicit name. Includes 34 monitor tests. The two production browser suites are separate fixture runs, not tests against personal records. Typecheck/build passed with the existing CV Studio tracing warning.

```sh
node --test tests/job-monitor.test.mjs
npm run typecheck --prefix web
npm run build --prefix web
# From web/, using the already-installed Chromium path:
CAREER_CENTRAL_CHROME_EXECUTABLE=/path/to/chrome node tests/browser-suites.mjs career-central
CAREER_CENTRAL_CHROME_EXECUTABLE=/path/to/chrome node tests/browser-suites.mjs job-monitor
```

No live monitor request, recurring installation, application/browser preparation, outgoing email or cloud action was part of acceptance. Public employer career-page research is not monitor execution. Private cached-baseline counts and missing eligibility facts should be reviewed locally, never represented as verified current openings.
