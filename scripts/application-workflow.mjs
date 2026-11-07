#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {freshLaunchOptions} from '../apply-scope.mjs';
import {prepareBrowser,validateResumes,validateSavedPlan} from '../lib/applications/browser.mjs';
import {greenhouseTarget,planGreenhouse} from '../lib/applications/greenhouse.mjs';
import {updateLedger,recordJob,transition,assertSubmissionAllowed,reservePreparation,finishPreparation,recoverPreparation} from '../lib/applications/store.mjs';
const root=getCareerOpsRoot(),dir=path.join(root,'data','application-automation');
const [command,...args]=process.argv.slice(2);
const arg=key=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2),{mode:0o600});
async function inspect(url,profile){
 const target=greenhouseTarget(url);
 const res=await fetch(target.api,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw Error(`Form schema GET failed: ${res.status}`);
 const schema=await res.json();schema.board=target.board;
 if(String(schema.id)!==target.id)throw Error('Posting identity mismatch');
 const saved={url,observedAt:new Date().toISOString(),plan:planGreenhouse(schema,profile)};
 fs.mkdirSync(path.join(dir,'plans'),{recursive:true,mode:0o700});
 write(path.join(dir,'plans',`${target.board}-${target.id}.json`),saved);
 return saved;
}
try{
 if(command==='import-discovery'){
  const run=JSON.parse(fs.readFileSync(path.join(root,'data','discovery','latest.json'),'utf8'));
  console.log(JSON.stringify(await updateLedger(root,ledger=>{
   for(const j of run.jobs){const row=recordJob(ledger,j);if(row.status==='Discovered')transition(ledger,row.key,'Evaluated',{matchScore:j.matchScore,runId:run.runId});row.latestEvaluation={runId:run.runId,matchScore:j.matchScore,priority:j.priority,eligibility:j.eligibility,availabilityCheck:j.availabilityCheck};}
   return {imported:run.jobs.length,submitted:0};
  })));
 }else if(command==='inspect-greenhouse'){
  const saved=await inspect(arg('--url'),validateResumes(root,read('profile.json'),read('policy.json')));
  console.log(JSON.stringify({platform:'greenhouse',fields:saved.plan.fields.length,blocked:saved.plan.blocked,readyForApproval:saved.plan.readyForApproval,submitted:false}));
 }else if(command==='prepare-greenhouse'){
  const policy=read('policy.json');
  if(policy.mode!=='approval'||policy.submissionEnabled!==false)throw Error('Preparation requires approval mode with submission disabled');
  const isStopped=()=>cancelled||process.env.CAREER_OPS_STOP_SUBMISSIONS==='1'||fs.existsSync(path.join(dir,'STOP'));
  let cancelled=false;const stop=()=>{cancelled=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const url=arg('--url'),target=greenhouseTarget(url);
  const checked=validateResumes(root,read('profile.json'),policy);
  if(!checked.resumeVersions.length&&!args.includes('--allow-partial'))throw Error('No approved PDF; explicitly request partial preparation to inspect known fields only');
  if(isStopped())throw Error('Kill switch active');
  const saved=await inspect(url,checked),plan=validateSavedPlan(saved,url);
  const reservation=await reservePreparation(root,{url,company:target.board,title:plan.jobTitle||'Greenhouse application'},plan.planHash);
  const artifact=path.join(dir,'attempts',reservation.attemptId);fs.mkdirSync(artifact,{recursive:true,mode:0o700});write(path.join(artifact,'plan.json'),saved);
  let browser;
  try{
   const {chromium}=await import('playwright');browser=await chromium.launch(freshLaunchOptions({headless:true}));
   const uploadAuthorization=policy.fileUploadAuthorization?.approved===true&&!policy.fileUploadAuthorization.usedAt?policy.fileUploadAuthorization:null;
   if(uploadAuthorization){uploadAuthorization.usedAt=new Date().toISOString();uploadAuthorization.attemptId=reservation.attemptId;write(path.join(dir,'policy.json'),policy);}
   const prepared=await prepareBrowser(browser,url,plan,{isStopped,uploadAuthorization});
   await prepared.page.screenshot({path:path.join(artifact,'review.png'),fullPage:true});fs.chmodSync(path.join(artifact,'review.png'),0o600);
   const result={...prepared.result,artifact:path.relative(root,artifact),observedAt:new Date().toISOString(),approvalState:'Not requested: this development run prohibits all real submissions'};
   write(path.join(artifact,'review.json'),result);
   await finishPreparation(root,reservation.key,reservation.attemptId,result);
   console.log(JSON.stringify({status:result.status,jobKey:reservation.key,populated:result.populated,attachments:result.attachments,unresolved:result.unresolved,blockedRequests:result.traffic?.filter(t=>t.blocked),artifact:result.artifact,submitted:false}));
  }catch(e){
   const result={status:'Failed',artifact:path.relative(root,artifact),failure:{message:e.message,kind:cancelled?'cancelled':'browser_or_network_or_structure'},unresolved:[{reason:e.message}],traffic:e.preparationTraffic||[],submitted:false};write(path.join(artifact,'review.json'),result);
   await finishPreparation(root,reservation.key,reservation.attemptId,result);throw e;
  }finally{if(browser)await browser.close();process.off('SIGTERM',stop);process.off('SIGINT',stop);}
 }else if(command==='recover'){
  const result=await recoverPreparation(root,arg('--key'),arg('--reason'));console.log(JSON.stringify({key:result.key,status:result.status,submitted:false}));
 }else if(command==='stop'){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'STOP'),'Submission kill switch enabled\n',{mode:0o600});console.log('Submission kill switch enabled');
 }else if(command==='submit'){
  assertSubmissionAllowed(root,read('policy.json'));
 }else{
  console.log('Usage: application-workflow.mjs import-discovery | inspect-greenhouse --url URL | prepare-greenhouse --url URL [--allow-partial] | recover --key KEY --reason REASON | stop | submit (disabled)');if(command)process.exitCode=1;
 }
}catch(e){console.error(e.message);process.exitCode=1;}
