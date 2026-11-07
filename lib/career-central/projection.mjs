// Pure read model: no IO, time lookup, browser, credential or application transport.
import {projectOperationalEvidence} from './operational-projection.mjs';
import {createHash} from 'node:crypto';
import {normalizeUrl} from '../../url-key.mjs';
import {detectColumns,resolveColumns,parseTrackerRow,parseScore,extractReqNumber,extractTrackerReportNumbers,isHeaderRow,isSeparatorRow} from '../../tracker-parse.mjs';
import {resolveCanonicalState} from '../../tracker-utils.mjs';
import {foldTakeHomes,isOffsetDateTime} from '../../assessment-log.mjs';
import {parseStatusLog,replayObservations} from '../../funnel-velocity.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
export const stableId=(kind,value)=>kind+':'+hash(String(value));
const sorted=xs=>xs.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
const text=(s,max=300)=>typeof s==='string'?s.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):null;
const date=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT/.test(s)&&Number.isFinite(Date.parse(s))?new Date(s).toISOString():null;
const req=s=>typeof s==='string'&&/\d/.test(s)&&!/^see opening id$/i.test(s)?s.trim().toUpperCase():null;
const LEGACY={Evaluated:'evaluated',Applied:'submitted',Responded:'responded',Assessment:'assessment',Interview:'interviewing',Offer:'offer',Hired:'hired',Rejected:'rejected',Discarded:'discarded',SKIP:'skipped'};
const AUTOMATION={Discovered:'discovered',Evaluated:'evaluated',Shortlisted:'shortlisted','Application Started':'application_started','Awaiting Approval':'awaiting_approval',Submitted:'submitted',Interviewing:'interviewing',Offer:'offer',Rejected:'rejected',Failed:'failed',Skipped:'skipped','Needs Information':'needs_information'};
const CATEGORIES=new Set(['verification','application_confirmation','assessment','interview','rejection','recruiter_update']);
const ref=(source,locator)=>({sourceId:source.id,locator,revision:source.revision||null});
const status=(raw,kind,states,sourceRef)=>({original:text(raw,80),normalized:kind==='tracker'?LEGACY[resolveCanonicalState(raw,states)]||'unknown':AUTOMATION[raw]||'unknown',source:sourceRef});
function safeUrl(raw){try{const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;
 // Sensitive or unknown query values are neither displayed nor followed. The core
 // parser still supplies the identity internally; the projection retains a digest.
 const sensitive=[...u.searchParams.keys()].some(k=>!/^utm_|^(?:source|src|gh_src|lever-source|gh_jid|jk|vjk|currentJobId|jobId|job_id|req_id|requisitionId|lang|language|locale)$/i.test(k));
 if(sensitive)return null;return normalizeUrl(u.href)||null;}catch{return null;}}
function urlIdentity(raw){try{const u=new URL(raw);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?normalizeUrl(raw):'';}catch{return '';}}

