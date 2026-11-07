// Shared pure storage contract: imported by the scheduler bundle and core engine.
import schema from './operational-storage.schema.json' with {type:'json'};
import {validateSchema} from './schema-validation.mjs';
export {schema as storageSchema};
export function instant(value){
 if(typeof value!=='string'||!new RegExp(schema.$defs.instant.pattern).test(value))return null;
 const [h,m,s]=[value.slice(11,13),value.slice(14,16),value.slice(17,19)].map(Number),day=new Date(value.slice(0,10)+'T00:00:00Z');
 if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value.slice(0,10)||h>23||m>59||s>59)return null;
 const n=Date.parse(value);return Number.isFinite(n)?new Date(n).toISOString():null;
}
export const expires=(at,ttl)=>at===null?null:new Date(Date.parse(at)+ttl*1000).toISOString();
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export function validateStorage(kind,value){
 const def=kind==='workers'&&value?.schemaVersion===1?'workersInput':kind;
 if(!Object.hasOwn(schema.$defs,def))return [':unsupported_contract'];
 const errors=validateSchema(value,{...schema,anyOf:undefined,$ref:'#/$defs/'+def});if(errors.length)return errors;
 const walk=v=>{if(!v||typeof v!=='object')return;for(const[k,x]of Object.entries(v)){if(x!==null&&(/At$/.test(k)||['from','through'].includes(k))&&!instant(x))errors.push(':invalid_time');if(x&&typeof x==='object')walk(x);}};walk(value);if(errors.length)return errors;
 if(def==='workerInput'&&new Set(value.capabilities).size!==value.capabilities.length)errors.push(':duplicate_capability');
 if(['workers','workersInput'].includes(def)){
  if(new Set(value.workers.map(w=>w.workerId)).size!==value.workers.length)errors.push(':duplicate_worker');
  for(const w of value.workers){if(new Set(w.capabilities).size!==w.capabilities.length)errors.push(':duplicate_capability');if(def==='workers'&&(w.heartbeatExpiresAt!==expires(w.lastHeartbeatAt,w.heartbeatTtlSeconds)||w.revision>value.revision))errors.push(':worker_revision_or_expiry');}
 }
 if(['mailbox','mailboxRequest'].includes(def)){
  const c=value.connection,s=value.synchronization,scope=value.folderScope;
  if(!scope.length||new Set(scope).size!==scope.length||scope.includes('all_messages')&&scope.length!==1)errors.push(':folder_scope');
  if(c&&(Date.parse(c.expiresAt)<=Date.parse(c.observedAt)||Date.parse(c.expiresAt)-Date.parse(c.observedAt)>86400000))errors.push(':connection_expiry');
  if(s){if(s.lastSuccessfulSyncAt&&Date.parse(s.lastSuccessfulSyncAt)>Date.parse(s.observedAt))errors.push(':sync_order');if(s.coverage&&(Date.parse(s.coverage.from)>Date.parse(s.coverage.through)||Date.parse(s.coverage.through)>Date.parse(s.observedAt)||s.incomplete===s.coverage.complete||s.coverage.complete&&(!s.lastSuccessfulSyncAt||Date.parse(s.lastSuccessfulSyncAt)<Date.parse(s.coverage.through))))errors.push(':coverage');}
  const p=value.checkpoint;if(p&&(!p.coverage.complete||Date.parse(p.coverage.from)>Date.parse(p.coverage.through)||Date.parse(p.coverage.through)>Date.parse(p.completedAt)||canonical([...p.folderScope].sort())!==canonical([...scope].sort())||s?.lastSuccessfulSyncAt!==p.completedAt))errors.push(':checkpoint');
  if(p&&s?.state==='idle'&&s.incomplete===false&&s.coverage?.complete&&canonical(p.coverage)!==canonical(s.coverage))errors.push(':checkpoint_coverage_mismatch');
  if(!p&&s?.lastSuccessfulSyncAt)errors.push(':checkpoint_missing');
  const r=value.retry;if(r.nextAttemptAt===null?r.delaySeconds!==0:r.delaySeconds<1||r.attempt<1||r.attempt>=8)errors.push(':retry');
  if(def==='mailbox'&&r.nextAttemptAt!==null&&r.nextAttemptAt!==expires(value.updatedAt,r.delaySeconds))errors.push(':retry_time');
 }
 if(value.schemaVersion===2&&def==='mailbox'&&(value.provenance.writer!=='local_metadata'||value.provenance.operationId!==value.operations.at(-1)?.id||value.provenance.receivedAt!==value.updatedAt))errors.push(':provenance');
 if(value.schemaVersion===2&&def==='workers')for(const w of value.workers)if(w.provenance.receivedAt!==w.observedAt||w.provenance.writer==='legacy_import'&&(w.revision!==0||w.provenance.operationId!==null)||w.provenance.writer==='local_metadata'&&(w.revision<1||w.provenance.operationId===null))errors.push(':worker_provenance');
 if(value.schemaVersion===2){if(!value.operations.length||new Set(value.operations.map(o=>o.id)).size!==value.operations.length||value.operations.some(o=>o.revision>value.revision)||value.operations.at(-1).revision!==value.revision||value.operations.some((o,i)=>o.revision!==value.revision-value.operations.length+1+i))errors.push(':operation_history');}
 return errors;
}
export function assertStorage(kind,value){if(validateStorage(kind,value).length)throw Object.assign(Error('Invalid operational metadata'),{code:'INVALID_OPERATIONAL_METADATA'});return value;}
