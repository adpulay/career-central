#!/usr/bin/env node
// Reassess the saved shortlist without discovering or adding any job identities.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {checkLivenessViaApi} from '../liveness-api.mjs';
import {evaluateJob,renderReport,canonicalJobKey} from '../lib/applications/discovery.mjs';
import {updateLedger} from '../lib/applications/store.mjs';
const root=getCareerOpsRoot(),dir=path.join(root,'data','discovery'),applicationDir=path.join(root,'data','application-automation');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const original=path.join(dir,'baseline-50.json');if(!fs.existsSync(original))fs.copyFileSync(path.join(dir,'latest.json'),original);
const run=read(original),profile=read(path.join(applicationDir,'profile.json')),policy=read(path.join(applicationDir,'policy.json'));
const reviewFile=path.join(applicationDir,'evaluation-reviews.json'),reviews=fs.existsSync(reviewFile)?read(reviewFile):{};
const boardCache=new Map(),jobs=[];const runId=new Date().toISOString().replace(/[:.]/g,'-');
for(const job of run.jobs){
 const key=canonicalJobKey(job),automatic=evaluateJob(job,policy,Date.now(),profile),review=reviews[key];
 const current={...job,...automatic,key};
 if(review){
  const digest=createHash('sha256').update(job.description||'').digest('hex');if(digest!==review.descriptionSha256)throw Error('Description changed; manual assessment must be reviewed again');
  current.matchScore=review.score;current.eligibility=review.eligibility;current.reasons.push(review.rationale);current.concerns.push(...review.concerns);current.review={method:'Description-by-description comparative assessment, anchored to saved resume',...review};
 }
 if(!process.argv.includes('--offline'))current.availabilityCheck={checkedAt:new Date().toISOString(),...(await checkLivenessViaApi(job.url,{boardCache})||{result:'uncertain',reason:'API check inconclusive'})};
 if(current.availabilityCheck?.result==='expired'){current.eligibility='excluded';current.exclusions.push('Posting expired at reevaluation');}
 current.priority=current.eligibility==='excluded'?'Low':current.matchScore>=80?'High':current.matchScore>=65?'Medium':'Low';
 current.graduationAndStart={graduationMonth:profile.education?.[0]?.graduation_month?.value,earliestStart:profile.standardAnswers?.full_time_start,requirementsReview:review?.graduationReview||'Exact post-graduation start needs employer confirmation'};
 jobs.push(current);
}
jobs.sort((a,b)=>(a.eligibility==='excluded')-(b.eligibility==='excluded')||b.matchScore-a.matchScore||a.key.localeCompare(b.key));
const result={...run,runId,generatedAt:new Date().toISOString(),jobs,reevaluated:jobs.length,top10:jobs.filter(j=>j.eligibility!=='excluded').slice(0,10).map(j=>j.key),profileRevision:profile.updatedAt,scoreMethod:'Comparative manual description review plus reusable heuristic signals; not interview probabilities'};
await updateLedger(root,ledger=>{
 const before=Object.keys(ledger.jobs).length;
 for(const job of jobs){const row=ledger.jobs[job.key];if(!row)throw Error('Existing shortlist identity missing from ledger; refusing duplicate creation');row.latestEvaluation={runId,matchScore:job.matchScore,priority:job.priority,eligibility:job.eligibility,availabilityCheck:job.availabilityCheck,review:job.review,graduationAndStart:job.graduationAndStart};ledger.events.push({id:randomUUID(),jobKey:job.key,type:'Reevaluated',at:result.generatedAt,runId,matchScore:job.matchScore,eligibility:job.eligibility});}
 if(Object.keys(ledger.jobs).length!==before)throw Error('Unexpected job record count change');
});
for(const name of ['latest.json',`${runId}-reevaluated.json`])fs.writeFileSync(path.join(dir,name),JSON.stringify(result,null,2),{mode:0o600});
fs.writeFileSync(path.join(dir,'latest.md'),renderReport(result),{mode:0o600});
fs.writeFileSync(path.join(dir,'top-10.md'),renderReport({...result,jobs:jobs.filter(j=>result.top10.includes(j.key)),returned:10,requested:10}),{mode:0o600});
console.log(JSON.stringify({reevaluated:jobs.length,excluded:jobs.filter(j=>j.eligibility==='excluded').length,active:jobs.filter(j=>j.availabilityCheck?.result==='active').length,top10:jobs.filter(j=>result.top10.includes(j.key)).map(j=>({company:j.company,title:j.title,score:j.matchScore}))}));
