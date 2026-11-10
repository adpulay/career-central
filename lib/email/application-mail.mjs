import {createHash,randomUUID} from 'node:crypto';
import {updateLedger} from '../applications/store.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const address=x=>String(x?.emailAddress?.address||'').toLowerCase();
const forbidden=/password|reset your|reset code|account recovery|Microsoft account|Google account|security info|MFA|multi.factor|two.factor|authenticator|sign[ -]?in|log[ -]?in|enroll(?:ment)?/i;
const bodyText=m=>String(m.body?.content||'').slice(0,100000).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ');
export function envelopeMatches(message,config,job,rule,now=Date.now()){
 if(!job||!rule||rule.jobKey!==job.key||!Array.isArray(rule.senders)||!rule.senders.length||message.isDraft)return false;
 const sender=address(message.from),recipients=[...(message.toRecipients||[]),...(message.ccRecipients||[])].map(address),time=Date.parse(message.receivedDateTime),start=Date.parse(job.lastSubmission?.dispatchedAt||job.activeSubmission?.dispatchedAt||job.createdAt);
 return rule.senders.includes(sender)&&(!message.sender||address(message.sender)===sender)&&recipients.includes(config.account.toLowerCase())&&Number.isFinite(time)&&Number.isFinite(start)&&time>=start&&time<=now+30000;
}
export function analyzeMessage(message,config,jobs,now=Date.now()){
 const subject=String(message.subject||''),text=subject+'\n'+bodyText(message);
 if(forbidden.test(text))return {category:'excluded_authentication',matched:false};
 const matches=[];
 for(const rule of config.rules||[]){const job=jobs[rule.jobKey];if(!envelopeMatches(message,config,job,rule,now))continue;
  const refs=[job.requisitionId,job.requisitionGroup?.split(':').slice(1).join(':')].filter(Boolean);
  try{const u=new URL(job.url);const id=u.pathname.match(/\/jobs\/(\d+)/)?.[1]||u.searchParams.get('gh_jid');if(id)refs.push(id);}catch{}
  const hasRef=refs.some(r=>new RegExp('(^|[^a-z0-9])'+r.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z0-9]|$)','i').test(text));
  const company=String(job.company||'').toLowerCase(),hasCompany=company.length>=3&&text.toLowerCase().includes(company);
  const session=job.activeVerification,received=Date.parse(message.receivedDateTime),requested=Date.parse(session?.requestedAt),expires=Date.parse(session?.expiresAt);
  const active=session?.jobKey===job.key&&session?.expectedSender===address(message.from)&&session?.purpose==='application_email_verification'&&Number.isFinite(requested)&&Number.isFinite(expires)&&expires>now&&expires-requested<=15*60*1000&&received>=requested&&received<=expires;
  if(hasCompany&&(hasRef||active))matches.push({job,active});
 }
 if(matches.length!==1)return {category:matches.length?'ambiguous':'unmatched',matched:false};
 const {job,active}=matches[0];let category='recruiter_update';
 if(/(?:application|applicant).{0,80}(?:verification|verify|security code)|(?:verification|security) code.{0,80}application/is.test(text))category='verification';
 else if(/(?:received|submitted|thank you for).{0,60}(?:your )?(?:application|applying)|application.{0,40}(?:received|successfully submitted)/is.test(text))category='application_confirmation';
 else if(/assessment|coding challenge|technical exercise|online test/i.test(text))category='assessment';
 else if(/interview|schedule.{0,30}(?:call|conversation)/i.test(text))category='interview';
 else if(/not.{0,20}moving forward|unfortunately|not selected/i.test(text))category='rejection';
 // A From address and message headers are signals, not proof of authenticity.
 // No initial integration path may authorize or reveal a code based on these.
 const codeCandidates=category==='verification'&&active?[...text.matchAll(/(?:verification|security|application)\s+code\s*(?:is|:)?\s*([0-9]{6,10})(?![0-9])/gi)].map(m=>m[1]):[];
 return {matched:true,jobKey:job.key,category,receivedAt:message.receivedDateTime,activeApplicationSession:!!active,hasUniqueCode:category==='verification'&&new Set(codeCandidates).size===1,codeUseAllowed:false,senderAuthentication:'not-live-validated',requiresReview:true,proposedStatus:category==='application_confirmation'?'Submitted':category==='interview'?'Interviewing':category==='rejection'?'Rejected':null};
}
export async function inspectMailbox({client,config,ledger,since,now=Date.now(),until=new Date(now).toISOString()}){
 const page=await client.list({since,until,maxPages:config.maxPages||5}),observations=[];let skipped=0;
 for(const message of page.messages){const messageKey=hash(config.account.toLowerCase()+'\0'+message.id);if(ledger.emailInbox?.[messageKey]){skipped++;continue;}
  if(!(config.rules||[]).some(rule=>envelopeMatches(message,config,ledger.jobs[rule.jobKey],rule,now)))continue;
  const detail=await client.detail(message.id);if(detail.id!==message.id)throw Error('Graph message identity mismatch');
  const result=analyzeMessage(detail,config,ledger.jobs,now);if(result.matched)observations.push({messageKey,...result});
 }
 return {observations,duplicatesSkipped:skipped,hasMore:page.hasMore};
}
export async function recordMailObservations(root,observations){
 return updateLedger(root,ledger=>{ledger.emailInbox||={};let added=0;
  for(const o of observations){if(!ledger.jobs[o.jobKey]||ledger.emailInbox[o.messageKey])continue;
   // Explicit allow-list: no subject, body, code, token, attachment, or external URL.
   const evidence={id:randomUUID(),type:'EmailObservation',source:'microsoft_graph',messageKey:o.messageKey,jobKey:o.jobKey,category:o.category,receivedAt:o.receivedAt,observedAt:new Date().toISOString(),requiresReview:true,senderAuthentication:'not-live-validated',codeUseAllowed:false,proposedStatus:o.proposedStatus||null};
   ledger.emailInbox[o.messageKey]=evidence;ledger.events.push(evidence);const job=ledger.jobs[o.jobKey];job.emailObservationIds||=[];job.emailObservationIds.push(evidence.id);added++;
  }return {added,statusChanges:0,codeUses:0};
 });
}
