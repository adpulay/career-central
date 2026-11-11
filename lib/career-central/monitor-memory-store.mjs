// In-memory monitor store implementing the CC-017 C0 store port. It is the
// reference model for a cloud store: each source has a separately versioned
// control record (definition, lease, checkpoint, schedule) and partition
// (postings, alerts, preparation proposals). Writes are compare-and-set on those
// versions (like S3 If-Match and DynamoDB conditional updates), and the partition
// is committed before the control record, which is where the lease is released.
// Used by contract tests and the handler wrapper's tests; it holds no real data.
import {validMonitor, sections, scopedToPart, partToScoped, stats, changesOf} from './monitor-store.mjs';

const fail = code => Object.assign(Error(code), {code});
const clone = value => structuredClone(value);

export function memoryMonitorStore({ledgerJobs = {}, faults = {}, role = 'local'} = {}) {
  const controls = new Map(), partitions = new Map();
  let index = {data: {schemaVersion: 1, sourceIds: [], revision: 0}, version: 0}, tickHeld = false, queue = Promise.resolve();
  const counters = stats();
  // Serializes mutations, as the file store's lock does.
  const serial = fn => {const run = queue.then(fn, fn); queue = run.catch(() => {}); return run;};
  const versionsOf = id => ({control: controls.get(id)?.version ?? 0, partition: partitions.get(id)?.version ?? 0});
  function assemble() {
    const {sourceIds, schemaVersion, revision, ...rest} = index.data;
    const monitor = {schemaVersion: 1, sources: {}, postings: {}, alerts: {}, preparationTasks: {}, revision, ...rest};
    for (const id of sourceIds) {
      const control = controls.get(id), part = partitions.get(id);
      if (!control || !part) throw fail('MONITOR_STATE_INVALID');
      const scoped = partToScoped({schemaVersion: control.schemaVersion, sourceId: id, source: control.data, ...part.data}, id);
      monitor.sources[id] = scoped.sources[id];
      for (const kind of ['postings', 'alerts', 'preparationTasks']) Object.assign(monitor[kind], scoped[kind]);
    }
    return validMonitor(clone(monitor));
  }
  function commitSource(id, part, expected, {partitionChanged, controlChanged}) {
    if (partitionChanged) {
      if ((partitions.get(id)?.version ?? 0) !== expected.partition) throw fail('MONITOR_STORE_CONFLICT');
      partitions.set(id, {data: clone(sections(part)), version: expected.partition + 1}); counters.partitionWrites++;
      faults.afterPartitionWrite?.(id);
    } else counters.unchangedPartitionSkips++;
    if (controlChanged) {
      if ((controls.get(id)?.version ?? 0) !== expected.control) throw fail('MONITOR_STORE_CONFLICT');
      controls.set(id, {data: clone(part.source), schemaVersion: 1, version: expected.control + 1}); counters.controlWrites++;
    }
  }
  return {
    kind: 'memory', role, stats: counters,
    backend: () => 'memory',
    readAll: () => assemble(),
    updateAll: (fn, {capacityCheck = false} = {}) => serial(async () => {
      const monitor = assemble(), before = clone(monitor);
      const result = await fn(monitor, clone(ledgerJobs));
      validMonitor(monitor);
      if (capacityCheck && Object.keys(monitor.alerts).length > 10000) throw fail('MONITOR_CAPACITY_REVIEW_REQUIRED');
      for (const id of Object.keys(monitor.sources)) {
        const scopedOf = m => ({schemaVersion: 1, revision: 0, sources: {[id]: m.sources[id]},
          postings: Object.fromEntries(Object.entries(m.postings).filter(([, p]) => p.sourceId === id)),
          alerts: Object.fromEntries(Object.entries(m.alerts).filter(([, a]) => m.postings[a.postingId]?.sourceId === id)),
          preparationTasks: Object.fromEntries(Object.entries(m.preparationTasks).filter(([, t]) => m.postings[t.postingId]?.sourceId === id))});
        const after = scopedOf(monitor), prior = before.sources[id] ? scopedOf(before) : {sources: {}, postings: undefined};
        const changes = before.sources[id] ? changesOf(prior, after, id) : {partitionChanged: true, controlChanged: true};
        commitSource(id, scopedToPart(after, id), versionsOf(id), changes);
      }
      const {sources, postings, alerts, preparationTasks, schemaVersion, revision, ...rest} = monitor;
      index = {data: {schemaVersion: 1, sourceIds: Object.keys(sources), revision, ...rest}, version: index.version + 1};
      return result;
    }),
    updateSource: (sourceId, fn, {capacityCheck = false, phaseHook} = {}) => serial(async () => {
      if (!index.data.sourceIds.includes(sourceId)) throw fail('MONITOR_SOURCE_UNKNOWN');
      const expected = versionsOf(sourceId), control = controls.get(sourceId);
      if (control.schemaVersion !== 1) throw fail('MONITOR_STATE_INVALID');
      const scoped = partToScoped({schemaVersion: 1, sourceId, source: clone(control.data), ...clone(partitions.get(sourceId).data)}, sourceId, index.data.revision);
      const before = clone(scoped), result = await fn(scoped, clone(ledgerJobs));
      const part = scopedToPart(scoped, sourceId), changes = changesOf(before, scoped, sourceId);
      if (capacityCheck && Buffer.byteLength(JSON.stringify(part)) > 3 * 1024 * 1024) throw fail('MONITOR_CAPACITY_REVIEW_REQUIRED');
      if (changes.partitionChanged || changes.controlChanged) {phaseHook?.('prepared'); commitSource(sourceId, part, expected, changes); phaseHook?.('committed');}
      else counters.unchangedPartitionSkips++;
      return result;
    }),
    acquireTickLock() {if (tickHeld) return null; tickHeld = true; return () => {tickHeld = false;};},
    testHooks: {
      externalWrite(sourceId) {
        const control = controls.get(sourceId), part = partitions.get(sourceId);
        controls.set(sourceId, {...control, version: control.version + 1});
        partitions.set(sourceId, {...part, version: part.version + 1});
      },
      corrupt(sourceId) {controls.set(sourceId, {...controls.get(sourceId), schemaVersion: 999});},
      versions: versionsOf,
    },
  };
}
