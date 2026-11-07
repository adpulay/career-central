import {test} from 'node:test';
import {toolRequired} from './required-tools.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareBrowser,validateResumes} from '../lib/applications/browser.mjs';
import {chromium} from 'playwright';
import {canonicalJobKey,evaluateJob} from '../lib/applications/discovery.mjs';
import {recordJob,transition,updateLedger,assertSubmissionAllowed} from '../lib/applications/store.mjs';
import {greenhouseTarget,planGreenhouse,fillGreenhouse} from '../lib/applications/greenhouse.mjs';
const browserSkip=!toolRequired('browser')&&!fs.existsSync(chromium.executablePath())&&'Chromium is not installed';
const job={company:'Fixture Employer',title:'Software Engineer I',url:'https://job-boards.greenhouse.io/fixture/jobs/123',requisitionId:'REQ-1'};
const ledger=()=>({schemaVersion:1,jobs:{},events:[]});
const verified=value=>({value,verified:true});
const profile={personal:{first_name:verified('Test'),last_name:verified('Candidate'),email:verified('test@example.invalid')},resumeVersions:[]};
const schema={id:123,board:'fixture',questions:[{label:'First Name',required:true,fields:[{name:'first_name',type:'input_text'}]},{label:'Email',required:true,fields:[{name:'email',type:'input_text'}]},{label:'Sponsorship',required:true,fields:[{name:'question_1',type:'multi_value_single_select'}]}]};
test('URL tracking variants deduplicate but different postings stay separate',()=>{
 assert.equal(canonicalJobKey(job),canonicalJobKey({...job,url:job.url+'?utm_source=board#application'}));
 assert.notEqual(canonicalJobKey(job),canonicalJobKey({...job,url:job.url+'4'}));
});
test('state graph refuses fabricated submissions and preserves history',()=>{
 const l=ledger(),r=recordJob(l,job);assert.throws(()=>transition(l,r.key,'Submitted'),/Invalid transition/);
 for(const s of ['Evaluated','Shortlisted','Application Started','Awaiting Approval'])transition(l,r.key,s);
 assert.throws(()=>transition(l,r.key,'Submitted'),/confirmation/);
 assert.equal(r.status,'Awaiting Approval');assert.equal(l.events.length,5);
 transition(l,r.key,'Submitted',{confirmation:{status:'confirmed',source:'manual_receipt',reference:'fixture-confirmation',url:job.url,observedAt:new Date().toISOString()},approval:{approvedAt:new Date().toISOString(),planHash:'fixture-plan'}});
 assert.throws(()=>transition(l,r.key,'Application Started'),/Invalid transition/);
 assert.equal(l.events.length,6);
});
test('related requisition cannot start while another posting is in progress',()=>{
 const l=ledger(),a=recordJob(l,job),b=recordJob(l,{...job,url:job.url+'4'});
 for(const r of [a,b]){transition(l,r.key,'Evaluated');transition(l,r.key,'Shortlisted');}
 transition(l,a.key,'Application Started');assert.throws(()=>transition(l,b.key,'Application Started'),/Requisition conflict/);
});
test('concurrent ledger updates retain all events and malformed ledger fails closed',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'career-ledger-'));
 try{
  await Promise.all(Array.from({length:8},(_,i)=>updateLedger(dir,l=>recordJob(l,{...job,url:job.url+i}))));
  const file=path.join(dir,'data/application-automation/ledger.json');const l=JSON.parse(fs.readFileSync(file));assert.equal(Object.keys(l.jobs).length,8);assert.equal(l.events.length,8);
  fs.writeFileSync(file,'broken');await assert.rejects(updateLedger(dir,()=>{}));assert.equal(fs.readFileSync(file,'utf8'),'broken');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('submission remains disabled even with configuration toggles',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'career-gate-'));
 try{assert.throws(()=>assertSubmissionAllowed(dir,{mode:'discovery'}),/disabled/);assert.throws(()=>assertSubmissionAllowed(dir,{mode:'autonomous',killSwitch:false,submissionEnabled:true}),/not implemented/);
 fs.mkdirSync(path.join(dir,'data/application-automation'),{recursive:true});fs.writeFileSync(path.join(dir,'data/application-automation/STOP'),'stop');assert.throws(()=>assertSubmissionAllowed(dir,{mode:'autonomous',killSwitch:false,submissionEnabled:true}),/kill switch/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('form schema rejects hostile hosts and flags unknown required information',()=>{
 assert.throws(()=>greenhouseTarget('https://job-boards.greenhouse.io.evil.invalid/fixture/jobs/123'));
 assert.throws(()=>greenhouseTarget('http://job-boards.greenhouse.io/fixture/jobs/123'));
 assert.equal(greenhouseTarget(job.url).id,'123');
 const p=planGreenhouse(schema,profile);assert.equal(p.readyForApproval,false);assert.equal(p.blocked[0].question,'Sponsorship');assert.equal(p.fields[0].value,'Test');
 const unknown=planGreenhouse({...schema,questions:[schema.questions[0]]},{personal:{first_name:{value:'Guess',verified:false}}});assert.equal(unknown.fields[0].value,null);assert.equal(unknown.blocked.length,1);
 const extra=planGreenhouse({...schema,compliance_questions:[{label:'Consent'}]},profile);assert.ok(extra.blocked.some(q=>q.question==='compliance_questions'));
});
test('candidate policy governs skills and location; foreign and senior roles excluded',()=>{
 const policy={discovery:{graduationYear:2030,resumeSkills:['Rust'],preferredCities:['Boston']}};
 const r=evaluateJob({...job,location:'Boston, MA',description:'New graduates in 2030. Rust.'},policy);
 assert.ok(r.reasons.some(s=>s.includes('Rust')));assert.ok(r.reasons.some(s=>s.includes('Graduation year')));
 assert.equal(evaluateJob({...job,location:'Seoul, South Korea'},policy).eligibility,'excluded');
 assert.equal(evaluateJob({...job,title:'Senior Software Engineer',location:'Dallas, TX'},policy).eligibility,'excluded');
 assert.equal(evaluateJob({...job,location:'Remote'},policy).eligibility,'needs_information');
});
test('Chromium fixture fills verified fields and pauses without form submission',{skip:browserSkip},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block'});let requests=0;
  await context.route('**/*',route=>{requests++;return route.abort();});
  const page=await context.newPage();
  await page.setContent('<form onsubmit="window.submitted=true;return false"><input name="first_name"><input name="email"><button type="submit">Apply</button></form>');
  const result=await fillGreenhouse(page,planGreenhouse({...schema,questions:schema.questions.slice(0,2)},profile));
  assert.equal(await page.locator('[name="first_name"]').inputValue(),'Test');assert.equal(await page.locator('[name="email"]').inputValue(),'test@example.invalid');
  assert.equal(result.status,'Awaiting Approval');assert.equal(result.submitted,false);assert.equal(await page.evaluate(()=>window.submitted),undefined);assert.equal(requests,0);
  const blocked=await fillGreenhouse(page,planGreenhouse(schema,profile));assert.equal(blocked.status,'Needs Information');
 }finally{await browser.close();}
});

