// Minimum local recurring-monitor scheduler. Nothing here installs an OS job or
// runs on import. An external trigger (cron, Task Scheduler, a supervised loop)
// calls `runMonitorTick` once per invocation; the tick polls each due,
// authorized source at most once through the existing `pollSource` cycle, which
// owns leases, backoff/Retry-After, adaptive intervals, jitter, conditional reads
// and per-(posting, version) alert/proposal deduplication.
//
// Activation is a persisted, expiring authorization naming exact sources. The
// tick refuses without it (and the CLI also requires --authorize-live-read).
// Recurring polling needs the split monitor store, so a legacy store would not
// rewrite the application ledger on every cycle.
import path from 'node:path';
import fs from 'node:fs';
import {checkPath} from '../../web/src/lib/core/operational-files.mjs';
import {tryAcquireDirLockSync, releaseOrWarn} from '../dir-lock.mjs';
import {updateMonitor, readMonitorState, monitorBackend} from './monitor-store.mjs';
import {pollSource} from './job-monitor.mjs';

const fail = code => Object.assign(Error(code), {code});
const iso = time => new Date(time).toISOString();
const MAX_AUTHORIZATION_HOURS = 30 * 24;

export async function authorizeRecurring(root, {sourceIds, hours, maxPollsPerTick = 5, now = Date.now()}) {
  if (!Array.isArray(sourceIds) || !sourceIds.length || new Set(sourceIds).size !== sourceIds.length) throw fail('MONITOR_AUTHORIZATION_INVALID');
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_AUTHORIZATION_HOURS) throw fail('MONITOR_AUTHORIZATION_INVALID');
  if (!Number.isInteger(maxPollsPerTick) || maxPollsPerTick < 1 || maxPollsPerTick > 5) throw fail('MONITOR_AUTHORIZATION_INVALID');
  if (monitorBackend(root) !== 'split') throw fail('MONITOR_STORE_MIGRATION_REQUIRED');
  return updateMonitor(root, monitor => {
    if (sourceIds.some(id => !Object.hasOwn(monitor.sources, id))) throw fail('MONITOR_SOURCE_UNKNOWN');
    monitor.scheduler = {...monitor.scheduler, authorization: {sourceIds: [...sourceIds], approvedAt: iso(now), expiresAt: iso(now + hours * 3600000), maxPollsPerTick}};
    monitor.revision++;
    return {authorized: true, ...monitor.scheduler.authorization};
  });
}

export async function revokeRecurring(root, {now = Date.now()} = {}) {
  return updateMonitor(root, monitor => {
    monitor.scheduler = {...monitor.scheduler, authorization: null, revokedAt: iso(now)};
    monitor.revision++;
    return {revoked: true};
  });
}

function activeAuthorization(monitor, now) {
  const auth = monitor.scheduler?.authorization;
  return auth && Date.parse(auth.expiresAt) > now ? auth : null;
}

