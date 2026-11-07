// Pure metadata projection. No transports, artifact readers, credentials or writers.
import {instant,validateOperationalInput,HEALTH_LIMITS} from './operational-contract.mjs';
const opaque=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(s)?s:null;
const digest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)?s:null;
const ref=(s,locator)=>({sourceId:s.id,locator,revision:s.revision||null});
const order=xs=>xs.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
const uniq=xs=>[...new Set(xs)].sort();
const clock=(at,now)=>at!==null&&Date.parse(at)>now;
const after=(at,seconds)=>at===null?null:new Date(Date.parse(at)+seconds*1000).toISOString();

function mailboxHealth({ledger,outlook,now,warn,conflict}){
 const value=ledger?.data.mailboxHealth,source=ledger?ref(ledger,'/mailboxHealth'):null;
 const connection={state:outlook?.state==='available'?'configured':'unknown',observedAt:null,expiresAt:null,errorCategory:null,liveValidated:false,issues:[],source:outlook?.state==='available'?ref(outlook,''):null};
 const synchronization={state:'unknown',observedAt:null,lastSuccessfulSyncAt:null,coverage:null,incomplete:null,errorCategory:null,staleAfterSeconds:HEALTH_LIMITS.syncStaleAfterSeconds,issues:[],source:null};
 const result={connection,synchronization,quality:'unavailable',persistence:null};
 if(value===undefined)return result;
 if(validateOperationalInput('mailbox',value).length){warn('MAILBOX_HEALTH_INVALID','ledger','/mailboxHealth');connection.issues=['invalid_health_contract'];synchronization.issues=['invalid_health_contract'];return result;}
 if(value.schemaVersion===2)result.persistence=Object.fromEntries(['schemaVersion','revision','accountId','updatedAt','folderScope','checkpoint','retry','provenance'].map(k=>[k,structuredClone(value[k])]));
 const c=value.connection,s=value.synchronization;
 if(c){Object.assign(connection,{state:c.state,observedAt:instant(c.observedAt),expiresAt:instant(c.expiresAt),errorCategory:c.errorCategory,source:{...source,locator:source.locator+'/connection'}});
  if(clock(connection.observedAt,now)){connection.state='unknown';connection.errorCategory='clock_skew';connection.issues.push('clock_skew');}
  else if(now>=Date.parse(connection.expiresAt)){connection.state='stale';connection.issues.push('connection_observation_expired');}
  if(c.state==='connected'&&outlook?.state==='missing'){connection.state='unknown';connection.issues.push('configuration_conflict');conflict('MAILBOX_CONFIGURATION_CONFLICT','mailbox',[connection.source,ref(outlook,'')]);}
 }
 if(s){Object.assign(synchronization,{state:s.state,observedAt:instant(s.observedAt),lastSuccessfulSyncAt:instant(s.lastSuccessfulSyncAt),coverage:s.coverage?{from:instant(s.coverage.from),through:instant(s.coverage.through),complete:s.coverage.complete}:null,incomplete:s.incomplete,errorCategory:s.errorCategory,source:{...source,locator:source.locator+'/synchronization'}});
  if(clock(synchronization.observedAt,now)||clock(synchronization.lastSuccessfulSyncAt,now)){synchronization.state='unknown';synchronization.errorCategory='clock_skew';synchronization.issues.push('clock_skew');}
  else if(now-Date.parse(synchronization.observedAt)>=HEALTH_LIMITS.syncStaleAfterSeconds*1000){synchronization.state='stale';synchronization.issues.push('sync_observation_expired');}
  else if(s.state==='failed'){synchronization.state='failed';}
  else if(s.state==='syncing'){synchronization.state='syncing';}
  else if(!synchronization.lastSuccessfulSyncAt){synchronization.state='unknown';synchronization.issues.push('no_successful_checkpoint');}
  else if(now-Date.parse(synchronization.lastSuccessfulSyncAt)>=HEALTH_LIMITS.syncStaleAfterSeconds*1000){synchronization.state='stale';synchronization.issues.push('successful_checkpoint_expired');}
  if(s.incomplete!==false||!s.coverage||!s.coverage.complete)synchronization.issues.push('coverage_incomplete_or_unknown');
 }
 result.quality=connection.issues.includes('configuration_conflict')?'conflicting':connection.state==='stale'||synchronization.state==='stale'?'stale':synchronization.incomplete===true||synchronization.state==='failed'?'incomplete':!synchronization.lastSuccessfulSyncAt||connection.state==='unknown'||connection.issues.length||synchronization.issues.length?'unknown':'fresh';
 return result;
}

