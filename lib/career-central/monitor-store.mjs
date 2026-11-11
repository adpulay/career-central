// Job-monitor state storage. Two backends behind one update/read seam:
//
// - legacy: `jobMonitor` inside the application ledger (existing installs until
//   migrated). Every write rewrites the whole ledger under its lock.
// - split:  data/job-monitor/index.json + sources/{sourceId}.json. Each source
//   partition holds its definition/checkpoint/lease, postings, and the alerts and
//   preparation proposals for those postings, so a poll commits one partition
//   atomically and never rewrites application or email records. The index is
//   written last and holds only the source list, revision and scheduler record.
//
// A fresh data root uses the split store. An existing legacy section is read and
// written in place until `migrateMonitorStore` moves it with verification.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {updateLedger} from '../applications/store.mjs';
import {ownedPath, readOwnedJson, atomicWriteOwnedJson, fileDigest, checkPath} from '../../web/src/lib/core/operational-files.mjs';
import {acquireDirLock, releaseOrWarn} from '../dir-lock.mjs';

const fail = code => Object.assign(Error(code), {code});
// Canonical (key-sorted) JSON: migration verification compares content, not the
// insertion order of postings interleaved across sources in the legacy section.
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const PARTITION_LIMIT_BYTES = 3 * 1024 * 1024;
const LEGACY_LIMIT_BYTES = 3 * 1024 * 1024;
const empty = () => ({schemaVersion: 1, sources: {}, postings: {}, alerts: {}, preparationTasks: {}, revision: 0});