// One scheduler pass. Overlapping invocations skip instead of queueing, and any
// source still leased by another worker is skipped by pollSource itself.
export async function runMonitorTick({root, context, fetchSnapshot, authorizeLiveRead = false, now = Date.now(), random = Math.random, signal, mode = 'live'}) {
  if (mode === 'live' && authorizeLiveRead !== true) throw fail('MONITOR_LIVE_NOT_AUTHORIZED');
  if (monitorBackend(root) !== 'split') throw fail('MONITOR_STORE_MIGRATION_REQUIRED');
  const lockDir = path.join(root, 'data', 'job-monitor', 'tick.lock'); checkPath(lockDir);
  fs.mkdirSync(path.dirname(lockDir), {recursive: true, mode: 0o700});
  const lock = tryAcquireDirLockSync(lockDir, {staleMs: 15 * 60000});
  if (!lock) return {skipped: 'tick_in_progress'};
  try {
    const monitor = readMonitorState(root), auth = activeAuthorization(monitor, now);
    if (!auth) {
      await recordTick(root, {at: iso(now), outcome: monitor.scheduler?.authorization ? 'authorization_expired' : 'not_authorized', polled: 0});
      throw fail('MONITOR_RECURRING_NOT_AUTHORIZED');
    }
    // Due order: never-polled first, then earliest nextDueAt.
    const due = auth.sourceIds.filter(id => monitor.sources[id]).sort((a, b) =>
      (Date.parse(monitor.sources[a].nextDueAt ?? 0) || 0) - (Date.parse(monitor.sources[b].nextDueAt ?? 0) || 0) || a.localeCompare(b));
    const results = {};
    let polled = 0;
    for (const sourceId of due) {
      if (signal?.aborted) {results[sourceId] = {skipped: 'cancelled'}; continue;}
      if (monitor.sources[sourceId].paused) {results[sourceId] = {skipped: 'paused'}; continue;}
      if (polled >= auth.maxPollsPerTick) {results[sourceId] = {skipped: 'tick_budget'}; continue;}
      const result = await pollSource({root, sourceId, context, fetchSnapshot, mode, authorizeLiveRead, now, random, signal});
      if (!result.skipped) polled++;
      results[sourceId] = result.skipped ? {skipped: result.skipped} : {state: result.state, new: result.new ?? 0, updated: result.updated ?? 0, alerts: result.alerts ?? 0,
        preparationTasks: result.preparationTasks ?? 0, errorCategory: result.errorCategory ?? null};
    }
    const failed = Object.values(results).filter(result => result.state === 'failed').length;
    await recordTick(root, {at: iso(now), outcome: failed ? 'completed_with_failures' : 'completed', polled, failed});
    return {polled, failed, results, recurringInstalled: false, submittedApplications: 0};
  } finally {releaseOrWarn(lock);}
}

async function recordTick(root, tick) {
  await updateMonitor(root, monitor => {
    monitor.scheduler = {...monitor.scheduler, lastTick: tick}; monitor.revision++;
  });
}

// Operational state per source and for the scheduler. These are deliberately
// distinct: no new jobs is healthy; a failing, overdue, rate-limited or
// worker-lost source is not; a paused or unauthorized source is a choice.
export function monitorHealth(monitor, now = Date.now()) {
  const auth = activeAuthorization(monitor, now);
  const sources = Object.fromEntries(Object.entries(monitor.sources).map(([id, source]) => {
    const interval = (source.adaptiveMinutes ?? source.definition.intervalMinutes) * 60000;
    const grace = Math.max(2 * interval, 10 * 60000), due = Date.parse(source.nextDueAt ?? '');
    const state = source.paused ? 'paused'
      : source.lease && source.lease.until <= now ? 'worker_lost'
      : source.lease ? 'polling'
      : !source.checkpoint ? 'never_polled'
      : source.checkpoint.provenance !== 'live_feed' && source.checkpoint.provenance !== 'synthetic' ? 'cached_only'
      : source.status === 'rate_limited' ? 'rate_limited'
      : source.failures > 0 ? 'failing'
      : auth?.sourceIds.includes(id) && Number.isFinite(due) && now - due > grace ? 'overdue'
      : source.lastCycle && (source.lastCycle.new || source.lastCycle.updated) ? 'ok_changes'
      : 'ok_no_changes';
    return [id, {state, recurring: !!auth?.sourceIds.includes(id), failures: source.failures ?? 0, errorCategory: source.errorCategory ?? null,
      lastSuccessAt: source.lastSuccessAt ?? null, nextDueAt: source.nextDueAt ?? null}];
  }));
  const lastTick = monitor.scheduler?.lastTick ?? null;
  const shortest = auth ? Math.min(...auth.sourceIds.filter(id => monitor.sources[id]).map(id => monitor.sources[id].definition.intervalMinutes)) * 60000 : null;
  const scheduler = !auth ? (monitor.scheduler?.authorization ? 'authorization_expired' : 'not_authorized')
    : !lastTick ? 'authorized_never_ran'
    : now - Date.parse(lastTick.at) > Math.max(2 * shortest, 10 * 60000) ? 'stale'
    : lastTick.outcome === 'completed_with_failures' ? 'running_with_failures' : 'running';
  return {scheduler, authorization: auth ? {sourceIds: auth.sourceIds, expiresAt: auth.expiresAt, maxPollsPerTick: auth.maxPollsPerTick} : null, lastTick, sources};
}