function workerHealth({schedule,now,warn,conflict}){
 const value=schedule?.data.workerHealth,source=schedule?ref(schedule,'/workerHealth'):null;
 if(value===undefined)return {coverage:'unknown',records:[],source:null,quality:'unavailable',persistence:null};
 if(validateOperationalInput('workers',value).length){warn('WORKER_HEALTH_INVALID','schedule','/workerHealth');return {coverage:'unknown',records:[],source,quality:'unavailable',persistence:null};}
 const groups=new Map();for(const [i,w]of value.workers.entries()){if(!groups.has(w.workerId))groups.set(w.workerId,[]);groups.get(w.workerId).push({w,source:ref(schedule,`/workerHealth/workers/${i}`)});}
 const records=[];
 for(const [workerId,items]of groups){
  if(items.length>1){const sources=items.map(x=>x.source);conflict('WORKER_IDENTITY_CONFLICT','worker:'+workerId,sources);records.push({workerId,sessionId:null,sequence:null,kind:'unknown',capabilities:[],lastHeartbeatAt:null,heartbeatExpiresAt:null,observedAt:null,availabilityExpiresAt:null,availability:'unknown',issues:['conflicting_worker_observations'],sources:order(sources)});continue;}
  const {w,source:r}=items[0],lastHeartbeatAt=instant(w.lastHeartbeatAt),observedAt=instant(w.observedAt),heartbeatExpiresAt=after(lastHeartbeatAt,w.heartbeatTtlSeconds),availabilityExpiresAt=after(observedAt,w.heartbeatTtlSeconds),issues=[];
  let availability=w.availability;
  if(clock(observedAt,now)||clock(lastHeartbeatAt,now)||lastHeartbeatAt&&Date.parse(lastHeartbeatAt)>Date.parse(observedAt)){availability='unknown';issues.push('clock_skew');}
  else if(w.availability==='online'&&!lastHeartbeatAt){availability='unknown';issues.push('heartbeat_missing');}
  else if(now>=Date.parse(availabilityExpiresAt)||w.availability==='online'&&now>=Date.parse(heartbeatExpiresAt)){availability='stale';issues.push('heartbeat_or_observation_expired');}
  records.push({stateRevision:value.schemaVersion===2?w.revision:null,workerId,sessionId:w.sessionId,sequence:w.sequence,kind:w.kind,capabilities:[...w.capabilities].sort(),lastHeartbeatAt,heartbeatExpiresAt,observedAt,availabilityExpiresAt,availability,issues,sources:[r]});
 }
 const quality=records.some(r=>r.issues.includes('conflicting_worker_observations'))?'conflicting':records.some(r=>r.availability==='stale')?'stale':records.some(r=>r.availability==='unknown')?'unknown':'fresh';
 return {coverage:'reported_only',records:order(records),source,quality,persistence:value.schemaVersion===2?{schemaVersion:2,revision:value.revision,updatedAt:value.updatedAt}:null};
}

