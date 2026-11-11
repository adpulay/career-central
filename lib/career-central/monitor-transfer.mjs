// Local <-> cloud monitor-state transfer (CC-017 C1 item 2).
//
// A bundle carries only monitor state for selected sources: each source's
// control record and partition (postings, alerts, preparation proposals). It
// never carries the profile, eligibility projection, résumés, email, application
// records or the recurring authorization (the target must be authorized
// separately). Integrity is a canonical SHA-256 over the content.
//
// Single writer: a source may carry `owner` ('local' | 'cloud'). Every store has
// a role, and pollSource skips a source owned by the other role ('not_owner'),
// so local and cloud schedulers can never both poll an employer after handover.
// Sources without an owner behave exactly as before.
import {createHash} from 'node:crypto';
import {storeFor} from './monitor-store.mjs';

export const TRANSFER_SCHEMA = 'career-central/monitor-transfer/v1';
const fail = code => Object.assign(Error(code), {code});
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digestOf = sources => createHash('sha256').update(JSON.stringify(canonical(sources))).digest('hex');
const ROLES = new Set(['local', 'cloud']);
// owner and lease are managed by the transfer itself, so they never make an
// otherwise identical source count as a conflict.
const comparable = section => ({...section, control: (({owner, lease, ...rest}) => rest)(section.control)});
const same = (left, right) => JSON.stringify(canonical(comparable(left))) === JSON.stringify(canonical(comparable(right)));
const load = async store => store.load ? store.load() : store.readAll();

function sectionFor(monitor, id) {
  const postings = Object.fromEntries(Object.entries(monitor.postings).filter(([, posting]) => posting.sourceId === id));
  const owned = kind => Object.fromEntries(Object.entries(monitor[kind]).filter(([, item]) => postings[item.postingId]));
  return {control: monitor.sources[id], partition: {postings, alerts: owned('alerts'), preparationTasks: owned('preparationTasks')}};
}

export async function exportMonitorBundle(rootOrStore, {sourceIds, now = Date.now()} = {}) {
  const monitor = await load(storeFor(rootOrStore));
  if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.some(id => !monitor.sources[id])) throw fail('MONITOR_SOURCE_UNKNOWN');
  if (sourceIds.some(id => monitor.sources[id].lease && monitor.sources[id].lease.until > now)) throw fail('MONITOR_SOURCE_BUSY');
  const sources = Object.fromEntries(sourceIds.map(id => [id, sectionFor(monitor, id)]));
  return {schema: TRANSFER_SCHEMA, exportedAt: new Date(now).toISOString(), sources, digest: digestOf(sources)};
}

export function verifyMonitorBundle(bundle) {
  if (bundle?.schema !== TRANSFER_SCHEMA || !bundle.sources || typeof bundle.sources !== 'object') throw fail('MONITOR_TRANSFER_INVALID');
  if (digestOf(bundle.sources) !== bundle.digest) throw fail('MONITOR_TRANSFER_DIGEST_MISMATCH');
  for (const [id, section] of Object.entries(bundle.sources)) {
    if (!/^[a-z0-9_-]{1,64}$/.test(id) || section?.control?.definition?.id !== id) throw fail('MONITOR_TRANSFER_INVALID');
    if (Object.values(section.partition.postings).some(posting => posting.sourceId !== id)) throw fail('MONITOR_TRANSFER_INVALID');
  }
  return true;
}

// Imports sources the target does not have. A source already present with
// identical content is a no-op; any other existing source is a conflict.
// Dry run by default. The written result is read back and compared.
export async function importMonitorBundle(rootOrStore, bundle, {dryRun = true, owner} = {}) {
  verifyMonitorBundle(bundle);
  if (owner !== undefined && !ROLES.has(owner)) throw fail('MONITOR_TRANSFER_INVALID');
  const store = storeFor(rootOrStore), current = await load(store);
  const plan = {create: [], identical: [], conflicts: []};
  for (const [id, section] of Object.entries(bundle.sources)) {
    if (!current.sources[id]) plan.create.push(id);
    else if (same(sectionFor(current, id), section)) plan.identical.push(id);
    else plan.conflicts.push(id);
  }
  if (plan.conflicts.length) throw Object.assign(fail('MONITOR_TRANSFER_CONFLICT'), {sources: plan.conflicts});
  if (dryRun || !plan.create.length) return {imported: false, dryRun, ...plan};
  await store.updateAll(monitor => {
    for (const id of plan.create) {
      const {control, partition} = bundle.sources[id];
      monitor.sources[id] = {...structuredClone(control), lease: null, ...(owner ? {owner} : {})};
      Object.assign(monitor.postings, structuredClone(partition.postings));
      Object.assign(monitor.alerts, structuredClone(partition.alerts));
      Object.assign(monitor.preparationTasks, structuredClone(partition.preparationTasks));
    }
    monitor.revision++;
  });
  const after = await load(store);
  for (const id of plan.create) {
    const expected = structuredClone(bundle.sources[id]); expected.control = {...expected.control, lease: null, ...(owner ? {owner} : {})};
    if (JSON.stringify(canonical(sectionFor(after, id))) !== JSON.stringify(canonical(expected))) throw fail('MONITOR_TRANSFER_VERIFY_FAILED');
  }
  return {imported: true, ...plan};
}

// Sets which role may poll the given sources. Use on both sides during handover:
// mark the source cloud-owned locally (local ticks then skip it) after the
// cloud import is verified; reverse to hand it back.
export async function setSourceOwner(rootOrStore, sourceIds, owner) {
  if (!ROLES.has(owner)) throw fail('MONITOR_TRANSFER_INVALID');
  return storeFor(rootOrStore).updateAll(monitor => {
    if (sourceIds.some(id => !monitor.sources[id])) throw fail('MONITOR_SOURCE_UNKNOWN');
    for (const id of sourceIds) monitor.sources[id].owner = owner;
    monitor.revision++;
    return {owner, sourceIds};
  });
}
