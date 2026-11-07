import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {updateLedger,transition} from './store.mjs';
import {greenhouseTarget,hashPlan,validateForm} from './greenhouse.mjs';
const terminal=new Set(['Submitted','Interviewing','Offer','Rejected']);
export const digest=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
export function approvalHash(review){const {reviewHash,nonce,...payload}=review;return digest(payload);}
export function assertReviewApproval(review,approval,now=Date.now()){
 if(approval?.action!=='approve-one'||approval.reviewHash!==review.reviewHash||approval.nonce!==review.nonce||approval.jobKey!==review.jobKey||approval.maxApplications!==1)throw Error('Explicit approval of this exact one-application review is required');
 if(approvalHash(review)!==review.reviewHash||!Number.isFinite(Date.parse(review.expiresAt))||Date.parse(review.expiresAt)<=now)throw Error('Review is stale or changed; prepare and review again');
}
export function checkNativePayload(body,review,attachment){
 let p;try{p=JSON.parse(Buffer.isBuffer(body)?body.toString('utf8'):body);}catch{throw Error('Unsupported native application payload');}
 const envelope=new Set(['job_application','fingerprint','g-recaptcha-enterprise-token','authenticity_token','request_token','captcha_retried']);
 for(const k of Object.keys(p))if(!envelope.has(k))throw Error('Unreviewed envelope field: '+k);
 const a=p.job_application;if(!a||typeof a!=='object'||Array.isArray(a))throw Error('Application object missing');
 const fields=new Map(review.plan.fields.map(f=>[f.name,f]));
 const base=new Set(['first_name','last_name','preferred_name','email','phone','resume_text','cover_letter_text','location','latitude','longitude','country_short_name']);
 for(const key of ['first_name','last_name','email'])if(a[key]!==fields.get(key)?.value)throw Error('Reviewed identity differs: '+key);
 const digits=s=>String(s||'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
 if(digits(a.phone)!==digits(fields.get('phone')?.value))throw Error('Reviewed phone differs');
 for(const key of base){if(['first_name','last_name','email','phone'].includes(key))continue;if(a[key]!==undefined&&a[key]!==null&&a[key]!==''){const expected=fields.get(key)?.value;if(expected==null||a[key]!==expected)throw Error('Unreviewed basic answer: '+key);}}
 if(!attachment?.remoteUploadConfirmed||!attachment.verifiedInBrowser||attachment.sha256!==review.resumeSha256||a.resume_url_filename!==review.resumeFilename)throw Error('Correct approved attachment not confirmed');
 const u=new URL(a.resume_url);if(u.protocol!=='https:'||u.hostname!=='grnhse-prod-jben-us-east-1.s3.amazonaws.com'||decodeURIComponent(u.pathname)!==decodeURIComponent(new URL(attachment.storageUrl).pathname))throw Error('Uploaded resume reference differs from reviewed attachment');
 const expectedQuestions=new Map(review.plan.fields.filter(f=>/^question_\d+(?:\[\])?$/.test(f.name)).map(f=>[f.name.match(/^question_(\d+)/)[1],f]));
 for(const [id,answer]of Object.entries(a.answers_attributes||{})){
  const f=expectedQuestions.get(id),selected=Object.values(answer.answer_selected_options_attributes||{}).map(o=>String(o.question_option_id));
  const substantive=answer.text_value!=null&&answer.text_value!==''||answer.boolean_value!==undefined||selected.length>0;
  if(!f||f.value===null){if(substantive)throw Error('Unreviewed custom answer: '+id);continue;}
  if(['input_text','textarea'].includes(f.type)){if(answer.text_value!==String(f.value))throw Error('Reviewed text answer differs: '+id);}
  else if(['0','1'].includes(String(f.value))){if(answer.boolean_value!==Number(f.value))throw Error('Reviewed yes/no answer differs: '+id);}
  else if(selected.length!==1||selected[0]!==String(f.value))throw Error('Reviewed dropdown differs: '+id);
 }
 for(const [id,f]of expectedQuestions){if(f.value!==null&&!Object.hasOwn(a.answers_attributes||{},id))throw Error('Reviewed custom answer missing: '+id);}
 const empty=x=>x==null||x===''||x===false||Array.isArray(x)&&x.every(empty)||typeof x==='object'&&Object.values(x).every(empty);
 for(const key of ['demographic_answers','data_compliance','attachments','employments','educations'])if(a[key]!==undefined&&!empty(a[key]))throw Error('Unreviewed additional form section: '+key);
 for(const key of ['mapped_url_token','appcast_click_id'])if(a[key]!=null&&a[key]!=='')throw Error('Unreviewed tracking metadata');
 if(a.time_zone&&a.time_zone!==review.timezone)throw Error('Browser timezone differs from reviewed timezone');
 const extras=new Set([...base,'resume_url','resume_url_filename','answers_attributes','demographic_answers','data_compliance','attachments','employments','educations','mapped_url_token','appcast_click_id','time_zone','from_job_board_renderer']);
 for(const key of Object.keys(a))if(!extras.has(key))throw Error('Unreviewed application field: '+key);
 return {payloadHash:digest(body),questionCount:expectedQuestions.size};
}
export async function reserveReviewedSubmission(root,review,approval){
 assertReviewApproval(review,approval);
 return updateLedger(root,l=>{
  const row=l.jobs[review.jobKey];if(!row||row.status!=='Awaiting Approval'||row.lastPreparation?.planHash!==review.plan.planHash)throw Error('Current preparation no longer matches review');
  if(row.activeSubmission||row.lastSubmission?.mayHaveBeenAccepted||row.lastSubmission?.verificationRequired||terminal.has(row.status))throw Error('Submission may already exist; reconciliation required');
  if(Object.values(l.jobs).some(j=>j.key!==row.key&&j.requisitionGroup&&j.requisitionGroup===row.requisitionGroup&&terminal.has(j.status)))throw Error('A related requisition already has an application');
  const id=randomUUID();row.activeSubmission={id,reviewHash:review.reviewHash,approvedAt:new Date().toISOString(),attempted:false,ownerPid:process.pid};
  l.events.push({id:randomUUID(),jobKey:row.key,type:'UserApprovedOneSubmission',at:new Date().toISOString(),submissionAttemptId:id,reviewHash:review.reviewHash,maxApplications:1});return id;
 });
}
export async function markSubmissionDispatched(root,review,id,payloadHash){
 return updateLedger(root,l=>{
  const row=l.jobs[review.jobKey];if(row?.activeSubmission?.id!==id||row.activeSubmission.attempted)throw Error('Submission reservation missing or already dispatched');
  row.activeSubmission.attempted=true;row.activeSubmission.payloadHash=payloadHash;row.activeSubmission.dispatchedAt=new Date().toISOString();l.events.push({id:randomUUID(),jobKey:row.key,type:'SubmissionDispatched',submissionAttemptId:id,payloadHash,at:row.activeSubmission.dispatchedAt});
 });
}
export async function finishReviewedSubmission(root,review,id,outcome){
 return updateLedger(root,l=>{
  const row=l.jobs[review.jobKey];if(row?.activeSubmission?.id!==id)throw Error('Submission reservation not owned');
  const dispatched=row.activeSubmission.attempted;
  if(row.activeSubmission.nativeResponse?.status===428)outcome={...outcome,verificationRequired:true,reason:'Native application endpoint requires verification (HTTP 428); preserve or reconcile the verification session before any retry'};
  if(outcome.confirmation){
   if(!dispatched||!row.activeSubmission.nativeResponse||row.activeSubmission.nativeResponse.status<200||row.activeSubmission.nativeResponse.status>=300||!outcome.confirmation.nativeRequestAccepted||!outcome.confirmation.confirmationPageVerified)throw Error('Accepted native request and verified receipt required');
   transition(l,row.key,'Submitted',{confirmation:outcome.confirmation,approval:{approvedAt:row.activeSubmission.approvedAt,planHash:review.plan.planHash,reviewHash:review.reviewHash},submissionAttemptId:id});
  }else transition(l,row.key,'Needs Information',{submissionAttemptId:id,reason:outcome.reason||'Submission unconfirmed',mayHaveBeenAccepted:dispatched&&!outcome.definitivelyRejected});
  row.lastSubmission={...row.activeSubmission,...outcome,mayHaveBeenAccepted:!outcome.confirmation&&dispatched&&!outcome.definitivelyRejected,finishedAt:new Date().toISOString()};delete row.activeSubmission;return row;
 });
}
export class NativeSubmissionController{
 constructor({root,review,getPolicy,getProfileHash,isStopped}){Object.assign(this,{root,review,getPolicy,getProfileHash,isStopped});this.armed=false;this.dispatched=false;this.nativeAccepted=false;this.definitivelyRejected=false;this.events=[];}
 stopped(){const p=this.getPolicy();return this.isStopped()||p.killSwitch!==false||p.submissionEnabled!==true||p.mode!=='approval';}
 async arm(page,approval,attachment){
  assertReviewApproval(this.review,approval);if(this.stopped())throw Error('Submission kill switch or policy prevents dispatch');
  if(this.getProfileHash()!==this.review.profileHash)throw Error('Profile changed since review');
  if(hashPlan(this.review.plan)!==this.review.plan.planHash)throw Error('Reviewed plan changed');
  if(digest(fs.readFileSync(this.review.resumePath))!==this.review.resumeSha256)throw Error('Approved resume changed');
  const validity=await validateForm(page,this.review.plan);if(validity.issues.length)throw Error('Required fields or form errors remain');
  if(page.url()!==this.review.applicationUrl)throw Error('Application page changed');
  this.attachment=attachment;this.attemptId=await reserveReviewedSubmission(this.root,this.review,approval);this.armed=true;
 }
 async routeDecision(req){
  if(!this.armed)return null;
  const u=new URL(req.url());if(this.stopped())return {allow:false,reason:'submission_kill_switch'};
  if(req.url()===this.review.submitUrl&&req.method()==='OPTIONS')return {allow:!this.dispatched,reason:'native_submission_preflight'};
  if(req.url()===this.review.submitUrl&&req.method()==='POST'){
   if(this.dispatched)throw Error('Second submission request blocked');
   if(this.getProfileHash()!==this.review.profileHash)throw Error('Profile changed before dispatch');
   const checked=checkNativePayload(req.postDataBuffer(),this.review,this.attachment);
   await markSubmissionDispatched(this.root,this.review,this.attemptId,checked.payloadHash);this.dispatched=true;
   return {allow:true,reason:'explicitly_approved_native_submission'};
  }
  if(req.method()==='GET'&&req.url()===this.review.confirmationUrl&&this.nativeAccepted)return {allow:true,reason:'verified_native_confirmation_navigation'};
  if(u.hostname==='email-address-validator.us.greenhouse.io'&&u.pathname==='/address/validate'&&req.method()==='GET'){
   const values=[...u.searchParams.values()];const email=this.review.plan.fields.find(f=>f.name==='email').value;
   return {allow:values.includes(email)&&values.every(x=>x===email||x==='true'||x==='false'),reason:'approved_native_email_validation'};
  }
  if(['www.recaptcha.net','www.gstatic.com'].includes(u.hostname)&&u.protocol==='https:'&&u.pathname.startsWith('/recaptcha/'))return {allow:['GET','POST'].includes(req.method()),reason:'native_security_assessment_no_challenge_solving'};
  return null;
 }
 async observe(response){
  if(!this.armed||!this.dispatched||response.url()!==this.review.submitUrl||response.request().method()!=='POST')return;
  this.nativeAccepted=response.status()>=200&&response.status()<300;this.definitivelyRejected=response.status()>=400&&response.status()<500;
  const event={kind:'native_response',status:response.status(),at:new Date().toISOString()};this.events.push(event);
  this.responsePersisted=updateLedger(this.root,l=>{const row=l.jobs[this.review.jobKey];if(row?.activeSubmission?.id!==this.attemptId)throw Error('Response reservation changed');row.activeSubmission.nativeResponse=event;l.events.push({id:randomUUID(),jobKey:row.key,type:'NativeSubmissionResponse',submissionAttemptId:this.attemptId,...event});});
  await this.responsePersisted;
 }
 async captureReceipt(page,artifact){
  if(!this.nativeAccepted||page.url()!==this.review.confirmationUrl)return null;
  await this.responsePersisted;
  const text=await page.locator('body').innerText();if(!/thank(?:s| you).*appl|application.{0,50}(?:received|submitted)|received your application/is.test(text))return null;
  const ref='greenhouse:'+this.review.board+':'+this.review.postingId+':'+this.attemptId;
  fs.writeFileSync(path.join(artifact,'confirmation.txt'),text,{mode:0o600});await page.screenshot({path:path.join(artifact,'confirmation.png'),fullPage:true});fs.chmodSync(path.join(artifact,'confirmation.png'),0o600);
  const confirmation={status:'confirmed',source:'browser_confirmation',reference:ref,url:page.url(),observedAt:new Date().toISOString(),nativeRequestAccepted:true,confirmationPageVerified:true,textHash:digest(text),evidence:path.relative(this.root,artifact)};
  fs.writeFileSync(path.join(artifact,'confirmation.json'),JSON.stringify({jobKey:this.review.jobKey,reviewHash:this.review.reviewHash,submissionAttemptId:this.attemptId,confirmation},null,2),{mode:0o600});
  return confirmation;
 }
}

export async function reconcileRecordedReceipt(root,review,id,artifact){
 const recorded=JSON.parse(fs.readFileSync(path.join(artifact,'confirmation.json'),'utf8'));
 if(recorded.jobKey!==review.jobKey||recorded.reviewHash!==review.reviewHash||recorded.submissionAttemptId!==id||recorded.confirmation.url!==review.confirmationUrl||digest(fs.readFileSync(path.join(artifact,'confirmation.txt')))!==recorded.confirmation.textHash)throw Error('Receipt evidence does not match the reviewed attempt');
 const ledger=JSON.parse(fs.readFileSync(path.join(root,'data/application-automation/ledger.json'),'utf8')),row=ledger.jobs[review.jobKey];
 if(row?.status==='Submitted'&&row.lastSubmission?.confirmation?.reference===recorded.confirmation.reference)return row;
 return finishReviewedSubmission(root,review,id,{confirmation:recorded.confirmation,recoveredFromReceipt:true});
}