/** Input: validated source descriptors; absent/malformed sources remain explicit. */
export function projectCareer({sources,asOf,consistency='stable',staleAfterHours=24}){
 if(!date(asOf)||!Array.isArray(sources)||!Number.isFinite(staleAfterHours)||staleAfterHours<0)throw Error('Invalid projection inputs');
 asOf=date(asOf);const now=Date.parse(asOf),byId=new Map(sources.map(s=>[s.id,s])),warnings=[],conflicts=[],entries=[],applications=[],attempts=[],evidence=[],pendingReviews=[];
 const warn=(code,sourceId,locator='')=>warnings.push({code,sourceId,locator});
 const conflict=(code,entityId,refs)=>conflicts.push({id:stableId('conflict',JSON.stringify([code,entityId,sorted([...refs])])),code,entityId,sources:sorted([...refs])});
 const available=id=>byId.get(id)?.state==='available'?byId.get(id):null;
 const states=available('states')?.data.states||[];
 for(const s of sources)if(s.state!=='available')warn('SOURCE_'+s.state.toUpperCase(),s.id);
 if(consistency!=='stable')warn('INCONSISTENT_SNAPSHOT',null);
 const add=(s,locator,raw,kind,key,trackerRow=null)=>{
  const r=ref(s,locator),url=urlIdentity(raw.url),requisition=req(raw.requisitionId||(typeof raw.requisitionGroup==='string'?raw.requisitionGroup.split(':').slice(1).join(':'):null)||(trackerRow?extractReqNumber(trackerRow.notes):null));
  const originalKey=text(key,256),entry={source:s,sourceRef:r,kind,key:originalKey,sourceKey:key,raw,trackerRow,url,requisition,company:text(raw.company),title:text(raw.title||raw.role),location:text(raw.location)};
  if(kind!=='discovery'&&status(raw.status,kind,states,r).normalized==='unknown')warn('SOURCE_STATUS_UNKNOWN',s.id,locator);
  entries.push(entry);return entry;
 };
 const discovery=available('discovery');if(discovery)for(const [i,j]of discovery.data.jobs.entries())add(discovery,`/jobs/${i}`,j,'discovery',j.key||String(i));
 const ledger=available('ledger');if(ledger)for(const key of Object.keys(ledger.data.jobs).sort()){const j=ledger.data.jobs[key];const e=add(ledger,'/jobs/'+key.replaceAll('~','~0').replaceAll('/','~1'),j,'ledger',key);if(j.key&&j.key!==key)warn('SOURCE_IDENTITY_MISMATCH','ledger',e.sourceRef.locator);}
 const tracker=available('tracker');let trackerRows=[];
 if(tracker){const lines=tracker.data.split(/\r?\n/),detected=detectColumns(lines),columns=resolveColumns(lines);if(!detected)warn('TRACKER_LEGACY_LAYOUT','tracker');{
  for(const [i,line]of lines.entries()){const row=parseTrackerRow(line,columns);if(row){const e=add(tracker,`line:${i+1}`,row,'tracker',String(row.num),row);trackerRows.push(e);}else if(line.startsWith('|')&&!isHeaderRow(line)&&!isSeparatorRow(line))warn('TRACKER_ROW_UNPARSEABLE','tracker',`line:${i+1}`);}
 }}
 // Exact source keys are hints, not permission to merge conflicting posting URLs.
 for(const key of new Set(entries.filter(e=>e.kind!=='tracker').map(e=>e.key))){const group=entries.filter(e=>e.key===key&&e.kind!=='tracker');if(new Set(group.map(e=>e.url).filter(Boolean)).size>1)conflict('SOURCE_KEY_URL_CONFLICT',stableId('source-key',key),group.map(e=>e.sourceRef));}
 const reqsByUrl=new Map();for(const e of entries)if(e.url&&e.requisition){if(!reqsByUrl.has(e.url))reqsByUrl.set(e.url,new Set());reqsByUrl.get(e.url).add(e.requisition);}
 const groups=new Map();
 for(const e of entries){const multiple=(reqsByUrl.get(e.url)?.size||0)>1;const identity=e.url?e.url+(multiple?'\0req:'+(e.requisition||'unknown'):''):e.kind+':'+e.key+':'+[e.company,e.title,e.requisition].join(':');
  e.jobId=stableId('job',identity);if(!groups.has(e.jobId))groups.set(e.jobId,[]);groups.get(e.jobId).push(e);
  if(multiple)conflict('POSTING_REQUISITION_CONFLICT',e.jobId,entries.filter(x=>x.url===e.url).map(x=>x.sourceRef));
 }
 const jobs=[];
 for(const [id,group]of groups){const values=field=>[...new Set(group.map(e=>e[field]).filter(Boolean))].sort();const claims=field=>group.filter(e=>e[field]).map(e=>({value:e[field],source:e.sourceRef}));
  for(const field of ['company','title','location'])if(values(field).length>1)conflict('JOB_'+field.toUpperCase()+'_CONFLICT',id,group.map(e=>e.sourceRef));
  const scoreClaims=[];for(const e of group){const raw=e.kind==='tracker'?e.raw.score:e.raw.matchScore;let n=null,scale=e.kind==='tracker'?5:100;
   if(e.kind==='tracker'&&/^\*?\*?\d+(?:[.,]\d+)?(?:\/5)?\*?\*?$/.test(String(raw)))n=parseScore(raw);else if(typeof raw==='number'&&Number.isFinite(raw))n=raw;
   if(n!==null&&n>=0&&n<=scale)scoreClaims.push({value:n,scale,method:e.kind==='tracker'?'legacy_report':e.raw.review?'review_override':'source_assessment',source:e.sourceRef});
  }
  if(new Set(scoreClaims.map(c=>c.value/c.scale)).size>1)conflict('SCORE_ASSESSMENT_DIFFERENCE',id,scoreClaims.map(c=>c.source));
  const availability=group.filter(e=>e.raw.availabilityCheck).map(e=>({verdict:['active','expired','uncertain'].includes(e.raw.availabilityCheck.result)?e.raw.availabilityCheck.result:'unknown',checkedAt:date(e.raw.availabilityCheck.checkedAt),source:e.sourceRef}));
  if(new Set(availability.map(c=>c.verdict).filter(v=>v!=='unknown')).size>1)conflict('AVAILABILITY_CONFLICT',id,availability.map(c=>c.source));
  const eligibilityClaims=group.filter(e=>typeof e.raw.eligibility==='string');if(new Set(eligibilityClaims.map(e=>e.raw.eligibility)).size>1)conflict('ELIGIBILITY_CONFLICT',id,eligibilityClaims.map(e=>e.sourceRef));
  jobs.push({id,company:values('company').length===1?values('company')[0]:null,title:values('title').length===1?values('title')[0]:null,location:values('location').length===1?values('location')[0]:null,claims:sorted([...claims('company').map(c=>({field:'company',...c})),...claims('title').map(c=>({field:'title',...c})),...claims('location').map(c=>({field:'location',...c}))]),identities:sorted(group.map(e=>({kind:e.kind,sourceKey:stableId('source',e.kind+':'+e.key),postingUrl:safeUrl(e.raw.url),requisition:e.requisition,source:e.sourceRef}))),scores:sorted(scoreClaims),statusClaims:sorted(group.filter(e=>e.kind!=='discovery').map(e=>status(e.raw.status,e.kind,states,e.sourceRef))),eligibility:sorted(group.filter(e=>typeof e.raw.eligibility==='string').map(e=>({value:['excluded','needs_information','review_required','eligible'].includes(e.raw.eligibility)?e.raw.eligibility:'unknown',source:e.sourceRef}))),availability:sorted(availability),sources:sorted(group.map(e=>e.sourceRef))});
 }
 const history=available('statusHistory'),parsedHistory=history?parseStatusLog(history.data,states):null;
 const historyTimelines=parsedHistory?replayObservations(parsedHistory.observations.filter(o=>!parsedHistory.unknownSources.some(u=>u.num===o.num&&u.source===o.source))):new Map();
 const engaged=new Set(['application_started','awaiting_approval','submitted','responded','assessment','interviewing','offer','hired','rejected','failed','needs_information']);
 const ledgerEntries=entries.filter(e=>e.kind==='ledger'&&(engaged.has(AUTOMATION[e.raw.status])||(ledger.data.events||[]).some(o=>o?.jobKey===e.key&&(engaged.has(AUTOMATION[o.to])||['SubmissionDispatched','NativeSubmissionResponse'].includes(o.type)))||e.raw.lastPreparation||e.raw.activeAttempt||e.raw.lastSubmission||e.raw.activeSubmission)),appByLedgerKey=new Map(),appByTrackerNum=new Map();
 function createApplication(group){const first=group.find(e=>e.kind==='ledger')||group[0],id=stableId('application',first.kind+':'+first.key+(first.kind==='tracker'?':'+first.jobId:''));
  const statuses=group.map(e=>status(e.raw.status,e.kind,states,e.sourceRef));const unique=[...new Set(statuses.map(s=>s.normalized))];if(unique.length>1)conflict('APPLICATION_STATUS_CONFLICT',id,group.map(e=>e.sourceRef));
  const uncertain=group.some(e=>e.raw.activeSubmission?.attempted||e.raw.lastSubmission?.mayHaveBeenAccepted),verification=group.some(e=>e.raw.lastSubmission?.verificationRequired);
  const record={id,jobId:first.jobId,status:unique.length===1?unique[0]:'conflicted',statusClaims:sorted(statuses),submissionState:uncertain?'uncertain':verification?'verification_required':statuses.some(s=>s.normalized==='submitted')?'reported_submitted':'unknown',independentlyVerified:false,sources:sorted(group.map(e=>e.sourceRef))};record.trackerNumber=group.filter(e=>e.kind==='tracker').length===1&&trackerRows.filter(e=>e.key===group.find(e=>e.kind==='tracker')?.key).length===1?Number(group.find(e=>e.kind==='tracker').key):null;applications.push(record);
  if(record.status==='conflicted')pendingReviews.push({id:stableId('review',id+':status'),applicationId:id,reason:'status_conflict',source:first.sourceRef});
  for(const e of group){if(e.kind==='ledger')appByLedgerKey.set(e.key,record);else appByTrackerNum.set(e.key,(appByTrackerNum.get(e.key)||[]).concat(record));}
  return record;
 }
 const attachedTrackers=new Set();
 for(const e of ledgerEntries){const candidates=trackerRows.filter(t=>t.jobId===e.jobId&&(!t.requisition||!e.requisition||t.requisition===e.requisition));
  const peers=ledgerEntries.filter(x=>x.jobId===e.jobId);if(candidates.length===1&&peers.length===1){createApplication([e,candidates[0]]);attachedTrackers.add(candidates[0]);}else{createApplication([e]);if(candidates.length||peers.length>1)conflict('APPLICATION_LINK_AMBIGUOUS',e.jobId,[e,...candidates,...peers].map(x=>x.sourceRef));}
 }
 for(const e of trackerRows)if(!attachedTrackers.has(e)&&(engaged.has(LEGACY[resolveCanonicalState(e.raw.status,states)])||(historyTimelines.get(Number(e.key))||[]).some(o=>engaged.has(LEGACY[o.to]))))createApplication([e]);
 for(const num of new Set(trackerRows.map(e=>e.key))){const rows=trackerRows.filter(e=>e.key===num);if(rows.length>1)conflict('DUPLICATE_TRACKER_NUMBER',stableId('tracker-number',num),rows.map(e=>e.sourceRef));}
 const attemptBindings=new Map();
 const applicationIds=new Set();for(const app of applications){if(applicationIds.has(app.id))app.id=stableId('application',app.id+JSON.stringify(app.sources));applicationIds.add(app.id);}
 for(const e of ledgerEntries){const app=appByLedgerKey.get(e.key),seen=new Set();for(const field of ['lastPreparation','activeAttempt','lastSubmission','activeSubmission']){const a=e.raw[field];if(!a||typeof a!=='object')continue;const key=a.id||a.attemptId||field,identity=(field.includes('Submission')?'submission:':'preparation:')+key;
   if(seen.has(identity))continue;seen.add(identity);const id=stableId('attempt',app.id+':'+identity),dispatched=a.attempted===true||!!date(a.dispatchedAt),http=Number.isInteger(a.nativeResponse?.status)?a.nativeResponse.status:null;
   const receipt=a.confirmation,receiptRecorded=field==='lastSubmission'&&dispatched&&http>=200&&http<300&&receipt?.status==='confirmed'&&receipt.source==='browser_confirmation'&&receipt.nativeRequestAccepted===true&&receipt.confirmationPageVerified===true&&!!date(receipt.observedAt)&&typeof receipt.textHash==='string'&&/^[a-f0-9]{64}$/.test(receipt.textHash)&&typeof receipt.reference==='string';
   const state=a.mayHaveBeenAccepted||field==='activeSubmission'&&dispatched?'uncertain':http===428||a.verificationRequired?'verification_required':receiptRecorded?'receipt_recorded':dispatched?'dispatched_unconfirmed':'prepared';
   attemptBindings.set(id,{applicationKey:e.key,rawAttemptId:key,identityKnown:typeof(a.id||a.attemptId)==='string',entry:e});
   const r=ref(e.source,e.sourceRef.locator+'/'+field);attempts.push({id,applicationId:app.id,kind:field.includes('Submission')?'submission':'preparation',state,dispatchedAt:date(a.dispatchedAt),finishedAt:date(a.finishedAt),httpStatus:http,source:r});
   if(state==='receipt_recorded'&&!['uncertain','verification_required'].includes(app.submissionState))app.submissionState='receipt_recorded';
   if(['uncertain','verification_required','dispatched_unconfirmed'].includes(state)){if(app.submissionState!=='uncertain')app.submissionState=state;pendingReviews.push({id:stableId('review',id),applicationId:app.id,reason:state,source:r});}
   if(receiptRecorded)evidence.push({id:stableId('evidence',id),applicationId:app.id,kind:'recorded_browser_receipt',occurredAt:date(receipt.observedAt),reviewRequired:true,independentlyVerified:false,source:r});
  }
 }
 // Preserve prior attempts/transitions from durable events, not only latest summaries.
 if(ledger)for(const [i,event]of (ledger.data.events||[]).entries()){
  if(!event||typeof event!=='object')continue;const app=appByLedgerKey.get(event.jobKey);if(!app)continue;
  const eventKinds={UserApprovedOneSubmission:'submission_approval_recorded',SubmissionDispatched:'submission_dispatch_recorded',NativeSubmissionResponse:'native_response_recorded',VerificationContinuationRequired:'verification_required'};
  const kind=eventKinds[event.type]||(AUTOMATION[event.to]?'state_transition':null);if(!kind)continue;
  const r=ref(ledger,`/events/${i}`),when=date(event.at),eventId=stableId('evidence','event:'+JSON.stringify([event.jobKey,event.id||i,kind]));
  const observation={id:eventId,applicationId:app.id,kind,occurredAt:when,reviewRequired:true,independentlyVerified:false,source:r};if(AUTOMATION[event.to])observation.status=AUTOMATION[event.to];evidence.push(observation);
  const key=event.submissionAttemptId||event.attemptId;if(typeof key!=='string')continue;
  const submission=typeof event.submissionAttemptId==='string',id=stableId('attempt',app.id+':'+(submission?'submission:':'preparation:')+key),existing=attempts.find(a=>a.id===id),http=Number.isInteger(event.status)&&event.status>=100&&event.status<=599?event.status:null;
  if(!attemptBindings.has(id))attemptBindings.set(id,{applicationKey:event.jobKey,rawAttemptId:key,entry:ledgerEntries.find(e=>e.key===event.jobKey)});
  if(!existing)attempts.push({id,applicationId:app.id,kind:submission?'submission':'preparation',state:submission?(event.type==='UserApprovedOneSubmission'?'approved':http===428?'verification_required':'dispatched_unconfirmed'):'prepared',dispatchedAt:event.type==='SubmissionDispatched'?when:null,finishedAt:null,httpStatus:http,source:r});
  else {
   if(event.type==='SubmissionDispatched'){existing.dispatchedAt||=when;if(existing.state==='approved')existing.state='dispatched_unconfirmed';}
   if(http!==null){if(existing.httpStatus!==null&&http!==existing.httpStatus){conflict('ATTEMPT_RESPONSE_CONFLICT',id,[existing.source,r]);app.submissionState='uncertain';}else{existing.httpStatus=http;if(http===428)existing.state='verification_required';else if(existing.state==='approved')existing.state='dispatched_unconfirmed';}}
  }
 }
 if(history){const parsed=parsedHistory;for(const x of parsed.unparseable)warn('STATUS_HISTORY_UNPARSEABLE','statusHistory',`line:${x.line}`);if(parsed.unknownSources.length)warn('STATUS_HISTORY_UNKNOWN_SOURCE','statusHistory');
  for(const [num,timeline]of historyTimelines){const apps=appByTrackerNum.get(String(num))||[];if(apps.length!==1){warn('STATUS_HISTORY_APPLICATION_UNRESOLVED','statusHistory');continue;}
   for(const [i,o]of timeline.entries())evidence.push({id:stableId('evidence',JSON.stringify(['history',num,i,o.date,o.to])),applicationId:apps[0].id,kind:'status_observation',occurredAt:o.date,reviewRequired:false,independentlyVerified:false,source:ref(history,`tracker:${num}/effective:${i}`),status:LEGACY[o.to]||'unknown'});
   const latest=timeline.at(-1);if(latest&&apps[0].statusClaims.some(c=>c.source.sourceId==='tracker'&&c.normalized!==(LEGACY[latest.to]||'unknown')))conflict('TRACKER_HISTORY_CONFLICT',apps[0].id,[ref(history,`tracker:${num}`),...apps[0].sources]);
  }
 }
 if(ledger){const inbox=ledger.data.emailInbox||{},events=ledger.data.events||[],mail=new Map();for(const [key,o]of Object.entries(inbox))if(CATEGORIES.has(o?.category))mail.set(o.messageKey||key,o);
  for(const o of events)if(o?.type==='EmailObservation'&&CATEGORIES.has(o.category)&&!mail.has(o.messageKey||o.id))mail.set(o.messageKey||o.id,o);
  for(const [key,o]of [...mail].sort(([a],[b])=>String(a)<String(b)?-1:1)){const app=appByLedgerKey.get(o.jobKey);if(!app){warn('EMAIL_APPLICATION_UNRESOLVED','ledger');continue;}const r=ref(ledger,'/emailInbox/'+hash(String(key))),id=stableId('evidence','email:'+String(key));evidence.push({id,applicationId:app.id,kind:'email_'+o.category,occurredAt:date(o.receivedAt),reviewRequired:true,independentlyVerified:false,source:r});pendingReviews.push({id:stableId('review',id),applicationId:app.id,reason:'email_'+o.category,source:r});}
 }
 for(const a of attempts)if(['uncertain','verification_required','dispatched_unconfirmed'].includes(a.state)){const app=applications.find(x=>x.id===a.applicationId);if(app&&['unknown','reported_submitted'].includes(app.submissionState))app.submissionState=a.state;if(!pendingReviews.some(r=>r.id===stableId('review',a.id)))pendingReviews.push({id:stableId('review',a.id),applicationId:a.applicationId,reason:a.state,source:a.source});}
 const uniqueEvidence=[];const evidenceIds=new Set();for(const item of evidence){if(evidenceIds.has(item.id)){warn('DUPLICATE_EVIDENCE_ID',item.source.sourceId,item.source.locator);continue;}evidenceIds.add(item.id);uniqueEvidence.push(item);}
 const policy=available('policy')?.data,profileSources=[];for(const name of ['profile','applicationProfile','careerProfile']){const s=available(name);if(!s)continue;let verified=0,unverified=0;const visit=x=>{if(!x||typeof x!=='object')return;if(Object.hasOwn(x,'verified'))x.verified===true?verified++:unverified++;if(x.review_status) x.review_status==='verified'?verified++:unverified++;for(const v of Object.values(x))if(v&&typeof v==='object')visit(v);};visit(s.data);profileSources.push({sourceId:name,revision:s.revision||null,verifiedFacts:name==='profile'?null:verified,unverifiedFacts:name==='profile'?null:unverified});}
 const config=available('profile')?.data,ap=available('applicationProfile')?.data;
 for(const [field,a,b]of [['email',config?.candidate?.email,ap?.personal?.email?.value],['full_name',config?.candidate?.full_name,[ap?.personal?.first_name?.value,ap?.personal?.last_name?.value].filter(Boolean).join(' ')]])if(a&&b&&String(a).trim().toLowerCase()!==String(b).trim().toLowerCase())conflict('PROFILE_FIELD_CONFLICT',stableId('profile-field',field),[ref(available('profile'),'/candidate/'+field),ref(available('applicationProfile'),'/personal')]);
 const assessment=available('assessments');let deadlines=null;
 if(assessment){deadlines=[];if(assessment.data.malformed.length)warn('ASSESSMENT_ROWS_UNPARSEABLE','assessments');for(const [i,a]of foldTakeHomes(assessment.data.rows).entries()){
  if(a.submittedAt)continue;const at=isOffsetDateTime(a.deadline)?date(a.deadline):null;if(a.deadline&&!at)warn('ASSESSMENT_DEADLINE_UNKNOWN','assessments');
  const matches=a.reportNum?trackerRows.filter(e=>extractTrackerReportNumbers(e.raw.report,e.raw.notes).some(n=>Number(n)===Number(a.reportNum))):[];
  const number=matches.length===1&&trackerRows.filter(e=>e.key===matches[0].key).length===1?Number(matches[0].key):null;
  deadlines.push({id:stableId('deadline',JSON.stringify([a.company,a.reportNum,a.subject])),at,company:text(a.company),trackerNumber:number,source:ref(assessment,`effective:${i}`)});
 }}
 const schedule=available('schedule')?.data;const automation={readOnly:true,executionSupported:false,mode:['approval','discovery','autonomous'].includes(policy?.mode)?policy.mode:null,submissionEnabled:typeof policy?.submissionEnabled==='boolean'?policy.submissionEnabled:null,killSwitch:typeof policy?.killSwitch==='boolean'?policy.killSwitch:null,autonomousAuthorizationRecorded:policy?policy.autonomousAuthorization!=null:null,schedule: schedule?{jobs:schedule.jobs.length,queued:schedule.queue.length,runs:schedule.runs.length,activeJobs:schedule.jobs.filter(j=>j.status==='active').length,pausedJobs:schedule.jobs.filter(j=>j.status==='paused').length,runningRuns:schedule.runs.filter(r=>r.state==='running').length,failedRuns:schedule.runs.filter(r=>r.state==='failed').length,nextRunAt:schedule.jobs.filter(j=>j.status==='active').map(j=>date(j.nextRunAt||j.startAt)).filter(Boolean).sort()[0]||null,lastRunAt:schedule.runs.map(r=>date(r.at)).filter(Boolean).sort().at(-1)||null}:null};
 const operationalEvidence=projectOperationalEvidence({sources,asOf,attempts,bindings:attemptBindings,applications,pendingReviews,idFor:stableId,warn,conflict});
 const metadata=sources.map(s=>{const observedAt=date(s.observedAt),age=observedAt?(now-Date.parse(observedAt))/3600000:null;return {id:s.id,state:s.state,revision:s.revision||null,observedAt,ageHours:age!==null&&age>=0?age:null,freshness:age===null?'unknown':age<0?'future':age>staleAfterHours?'stale':'current',ownership:s.ownership||'source',coverage:s.coverage||'unknown'};});
 for(const s of metadata)if(['future','stale'].includes(s.freshness))warn('SOURCE_'+s.freshness.toUpperCase(),s.id);
 const result={schemaVersion:1,operationalEvidence,asOf,consistency,sources:sorted(metadata),jobs:sorted(jobs),applications:sorted(applications),attempts:sorted(attempts),evidence:sorted(uniqueEvidence),conflicts:sorted([...new Map(conflicts.map(x=>[x.id,x])).values()]),warnings:sorted(warnings),pendingReviews:sorted(pendingReviews),deadlines:deadlines===null?null:sorted(deadlines),profile:{sources:sorted(profileSources),timeBudgetMinutes:null},mailbox:{configured:available('outlook')?true:byId.get('outlook')?.state==='missing'?false:null,authenticationValidated:false,syncFreshness:'unknown',codeUseSupported:false},automation,counts:{jobs:jobs.length,applications:applications.length,submittedClaims:applications.filter(a=>a.statusClaims.some(s=>s.normalized==='submitted')).length,recordedReceipts:applications.filter(a=>a.submissionState==='receipt_recorded').length,uncertainSubmissions:applications.filter(a=>['uncertain','verification_required','dispatched_unconfirmed'].includes(a.submissionState)).length,confirmedSubmissions:null,responseRate:null}};
 return result;
}