function attemptLifecycle({attempt,binding,ledger,now,idFor,conflict,pendingReviews,applications,conflictingReviewIds}){
 const observations=[],issues=[],receipts=[],approvals=[],responses=[],acceptedResponses=[],dispatches=[],reviews=[];
 const sourceApplicationKey=opaque(binding?.entry?.sourceKey??binding?.applicationKey),sourceAttemptId=binding?.identityKnown===false?null:opaque(binding?.rawAttemptId);
 const add=(kind,at,source,reviewStatus='unreviewed',eventId=null)=>{
  const occurredAt=instant(at),sourceEventId=opaque(eventId),id=idFor('observation',JSON.stringify([attempt.id,source.sourceId,sourceEventId?['event',sourceEventId]:['locator',source.locator],kind]));
  if(!observations.some(o=>o.id===id))observations.push({id,sourceEventId,kind,occurredAt,reviewStatus,source});
  if(at&&!occurredAt)issues.push('invalid_timestamp');if(!occurredAt&&kind!=='prepared'&&kind!=='acceptance_uncertain')issues.push('missing_timestamp');if(clock(occurredAt,now))issues.push('clock_skew');
 };
 if(!sourceAttemptId||!sourceApplicationKey)issues.push('source_identity_unavailable');
 const entry=binding?.entry;
 if(entry){
  for(const field of ['lastPreparation','activeAttempt','lastSubmission','activeSubmission']){
   const a=entry.raw[field];if(!a||typeof a!=='object')continue;
   const kind=field.includes('Submission')?'submission':'preparation';
   if(kind!==attempt.kind||(a.id||a.attemptId||field)!==binding.rawAttemptId)continue;
   const r=ref(ledger,entry.sourceRef.locator+'/'+field);
   if(kind==='preparation')add('prepared',a.startedAt||a.finishedAt,r);
   if(a.approvedAt){add('authorized',a.approvedAt,r);approvals.push({hash:digest(a.reviewHash),at:instant(a.approvedAt)});}
   if(a.attempted||a.dispatchedAt){add('dispatched',a.dispatchedAt,r);dispatches.push(instant(a.dispatchedAt));}
   if(Number.isInteger(a.nativeResponse?.status)){responses.push(a.nativeResponse.status);if(a.nativeResponse.status>=200&&a.nativeResponse.status<300)acceptedResponses.push(instant(a.nativeResponse.at||a.finishedAt));add('native_response',a.nativeResponse.at||a.finishedAt,r);}
   if(a.nativeResponse?.status===428||a.verificationRequired)add('verification_required',a.nativeResponse?.at||a.finishedAt,r,'needs_review');
   if(a.mayHaveBeenAccepted||field==='activeSubmission'&&a.attempted)add('acceptance_uncertain',a.finishedAt||a.dispatchedAt,r,'needs_review');
   if(a.confirmation){const c=a.confirmation;add('receipt_observed',c.observedAt,r,'unreviewed');
    const at=instant(c.observedAt),http=a.nativeResponse?.status;
    const qualifies=c.status==='confirmed'&&c.source==='browser_confirmation'&&c.nativeRequestAccepted===true&&c.confirmationPageVerified===true&&a.attempted===true&&http>=200&&http<300&&digest(c.textHash)&&typeof c.reference==='string'&&c.reference.trim()&&at;
    receipts.push({hash:digest(c.textHash),at,reviewHash:digest(a.reviewHash),qualifies:!!qualifies,source:r});
   }
  }
  for(const [i,e]of (ledger.data.events||[]).entries()){
   if(e?.jobKey!==binding.applicationKey||(attempt.kind==='submission'?e.submissionAttemptId:e.attemptId)!==binding.rawAttemptId)continue;
   const r=ref(ledger,`/events/${i}`);
   if(e.type==='ReceiptReconciled'){
    if(validateOperationalInput('receiptReview',e).length){issues.push('invalid_receipt_review');continue;}
    if(conflictingReviewIds.has(e.id))issues.push('receipt_review_identity_conflict');
    reviews.push({...e,receiptObservedAt:instant(e.receiptObservedAt),at:instant(e.at),source:r});add(e.decision==='confirmed'?'receipt_confirmed':e.decision==='rejected'?'receipt_rejected':'receipt_review_required',e.at,r,e.decision==='confirmed'?'confirmed':e.decision==='rejected'?'rejected':'needs_review',e.id);continue;
   }
   if(e.type==='UserApprovedOneSubmission'){add('authorized',e.at,r,'unreviewed',e.id);approvals.push({hash:digest(e.reviewHash),at:instant(e.at)});}
   else if(e.type==='SubmissionDispatched'){add('dispatched',e.at,r,'unreviewed',e.id);dispatches.push(instant(e.at));}
   else if(e.type==='NativeSubmissionResponse'){if(Number.isInteger(e.status))responses.push(e.status);if(e.status>=200&&e.status<300)acceptedResponses.push(instant(e.at));add(e.status===428?'verification_required':'native_response',e.at,r,e.status===428?'needs_review':'unreviewed',e.id);}
   else if(e.type==='VerificationContinuationRequired')add('verification_required',e.at,r,'needs_review',e.id);
   else if(e.to==='Submitted'&&e.confirmation){
    const c=e.confirmation,at=instant(c.observedAt);add('receipt_observed',c.observedAt,r,'unreviewed',e.id);
    if(e.approval?.approvedAt){add('authorized',e.approval.approvedAt,r);approvals.push({hash:digest(e.approval.reviewHash),at:instant(e.approval.approvedAt)});}
    receipts.push({hash:digest(c.textHash),at,reviewHash:digest(e.approval?.reviewHash),qualifies:!!(c.status==='confirmed'&&c.source==='browser_confirmation'&&c.nativeRequestAccepted===true&&c.confirmationPageVerified===true&&digest(c.textHash)&&typeof c.reference==='string'&&c.reference.trim()&&at),source:r});
   }
   else if(e.attemptId&&e.to==='Application Started')add('prepared',e.at,r,'unreviewed',e.id);
  }
 }
 if(!observations.length){issues.push('incomplete_attempt_evidence');add(attempt.kind==='preparation'?'prepared':'acceptance_uncertain',null,attempt.source,'needs_review');}
 if(receipts.some(r=>!r.qualifies))issues.push('incomplete_receipt_evidence');
 const receiptSources=receipts.map(r=>r.source).concat(reviews.map(r=>r.source));
 const contradicts=reviews.some(r=>r.decision==='rejected')&&receipts.some(r=>r.qualifies)||new Set(receipts.map(r=>JSON.stringify([r.hash,r.at]))).size>1||new Set(reviews.map(r=>JSON.stringify([r.receiptTextHash,r.receiptObservedAt,r.reviewHash,r.decision]))).size>1;
 if(contradicts){issues.push('receipt_evidence_conflict');conflict('RECEIPT_EVIDENCE_CONFLICT',attempt.id,receiptSources);}
 const verification=observations.some(o=>o.kind==='verification_required'),dispatched=observations.some(o=>o.kind==='dispatched');
 if(responses.length&&!dispatched)issues.push('dispatch_evidence_missing');
 if(verification&&receipts.length){issues.push('receipt_verification_conflict');conflict('RECEIPT_VERIFICATION_CONFLICT',attempt.id,observations.map(o=>o.source));}
 if(new Set(responses).size>1){issues.push('native_response_conflict');conflict('ATTEMPT_RESPONSE_CONFLICT',attempt.id,observations.filter(o=>['native_response','verification_required'].includes(o.kind)).map(o=>o.source));}
 if(new Set(approvals.map(a=>a.hash).filter(Boolean)).size>1){issues.push('authorization_conflict');conflict('ATTEMPT_AUTHORIZATION_CONFLICT',attempt.id,observations.filter(o=>o.kind==='authorized').map(o=>o.source));}
 for(const review of reviews){const matched=receipts.some(r=>r.qualifies&&r.hash===review.receiptTextHash&&r.at===instant(review.receiptObservedAt)&&r.reviewHash===review.reviewHash);
  if(!matched){issues.push('receipt_review_unbound');conflict('RECEIPT_REVIEW_UNBOUND',attempt.id,receiptSources);}
 }
 const confirmations=reviews.filter(r=>r.decision==='confirmed');
 const eligibleConfirmation=confirmations.some(review=>receipts.some(r=>r.qualifies&&r.hash===review.receiptTextHash&&r.at===instant(review.receiptObservedAt)&&r.reviewHash===review.reviewHash&&Date.parse(review.at)>=Date.parse(r.at)&&dispatches.some(d=>d&&Date.parse(d)<=Date.parse(r.at)&&acceptedResponses.some(t=>t&&Date.parse(t)>=Date.parse(d)&&Date.parse(t)<=Date.parse(r.at))&&approvals.some(a=>a.hash===r.reviewHash&&a.at&&Date.parse(a.at)<=Date.parse(d)))));
 if(confirmations.length&&(!eligibleConfirmation||observations.some(o=>o.kind==='acceptance_uncertain')))issues.push('confirmation_chain_incomplete');
 const confirmed=eligibleConfirmation&&!verification&&!issues.length;
 let state=attempt.kind==='preparation'?'prepared':'unknown',reviewStatus='unreviewed';
 if(observations.some(o=>o.kind==='authorized'))state='authorized';
 if(dispatched)state='dispatched';
 if(dispatched&&(responses.some(s=>s>=200&&s<300)||observations.some(o=>o.kind==='acceptance_uncertain')||receipts.length))state='acceptance_uncertain';
 if(verification)state='verification_required';
 if(confirmed){state='confirmed_receipt';reviewStatus='confirmed';}
 else if(issues.length||state==='acceptance_uncertain'||state==='verification_required'||receipts.length||reviews.length){reviewStatus=reviews.length&&reviews.every(r=>r.decision==='rejected')?'rejected':'needs_review';if(issues.length)state=verification&&!receipts.length&&!issues.some(i=>/conflict|unbound/.test(i))?'verification_required':dispatched||receipts.length?'acceptance_uncertain':'unknown';}
 if(reviewStatus==='needs_review'||reviewStatus==='rejected'){
  const sources=order(observations.map(o=>o.source)),r=sources[0]||attempt.source;
  pendingReviews.push({id:idFor('review','operational:'+attempt.id),applicationId:attempt.applicationId,reason:state==='verification_required'?'verification_required':'evidence_reconciliation_required',source:r});
  if(issues.some(i=>/conflict|unbound/.test(i))){const app=applications.find(a=>a.id===attempt.applicationId);if(app)app.submissionState='uncertain';}
 }
 return {applicationId:attempt.applicationId,attemptId:attempt.id,sourceApplicationKey,sourceAttemptId,kind:attempt.kind,state,reviewStatus,independentlyVerified:false,observations:order(observations),issues:uniq(issues),sources:order([...new Map(observations.map(o=>[JSON.stringify(o.source),o.source])).values()])};
}

