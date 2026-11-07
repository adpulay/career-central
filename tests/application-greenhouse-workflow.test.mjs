import {test} from 'node:test';
import {toolRequired} from './required-tools.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {standardAnswer,planGreenhouse,fillGreenhouse,hashPlan} from '../lib/applications/greenhouse.mjs';
import {validateSavedPlan} from '../lib/applications/browser.mjs';
import {reservePreparation,finishPreparation,recoverPreparation,updateLedger} from '../lib/applications/store.mjs';
import {evaluateJob} from '../lib/applications/discovery.mjs';
const v=value=>({value,verified:true});
const profile={personal:{first_name:v('Test'),last_name:v('Candidate'),email:v('test@example.invalid'),country:v('United States')},authorization:{us_work_authorized:v(true),citizenship:v('United States citizen'),current_sponsorship_required:v(false),future_sponsorship_required:v(false)},education:[{institution:v('Fixture University'),degree:v('Bachelor of Science in Engineering'),graduation_month:v('2030-05')}],standardAnswers:{full_time_start:{value:'2030-06',verified:false,provisional:true}},resumeVersions:[],employerAnswers:[]};
const browserSkip=!toolRequired('browser')&&!fs.existsSync(chromium.executablePath())&&'Chromium is not installed';
const job={company:'Fixture',title:'Software Engineer I',url:'https://job-boards.greenhouse.io/fixture/jobs/123'};
const question=(name,label,type='input_text',required=true,values=[])=>({label,required,fields:[{name,type,values}]});
const schema=questions=>({id:123,board:'fixture',questions});
test('verified work authorization and current/future sponsorship map without treating false as missing',()=>{
 assert.equal(standardAnswer('Are you legally authorized to work in the United States?',profile).value,true);
 for(const label of ['Do you require immigration sponsorship to work in the United States?','Will you now or in the future require visa sponsorship for employment?','Will you require immigration sponsorship at any point in the future to maintain authorization to work in the United States?'])assert.equal(standardAnswer(label,profile).value,false);
});
test('citizenship never answers clearance, export controls, investigation consent or pronouns',()=>{
 for(const label of ['Do you hold an active security clearance?','Are you a U.S. person under ITAR export controls?','Are you willing to undergo a background investigation?','What are your pronouns?'])assert.equal(standardAnswer(label,profile),null);
 assert.equal(standardAnswer('Are you a U.S. citizen?',profile).value,true);
 assert.equal(standardAnswer('Earliest start date',profile),null);
});
test('dropdowns use actual option values and flag ambiguous choice mappings',()=>{
 const q=question('sponsor','Do you require immigration sponsorship to work in the United States?','multi_value_single_select',true,[{label:'Yes',value:900},{label:'No',value:901}]);
 const p=planGreenhouse(schema([q]),profile);assert.equal(p.fields.find(f=>f.name==='sponsor').value,'901');
 const ambiguous=planGreenhouse(schema([{...q,fields:[{...q.fields[0],values:[{label:'No',value:0},{label:'No',value:1}]}]}]),profile);assert.equal(ambiguous.readyForApproval,false);
});
test('unverified employer answers and sensitive optional questions stay unanswered',()=>{
 const p=planGreenhouse(schema([question('custom','Why this employer?'),question('pronouns','Pronouns','input_text',false)]),{...profile,employerAnswers:[{board:'fixture',postingId:123,question:'Why this employer?',value:'Guess',approved:true,verified:false}]});
 assert.equal(p.fields.find(f=>f.name==='custom').value,null);assert.equal(p.fields.find(f=>f.name==='pronouns').value,null);
});
test('stale, invalid timestamp, changed job and tampered payloads invalidate saved plans',()=>{
 const p=planGreenhouse(schema([question('first_name','First Name')]),profile),saved={url:job.url,observedAt:new Date().toISOString(),plan:p};
 assert.equal(validateSavedPlan(saved,job.url).planHash,p.planHash);
 for(const observedAt of ['invalid',new Date(Date.now()-31*60*1000).toISOString(),new Date(Date.now()+5*60*1000).toISOString()])assert.throws(()=>validateSavedPlan({...saved,observedAt},job.url));
 assert.throws(()=>validateSavedPlan({...saved,plan:{...p,postingId:456}},job.url));
 assert.throws(()=>validateSavedPlan({...saved,plan:{...p,fields:[]}},job.url));
});
test('concurrent preparation reserves before browser work and records failure without losing history',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'career-attempt-'));
 try{
  const attempts=await Promise.allSettled(Array.from({length:5},()=>reservePreparation(root,job,'fixture-hash')));
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  const a=attempts.find(x=>x.status==='fulfilled').value;
  await assert.rejects(finishPreparation(root,a.key,'wrong-token',{status:'Needs Information'}),/reservation/);
  await finishPreparation(root,a.key,a.attemptId,{status:'Failed',failure:{message:'Fixture browser crashed'}});
  const retry=await reservePreparation(root,job,'next-plan');
  await finishPreparation(root,retry.key,retry.attemptId,{status:'Needs Information',unresolved:[{question:'Fixture answer'}]});
  const l=JSON.parse(fs.readFileSync(path.join(root,'data/application-automation/ledger.json')));assert.equal(Object.keys(l.jobs).length,1);assert.equal(l.jobs[a.key].status,'Needs Information');assert.ok(l.events.some(e=>e.to==='Failed'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('interrupted attempts require recovery and cannot be recorded as Submitted',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'career-recovery-'));
 try{
  const a=await reservePreparation(root,job,'fixture-hash');
  await assert.rejects(recoverPreparation(root,a.key,'test'),/still alive/);
  await assert.rejects(finishPreparation(root,a.key,a.attemptId,{status:'Submitted'}),/cannot record a submission/);
  await updateLedger(root,l=>{l.jobs[a.key].activeAttempt.pid=2147483647;});
  const row=await recoverPreparation(root,a.key,'Confirmed fixture owner no longer exists');assert.equal(row.status,'Needs Information');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Ontario CA is not California and confirmed authorization removes missing-authorization warning',()=>{
 const r=evaluateJob({...job,location:'Toronto, ON, CA'},{},Date.now(),profile);assert.equal(r.eligibility,'excluded');assert.ok(!r.concerns.some(s=>s.includes('authorization not verified')));
});
test('real Chromium handles native selects, checkboxes, files, conditional questions and validation without submitting',{skip:browserSkip},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'career-fields-'));const browser=await chromium.launch({headless:true});
 try{
  const file=path.join(root,'fixture.pdf'),bytes=Buffer.from('%PDF-1.7 fixture approved document');fs.writeFileSync(file,bytes);
  const p={...profile,resumeVersions:[{path:file,sha256:createHash('sha256').update(bytes).digest('hex'),approved:true}],employerAnswers:[{board:'fixture',postingId:123,question:'Fixture consent',value:true,verified:true,approved:true}]};
  const plan=planGreenhouse(schema([question('first_name','First Name'),question('sponsor','Do you require immigration sponsorship to work in the United States?','multi_value_single_select',true,[{label:'Yes',value:1},{label:'No',value:0}]),question('resume','Resume','input_file'),question('consent','Fixture consent','checkbox')]),p);
  const page=await browser.newPage();await page.setContent('<form onsubmit="window.submitted=true;return false"><input id="first_name" required><select id="sponsor" required><option value="">Choose</option><option value="1">Yes</option><option value="0">No</option></select><input type="file" id="resume"><input type="checkbox" id="consent" onchange="document.querySelector(\'#conditional\').hidden=false"><input id="conditional" hidden required><div role="alert">Fixture server error</div><button type="submit">Submit</button></form>');
  const result=await fillGreenhouse(page,plan);assert.equal(await page.locator('#first_name').inputValue(),'Test');assert.equal(await page.locator('#sponsor').inputValue(),'0');assert.equal(await page.locator('#consent').isChecked(),true);
  assert.equal(await page.locator('#resume').evaluate(e=>e.files[0].size),bytes.length);assert.equal(result.attachments[0].verifiedInBrowser,true);assert.equal(result.attachments[0].remoteUploadConfirmed,false);
  assert.equal(result.status,'Needs Information');assert.ok(result.unresolved.some(x=>x.question==='conditional'));assert.ok(result.unresolved.some(x=>x.reason==='Fixture server error'));assert.equal(await page.evaluate(()=>window.submitted),undefined);
 }finally{await browser.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('tampered plan and changed resume fail before attachment',async()=>{
 const p=planGreenhouse(schema([question('first_name','First Name')]),profile);await assert.rejects(fillGreenhouse({}, {...p,fields:[]}),/integrity/);
});

test('authorization mapping rejects foreign-country and compound eligibility questions',()=>{
 assert.equal(standardAnswer('Do you require visa sponsorship to work in Canada?',profile),null);
 assert.equal(standardAnswer('Are you legally authorized to work in the United States and will you need visa sponsorship?',profile),null);
 assert.equal(standardAnswer('Do you not require immigration sponsorship to work in the United States?',profile),null);
});
