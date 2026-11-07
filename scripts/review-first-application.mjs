#!/usr/bin/env node
// Interactive one-application review. It cannot submit without a separate approve-one message.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {loadYaml} from '../lib/yaml-document.mjs';
import {freshLaunchOptions} from '../apply-scope.mjs';
import {prepareBrowser,validateResumes} from '../lib/applications/browser.mjs';
import {greenhouseTarget,planGreenhouse,validateForm} from '../lib/applications/greenhouse.mjs';
import {updateLedger,transition,reservePreparation,finishPreparation} from '../lib/applications/store.mjs';
import {digest,approvalHash,NativeSubmissionController,finishReviewedSubmission} from '../lib/applications/reviewed-submission.mjs';
import {mirrorConfirmedSubmission} from '../lib/applications/confirmed-tracker.mjs';
import {checkLivenessViaApi} from '../liveness-api.mjs';
const root=getCareerOpsRoot(),dir=path.join(root,'data/application-automation'),args=process.argv.slice(2),key=args[args.indexOf('--job-key')+1];
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')),write=(f,x)=>fs.writeFileSync(f,JSON.stringify(x,null,2),{mode:0o600});
const job=JSON.parse(fs.readFileSync(path.join(root,'data/discovery/latest.json'))).jobs.find(j=>j.key===key);if(!job)throw Error('Select an existing reviewed job key');
const route=read('first-submission/eight-current-schemas.json').find(x=>x.jobKey===key);if(!route?.board||!route?.id)throw Error('Verified Greenhouse identity unavailable');
const applicationUrl=`https://job-boards.greenhouse.io/${route.board}/jobs/${route.id}`,target=greenhouseTarget(applicationUrl);
const policy=read('policy.json'),profile=validateResumes(root,read('profile.json'),policy);if(policy.mode!=='approval'||policy.submissionEnabled!==false||policy.killSwitch!==true||policy.autonomousAuthorization)throw Error('Start from approval mode, disabled submissions and active kill switch');
if(profile.standardAnswers.full_time_start.verified!==true||profile.standardAnswers.full_time_start.provisional)throw Error('Confirmed availability required');
if(profile.applicationHistory?.[key]?.verified!==true||profile.applicationHistory[key].neverApplied!==true)throw Error('External application history must be confirmed');
const schemaResponse=await fetch(target.api,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!schemaResponse.ok)throw Error('Job is not confirmed active');const schema=await schemaResponse.json();schema.board=target.board;
const plan=planGreenhouse(schema,profile);if(!plan.readyForApproval)throw Error('Unanswered required questions: '+plan.blocked.map(q=>q.question).join('; '));
const html=await(await fetch(applicationUrl,{redirect:'error',signal:AbortSignal.timeout(20000)})).text();
const property=name=>html.match(new RegExp('"'+name+'"\\s*:\\s*"([^"<>]+)"'))?.[1];
const submitUrl=property('submitPath'),confirmationUrl=new URL(property('confirmationPath')||'',applicationUrl).href;
const submissionTarget=greenhouseTarget(submitUrl);if(submissionTarget.board!==target.board||submissionTarget.id!==target.id||confirmationUrl!==applicationUrl+'/confirmation')throw Error('Unsupported native submission/confirmation paths');
const configuration=loadYaml(fs.readFileSync(path.join(root,'config/profile.yml'),'utf8')),timezone=configuration.location.timezone;
const resume=profile.resumeVersions[0],sessionId=randomUUID(),expiresAt=new Date(Date.now()+45*60*1000).toISOString();
await updateLedger(root,l=>{
 const row=l.jobs[key];if(!row)throw Error('Job record missing');if(row.activeSubmission||row.lastSubmission?.mayHaveBeenAccepted)throw Error('Reconcile prior submission before proceeding');
 if(row.liveReview&&Date.parse(row.liveReview.expiresAt)>Date.now()){let alive=true;try{process.kill(row.liveReview.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}if(alive)throw Error('Another review session is already active');}
 if(row.status==='Awaiting Approval')transition(l,key,'Needs Information',{reason:'Previous browser was closed; refreshing the exact application for user review'});
 row.liveReview={id:sessionId,pid:process.pid,expiresAt};
});
const reservation=await reservePreparation(root,job,plan.planHash),artifact=path.join(dir,'attempts',reservation.attemptId);fs.mkdirSync(artifact,{recursive:true,mode:0o700});
let cancelled=false,browser,prepared,review,preparedFinished=false,submissionFinished=false;
const stop=()=>{cancelled=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
const isStopped=()=>cancelled||process.env.CAREER_OPS_STOP_SUBMISSIONS==='1'||fs.existsSync(path.join(dir,'STOP'));
const getPolicy=()=>read('policy.json'),getProfileHash=()=>digest(fs.readFileSync(path.join(dir,'profile.json')));
review={jobKey:key,board:target.board,postingId:target.id,company:job.company,title:job.title,location:job.location,matchScore:job.matchScore,applicationUrl,submitUrl,confirmationUrl,plan,resumePath:resume.path,resumeFilename:path.basename(resume.path),resumeSha256:resume.sha256,profileHash:getProfileHash(),timezone,earliestStart:profile.standardAnswers.full_time_start.value,expiresAt,nonce:randomUUID()};
const controller=new NativeSubmissionController({root,review,getPolicy,getProfileHash,isStopped});
const disable=()=>{const current=getPolicy();current.submissionEnabled=false;current.killSwitch=true;current.mode='approval';current.limits={...current.limits,perRunSubmissions:0};write(path.join(dir,'policy.json'),current);};
try{
 const {chromium}=await import('playwright');browser=await chromium.launch(freshLaunchOptions({headless:true}));
 prepared=await prepareBrowser(browser,applicationUrl,plan,{isStopped,submissionController:controller,timezoneId:timezone,uploadAuthorization:{approved:true,jobUrl:applicationUrl,host:'grnhse-prod-jben-us-east-1.s3.amazonaws.com',sha256:resume.sha256,bytes:fs.statSync(resume.path).size,expiresAt,source:'User authorized preparing this reviewed application with the approved unchanged PDF'}});
 if(prepared.result.status!=='Awaiting Approval')throw Error('Form requires attention: '+prepared.result.unresolved.map(x=>x.question+': '+x.reason).join('; '));
 const attachment=prepared.result.attachments.find(a=>a.sha256===resume.sha256&&a.remoteUploadConfirmed&&a.verifiedInBrowser);if(!attachment?.storageUrl)throw Error('Exact uploaded PDF reference could not be bound to review');
 const notices=await prepared.page.locator('a').evaluateAll(es=>es.filter(e=>/candidate.*privacy|applicant.*privacy|privacy.*notice/i.test(e.innerText)).map(e=>({label:e.innerText,url:e.href})));
 review.legalNotices=notices;review.attachment=attachment;review.risks=['Published listing does not specify a start date; June 2027 is confirmed candidate availability, not an employer commitment.','Resume demonstrates production internship work, not multiple years of full-time experience or production backend scale beyond its stated scope.','Email verification and native security assessment may run only after explicit submission approval; an active challenge stops automation.'];
 review.reviewHash=approvalHash(review);
 await prepared.page.screenshot({path:path.join(artifact,'review.png'),fullPage:true});fs.chmodSync(path.join(artifact,'review.png'),0o600);
 const result={...prepared.result,artifact:path.relative(root,artifact),observedAt:new Date().toISOString(),approvalState:'Explicit approval pending; no submit action taken'};write(path.join(artifact,'review.json'),result);write(path.join(artifact,'submission-review.json'),review);
 await finishPreparation(root,key,reservation.attemptId,result);preparedFinished=true;
 const md=`# First application ready for review\n\n${job.company} — ${job.title}\n\nApplication: ${applicationUrl}\n\nConfirmed availability: ${review.earliestStart} (exact day not provided). Score: ${job.matchScore}/100.\n\n| Field | Reviewed answer |\n|---|---|\n`+plan.fields.filter(f=>f.value!==null).map(f=>`| ${f.label.replace(/[\n|]/g,' ')} | ${f.name==='resume'?review.resumeFilename:String(f.displayValue??f.value).replaceAll('|','/')} |`).join('\n')+`\n\nResume SHA-256: ${review.resumeSha256}\n\nReview hash: ${review.reviewHash}\n\nExpires: ${expiresAt}\n\n`+review.risks.map(r=>'- '+r).join('\n')+'\n\nPrivacy notices: '+notices.map(n=>`[${n.label}](${n.url})`).join(', ')+'\n\nNo submission has occurred. Approval applies to one application only and does not enable autonomous mode.\n';
 fs.writeFileSync(path.join(artifact,'submission-review.md'),md,{mode:0o600});write(path.join(dir,'first-submission/live-review-session.json'),{sessionId,jobKey:key,reviewHash:review.reviewHash,nonce:review.nonce,pid:process.pid,expiresAt,artifact:path.relative(root,artifact),status:'awaiting-explicit-user-approval'});
 console.log(JSON.stringify({event:'ready_for_user_review',company:review.company,title:review.title,jobKey:key,reviewHash:review.reviewHash,nonce:review.nonce,artifact:path.relative(root,artifact),fields:result.populated.length,attachmentConfirmed:true,expiresAt,submitted:false}));
 const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});const timer=setTimeout(()=>{cancelled=true;input.close();},45*60*1000);
 for await(const line of input){
  let message;try{message=JSON.parse(line);}catch{console.log(JSON.stringify({event:'rejected_control_message',reason:'JSON control message required'}));continue;}
  if(message.action==='cancel'){cancelled=true;break;}
  try{
   const live=await checkLivenessViaApi(applicationUrl);if(live?.result!=='active')throw Error('Fresh ATS API liveness check is not active');
   const fresh=await(await fetch(target.api,{redirect:'error',signal:AbortSignal.timeout(15000)})).json();fresh.board=target.board;if(planGreenhouse(fresh,profile).planHash!==plan.planHash)throw Error('Application questions changed; review again');
   const current=getPolicy();if(isStopped()||current.killSwitch!==true||current.submissionEnabled!==false)throw Error('Unexpected policy or emergency-stop state');
   // This exact one-application approval is the only place submission is armed.
   const {assertReviewApproval}=await import('../lib/applications/reviewed-submission.mjs');assertReviewApproval(review,message);
   current.mode='approval';current.submissionEnabled=true;current.killSwitch=false;current.limits={...current.limits,perRunSubmissions:1};current.oneApplicationApproval={reviewHash:review.reviewHash,jobKey:key,maxApplications:1,approvedAt:new Date().toISOString()};write(path.join(dir,'policy.json'),current);
   await controller.arm(prepared.page,message,attachment);
   const button=prepared.page.getByRole('button',{name:'Submit application',exact:true});if(await button.count()!==1)throw Error('Exact native Submit application control is unavailable');
   await button.click();
   await prepared.page.waitForURL(confirmationUrl,{timeout:45000}).catch(()=>{});
   const confirmation=await controller.captureReceipt(prepared.page,artifact);
   const outcome=confirmation?{confirmation}:{reason:'No verified confirmation; inspect form errors or a security challenge before any further action',definitivelyRejected:controller.definitivelyRejected};
   const row=await finishReviewedSubmission(root,review,controller.attemptId,outcome);submissionFinished=true;disable();
   write(path.join(artifact,'submission-outcome.json'),{...outcome,status:row.status,nativeEvents:controller.events,observedAt:new Date().toISOString()});
   if(confirmation){try{const mirror=await mirrorConfirmedSubmission(root,review,confirmation);const recoveryCheck=await mirrorConfirmedSubmission(root,review,confirmation);write(path.join(artifact,'recovery-validation.json'),{trackerReplay:recoveryCheck,submissionReplayAttempted:false});console.log(JSON.stringify({event:'submission_confirmed',status:row.status,confirmation,tracker:mirror,recoveryCheck}));}catch(e){console.log(JSON.stringify({event:'submission_confirmed_tracker_pending',status:row.status,confirmation,error:e.message}));}}
   else console.log(JSON.stringify({event:'submission_unconfirmed',status:row.status,mayHaveBeenAccepted:row.lastSubmission.mayHaveBeenAccepted}));
   break;
  }catch(e){disable();if(controller.attemptId&&!submissionFinished){await finishReviewedSubmission(root,review,controller.attemptId,{reason:e.message,definitivelyRejected:controller.definitivelyRejected});submissionFinished=true;}console.log(JSON.stringify({event:'stopped_without_verified_submission',reason:e.message}));break;}
 }
 clearTimeout(timer);input.close();
}catch(e){if(!preparedFinished)await finishPreparation(root,key,reservation.attemptId,{status:'Failed',failure:{message:e.message},artifact:path.relative(root,artifact)});console.error(e.message);process.exitCode=1;}
finally{disable();if(browser)await browser.close();await updateLedger(root,l=>{const row=l.jobs[key];if(row?.liveReview?.id===sessionId)delete row.liveReview;});}
