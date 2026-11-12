// Cloud-shaped monitor store (CC-017 C1 preparation): implements the store port
// over two minimal client interfaces, so the semantics can be tested locally
// without an AWS SDK, credentials or resources.
//
//   objects (S3-like):  get(key) -> {body, etag} | null
//                       put(key, body, {ifMatch?, ifNoneMatch?}) -> {etag}
//                       throws {code: 'PreconditionFailed'} on a failed condition
//   table (DynamoDB-like): get(pk, sk) -> {item, version} | null
//                       put(pk, sk, item, {expectedVersion}) -> {version}
//                       (expectedVersion null = must not exist; throws
//                       {code: 'ConditionalCheckFailed'} on a failed condition)
//                       delete(pk, sk, {expectedVersion})
//
// Layout: partitions/{sourceId}.json holds postings, alerts and proposals; the
// control item SOURCE#{id}/CONTROL holds the source record (definition, lease,
// checkpoint, schedule); MONITOR/INDEX holds the source list and scheduler
// record; MONITOR/TICKLOCK is a conditional, expiring tick lock. A source cycle
// writes the partition first (If-Match) and then the control item (conditional
// on its version), which is where the lease is released. An unchanged snapshot
// skips the partition PUT entirely.
import {createHash, randomUUID} from 'node:crypto';
import {validMonitor, sections, scopedToPart, partToScoped, stats, changesOf} from './monitor-store.mjs';

const fail = code => Object.assign(Error(code), {code});
const clone = value => structuredClone(value);
const partitionKey = id => `partitions/${id}.json`;
const conflict = error => {if (['PreconditionFailed', 'ConditionalCheckFailed'].includes(error?.code)) throw fail('MONITOR_STORE_CONFLICT'); throw error;};
const ID = /^[a-z0-9_-]{1,64}$/;

