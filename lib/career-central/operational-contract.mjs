import {instant,validateStorage} from '../../web/src/lib/core/operational-storage-contract.mjs';
export {instant};
import schema from './operational-evidence.schema.json' with {type:'json'};
import {validateSchema} from './schema-validation.mjs';
export {schema as operationalSchema};
export const HEALTH_LIMITS=Object.freeze({syncStaleAfterSeconds:86400,connectionMaxTtlSeconds:86400});
function temporalErrors(value){
 const errors=[];
 const walk=v=>{if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){if(x!==null&&(/At$/.test(k)||['from','through'].includes(k))&&typeof x==='string'&&!instant(x))errors.push(':invalid_time');if(x&&typeof x==='object')walk(x);}};walk(value);return errors;
}
export function validateOperationalInput(kind,value){
 if(value?.schemaVersion===2&&['workers','mailbox'].includes(kind))return validateStorage(kind,value);
 const names={mailbox:'mailboxInput',workers:'workersInput',receiptReview:'receiptReviewInput'};
 if(!names[kind])return [':unsupported_contract'];
 const errors=validateSchema(value,{...schema,$ref:'#/$defs/'+names[kind]});if(errors.length)return errors;
 errors.push(...temporalErrors(value));if(errors.length)return errors;
 if(kind==='mailbox'){
  const c=value.connection,s=value.synchronization;
  if(c&&(Date.parse(c.expiresAt)<=Date.parse(c.observedAt)||Date.parse(c.expiresAt)-Date.parse(c.observedAt)>HEALTH_LIMITS.connectionMaxTtlSeconds*1000))errors.push('/connection:invalid_expiry');
  if(s){const end=Date.parse(s.observedAt),last=Date.parse(s.lastSuccessfulSyncAt);
   if(s.lastSuccessfulSyncAt&&last>end)errors.push('/synchronization:invalid_order');
   if(s.coverage&&(Date.parse(s.coverage.from)>Date.parse(s.coverage.through)||Date.parse(s.coverage.through)>end||s.incomplete===s.coverage.complete||s.coverage.complete&&(!s.lastSuccessfulSyncAt||last<Date.parse(s.coverage.through))))errors.push('/synchronization:invalid_coverage');
  }
 }
 if(kind==='workers')for(const w of value.workers){if(new Set(w.capabilities).size!==w.capabilities.length)errors.push('/workers:invalid_observation');}
 return errors;
}
export function validateOperationalEvidence(value,projection){
 const errors=validateSchema(value,schema);if(errors.length)return errors;
 errors.push(...temporalErrors(value));if(!instant(value.asOf))errors.push('/asOf:invalid_time');if(errors.length)return errors;
 const now=Date.parse(value.asOf);
 const seen=new Set();
 for(const a of value.applicationAttempts){
  if(seen.has(a.attemptId))errors.push('/operationalEvidence:duplicate_attempt');seen.add(a.attemptId);
  if(projection&&!projection.attempts.some(t=>t.id===a.attemptId&&t.applicationId===a.applicationId&&t.kind===a.kind))errors.push('/operationalEvidence:attempt_identity');
  const ids=a.observations.map(o=>o.id);if(new Set(ids).size!==ids.length)errors.push('/operationalEvidence:duplicate_observation');
  if(a.state==='confirmed_receipt'&&(a.reviewStatus!=='confirmed'||!a.observations.some(o=>o.kind==='receipt_confirmed')||!a.observations.some(o=>o.kind==='receipt_observed')||!a.observations.some(o=>o.kind==='authorized')||!a.observations.some(o=>o.kind==='dispatched')||a.issues.length))errors.push('/operationalEvidence:unsupported_confirmation');
 }
 for(const a of value.applicationAttempts){
  if(a.reviewStatus==='confirmed'&&a.state!=='confirmed_receipt')errors.push('/operationalEvidence:review_state');
  if(a.state==='confirmed_receipt'&&(!a.sourceAttemptId||!a.sourceApplicationKey||a.observations.some(o=>o.occurredAt&&Date.parse(o.occurredAt)>now)))errors.push('/operationalEvidence:confirmation_time_or_identity');
 }
 for(const w of value.workers.records){
  if(w.availability==='online'&&(!w.lastHeartbeatAt||!w.observedAt||Date.parse(w.lastHeartbeatAt)>Date.parse(w.observedAt)||Date.parse(w.observedAt)>now||!w.heartbeatExpiresAt||Date.parse(w.heartbeatExpiresAt)<=now||!w.availabilityExpiresAt||Date.parse(w.availabilityExpiresAt)<=now))errors.push('/operationalEvidence:unsupported_online');
  if(w.availability==='offline'&&(!w.observedAt||Date.parse(w.observedAt)>now||!w.availabilityExpiresAt||Date.parse(w.availabilityExpiresAt)<=now))errors.push('/operationalEvidence:unsupported_offline');
 }
 const c=value.mailbox.connection,s=value.mailbox.synchronization;
 if(c.state==='connected'&&(!c.observedAt||!c.expiresAt||Date.parse(c.observedAt)>now||Date.parse(c.expiresAt)<=now))errors.push('/operationalEvidence:unsupported_connection');
 if(s.state==='idle'&&(!s.lastSuccessfulSyncAt||Date.parse(s.lastSuccessfulSyncAt)>now||now-Date.parse(s.lastSuccessfulSyncAt)>=s.staleAfterSeconds*1000))errors.push('/operationalEvidence:unsupported_sync');
 if(projection&&(value.asOf!==projection.asOf||value.applicationAttempts.length!==projection.attempts.length))errors.push('/operationalEvidence:projection_mismatch');
 if(new Set(value.workers.records.map(w=>w.workerId)).size!==value.workers.records.length)errors.push('/operationalEvidence:duplicate_worker');
 return errors;
}