export function validMonitor(value) {
  if (value.schemaVersion !== 1 || !Number.isInteger(value.revision) || !['sources', 'postings', 'alerts', 'preparationTasks'].every(key => value[key] && !Array.isArray(value[key]) && typeof value[key] === 'object')) throw fail('MONITOR_STATE_INVALID');
  return value;
}
const dir = root => path.join(root, 'data', 'job-monitor');
const indexFile = root => path.join(dir(root), 'index.json');
const sourceFile = (root, id) => {
  if (!/^[a-z0-9_-]{1,64}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw fail('MONITOR_STATE_INVALID');
  return path.join(dir(root), 'sources', `${id}.json`);
};
const ledgerFile = root => ownedPath(root, 'mailbox');

// Which backend owns monitor state for this root. Throws when an interrupted
// migration left both copies; `migrateMonitorStore` resolves that.
export function monitorBackend(root) {
  const index = readOwnedJson(checkPath(indexFile(root)));
  const legacy = readOwnedJson(ledgerFile(root))?.jobMonitor;
  if (index && legacy !== undefined) throw fail('MONITOR_STORE_MIGRATION_INCOMPLETE');
  return legacy !== undefined ? 'legacy' : 'split';
}

function partition(monitor) {
  validMonitor(monitor);
  const parts = {};
  for (const [id, source] of Object.entries(monitor.sources)) parts[id] = {schemaVersion: 1, sourceId: id, source, postings: {}, alerts: {}, preparationTasks: {}};
  for (const [id, posting] of Object.entries(monitor.postings)) {
    if (!parts[posting.sourceId]) throw fail('MONITOR_STATE_INVALID');
    parts[posting.sourceId].postings[id] = posting;
  }
  for (const kind of ['alerts', 'preparationTasks']) for (const [id, item] of Object.entries(monitor[kind])) {
    const owner = monitor.postings[item.postingId]?.sourceId;
    if (!owner) throw fail('MONITOR_STATE_INVALID');
    parts[owner][kind][id] = item;
  }
  const {sources, postings, alerts, preparationTasks, schemaVersion, revision, ...rest} = monitor;
  return {parts, index: {schemaVersion: 1, sourceIds: Object.keys(parts), revision, ...rest}};
}

function assemble(index, parts) {
  if (index.schemaVersion !== 1 || !Array.isArray(index.sourceIds)) throw fail('MONITOR_STATE_INVALID');
  const {sourceIds, schemaVersion, revision, ...rest} = index;
  const monitor = {schemaVersion: 1, sources: {}, postings: {}, alerts: {}, preparationTasks: {}, revision, ...rest};
  for (const id of sourceIds) {
    const part = parts[id];
    if (!part || part.schemaVersion !== 1 || part.sourceId !== id) throw fail('MONITOR_STATE_INVALID');
    monitor.sources[id] = part.source;
    for (const kind of ['postings', 'alerts', 'preparationTasks']) Object.assign(monitor[kind], part[kind]);
  }
  return validMonitor(monitor);
}

function readSplit(root) {
  const index = readOwnedJson(checkPath(indexFile(root)));
  if (!index) return {monitor: empty(), digests: {index: null}};
  const parts = {}, digests = {index: fileDigest(indexFile(root))};
  for (const id of index.sourceIds ?? []) {
    const file = checkPath(sourceFile(root, id));
    parts[id] = readOwnedJson(file); digests[id] = fileDigest(file);
  }
  return {monitor: assemble(index, parts), digests};
}

// Partitions are written before the index; each file is atomically replaced and
// guarded by the digest read under the lock. A crash between files leaves every
// file internally consistent; a stale index revision is harmless.
function writeSplit(root, before, after, digests) {
  const old = before ? partition(before) : {parts: {}, index: null}, next = partition(after);
  for (const [id, part] of Object.entries(next.parts)) {
    if (Buffer.byteLength(JSON.stringify(part)) > PARTITION_LIMIT_BYTES) throw fail('MONITOR_CAPACITY_REVIEW_REQUIRED');
  }
  for (const [id, part] of Object.entries(next.parts)) {
    if (JSON.stringify(part) !== JSON.stringify(old.parts[id])) atomicWriteOwnedJson(sourceFile(root, id), part, {expectedDigest: digests[id] ?? null});
  }
  if (JSON.stringify(next.index) !== JSON.stringify(old.index)) atomicWriteOwnedJson(indexFile(root), next.index, {expectedDigest: digests.index ?? null});
}

async function withMonitorLock(root, fn) {
  const lockDir = path.join(root, 'data', 'job-monitor.lock'); checkPath(lockDir);
  fs.mkdirSync(path.dirname(lockDir), {recursive: true, mode: 0o700});
  const lock = await acquireDirLock(lockDir, {timeoutMs: 5000, retryMs: 25, maxWaitMs: 10000});
  try {return await fn();} finally {releaseOrWarn(lock);}
}

export function readMonitorState(root) {
  const backend = monitorBackend(root);
  if (backend === 'legacy') return structuredClone(validMonitor(readOwnedJson(ledgerFile(root)).jobMonitor));
  return readSplit(root).monitor;
}

// fn(monitor, ledgerJobs) mutates monitor; ledgerJobs is a read-only snapshot of
// application records for prior-application checks. `capacityCheck` applies the
// backend's storage budget (polls), as the inline check did before.
export async function updateMonitor(root, fn, {capacityCheck = false, phaseHook} = {}) {
  if (monitorBackend(root) === 'legacy') {
    return updateLedger(root, async ledger => {
      if (ledger.jobMonitor === undefined) throw fail('MONITOR_STORE_CHANGED');
      const monitor = validMonitor(ledger.jobMonitor);
      const result = await fn(monitor, structuredClone(ledger.jobs));
      if (capacityCheck && (Object.keys(monitor.postings).length > 5000 || Object.keys(monitor.alerts).length > 10000 || Buffer.byteLength(JSON.stringify(monitor)) > LEGACY_LIMIT_BYTES)) throw fail('MONITOR_CAPACITY_REVIEW_REQUIRED');
      return result;
    }, {phaseHook});
  }
  return withMonitorLock(root, async () => {
    if (monitorBackend(root) !== 'split') throw fail('MONITOR_STORE_CHANGED');
    const {monitor, digests} = readSplit(root), before = structuredClone(monitor);
    const jobs = readOwnedJson(ledgerFile(root))?.jobs ?? {};
    const result = await fn(monitor, jobs);
    if (capacityCheck && Object.keys(monitor.alerts).length > 10000) throw fail('MONITOR_CAPACITY_REVIEW_REQUIRED');
    if (JSON.stringify(monitor) !== JSON.stringify(before)) {
      phaseHook?.('prepared');
      writeSplit(root, digests.index ? before : null, monitor, digests);
      phaseHook?.('committed');
    }
    return result;
  });
}

// Moves a legacy `jobMonitor` section into the split store. Dry run reports the
// partition sizes and verifies a lossless round trip without writing. A real run
// writes partitions and an index recording the legacy content hash, verifies the
// written store equals the legacy section, and only then removes the section from
// the ledger (no other ledger field changes). Re-running after a crash between
// those steps completes the removal when the hashes still match.
export async function migrateMonitorStore(root, {dryRun = true} = {}) {
  return updateLedger(root, async ledger => withMonitorLock(root, async () => {
    const legacy = ledger.jobMonitor, index = readOwnedJson(checkPath(indexFile(root)));
    if (legacy === undefined) return {migrated: false, reason: index ? 'already_migrated' : 'nothing_to_migrate'};
    validMonitor(legacy);
    const legacyHash = hash(legacy);
    if (index) {
      // Two copies: finish only when their content is identical (an interrupted
      // migration or rollback); anything else is a conflict for review.
      if (!same(stripMigration(readSplit(root).monitor), legacy)) throw fail(index.migration?.legacyHash === legacyHash ? 'MONITOR_STORE_MIGRATION_VERIFY_FAILED' : 'MONITOR_STORE_MIGRATION_CONFLICT');
      if (dryRun) return {migrated: false, dryRun: true, resumable: true};
      delete ledger.jobMonitor; return {migrated: true, resumed: true};
    }
    const {parts} = partition(legacy);
    const sizes = Object.fromEntries(Object.entries(parts).map(([id, part]) => [id, Buffer.byteLength(JSON.stringify(part))]));
    if (Object.values(sizes).some(size => size > PARTITION_LIMIT_BYTES)) throw fail('MONITOR_CAPACITY_REVIEW_REQUIRED');
    const roundTrip = assemble(partition(legacy).index, parts);
    if (!same(roundTrip, legacy)) throw fail('MONITOR_STORE_MIGRATION_VERIFY_FAILED');
    const report = {sources: Object.keys(parts).length, postings: Object.keys(legacy.postings).length, alerts: Object.keys(legacy.alerts).length,
      preparationTasks: Object.keys(legacy.preparationTasks).length, partitionBytes: sizes, legacyHash};
    if (dryRun) return {migrated: false, dryRun: true, ...report};
    const withMarker = {...legacy, migration: {legacyHash, migratedAt: new Date().toISOString()}};
    try {
      writeSplit(root, null, withMarker, {index: null});
      if (!same(stripMigration(readSplit(root).monitor), legacy)) throw fail('MONITOR_STORE_MIGRATION_VERIFY_FAILED');
    } catch (error) {
      // Nothing was removed from the ledger; drop partial split files so the
      // legacy copy remains the only owner.
      fs.rmSync(dir(root), {recursive: true, force: true});
      throw error;
    }
    delete ledger.jobMonitor;
    return {migrated: true, ...report};
  }));
}
const stripMigration = ({migration, ...monitor}) => monitor;

// Reverse of migrateMonitorStore: folds the split store, including any state
// recorded after migration, back into the ledger's `jobMonitor` section. The
// ledger is written first and read back; data/job-monitor/ is removed only once
// the written section equals the split content. An interruption between those
// steps leaves two identical copies (reported as MONITOR_STORE_MIGRATION_INCOMPLETE),
// and re-running either command completes it. Requires no active source lease;
// dry run unless dryRun is false. Restoring the pre-migration backup is the
// fallback when the split store itself is unreadable.
export async function rollbackMonitorStore(root, {dryRun = true, now = Date.now()} = {}) {
  const result = await updateLedger(root, async ledger => withMonitorLock(root, async () => {
    const index = readOwnedJson(checkPath(indexFile(root)));
    if (!index) return {rolledBack: false, reason: ledger.jobMonitor !== undefined ? 'already_legacy' : 'nothing_to_roll_back'};
    const monitor = stripMigration(readSplit(root).monitor);
    if (ledger.jobMonitor !== undefined) {
      if (!same(ledger.jobMonitor, monitor)) throw fail('MONITOR_STORE_MIGRATION_CONFLICT');
      return dryRun ? {rolledBack: false, dryRun: true, resumable: true} : {rolledBack: true, resumed: true, expected: monitor};
    }
    if (Object.values(monitor.sources).some(source => source.lease && source.lease.until > now)) throw fail('MONITOR_SOURCE_BUSY');
    if (Buffer.byteLength(JSON.stringify(monitor)) > LEGACY_LIMIT_BYTES) throw fail('MONITOR_CAPACITY_REVIEW_REQUIRED');
    const report = {sources: Object.keys(monitor.sources).length, postings: Object.keys(monitor.postings).length,
      alerts: Object.keys(monitor.alerts).length, preparationTasks: Object.keys(monitor.preparationTasks).length};
    if (dryRun) return {rolledBack: false, dryRun: true, ...report};
    ledger.jobMonitor = monitor;
    return {rolledBack: true, ...report, expected: monitor};
  }));
  if (!result.expected) return result;
  const {expected, ...report} = result;
  if (!same(readOwnedJson(ledgerFile(root))?.jobMonitor, expected)) throw fail('MONITOR_STORE_MIGRATION_VERIFY_FAILED');
  fs.rmSync(dir(root), {recursive: true, force: true});
  return report;
}