// tickLeaseMs must exceed the longest invocation (Lambda timeout ≤ 300 s in the plan).
export function createCloudMonitorStore({objects, table, ledgerJobs = {}, clock = Date.now, tickLeaseMs = 6 * 60000} = {}) {
  if (!objects || !table) throw fail('MONITOR_STORE_INVALID');
  const counters = stats();
  let queue = Promise.resolve();
  const serial = fn => {const run = queue.then(fn, fn); queue = run.catch(() => {}); return run;};
  async function readSource(id) {
    if (!ID.test(id)) throw fail('MONITOR_STATE_INVALID');
    const control = await table.get(`SOURCE#${id}`, 'CONTROL'), object = await objects.get(partitionKey(id));
    if (!control || !object) throw fail('MONITOR_STATE_INVALID');
    let part; try {part = JSON.parse(object.body);} catch {throw fail('MONITOR_STATE_INVALID');}
    if (control.item?.schemaVersion !== 1) throw fail('MONITOR_STATE_INVALID');
    return {scoped: partToScoped({...part, source: control.item.source}, id), controlVersion: control.version, etag: object.etag};
  }
  async function readIndex() {
    const index = await table.get('MONITOR', 'INDEX');
    return index ? {data: index.item, version: index.version} : {data: {schemaVersion: 1, sourceIds: [], revision: 0}, version: null};
  }
  async function writeSource(id, part, {etag, controlVersion}, {partitionChanged, controlChanged}) {
    if (partitionChanged) {
      const body = JSON.stringify({schemaVersion: 1, sourceId: id, ...sections(part)});
      await objects.put(partitionKey(id), body, etag ? {ifMatch: etag} : {ifNoneMatch: '*'}).catch(conflict);
      counters.partitionWrites++;
    } else counters.unchangedPartitionSkips++;
    if (controlChanged) {
      await table.put(`SOURCE#${id}`, 'CONTROL', {schemaVersion: 1, source: part.source}, {expectedVersion: controlVersion ?? null}).catch(conflict);
      counters.controlWrites++;
    }
  }
  async function readAll() {
    const index = await readIndex(), {sourceIds, schemaVersion, revision, ...rest} = index.data;
    if (schemaVersion !== 1 || !Array.isArray(sourceIds)) throw fail('MONITOR_STATE_INVALID');
    const monitor = {schemaVersion: 1, sources: {}, postings: {}, alerts: {}, preparationTasks: {}, revision, ...rest};
    for (const id of sourceIds) {
      const {scoped} = await readSource(id);
      monitor.sources[id] = scoped.sources[id];
      for (const kind of ['postings', 'alerts', 'preparationTasks']) Object.assign(monitor[kind], scoped[kind]);
    }
    return validMonitor(clone(monitor));
  }
  const scopedOf = (monitor, id) => ({schemaVersion: 1, revision: 0, sources: {[id]: monitor.sources[id]},
    postings: Object.fromEntries(Object.entries(monitor.postings).filter(([, p]) => p.sourceId === id)),
    alerts: Object.fromEntries(Object.entries(monitor.alerts).filter(([, a]) => monitor.postings[a.postingId]?.sourceId === id)),
    preparationTasks: Object.fromEntries(Object.entries(monitor.preparationTasks).filter(([, t]) => monitor.postings[t.postingId]?.sourceId === id))});

  const store = {
    kind: 'cloud', role: 'cloud', stats: counters, backend: () => 'cloud',
    // load() is the authoritative read: it fetches current state from the object
    // store and table every time, and the scheduler uses it for every decision.
    // readAll() only returns this instance's last-loaded view (display/tests); it
    // is never used to decide anything, and every mutation re-reads current state
    // inside its conditional writes.
    snapshot: null,
    load: () => serial(async () => {store.snapshot = await readAll(); return clone(store.snapshot);}),
    readAll() {if (!store.snapshot) throw fail('MONITOR_STORE_NOT_LOADED'); return clone(store.snapshot);},
    refresh: () => store.load(),
    updateAll: (fn, {capacityCheck = false} = {}) => serial(async () => {
      const index = await readIndex(), monitor = index.version === null ? validMonitor({schemaVersion: 1, sources: {}, postings: {}, alerts: {}, preparationTasks: {}, revision: 0}) : await readAll();
      const before = clone(monitor), versions = {};
      for (const id of Object.keys(before.sources)) {const {controlVersion, etag} = await readSource(id); versions[id] = {controlVersion, etag};}
      const result = await fn(monitor, clone(ledgerJobs));
      validMonitor(monitor);
      if (capacityCheck && Object.keys(monitor.alerts).length > 10000) throw fail('MONITOR_CAPACITY_REVIEW_REQUIRED');
      for (const id of Object.keys(monitor.sources)) {
        if (!ID.test(id)) throw fail('MONITOR_STATE_INVALID');
        const after = scopedOf(monitor, id), changes = before.sources[id] ? changesOf(scopedOf(before, id), after, id) : {partitionChanged: true, controlChanged: true};
        await writeSource(id, scopedToPart(after, id), versions[id] ?? {}, changes);
      }
      const {sources, postings, alerts, preparationTasks, schemaVersion, revision, ...rest} = monitor;
      await table.put('MONITOR', 'INDEX', {schemaVersion: 1, sourceIds: Object.keys(sources), revision, ...rest}, {expectedVersion: index.version}).catch(conflict);
      store.snapshot = await readAll();
      return result;
    }),
    updateSource: (sourceId, fn, {capacityCheck = false, phaseHook} = {}) => serial(async () => {
      const index = await readIndex();
      if (!index.data.sourceIds.includes(sourceId)) throw fail('MONITOR_SOURCE_UNKNOWN');
      const {scoped, controlVersion, etag} = await readSource(sourceId), before = clone(scoped);
      const result = await fn(scoped, clone(ledgerJobs));
      const part = scopedToPart(scoped, sourceId), changes = changesOf(before, scoped, sourceId);
      if (capacityCheck && Buffer.byteLength(JSON.stringify(part)) > 3 * 1024 * 1024) throw fail('MONITOR_CAPACITY_REVIEW_REQUIRED');
      if (changes.partitionChanged || changes.controlChanged) {phaseHook?.('prepared'); await writeSource(sourceId, part, {etag, controlVersion}, changes); phaseHook?.('committed');}
      else counters.unchangedPartitionSkips++;
      store.snapshot = await readAll();
      return result;
    }),
    // Distributed, expiring tick lease (MONITOR/TICKLOCK), shared by every
    // invocation and container: acquired with a version-conditional put, released
    // with a version-conditional delete. A holder that crashes simply lets it
    // expire. Per-source leases in the control items still fence each employer.
    async acquireTickLock({now = clock()} = {}) {
      const current = await table.get('MONITOR', 'TICKLOCK');
      if (current && current.item.until > now) return null;
      try {
        const {version} = await table.put('MONITOR', 'TICKLOCK', {token: randomUUID(), until: now + tickLeaseMs}, {expectedVersion: current ? current.version : null});
        return async () => {await table.delete('MONITOR', 'TICKLOCK', {expectedVersion: version}).catch(error => {if (error.code !== 'ConditionalCheckFailed') throw error;});};
      } catch (error) {if (error.code === 'ConditionalCheckFailed') return null; throw error;}
    },
    testHooks: {
      async externalWrite(sourceId) {
        const object = await objects.get(partitionKey(sourceId)); await objects.put(partitionKey(sourceId), object.body + ' ');
        const control = await table.get(`SOURCE#${sourceId}`, 'CONTROL'); await table.put(`SOURCE#${sourceId}`, 'CONTROL', control.item);
      },
      async corrupt(sourceId) {const control = await table.get(`SOURCE#${sourceId}`, 'CONTROL'); await table.put(`SOURCE#${sourceId}`, 'CONTROL', {...control.item, schemaVersion: 999});},
    },
  };
  return store;
}

