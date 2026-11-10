// Explicit metadata publication only. Never called by projection/page reads.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getCareerOpsRoot} from '../../path-resolver.mjs';
import {updateLedger} from '../applications/store.mjs';
import {withResourceLock,readScheduledStore,writeScheduledStoreAtomic} from '../../web/src/lib/scheduled-jobs-store.mjs';
import {ownedPath,checkPath,fileDigest,ioError} from '../../web/src/lib/core/operational-files.mjs';
import {assertStorage,instant,expires,canonical} from '../../web/src/lib/core/operational-storage-contract.mjs';
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex');
const fail=code=>{throw ioError(code);};
const time=options=>{const at=instant(options.now??new Date().toISOString());if(!at)fail('INVALID_RECEIVER_TIME');return at;};
function replay(current,request){
 const operation=current?.operations?.find(o=>o.id===request.operationId);
 if(operation){if(operation.digest!==hash(request))fail('IDEMPOTENCY_CONFLICT');return {revision:operation.revision,currentRevision:current.revision,replayed:true};}
 if((current?.revision??0)!==request.expectedRevision)fail('STALE_STATE_REVISION');return null;
}
function operations(current,request,revision){return [...(current?.operations??[]),{id:request.operationId,digest:hash(request),revision}].slice(-128);}
function receiverOrder(current,at){if(current?.updatedAt&&Date.parse(at)<Date.parse(current.updatedAt))fail('RECEIVER_CLOCK_REGRESSION');}
function provenance(request,at){return {writer:'local_metadata',operationId:request.operationId,receivedAt:at};}
function safeLocks(file){checkPath(file+'.lock');checkPath(file+'.lock.recover');}
export async function recordWorkerHeartbeat(root=getCareerOpsRoot(),request,options={}){
 assertStorage('workerCommand',request);const at=time(options);assertStorage('workerInput',{...request.worker,observedAt:at});const file=ownedPath(root,'worker',{create:true});safeLocks(file);
 return withResourceLock(file,()=>{
  const before=fileDigest(file),store=readScheduledStore(file),current=store.workerHealth,old=replay(current,request);if(old)return old;receiverOrder(current,at);
  const previous=current?.workers?.find(w=>w.workerId===request.worker.workerId),w={...request.worker,capabilities:[...request.worker.capabilities].sort(),observedAt:at};
  if(previous){
   if(previous.sessionId===w.sessionId){if(request.previousSessionId!==null||w.sequence<=previous.sequence)fail('STALE_WORKER_SEQUENCE');if(w.lastHeartbeatAt&&previous.lastHeartbeatAt&&Date.parse(w.lastHeartbeatAt)<Date.parse(previous.lastHeartbeatAt))fail('HEARTBEAT_CLOCK_REGRESSION');if(w.lastHeartbeatAt===null)w.lastHeartbeatAt=previous.lastHeartbeatAt;}
   else if(request.previousSessionId!==previous.sessionId)fail('WORKER_SESSION_CONFLICT');
  }else if(request.previousSessionId!==null)fail('WORKER_SESSION_CONFLICT');
  const revision=(current?.revision??0)+1,records=(current?.workers??[]).filter(r=>r.workerId!==w.workerId).map(r=>current.schemaVersion===2?r:{...r,revision:0,heartbeatExpiresAt:expires(r.lastHeartbeatAt,r.heartbeatTtlSeconds),provenance:{writer:'legacy_import',operationId:null,receivedAt:r.observedAt}});
  records.push({...w,revision,heartbeatExpiresAt:expires(w.lastHeartbeatAt,w.heartbeatTtlSeconds),provenance:provenance(request,at)});
  const next={schemaVersion:2,revision,updatedAt:at,operations:operations(current,request,revision),workers:records.sort((a,b)=>a.workerId<b.workerId?-1:a.workerId>b.workerId?1:0)};assertStorage('workers',next);store.workerHealth=next;
  writeScheduledStoreAtomic(file,store,{expectedDigest:before,phaseHook:options.phaseHook});return {revision,currentRevision:revision,replayed:false};
 });
}
// Closed provider slots share the existing ledger lock, never account bindings.
export function mailboxHealthField(provider='outlook') {
 if(provider==='outlook')return 'mailboxHealth';
 if(provider==='gmail')return 'gmailMailboxHealth';
 fail('UNSUPPORTED_MAILBOX_PROVIDER');
}
export async function recordMailboxHealth(root=getCareerOpsRoot(),request,options={}){
 const field=mailboxHealthField(options.provider??'outlook');
 assertStorage('mailboxCommand',request);assertStorage('mailboxRequest',request.health);const at=time(options);ownedPath(root,'mailbox',{create:true});
 return updateLedger(root,ledger=>{
  const current=ledger[field];if(current&&current.schemaVersion!==2)fail('LEGACY_MAILBOX_REVIEW_REQUIRED');if(current)assertStorage('mailbox',current);
  const old=replay(current,request);if(old)return old;receiverOrder(current,at);
  const h=structuredClone(request.health);h.folderScope.sort();if(h.checkpoint)h.checkpoint.folderScope.sort();
  if(current&&(h.accountId!==current.accountId||canonical(h.folderScope)!==canonical([...current.folderScope].sort())))fail('MAILBOX_CONTEXT_CONFLICT');
  const complete=h.synchronization?.state==='idle'&&h.synchronization.incomplete===false&&h.synchronization.coverage?.complete===true;
  if(!complete&&canonical(h.checkpoint)!==canonical(current?.checkpoint??null))fail('INCOMPLETE_CHECKPOINT_ADVANCE');
  if(!complete&&h.retry.attempt<(current?.retry.attempt??0))fail('RETRY_REGRESSION');
  if(!complete&&h.retry.attempt>(current?.retry.attempt??0)+1)fail('RETRY_SEQUENCE_CONFLICT');
  if(complete&&(h.retry.attempt!==0||h.retry.nextAttemptAt!==null))fail('SUCCESS_RETRY_CONFLICT');
  if(h.checkpoint){
   if(Date.parse(h.checkpoint.completedAt)>Date.parse(at))fail('CHECKPOINT_CLOCK_SKEW');
   if(current?.checkpoint){if(h.checkpoint.completedAt===current.checkpoint.completedAt&&canonical(h.checkpoint)!==canonical(current.checkpoint))fail('CHECKPOINT_ID_CONFLICT');if(Date.parse(h.checkpoint.completedAt)<Date.parse(current.checkpoint.completedAt))fail('CHECKPOINT_REGRESSION');if(h.checkpoint.id===current.checkpoint.id&&canonical(h.checkpoint)!==canonical(current.checkpoint))fail('CHECKPOINT_ID_CONFLICT');}
  }else if(current?.checkpoint)fail('CHECKPOINT_REGRESSION');
  const revision=(current?.revision??0)+1,next={schemaVersion:2,revision,updatedAt:at,operations:operations(current,request,revision),provenance:provenance(request,at),...h};assertStorage('mailbox',next);ledger[field]=next;return {revision,currentRevision:revision,replayed:false};
 },{phaseHook:options.phaseHook});
}
// Recovery only discards dead writers' uncommitted temp files under the owner lock.
// It never promotes a temp snapshot or repeats a mailbox/application action.
export async function recoverOperationalTemps(root=getCareerOpsRoot(),kind){
 const file=ownedPath(root,kind);if(!fs.existsSync(path.dirname(file)))return {removed:0,retained:0};safeLocks(file);
 return withResourceLock(file,()=>{
  let removed=0,retained=0;const prefix=path.basename(file)+'.tmp-';
  for(const name of fs.readdirSync(path.dirname(file))){if(!name.startsWith(prefix))continue;const match=name.slice(prefix.length).match(/^(\d+)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);if(!match){retained++;continue;}
   const temp=path.join(path.dirname(file),name);try{checkPath(temp);const s=fs.lstatSync(temp);if(!s.isFile()||s.nlink!==1){retained++;continue;}let dead=false;try{process.kill(Number(match[1]),0);}catch(e){dead=e.code==='ESRCH';}if(!dead){retained++;continue;}fs.unlinkSync(temp);removed++;}catch{retained++;}
  }
  return {removed,retained};
 });
}