test('approved resume bytes and policy allowlist must both match',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'career-resume-'));
 try{
  fs.writeFileSync(path.join(dir,'fixture.pdf'),'%PDF-1.7 fixture resume bytes');
  const sha256=createHash('sha256').update('%PDF-1.7 fixture resume bytes').digest('hex');
  const p={resumeVersions:[{path:'fixture.pdf',sha256,approved:true}]};
  assert.equal(validateResumes(dir,p,{approvedResumeHashes:[]}).resumeVersions.length,0);
  assert.equal(validateResumes(dir,p,{approvedResumeHashes:[sha256]}).resumeVersions.length,1);
  fs.writeFileSync(path.join(dir,'fixture.pdf'),'changed bytes');
  assert.throws(()=>validateResumes(dir,p,{approvedResumeHashes:[sha256]}),/changed/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('foreign graduate listings and masters-only cohorts are excluded',()=>{
 assert.equal(evaluateJob({...job,title:'Software Engineer New Grad 2027',location:'Aarhus, Denmark'}).eligibility,'excluded');
 assert.equal(evaluateJob({...job,title:"Master's University Grad Machine Learning Engineer 2027",location:'San Francisco, CA'}).eligibility,'excluded');
});
test('kill switch interrupts browser filling before writing any field',async()=>{
 let touched=false;
 await assert.rejects(fillGreenhouse({locator(){touched=true;}},planGreenhouse(schema,profile),{isStopped:()=>true}),/Kill switch/);
 assert.equal(touched,false);
});

test('browser boundary blocks autosave after prefill without sending personal data',{skip:browserSkip},async()=>{
 const realBrowser=await chromium.launch({headless:true});let failed;
 const fixtureBrowser={async newContext(options){
  const context=await realBrowser.newContext(options);
  failed=context.waitForEvent('requestfailed',{timeout:5000});
  const newPage=context.newPage.bind(context);
  context.newPage=async()=>{
   const page=await newPage();
   await page.route(job.url,route=>route.fulfill({contentType:'text/html',body:`<form><input name="first_name" oninput="fetch('https://job-boards.greenhouse.io/fixture-autosave?name='+this.value).catch(()=>{})"><input name="email"><button type="submit">Apply</button></form>`}));
   return page;
  };return context;
 }};
 try{
  const prepared=await prepareBrowser(fixtureBrowser,job.url,planGreenhouse({...schema,questions:schema.questions.slice(0,2)},profile));
  const request=await failed;
  assert.ok(request.url().includes('fixture-autosave'));
  assert.equal(prepared.result.submitted,false);
  assert.equal(await prepared.page.locator('[name="first_name"]').inputValue(),'Test');
  await prepared.context.close();
 }finally{await realBrowser.close();}
});