// In-memory fakes with the same conditional semantics as the real services.
// beforePut may throw to reject a write without applying it (a real 412);
// afterPut runs after the write is applied (a throw there models an ambiguous outcome).
export function memoryObjectStore({beforePut, afterPut} = {}) {
  const items = new Map();
  const etagOf = body => createHash('sha256').update(body).digest('hex').slice(0, 32);
  return {
    async get(key) {const body = items.get(key); return body === undefined ? null : {body, etag: etagOf(body)};},
    async put(key, body, {ifMatch, ifNoneMatch} = {}) {
      beforePut?.(key);
      const current = items.get(key);
      if (ifNoneMatch === '*' && current !== undefined) throw Object.assign(Error('PreconditionFailed'), {code: 'PreconditionFailed'});
      if (ifMatch !== undefined && (current === undefined || etagOf(current) !== ifMatch)) throw Object.assign(Error('PreconditionFailed'), {code: 'PreconditionFailed'});
      items.set(key, body); afterPut?.(key);
      return {etag: etagOf(body)};
    },
    raw: items,
  };
}
export function memoryTable({afterPut} = {}) {
  const items = new Map(), key = (pk, sk) => `${pk}\u0000${sk}`;
  const failed = () => Object.assign(Error('ConditionalCheckFailed'), {code: 'ConditionalCheckFailed'});
  return {
    async get(pk, sk) {const entry = items.get(key(pk, sk)); return entry ? {item: clone(entry.item), version: entry.version} : null;},
    async put(pk, sk, item, {expectedVersion} = {}) {
      const entry = items.get(key(pk, sk));
      if (expectedVersion === null ? entry !== undefined : expectedVersion !== undefined && entry?.version !== expectedVersion) throw failed();
      const version = (entry?.version ?? 0) + 1; items.set(key(pk, sk), {item: clone(item), version}); afterPut?.(pk, sk);
      return {version};
    },
    async delete(pk, sk, {expectedVersion} = {}) {const entry = items.get(key(pk, sk)); if (expectedVersion !== undefined && entry?.version !== expectedVersion) throw failed(); items.delete(key(pk, sk));},
    raw: items,
  };
}
