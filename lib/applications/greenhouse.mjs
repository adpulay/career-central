import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const hosts=new Set(['boards.greenhouse.io','job-boards.greenhouse.io','job-boards.eu.greenhouse.io']);
export function greenhouseTarget(url){
 const u=new URL(url);if(u.protocol!=='https:'||!hosts.has(u.hostname)||u.username||u.password||u.port)throw Error('Unsupported Greenhouse URL');
 const m=u.pathname.match(/^\/([a-zA-Z0-9_-]+)\/jobs\/(\d+)\/?$/);if(!m)throw Error('Unrecognized Greenhouse posting URL');
 return {board:m[1],id:m[2],api:`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}?questions=true`};
}
export function readVerified(profile,key){
 let x=profile;for(const k of key.split('.'))x=x?.[k];
 return x?.verified===true&&x.provisional!==true&&x.value!=null&&String(x.value).trim()!==''?x.value:null;
}
const normalize=s=>String(s??'').replace(/[\s*]+/g,' ').trim().toLowerCase();
const fieldPaths={first_name:'personal.first_name',last_name:'personal.last_name',email:'personal.email',phone:'personal.phone',country:'personal.country',school_name:'education.0.institution',degree:'education.0.degree',discipline:'education.0.discipline'};
export function standardAnswer(label,profile){
 const q=normalize(label).replace(/\?$/,'');
 // Citizenship does not establish export, clearance, investigation consent or demographic facts.
 if(/\b(canada|united kingdom|germany|australia)\b/.test(q)&&/sponsor|authorized|eligible|visa/.test(q))return null;
 if(/\b(authorized|eligible)\b.*\b(and|or)\b|\b(and|or)\b.*\b(authorized|eligible)\b/.test(q)&&/sponsor/.test(q))return null;
 if(q==='pronouns'){const value=readVerified(profile,'personal.pronouns');return value===null?null:{value,provenance:'personal.pronouns'};}
 if(/clearance|classified|export|itar|\bear\b|background|investigation|u\.?s\.? person|pronoun|gender|veteran|disabilit|ethnic|race\b/.test(q))return null;
 let key;
 if(/^(linkedin|linkedin (profile|url)|linkedin profile url)$/.test(q))key='personal.linkedin';
 else if(/^(preferred name|preferred first name)$/.test(q))key='personal.preferred_name';
 else if(/^(country|country of residence)$/.test(q))key='personal.country';
 else if(/^(which u\.s\. state or canadian province do you reside in|state(?: of residence)?|state\/province)$/.test(q))key='personal.region';
 else if(/^(are you (legally )?(authorized|eligible) to work in (the )?(united states|u\.?s\.?a?\.?)( without restriction)?|do you have (unrestricted )?(legal )?(authorization|the right) to work in (the )?(united states|u\.?s\.?))$/.test(q))key='authorization.us_work_authorized';
 else if(/\b(require|need)\b.*\b(sponsorship|sponsor)\b/.test(q)&&/\b(work|employment|immigration|visa|h-?1b|authorization)\b/.test(q)&&!(/\bnot\b|\band\b.*\b(authorized|eligible)\b/.test(q))){
  key=/future|ever|now or|now.*future/.test(q)?'authorization.future_sponsorship_required':'authorization.current_sponsorship_required';
 }else if(/^(are you a (united states|u\.?s\.?) citizen|u\.?s\.? citizenship)$/.test(q)){
  const citizenship=readVerified(profile,'authorization.citizenship');return citizenship===null?null:{value:/united states citizen/i.test(citizenship),provenance:'authorization.citizenship'};
 }else if(/^(university|school|university name|college\/university)$/.test(q))key='education.0.institution';
 else if(/^(degree|degree earned|degree program)$/.test(q))key='education.0.degree';
 else if(/^(major|field of study|discipline)$/.test(q))key='education.0.discipline';
 else if(/^(gpa|cumulative gpa|most recent gpa|please indicate your most recent gpa)$/.test(q)){
  const g=readVerified(profile,'education.0.gpa');return g===null?null:{value:g.value,provenance:'education.0.gpa'};
 }else if(/^(graduation year|expected graduation year)$/.test(q)){
  const m=readVerified(profile,'education.0.graduation_month');return m?{value:m.slice(0,4),provenance:'education.0.graduation_month'}:null;
 }else if(/^(graduation date|expected graduation date|graduation month|please confirm your graduation date:?)$/.test(q))key='education.0.graduation_month';
 else if(/^(are you willing to relocate|willing to relocate)$/.test(q))key='standardAnswers.relocation';
 else if(/^(earliest start date|available start date|when can you start)$/.test(q))key='standardAnswers.full_time_start';
 if(!key)return null;const value=readVerified(profile,key);return value===null?null:{value,provenance:key};
}
function selectAnswer(field,answer){
 const values=field.values||[];
 if(field.type==='checkbox'&&typeof answer.value==='boolean')return {...answer,displayValue:String(answer.value)};
 if(['multi_value_single_select','multi_value_multi_select','select','radio'].includes(field.type)){
  const desired=typeof answer.value==='boolean'?(answer.value?'Yes':'No'):String(answer.value);
  let matches=values.filter(v=>normalize(v.label)===normalize(desired));
  if(!matches.length&&/bachelor/i.test(desired))matches=values.filter(v=>/bachelor/i.test(v.label));
  if(matches.length!==1)return null;
  return {...answer,value:String(matches[0].value),displayValue:matches[0].label};
 }
 if(['input_text','textarea','input_email','input_tel','input_number'].includes(field.type))return {...answer,displayValue:String(answer.value)};
 return null;
}
export function planGreenhouse(schema,profile){
 if(!schema||!Array.isArray(schema.questions))throw Error('Missing application question schema');
 const fields=[],blocked=[],questions=[];
 const all=[...schema.questions];
 for(const [section,value]of Object.entries(schema))if(section!=='questions'&&/question/i.test(section)&&Array.isArray(value)){
  for(const q of value){if(Array.isArray(q.fields))all.push({...q,section});else blocked.push({question:section,label:q.label,reason:'Unsupported question section requires review'});}
 }
 for(const q of all){
  const options=Array.isArray(q.fields)?q.fields:[];
  questions.push({label:q.label,required:q.required===true,section:q.section||'questions',fields:options});
  const field=options.find(f=>f.name==='resume'&&f.type==='input_file')||options[0];
  if(!field){if(q.required)blocked.push({question:q.label,reason:'Question has no supported field schema'});continue;}
  let answer=fieldPaths[field.name]?{value:readVerified(profile,fieldPaths[field.name]),provenance:fieldPaths[field.name]}:standardAnswer(q.label,profile);
  if(field.name==='resume'){
   const r=profile.resumeVersions?.find(r=>r.approved===true&&r.sha256&&r.path);
   answer=r?{value:r.path,provenance:'approved resume version',resumeSha256:r.sha256}:null;
  }
  if(!answer||answer.value===null){
   const exact=profile.employerAnswers?.find(a=>String(a.postingId)===String(schema.id)&&a.board===schema.board&&a.question===q.label&&a.approved===true&&a.verified===true);
   answer=exact?{value:exact.value,provenance:'approved employer-specific answer'}:null;
  }
  const selected=answer?(field.type==='input_file'?answer:selectAnswer(field,answer)):null;
  fields.push({name:field.name,label:q.label,type:field.type,required:q.required===true,value:selected?.value??null,displayValue:selected?.displayValue,provenance:selected?.provenance??null,resumeSha256:selected?.resumeSha256,options:field.values||[]});
  if(q.required===true&&(!selected||selected.value===null))blocked.push({question:q.label,reason:'Verified answer, supported choice, or approved resume missing'});
 }
 const country=readVerified(profile,'personal.country');
 if(country!==null&&!fields.some(f=>f.name==='country'))fields.unshift({name:'country',label:'Country',type:'input_text',required:false,value:country,displayValue:country,provenance:'personal.country',browserOnly:true});
 const plan={schemaVersion:2,platform:'greenhouse',postingId:schema.id,board:schema.board,jobTitle:schema.title,questions,fields,blocked,readyForApproval:blocked.length===0,submissionEnabled:false};
 return {...plan,planHash:hashPlan(plan)};
}
export function hashPlan(plan){const {planHash,...payload}=plan;return createHash('sha256').update(JSON.stringify(payload)).digest('hex');}
export async function inspectControls(page){
 return page.locator('input,textarea,select').evaluateAll(els=>els.map(e=>{
  const label=e.labels?.[0]?.innerText||e.getAttribute('aria-label')||'';
  const rect=e.getBoundingClientRect(),style=getComputedStyle(e);
  let selected=null;for(let parent=e.parentElement,depth=0;parent&&depth<5;parent=parent.parentElement,depth++){const node=parent.querySelector('[class*=\"single-value\"],[class*=\"singleValue\"]');if(node){selected=node.textContent.trim();break;}if(parent.tagName==='FORM')break;}
  const proxy=!e.id&&!e.name&&!label&&!!e.closest('[class*=\"select\"]');
  return {id:e.id,name:e.name,tag:e.tagName,type:e.type,role:e.getAttribute('role'),label,required:e.required||e.getAttribute('aria-required')==='true'||/\*\s*$/.test(label),disabled:e.disabled,proxy,visible:rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none',pattern:e.pattern||null,min:e.min||null,max:e.max||null,maxLength:e.maxLength>0?e.maxLength:null,dependsOn:e.getAttribute('data-depends-on'),ariaControls:e.getAttribute('aria-controls'),options:e.options?[...e.options].map(o=>({label:o.label,value:o.value})):undefined,hasValue:e.type==='file'?e.files.length>0:!!e.value||!!selected};
 }));
}
async function fieldLocator(page,f){
 const byId=page.locator(`[id=${JSON.stringify(f.name)}]`);if(await byId.count()===1)return byId;
 const byName=page.locator(`[name=${JSON.stringify(f.name)}]`);if(await byName.count()===1)return byName;
 return null;
}
export async function validateForm(page,plan){
 const controls=await inspectControls(page),issues=[];
 for(const c of controls){
  if(!c.visible||c.disabled||c.proxy||/recaptcha|csrf|token|honeypot/i.test(c.name+' '+c.id))continue;
  if(c.required&&!c.hasValue)issues.push({question:c.label||c.id||c.name||'Unlabeled control',reason:'Visible required field is unanswered',field:c.id||c.name});
  if(c.required&&!plan.fields.some(f=>f.name===c.id||f.name===c.name))issues.push({question:c.label||c.id||c.name,reason:'Required browser control not present in reviewed schema'});
 }
 const errors=await page.locator('[aria-invalid="true"],[role="alert"],.error-message,.field-error').evaluateAll(els=>els.filter(e=>e.getClientRects().length&&e.textContent.trim()).map(e=>({text:e.textContent.trim(),id:e.id})).slice(0,30));
 for(const error of errors)issues.push({question:error.id||'Form error',reason:error.text});
 const native=await page.locator('input,textarea,select').evaluateAll(els=>els.filter(e=>e.getClientRects().length&&e.willValidate&&!e.validity.valid&&!( !e.id&&!e.name&&e.closest('[class*=\"select\"]'))).map(e=>({question:e.labels?.[0]?.innerText||e.id||e.name,reason:e.validationMessage})));issues.push(...native);
 return {controls,issues};
}
export async function fillGreenhouse(page,plan,{isStopped=()=>false,allowMissingResume=true,waitForResumeUpload=null}={}){
 if(isStopped())throw Error('Kill switch active');
 if(plan.platform!=='greenhouse'||plan.submissionEnabled!==false)throw Error('Invalid preparation-only plan');
 if(plan.schemaVersion>=2&&hashPlan(plan)!==plan.planHash)throw Error('Plan integrity mismatch');
 const unresolved=[...plan.blocked],populated=[],attachments=[],controlsBefore=await inspectControls(page);
 if(!allowMissingResume&&plan.fields.some(f=>f.name==='resume'&&f.required&&f.value===null))throw Error('Approved resume required');
 for(const f of plan.fields){
  if(isStopped())throw Error('Kill switch active');
  if(f.value===null)continue;
  const locator=await fieldLocator(page,f);
  if(!locator){if(f.required)unresolved.push({question:f.label,reason:'Field absent or ambiguous in browser'});continue;}
  try{
   const metadata=await locator.evaluate(e=>({tag:e.tagName,type:e.type,role:e.getAttribute('role')}));
   if(f.type==='input_file'){
    const bytes=fs.readFileSync(f.value);
    if(!f.resumeSha256||createHash('sha256').update(bytes).digest('hex')!==f.resumeSha256)throw Error('Approved resume bytes changed before attachment');
    await locator.setInputFiles({name:path.basename(f.value),mimeType:'application/pdf',buffer:bytes});
    const upload=waitForResumeUpload?await waitForResumeUpload():null;
    const attached=await page.locator('input[type=\"file\"]').evaluateAll(els=>els.flatMap(e=>[...e.files].map(x=>({name:x.name,size:x.size,type:x.type}))));
    if(upload?.remoteUploadConfirmed){
     const filename=page.getByText(path.basename(f.value),{exact:false});
     await filename.first().waitFor({state:'visible',timeout:10000}).catch(()=>{});
     const filenameVisible=await filename.count()>0;
     attachments.push({field:f.name,files:[{name:path.basename(f.value),size:bytes.length,type:'application/pdf'}],verifiedInBrowser:filenameVisible,...upload});
     if(!filenameVisible)throw Error('Remote PDF upload confirmed but attachment display was not confirmed');
    }else{
     attachments.push({field:f.name,files:attached,verifiedInBrowser:attached.length===1,remoteUploadConfirmed:false,reason:upload?.reason});
     if(upload||attached.length!==1)throw Error(upload?.reason||'Attachment triggered remote upload; remote success not confirmed');
    }
   }else if(metadata.tag==='SELECT')await locator.selectOption(String(f.value));
   else if(metadata.type==='checkbox'){
    if(typeof f.value!=='boolean')throw Error('Checkbox requires explicit verified boolean');await locator.setChecked(f.value);
   }else if(metadata.type==='radio')await locator.check();
   else if(metadata.role==='combobox'){
    await locator.click();
    let option=page.getByRole('option',{name:String(f.displayValue??f.value),exact:true});
    if(await option.count()!==1){
     await locator.fill(String(f.displayValue??f.value));
     if(f.name==='country'&&String(f.displayValue??f.value)==='United States')option=page.getByRole('option',{name:/^United States(?:\s*\+1)?$/});
     await option.waitFor({state:'visible',timeout:3000}).catch(()=>{});
    }
    if(await option.count()!==1)throw Error('Dropdown option unavailable or ambiguous; network lookup may be blocked');
    await option.click();
    const display=await locator.evaluate(e=>e.closest('[class*="select"]')?.textContent||e.parentElement?.parentElement?.textContent||e.value);
    const readback=(await inspectControls(page)).find(c=>c.id===f.name||c.name===f.name);
    if(!display.includes(String(f.displayValue??f.value))&&!readback?.hasValue)throw Error('Dropdown selection not confirmed in browser');
   }else await locator.fill(String(f.value));
   populated.push({field:f.name,label:f.label,type:f.type,provenance:f.provenance,verifiedInBrowser:true});
  }catch(e){unresolved.push({question:f.label,reason:`Browser field could not be populated: ${e.message}`});}
 }
 const validation=await validateForm(page,plan);unresolved.push(...validation.issues);
 return {status:unresolved.length?'Needs Information':'Awaiting Approval',unresolved,populated,attachments,controlsBefore,controlsAfter:validation.controls,planHash:plan.planHash,submitted:false,requiresExplicitSubmissionApproval:true};
}
