import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePilotPolicy,policyHash,planPilot,evaluatePilotCandidate} from '../lib/applications/pilot.mjs';
const hash='a'.repeat(64),v=value=>({value,verified:true});
const policy={maxApplications:5,minimumMatchScore:85,platform:'greenhouse',countries:['United States'],approvedResumeSha256:hash,earliestFullTimeStartMonth:'2030-06',graduationMonth:'2030-05',autonomousEnabled:true,submissionEnabled:true};
function fixture(n=1){
 const jobs=Array.from({length:n},(_,i)=>({key:String(i),company:'Fixture '+i,title:'Software Engineer I',provider:'greenhouse',matchScore:90,eligibility:'review_required',availabilityCheck:{result:'active'},confirmedPilotEligibility:{seniority:true,graduation:true,usLocation:true,startDate:true},employerProcessValidated:true}));
 const profile={standardAnswers:{full_time_start:v('2030-06')},education:[{graduation_month:v('2030-05')}],authorization:{us_work_authorized:v(true),future_sponsorship_required:v(false)},applicationHistory:Object.fromEntries(jobs.map(j=>[j.key,{verified:true,neverApplied:true}]))};
 const ledger={jobs:Object.fromEntries(jobs.map(j=>[j.key,{key:j.key,status:'Awaiting Approval',lastPreparation:{status:'Awaiting Approval',unresolved:[],attachments:[{remoteUploadConfirmed:true,verifiedInBrowser:true,sha256:hash}],browserErrors:[]}}]))};
 const authorization={explicitlyEnabled:true,policyHash:policyHash(policy),maxApplications:5,resumeSha256:hash,startMonth:'2030-06',expiresAt:new Date(Date.now()+60000).toISOString()};
 return {jobs,context:{policy,profile,ledger,authorization,mode:'autonomous',transportValidated:true}};
}
test('pilot rejects caps above five, thresholds below 85 and other platforms',()=>{
 for(const override of [{maxApplications:6},{minimumMatchScore:84},{platform:'lever'},{countries:['Canada']}])assert.throws(()=>validatePilotPolicy({...policy,...override}));
});
test('a fully verified fixture plan remains limited to five without executing submissions',()=>{
 const {jobs,context}=fixture(9),result=planPilot(jobs,context);assert.equal(result.readyForSubmission.length,5);assert.equal(result.submissionEnabled,false);
});
test('a prompt or candidate score cannot enable autonomy without separate matching confirmation',()=>{
 const {jobs,context}=fixture();for(const override of [{authorization:null},{mode:'approval'},{authorization:{...context.authorization,maxApplications:6}},{authorization:{...context.authorization,resumeSha256:'b'.repeat(64)}},{authorization:{...context.authorization,expiresAt:'2020-01-01'}}])assert.equal(evaluatePilotCandidate(jobs[0],{...context,...override}).eligible,false);
});
test('provisional start, missing external history and incomplete employer answers block submission readiness',()=>{
 const {jobs,context}=fixture();context.profile.standardAnswers.full_time_start.provisional=true;assert.equal(evaluatePilotCandidate(jobs[0],context).eligible,false);delete context.profile.standardAnswers.full_time_start.provisional;
 delete context.profile.applicationHistory['0'];assert.equal(evaluatePilotCandidate(jobs[0],context).eligible,false);context.profile.applicationHistory['0']={verified:true,neverApplied:true};
 context.ledger.jobs['0'].lastPreparation.unresolved=[{question:'Unknown employer question'}];assert.equal(evaluatePilotCandidate(jobs[0],context).eligible,false);
});
test('unvalidated transport, existing submissions, wrong platform and uncertain eligibility block the pilot',()=>{
 const {jobs,context}=fixture();assert.equal(evaluatePilotCandidate(jobs[0],{...context,transportValidated:false}).eligible,false);
 context.ledger.jobs['0'].status='Submitted';assert.equal(evaluatePilotCandidate(jobs[0],context).eligible,false);context.ledger.jobs['0'].status='Awaiting Approval';
 for(const override of [{provider:'lever'},{eligibility:'needs_information'},{matchScore:84},{title:'Senior Software Engineer'},{title:'Platform Account Manager'}])assert.equal(evaluatePilotCandidate({...jobs[0],...override},context).eligible,false);
});
