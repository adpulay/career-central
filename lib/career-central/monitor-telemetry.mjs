// Redacted operational telemetry for the monitor (CC-017 C0 item 4).
//
// Two outputs, both plain JSON lines (CloudWatch Logs ingests them; EMF lines
// also become metrics without an SDK call):
// - tickMetrics(): one CloudWatch Embedded Metric Format record per tick with at
//   most ten aggregate metrics, so a personal deployment stays inside the free
//   custom-metric allowance. Per-source detail goes to logs, not metric dimensions.
// - logLine(): an allowlisted structured log record. Every field is optional and
//   validated; anything else (posting text, titles, URLs, profile values, error
//   messages from providers) is dropped by construction.
export const METRIC_NAMESPACE = 'CareerCentral/Monitor';
const ID = /^[a-z0-9_-]{1,64}$/, CATEGORY = /^(?:[a-z0-9_]{1,64}|MONITOR_[A-Z_]{1,60})$/;
const STATES = new Set(['healthy', 'unchanged', 'failed', 'rate_limited', 'cancelled', 'cached_baseline', 'busy', 'paused', 'not_due', 'tick_budget', 'deadline', 'tick_in_progress', 'live_baseline_exists']);
const EVENTS = new Set(['tick_started', 'tick_completed', 'tick_failed', 'tick_skipped', 'source_cycle']);
const LEVELS = new Set(['info', 'warn', 'error']);
const count = value => Number.isInteger(value) && value >= 0 && value <= 1e6 ? value : undefined;

export function logLine({level = 'info', event, correlationId, environment, sourceId, state, errorCategory, counts = {}, durationMs, health} = {}) {
  const record = {level: LEVELS.has(level) ? level : 'info', event: EVENTS.has(event) ? event : 'source_cycle'};
  if (typeof correlationId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(correlationId)) record.correlationId = correlationId;
  if (typeof environment === 'string' && /^(dev|prod|local)$/.test(environment)) record.environment = environment;
  if (typeof sourceId === 'string' && ID.test(sourceId)) record.sourceId = sourceId;
  if (typeof state === 'string' && STATES.has(state)) record.state = state;
  if (typeof errorCategory === 'string' && CATEGORY.test(errorCategory)) record.errorCategory = errorCategory;
  if (typeof health === 'string' && ID.test(health)) record.health = health;
  for (const key of ['new', 'updated', 'alerts', 'preparationTasks', 'polled', 'failed']) if (count(counts[key]) !== undefined) (record.counts ??= {})[key] = counts[key];
  if (Number.isFinite(durationMs) && durationMs >= 0) record.durationMs = Math.round(durationMs);
  return JSON.stringify(record);
}

export function tickMetrics({results = {}, durationMs = 0, health, environment = 'local', now = Date.now()}) {
  const cycles = Object.values(results);
  const sum = key => cycles.reduce((total, cycle) => total + (count(cycle[key]) ?? 0), 0);
  const values = {
    PollSucceeded: cycles.filter(cycle => cycle.state === 'healthy' || cycle.state === 'unchanged').length,
    PollFailed: cycles.filter(cycle => cycle.state === 'failed').length,
    RateLimited: cycles.filter(cycle => cycle.errorCategory === 'rate_limit').length,
    NotModified: cycles.filter(cycle => cycle.state === 'unchanged').length,
    NewOrChangedPostings: sum('new') + sum('updated'),
    AlertsCreated: sum('alerts'),
    TickDurationMs: Math.round(durationMs),
    SourcesOverdue: health ? Object.values(health.sources).filter(source => source.state === 'overdue').length : 0,
    SourcesFailing: health ? Object.values(health.sources).filter(source => source.recurring && ['failing', 'rate_limited', 'worker_lost'].includes(source.state)).length : 0,
    AuthorizationHoursRemaining: health?.authorization ? Math.max(0, Math.floor((Date.parse(health.authorization.expiresAt) - now) / 3600000)) : 0,
  };
  return {_aws: {Timestamp: now, CloudWatchMetrics: [{Namespace: METRIC_NAMESPACE, Dimensions: [['Environment']],
    Metrics: Object.keys(values).map(Name => ({Name, Unit: Name === 'TickDurationMs' ? 'Milliseconds' : Name === 'AuthorizationHoursRemaining' ? 'None' : 'Count'}))}]},
    Environment: environment, ...values};
}
