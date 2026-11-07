import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {toolRequired} from './required-tools.mjs';
import {planGreenhouse} from '../lib/applications/greenhouse.mjs';
import {approvalHash,assertReviewApproval,checkNativePayload,digest,reserveReviewedSubmission,markSubmissionDispatched,finishReviewedSubmission,NativeSubmissionController,reconcileRecordedReceipt} from '../lib/applications/reviewed-submission.mjs';
import {recordJob,transition,updateLedger,reservePreparation} from '../lib/applications/store.mjs';
import {mirrorConfirmedSubmission} from '../lib/applications/confirmed-tracker.mjs';
const browserSkip=!toolRequired('browser')&&!fs.existsSync(chromium.executablePath())&&'Chromium is not installed';
const v=value=>({value,verified:true});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'career-submit-')),file=path.join(root,'fixture.pdf');fs.writeFileSync(file,'%PDF-1.7 fixture approved bytes');
 const schema={id:123,board:'fixture',title:'Software Engineer I',questions:[...['first_name','last_name','email','phone'].map(name=>({label:name,required:true,fields:[{name,type:'input_text'}]})),{label:'Resume',required:true,fields:[{name:'resume',type:'input_file'}]},{label:'Do you require visa sponsorship to work in the United States?',required:true,fields:[{name:'question_42',type:'multi_value_single_select',values:[{label:'Yes',value:1},{label:'No',value:0}]}]}]};
 const profile={personal:{first_name:v('Test'),last_name:v('Candidate'),email:v('test@example.invalid'),phone:v('5551112222')},authorization:{current_sponsorship_required:v(false)},resumeVersions:[{path:file,sha256:digest(fs.readFileSync(file)),approved:true}]};
 const plan=planGreenhouse(schema,profile),url='https://job-boards.greenhouse.io/fixture/jobs/123';
 const review={jobKey:'fixture-key',board:'fixture',postingId:'123',company:'Fixture',title:'Software Engineer I',location:'Remote US',matchScore:90,applicationUrl:url,submitUrl:'https://boards.greenhouse.io/fixture/jobs/123',confirmationUrl:url+'/confirmation',plan,resumePath:file,resumeFilename:'fixture.pdf',resumeSha256:profile.resumeVersions[0].sha256,profileHash:'fixture-profile',timezone:'UTC',expiresAt:new Date(Date.now()+60000).toISOString(),nonce:'fixture-nonce'};review.reviewHash=approvalHash(review);
 const approval={action:'approve-one',jobKey:review.jobKey,reviewHash:review.reviewHash,nonce:review.nonce,maxApplications:1};
 const attachment={remoteUploadConfirmed:true,verifiedInBrowser:true,sha256:review.resumeSha256,storageUrl:'https://grnhse-prod-jben-us-east-1.s3.amazonaws.com/fixture.pdf'};
 const payload={job_application:{first_name:'Test',last_name:'Candidate',email:'test@example.invalid',phone:'+15551112222',resume_url:attachment.storageUrl,resume_url_filename:'fixture.pdf',answers_attributes:{42:{question_id:'42',boolean_value:0}},data_compliance:{},demographic_answers:[],attachments:{},employments:[{current:false}],educations:[],time_zone:'UTC',from_job_board_renderer:true},fingerprint:{fixture:true},authenticity_token:'page-owned-token'};
 return {root,review,approval,attachment,payload};
}
async function seed(f){await updateLedger(f.root,l=>{const row=recordJob(l,{company:f.review.company,title:f.review.title,url:f.review.applicationUrl});f.review.jobKey=row.key;f.review.reviewHash=approvalHash(f.review);f.approval.jobKey=row.key;f.approval.reviewHash=f.review.reviewHash;for(const s of ['Evaluated','Shortlisted','Application Started','Awaiting Approval'])transition(l,row.key,s);row.lastPreparation={status:'Awaiting Approval',planHash:f.review.plan.planHash};});}
test('approval binds the exact job, PDF, answers, expiry and one application limit',()=>{
 const f=fixture();try{assert.doesNotThrow(()=>assertReviewApproval(f.review,f.approval));for(const change of [{maxApplications:5},{reviewHash:'changed'},{nonce:'wrong'},{jobKey:'other'}])assert.throws(()=>assertReviewApproval(f.review,{...f.approval,...change}));assert.throws(()=>assertReviewApproval({...f.review,expiresAt:'2020-01-01'},f.approval));}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('native payload must match reviewed identity, custom answers and uploaded PDF without changing CSRF',()=>{
 const f=fixture();try{const original=Buffer.from(JSON.stringify(f.payload)),before=Buffer.from(original);assert.ok(checkNativePayload(original,f.review,f.attachment).payloadHash);assert.deepEqual(original,before);
 for(const change of [a=>a.email='other@example.invalid',a=>a.answers_attributes[42].boolean_value=1,a=>a.resume_url='https://example.invalid/other.pdf',a=>a.demographic_answers=[{answer:'invented'}],a=>a.educations=[{degree:'invented'}]]){const p=structuredClone(f.payload);change(p.job_application);assert.throws(()=>checkNativePayload(JSON.stringify(p),f.review,f.attachment));}
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('durable reservation prevents duplicate dispatch and ambiguous outcomes block preparation retry',async()=>{
 const f=fixture();try{await seed(f);const attempts=await Promise.allSettled([reserveReviewedSubmission(f.root,f.review,f.approval),reserveReviewedSubmission(f.root,f.review,f.approval)]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);const id=attempts.find(x=>x.status==='fulfilled').value;await markSubmissionDispatched(f.root,f.review,id,'payload');await assert.rejects(markSubmissionDispatched(f.root,f.review,id,'payload'),/already dispatched/);const row=await finishReviewedSubmission(f.root,f.review,id,{reason:'Network timeout'});assert.equal(row.status,'Needs Information');assert.equal(row.lastSubmission.mayHaveBeenAccepted,true);await assert.rejects(reservePreparation(f.root,{url:f.review.applicationUrl,company:'Fixture',title:'Software Engineer I'},f.review.plan.planHash),/reconciliation/);}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('HTTP acceptance without a verified receipt never becomes Submitted',async()=>{
 const f=fixture();try{await seed(f);const id=await reserveReviewedSubmission(f.root,f.review,f.approval);await markSubmissionDispatched(f.root,f.review,id,'payload');await assert.rejects(finishReviewedSubmission(f.root,f.review,id,{confirmation:{nativeRequestAccepted:true,confirmationPageVerified:false}}),/receipt/);}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('kill switch and disarmed controller prevent any native request allowance',async()=>{
 const f=fixture();try{const c=new NativeSubmissionController({root:f.root,review:f.review,getPolicy:()=>({mode:'approval',killSwitch:true,submissionEnabled:false}),getProfileHash:()=>f.review.profileHash,isStopped:()=>false});const req={url:()=>f.review.submitUrl,method:()=> 'POST'};assert.equal(await c.routeDecision(req),null);c.armed=true;assert.equal((await c.routeDecision(req)).allow,false);}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('controlled browser verifies native submit, confirmation, receipt recovery and idempotent tracker mirror',{skip:browserSkip},async()=>{
 const f=fixture(),browser=await chromium.launch({headless:true});let oldTracker=process.env.CAREER_OPS_TRACKER;delete process.env.CAREER_OPS_TRACKER;
 try{await seed(f);fs.writeFileSync(path.join(f.root,'data/applications.md'),'# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');const policy={mode:'approval',killSwitch:false,submissionEnabled:true};const c=new NativeSubmissionController({root:f.root,review:f.review,getPolicy:()=>policy,getProfileHash:()=>f.review.profileHash,isStopped:()=>false});const context=await browser.newContext({serviceWorkers:'block'});let nativePosts=0;context.on('response',r=>c.observe(r));await context.route('**/*',async route=>{const req=route.request();if(req.url()===f.review.submitUrl){const d=await c.routeDecision(req);assert.equal(d.allow,true);nativePosts++;return route.fulfill({status:200,contentType:'application/json',body:'{}'});}if(req.url()===f.review.confirmationUrl)return route.fulfill({contentType:'text/html',body:'<h1>Thank you for applying!</h1><p>We received your application.</p>'});if(req.url()===f.review.applicationUrl)return route.fulfill({contentType:'text/html',body:`<form><input id="first_name" value="Test"><input id="last_name" value="Candidate"><input id="email" value="test@example.invalid"><input id="phone" value="5551112222"><span>fixture.pdf</span><button type="submit">Submit application</button></form><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const r=await fetch(${JSON.stringify(f.review.submitUrl)},{method:'POST',body:JSON.stringify(${JSON.stringify(f.payload)})});if(r.ok)location.assign(${JSON.stringify(f.review.confirmationUrl)});};</script>`});return route.abort();});const page=await context.newPage();await page.goto(f.review.applicationUrl);await c.arm(page,f.approval,f.attachment);await page.getByRole('button',{name:'Submit application',exact:true}).click();await page.waitForURL(f.review.confirmationUrl);const artifact=path.join(f.root,'data/application-automation/receipt');fs.mkdirSync(artifact,{recursive:true});const confirmation=await c.captureReceipt(page,artifact);assert.equal(nativePosts,1);assert.equal(confirmation.status,'confirmed');
 const row=await reconcileRecordedReceipt(f.root,f.review,c.attemptId,artifact);assert.equal(row.status,'Submitted');const again=await reconcileRecordedReceipt(f.root,f.review,c.attemptId,artifact);assert.equal(again.status,'Submitted');const first=await mirrorConfirmedSubmission(f.root,f.review,confirmation),second=await mirrorConfirmedSubmission(f.root,f.review,confirmation);assert.equal(first.status,'recorded');assert.equal(second.status,'already-recorded');assert.equal(fs.readFileSync(path.join(f.root,'data/applications.md'),'utf8').split('\n').filter(s=>/^\| 1 /.test(s)).length,1);
 }finally{if(oldTracker===undefined)delete process.env.CAREER_OPS_TRACKER;else process.env.CAREER_OPS_TRACKER=oldTracker;await browser.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('placeholder requisition labels do not collapse distinct employer postings',()=>{
 const ledger={jobs:{},events:[]};
 const a=recordJob(ledger,{company:'Fixture',title:'One',url:'https://example.invalid/jobs?gh_jid=1',requisitionId:'See Opening ID'});
 const b=recordJob(ledger,{company:'Fixture',title:'Two',url:'https://example.invalid/jobs?gh_jid=2',requisitionId:'See Opening ID'});
 assert.equal(a.requisitionGroup,null);assert.equal(b.requisitionGroup,null);assert.notEqual(a.key,b.key);
});

 test('verification-required native response blocks new preparation and submission without replay',async()=>{
 const f=fixture();try{await seed(f);const id=await reserveReviewedSubmission(f.root,f.review,f.approval);await markSubmissionDispatched(f.root,f.review,id,'payload');await updateLedger(f.root,l=>{l.jobs[f.review.jobKey].activeSubmission.nativeResponse={kind:'native_response',status:428};});const row=await finishReviewedSubmission(f.root,f.review,id,{definitivelyRejected:true});assert.equal(row.status,'Needs Information');assert.equal(row.lastSubmission.verificationRequired,true);assert.equal(row.lastSubmission.mayHaveBeenAccepted,false);await assert.rejects(reservePreparation(f.root,{url:f.review.applicationUrl,company:'Fixture',title:'Software Engineer I'},f.review.plan.planHash),/reconciliation/);await updateLedger(f.root,l=>{l.jobs[f.review.jobKey].status='Awaiting Approval';});await assert.rejects(reserveReviewedSubmission(f.root,f.review,f.approval),/reconciliation/); }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
