// Preparation-only browser boundary. There is deliberately no submit capability.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {inspectPdfUpload} from './upload-policy.mjs';
import { greenhouseTarget,fillGreenhouse,hashPlan } from './greenhouse.mjs';
export function validateResumes(root,profile,policy){
 return {...profile,resumeVersions:(profile.resumeVersions||[]).filter(r=>r.approved===true&&policy.approvedResumeHashes?.includes(r.sha256)).map(r=>{
  const file=fs.realpathSync(path.resolve(root,r.path)),bytes=fs.readFileSync(file);
  if(createHash('sha256').update(bytes).digest('hex')!==r.sha256)throw Error('Approved resume content changed; reapproval required');
  if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Approved resume is not a PDF');
  return {...r,path:file};
 })};
}
export function validateSavedPlan(saved,url,now=Date.now()){
 const target=greenhouseTarget(url),at=Date.parse(saved?.observedAt);
 if(saved?.url!==url||!Number.isFinite(at)||at>now+60000||now-at>30*60*1000)throw Error('Inspect exact posting again: missing, future or stale plan');
 if(String(saved.plan?.postingId)!==target.id||saved.plan?.board!==target.board||hashPlan(saved.plan)!==saved.plan.planHash)throw Error('Plan identity or integrity mismatch');
 return saved.plan;
}
export async function prepareBrowser(browser,url,plan,{isStopped=()=>false,uploadAuthorization=null,submissionController=null,timezoneId=undefined}={}){
 const expected=greenhouseTarget(url);
 if(plan.board!==expected.board||String(plan.postingId)!==expected.id)throw Error('Plan/posting mismatch');
 if(isStopped())throw Error('Kill switch active');
 const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,...(timezoneId?{timezoneId}: {})});
 let phase='loading';const traffic=[];let uploadUsed=false,resolveUpload,pendingUpload=null;const browserErrors=[];
 context.on('response',async response=>{
  if(!pendingUpload||response.request()!==pendingUpload.request)return;
  await response.finished().catch(()=>{});
  const evidence={remoteUploadConfirmed:response.status()>=200&&response.status()<300,status:response.status(),host:pendingUpload.host,sha256:pendingUpload.sha256,bytes:pendingUpload.bytes,observedAt:new Date().toISOString()};
  try{const xml=await response.text();const raw=xml.match(/<Location>([^<]+)<\/Location>/)?.[1];if(raw){const parsed=new URL(raw.replaceAll('&amp;','&'));if(parsed.protocol==='https:'&&parsed.hostname===pendingUpload.host)evidence.storageUrl=parsed.href;}}catch{}
  traffic.push({phase,host:pendingUpload.host,path:'/',method:'POST',blocked:false,reason:'explicit_pdf_only_authorization',responseStatus:response.status()});
  resolveUpload(evidence);
 });
 context.on('requestfailed',request=>{if(pendingUpload?.request===request)resolveUpload({remoteUploadConfirmed:false,reason:'Native PDF upload failed: '+request.failure()?.errorText});});
 const uploadResult=new Promise(resolve=>{resolveUpload=resolve;});
 const waitForResumeUpload=async()=>{let timer;try{return await Promise.race([uploadResult,new Promise(resolve=>{timer=setTimeout(()=>resolve({remoteUploadConfirmed:false,reason:'Upload confirmation timed out'}),15000);})]);}finally{clearTimeout(timer);}};
 context.on('response',response=>submissionController?.observe(response).catch(()=>{}));
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  let reason=null;
  if(submissionController?.armed){
   try{const decision=await submissionController.routeDecision(req);if(decision){traffic.push({phase,host:u.hostname,path:u.pathname,method:req.method(),blocked:!decision.allow,reason:decision.reason});return decision.allow?route.continue():route.abort();}}catch(e){traffic.push({phase,host:u.hostname,path:u.pathname,method:req.method(),blocked:true,reason:e.message});return route.abort();}
  }
  if(isStopped())reason='kill_switch';
  else if(phase!=='loading'){
   if(req.method()==='GET'&&!u.search&&u.hostname==='job-boards.cdn.greenhouse.io'&&/^\/assets\/[A-Za-z0-9_.-]+\.(webp|png|svg|woff2|css|js)$/.test(u.pathname)){traffic.push({phase,host:u.hostname,path:u.pathname,method:'GET',blocked:false,reason:'static_non_personal_asset'});return route.continue();}
   if(req.method()==='POST'&&u.hostname==='grnhse-prod-jben-us-east-1.s3.amazonaws.com'){
    const inspection=inspectPdfUpload({url:req.url(),method:req.method(),contentType:req.headers()['content-type'],body:req.postDataBuffer()},uploadAuthorization);
    if(inspection.allowed&&!uploadUsed&&uploadAuthorization.jobUrl===url){
     uploadUsed=true;
     if(isStopped()){resolveUpload({remoteUploadConfirmed:false,reason:'Kill switch active'});return route.abort();}
     pendingUpload={request:req,host:u.hostname,sha256:inspection.sha256,bytes:inspection.bytes};
     // Keep the browser's native upload/progress/CORS handling. Any redirected
     // request is independently routed and rejected after this one allowance.
     return route.continue();
    }
    resolveUpload({remoteUploadConfirmed:false,reason:inspection.reason||'Upload authorization already used',deniedField:inspection.field,tokenBytes:inspection.tokenBytes,tokenShape:inspection.tokenShape});
    traffic.push({phase,host:u.hostname,path:u.pathname,method:req.method(),blocked:true,reason:inspection.reason,deniedField:inspection.field,tokenBytes:inspection.tokenBytes,tokenShape:inspection.tokenShape});
   }
   reason='private_fill_network_frozen';
  }
  else if(!['GET','HEAD'].includes(req.method()))reason='write_request_blocked';
  else if(u.protocol!=='https:')reason='insecure_request';
  else if(req.isNavigationRequest()&&req.frame()===page?.mainFrame()){
   try{const target=greenhouseTarget(u.href);if(target.board!==expected.board||target.id!==expected.id)reason='unexpected_redirect';}catch{reason='unexpected_redirect';}
  }else if(!/(^|\.)(greenhouse\.io|greenhouse\.com|grnhse\.io|gstatic\.com|recaptcha\.net)$/.test(u.hostname))reason='nonessential_external_resource';
  // Store no query strings, request bodies, tokens or personal field values.
  traffic.push({phase,host:u.hostname,path:u.pathname,method:req.method(),blocked:reason!==null,reason});
  return reason?route.abort():route.continue();
 });
 await context.routeWebSocket('**/*',socket=>socket.close());
 let page=await context.newPage();
 page.on('pageerror',e=>browserErrors.push({kind:'pageerror',message:e.message}));
 try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  const final=greenhouseTarget(page.url());if(final.board!==expected.board||final.id!==expected.id)throw Error('Unexpected posting redirect');
  await page.waitForSelector('input[id="first_name"],input[name="first_name"]',{state:'attached',timeout:15000});
  // Wait only for initial non-personal resources; never fill during loading.
  await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
  if(plan.jobTitle&&!(await page.title()).toLowerCase().includes(plan.jobTitle.toLowerCase()))throw Error('Employer job title does not match inspected posting');
  phase='private_fill';
  const challenge=page.locator('iframe[src*="/bframe"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],input[type="password"]');
  let activeChallenge=false;for(const item of await challenge.all())if(await item.isVisible())activeChallenge=true;
  const captchaPresent=await page.locator('iframe[src*="recaptcha"],textarea[name="g-recaptcha-response"]').count()>0;
  if(activeChallenge)return {context,page,result:{status:'Needs Information',submitted:false,traffic,captchaPresent,unresolved:[{reason:'Active security challenge or login detected; no fill attempted'}]}};
  if(isStopped())throw Error('Kill switch active');
  const result=await fillGreenhouse(page,plan,{isStopped,waitForResumeUpload});
  return {context,page,result:{...result,traffic,browserErrors,captchaPresent,securityNote:'Passive CAPTCHA widgets untouched; no challenge solved and no submit action invoked',networkFrozenBeforePersonalData:true}};
 }catch(e){e.preparationTraffic=traffic;await context.close();throw e;}
}