export function projectOperationalEvidence({sources,asOf,attempts,bindings,applications,pendingReviews,idFor,warn,conflict}){
 const byId=new Map(sources.map(s=>[s.id,s])),available=id=>byId.get(id)?.state==='available'?byId.get(id):null,now=Date.parse(asOf),ledger=available('ledger');
 const conflictingReviewIds=new Set(),reviewIdentities=new Map();
 for(const [i,e]of (ledger?.data.events||[]).entries())if(e?.type==='ReceiptReconciled'){
  const r=ref(ledger,`/events/${i}`);
  if(validateOperationalInput('receiptReview',e).length){warn('RECEIPT_REVIEW_INVALID','ledger',r.locator);continue;}
  if(![...bindings.values()].some(b=>b.applicationKey===e.jobKey&&b.rawAttemptId===e.submissionAttemptId))warn('RECEIPT_REVIEW_UNRESOLVED','ledger',r.locator);
  const signature=JSON.stringify([e.jobKey,e.submissionAttemptId,e.reviewHash,e.receiptTextHash,instant(e.receiptObservedAt),instant(e.at),e.decision,e.reviewer]);
  if(!reviewIdentities.has(e.id))reviewIdentities.set(e.id,[]);reviewIdentities.get(e.id).push({signature,source:r});
 }
 for(const [id,items]of reviewIdentities)if(new Set(items.map(i=>i.signature)).size>1){conflictingReviewIds.add(id);conflict('RECEIPT_REVIEW_IDENTITY_CONFLICT',idFor('review-identity',id),items.map(i=>i.source));}
 return {schemaVersion:1,asOf,applicationAttempts:order(attempts.map(attempt=>attemptLifecycle({attempt,binding:bindings.get(attempt.id),ledger,now,idFor,conflict,pendingReviews,applications,conflictingReviewIds}))),mailbox:mailboxHealth({ledger,outlook:byId.get('outlook'),now,warn,conflict}),workers:workerHealth({schedule:available('schedule'),now,warn,conflict})};
}
