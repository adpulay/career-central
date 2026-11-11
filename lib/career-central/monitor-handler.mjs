// Lambda-compatible entry point around the existing scheduler tick (CC-017 C0
// item 5). No AWS SDK and no network or storage choice of its own: the caller
// injects the store (local file store today; a cloud store later), the
// minimized eligibility projection, the feed reader and the clock. The returned
// handler has the `(event, context)` shape AWS Lambda calls, and also runs
// locally for tests.
//
// Safety: it runs one tick through runMonitorTick, so the persisted recurring
// authorization, per-tick budget, leases, backoff and deduplication all apply.
// It refuses live reads unless constructed with authorizeLiveRead: true. It
// stops starting new source cycles before the invocation deadline. It returns
// counts only and logs only redacted telemetry.
import {randomUUID} from 'node:crypto';
import {runMonitorTick, monitorHealth} from './monitor-scheduler.mjs';
import {contextFromProjection} from './eligibility-projection.mjs';
import {logLine, tickMetrics} from './monitor-telemetry.mjs';

// `fixtureSources` (dev only): {sourceId: async () => snapshot} replaces the live
// read for those sources so cloud acceptance can create controlled new, changed
// and expired postings without touching employer feeds. Construction fails in
// any other environment, so a production configuration cannot enable it.
export function createMonitorHandler({store, loadProjection, fetchSnapshot, authorizeLiveRead = false, mode = 'live', environment = 'local', fixtureSources = null,
  clock = Date.now, log = line => console.log(line), safetyMarginMs = 30000, perSourceBudgetMs = 45000} = {}) {
  const invalid = () => Object.assign(Error('MONITOR_HANDLER_CONFIG_INVALID'), {code: 'MONITOR_HANDLER_CONFIG_INVALID'});
  if (!store || typeof loadProjection !== 'function' || typeof fetchSnapshot !== 'function') throw invalid();
  if (fixtureSources && (environment !== 'dev' || typeof fixtureSources !== 'object' || Object.values(fixtureSources).some(loader => typeof loader !== 'function'))) throw invalid();
  const reader = fixtureSources ? (definition, checkpoint, signal) => Object.hasOwn(fixtureSources, definition.id) ? fixtureSources[definition.id]() : fetchSnapshot(definition, checkpoint, signal) : fetchSnapshot;
  return async function handler(event = {}, lambdaContext = {}) {
    const started = clock(), correlationId = `tick-${randomUUID()}`;
    const remaining = () => typeof lambdaContext.getRemainingTimeInMillis === 'function' ? lambdaContext.getRemainingTimeInMillis() : Number.POSITIVE_INFINITY;
    log(logLine({event: 'tick_started', correlationId, environment}));
    let result, error;
    try {
      const {context} = contextFromProjection(await loadProjection());
      result = await runMonitorTick({root: store, context, fetchSnapshot: reader, authorizeLiveRead, mode, now: started,
        deadline: () => remaining() > safetyMarginMs + perSourceBudgetMs});
    } catch (caught) {error = caught;}
    const durationMs = clock() - started;
    let health = null;
    // The tick itself loads authoritative state every invocation (warm or cold);
    // health is read the same way after the tick.
    try {health = monitorHealth(store.load ? await store.load() : store.readAll(), clock());} catch { /* health is best effort; the tick outcome is reported regardless */ }
    if (result?.skipped) {
      log(logLine({event: 'tick_skipped', correlationId, environment, state: result.skipped, durationMs}));
      return {ok: true, correlationId, skipped: result.skipped};
    }
    if (error) {
      const errorCategory = /^MONITOR_[A-Z_]+$|^ELIGIBILITY_[A-Z_]+$/.test(error.code || '') ? error.code : 'handler_error';
      log(logLine({level: errorCategory === 'MONITOR_RECURRING_NOT_AUTHORIZED' ? 'warn' : 'error', event: 'tick_failed', correlationId, environment, errorCategory, durationMs}));
      return {ok: false, correlationId, errorCode: errorCategory};
    }
    for (const [sourceId, cycle] of Object.entries(result.results)) {
      log(logLine({level: cycle.state === 'failed' ? 'warn' : 'info', event: 'source_cycle', correlationId, environment, sourceId,
        state: cycle.state ?? cycle.skipped, errorCategory: cycle.errorCategory ?? undefined, counts: cycle, health: health?.sources?.[sourceId]?.state}));
    }
    log(JSON.stringify(tickMetrics({results: result.results, durationMs, health, environment, now: clock()})));
    log(logLine({event: 'tick_completed', correlationId, environment, counts: {polled: result.polled, failed: result.failed}, durationMs, health: health?.scheduler}));
    return {ok: true, correlationId, polled: result.polled, failed: result.failed,
      deferred: Object.entries(result.results).filter(([, cycle]) => cycle.skipped === 'deadline').map(([sourceId]) => sourceId)};
  };
}
