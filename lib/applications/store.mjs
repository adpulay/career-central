import {ownedPath,readOwnedJson,atomicWriteOwnedJson,fileDigest,checkPath} from '../../web/src/lib/core/operational-files.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireDirLock, releaseOrWarn } from '../dir-lock.mjs';
import { canonicalJobKey } from './discovery.mjs';
export const transitions={
 Discovered:['Evaluated','Skipped','Needs Information'],
 Evaluated:['Shortlisted','Skipped','Needs Information'],
 Shortlisted:['Application Started','Skipped','Needs Information'],
 'Application Started':['Awaiting Approval','Needs Information','Failed','Skipped'],
 'Needs Information':['Evaluated','Application Started','Skipped'],
 'Awaiting Approval':['Submitted','Needs Information','Failed','Skipped'],
 Submitted:['Interviewing','Offer','Rejected'],Interviewing:['Offer','Rejected'],
 Offer:[],Rejected:[],Failed:['Application Started','Needs Information','Skipped'],Skipped:['Evaluated'],
};
export async function updateLedger(root,fn,options={}){
 const file=ownedPath(root,'mailbox',{create:true});
 checkPath(file+'.lock');checkPath(file+'.lock.recover');
 const lock=await acquireDirLock(file+'.lock',{timeoutMs:5000,retryMs:25,maxWaitMs:10000});
 try{
  const before=fileDigest(file),saved=readOwnedJson(file),ledger=saved??{schemaVersion:1,jobs:{},events:[]};
  const original=JSON.stringify(ledger);
  if(ledger.schemaVersion!==1||!ledger.jobs||!Array.isArray(ledger.events))throw Error('Invalid ledger; refusing overwrite');
  const result=await fn(ledger);
  if(saved===undefined||JSON.stringify(ledger)!==original)atomicWriteOwnedJson(file,ledger,{expectedDigest:before,phaseHook:options.phaseHook});
  return result;
 }finally{releaseOrWarn(lock);}
}
export function recordJob(ledger,job){
 const key=canonicalJobKey(job);
 const existing=ledger.jobs[key];
 // Req IDs are conservative submission conflict groups, never merge keys.
 const meaningfulReq=job.requisitionId&&!/^(?:see opening id|unknown|n\/a|tbd|not provided)$/i.test(String(job.requisitionId).trim());
 const group=meaningfulReq?`${String(job.company).toLowerCase()}:${job.requisitionId}`:null;
 if(existing)return existing;
 const value={key,company:job.company,title:job.title,url:job.url,requisitionGroup:group,status:'Discovered',createdAt:new Date().toISOString()};
 ledger.jobs[key]=value;ledger.events.push({id:randomUUID(),jobKey:key,from:null,to:'Discovered',at:value.createdAt});return value;
}
export function transition(ledger,key,to,details={}){
 const job=ledger.jobs[key];if(!job)throw Error('Unknown job');
 if(!transitions[job.status]?.includes(to))throw Error(`Invalid transition ${job.status} -> ${to}`);
 if(to==='Application Started'){
  const duplicate=Object.values(ledger.jobs).find(j=>j.key!==key&&job.requisitionGroup&&j.requisitionGroup===job.requisitionGroup&&['Application Started','Awaiting Approval','Submitted','Interviewing','Offer','Rejected'].includes(j.status));
  if(duplicate)throw Error('Requisition conflict: inspect sibling posting before proceeding');
 }
 if(to==='Submitted'){
  const c=details.confirmation;
  if(!c||c.status!=='confirmed'||!['browser_confirmation','confirmation_email','manual_receipt'].includes(c.source)||!c.reference?.trim()||!c.observedAt||!Number.isFinite(Date.parse(c.observedAt))||!c.url)throw Error('Actual confirmation evidence required');
  if(new URL(c.url).protocol!=='https:')throw Error('Confirmation URL must use HTTPS');
  const approved=details.approval;
  if(!approved?.approvedAt||!approved?.planHash)throw Error('Approval bound to reviewed plan required');
 }
 const from=job.status;job.status=to;job.updatedAt=new Date().toISOString();
 ledger.events.push({id:randomUUID(),jobKey:key,from,to,at:job.updatedAt,...details});return job;
}
export function assertSubmissionAllowed(root,policy){
 if(process.env.CAREER_OPS_STOP_SUBMISSIONS==='1'||fs.existsSync(path.join(root,'data','application-automation','STOP')))throw Error('Submission kill switch active');
 if(!policy||policy.killSwitch!==false||policy.submissionEnabled!==true)throw Error('Submission disabled');
 if(!['approval','autonomous'].includes(policy.mode))throw Error('Discovery mode cannot submit');
 // No submit adapter is shipped. Enabling a JSON flag alone is insufficient.
 throw Error('Autonomous/generic submission transport is not implemented or validated; use the explicit one-application review workflow');
}

export async function reservePreparation(root,job,planHash){
 return updateLedger(root,ledger=>{
  const row=recordJob(ledger,job);
  if(row.liveReview&&row.liveReview.pid!==process.pid&&Date.parse(row.liveReview.expiresAt)>Date.now())throw Error('Another live review owns this job');
  if(row.activeSubmission||row.lastSubmission?.mayHaveBeenAccepted||row.lastSubmission?.verificationRequired)throw Error('Prior submission requires reconciliation; automatic retry blocked');
  if(['Submitted','Interviewing','Offer','Rejected','Awaiting Approval','Application Started'].includes(row.status))throw Error('Application already submitted, prepared, or in progress; inspect existing history before retry');
  if(row.status==='Discovered')transition(ledger,row.key,'Evaluated');
  if(row.status==='Evaluated')transition(ledger,row.key,'Shortlisted');
  if(!['Shortlisted','Needs Information','Failed'].includes(row.status))throw Error('Application state does not permit preparation');
  const attemptId=randomUUID();
  transition(ledger,row.key,'Application Started',{attemptId,planHash});
  row.activeAttempt={id:attemptId,planHash,pid:process.pid,startedAt:new Date().toISOString()};
  return {key:row.key,attemptId};
 });
}
export async function finishPreparation(root,key,attemptId,result){
 return updateLedger(root,ledger=>{
  const row=ledger.jobs[key];
  if(!row||row.status!=='Application Started'||row.activeAttempt?.id!==attemptId)throw Error('Preparation reservation no longer owned by this attempt');
  if(!['Needs Information','Awaiting Approval','Failed'].includes(result.status))throw Error('Preparation cannot record a submission');
  transition(ledger,key,result.status,{attemptId,planHash:row.activeAttempt.planHash,artifact:result.artifact,unresolved:result.unresolved||[],failure:result.failure});
  row.lastPreparation={attemptId,...result,submitted:false,finishedAt:new Date().toISOString()};
  delete row.activeAttempt;return row;
 });
}
export async function recoverPreparation(root,key,reason){
 return updateLedger(root,ledger=>{
  const row=ledger.jobs[key];if(row?.status!=='Application Started'||!row.activeAttempt)throw Error('No interrupted preparation to recover');
  let alive=true;try{process.kill(row.activeAttempt.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
  if(alive)throw Error('Preparation owner is still alive; stop that worker before recovery');
  if(!reason?.trim())throw Error('Recovery reason required');
  transition(ledger,key,'Needs Information',{attemptId:row.activeAttempt.id,recoveryReason:reason,note:'Interrupted preparation; no submission inferred'});
  delete row.activeAttempt;return row;
 });
}
