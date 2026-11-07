import {createHash} from 'node:crypto';
export function policyHash(policy){return createHash('sha256').update(JSON.stringify(policy)).digest('hex');}
export function validatePilotPolicy(policy){
 if(!Number.isInteger(policy.maxApplications)||policy.maxApplications<1||policy.maxApplications>5)throw Error('Pilot application cap must be between 1 and 5');
 if(!Number.isFinite(policy.minimumMatchScore)||policy.minimumMatchScore<85||policy.minimumMatchScore>100)throw Error('Pilot minimum score must be at least 85');
 if(policy.platform!=='greenhouse'||JSON.stringify(policy.countries)!==JSON.stringify(['United States']))throw Error('Pilot is restricted to Greenhouse and United States');
 if(!policy.approvedResumeSha256||!/^[a-f0-9]{64}$/.test(policy.approvedResumeSha256))throw Error('Approved unchanged resume hash required');
 return policy;
}
export function evaluatePilotCandidate(job,{policy,profile,ledger,authorization=null,mode='approval',transportValidated=false}={}){
 validatePilotPolicy(policy);const blockers=[];
 const a=authorization;
 if(mode!=='autonomous'||policy.autonomousEnabled!==true||policy.submissionEnabled!==true||a?.explicitlyEnabled!==true)blockers.push('Autonomous submission is disabled; separate explicit confirmation required');
 if(!a||a.policyHash!==policyHash(policy)||a.maxApplications!==policy.maxApplications||a.resumeSha256!==policy.approvedResumeSha256||a.startMonth!==policy.earliestFullTimeStartMonth||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=Date.now())blockers.push('No separate authorization bound to the limit, unchanged PDF, start date and policy');
 const start=profile.standardAnswers?.full_time_start;
 if(start?.verified!==true||start.provisional===true||start.value!==policy.earliestFullTimeStartMonth)blockers.push('June start remains provisional and must be confirmed before submission');
 if(!transportValidated)blockers.push('Submission and confirmation workflow has not been validated');
 if(job.provider!=='greenhouse')blockers.push('Platform is not Greenhouse');
 if(job.matchScore<policy.minimumMatchScore)blockers.push('Below minimum match score');
 if(!/\b(?:software|systems?|cloud|devops|platform|site reliability|infrastructure)\b.*\b(?:engineer|developer)\b|\bSRE\b/i.test(job.title))blockers.push('Outside approved engineering categories');
 if(/\b(senior|staff|principal|director|head|manager)\b/i.test(job.title))blockers.push('Seniority title is outside the entry-level pilot');
 if(profile.education?.[0]?.graduation_month?.verified!==true||profile.education[0].graduation_month.value!==policy.graduationMonth)blockers.push('Verified graduation month does not match the pilot');
 if(job.eligibility==='excluded'||job.eligibility==='needs_information')blockers.push('Existing eligibility review excludes or cannot confirm this job');
 if(job.availabilityCheck?.result!=='active')blockers.push('Active application link not verified');
 if(job.confirmedPilotEligibility?.seniority!==true||job.confirmedPilotEligibility?.graduation!==true||job.confirmedPilotEligibility?.usLocation!==true||job.confirmedPilotEligibility?.startDate!==true)blockers.push('Seniority, US placement, graduation and start compatibility are not all confirmed');
 if(profile.authorization?.us_work_authorized?.verified!==true||profile.authorization.us_work_authorized.value!==true||profile.authorization?.future_sponsorship_required?.verified!==true||profile.authorization.future_sponsorship_required.value!==false)blockers.push('Verified unrestricted authorization and no sponsorship required');
 const row=ledger.jobs[job.key];
 if(!row)blockers.push('Job not present in ledger');
 if(row&&['Submitted','Interviewing','Offer','Rejected'].includes(row.status))blockers.push('Existing application blocks duplicate submission');
 if(job.requisitionId&&Object.values(ledger.jobs).some(r=>r.key!==job.key&&r.requisitionGroup===`${job.company.toLowerCase()}:${job.requisitionId}`&&['Submitted','Interviewing','Offer','Rejected'].includes(r.status)))blockers.push('Related requisition already has an application');
 if(profile.applicationHistory?.[job.key]?.verified!==true||profile.applicationHistory[job.key].neverApplied!==true)blockers.push('Prior external application history for this employer/requisition is unconfirmed');
 const prep=row?.lastPreparation;
 if(prep?.status!=='Awaiting Approval'||prep.unresolved?.length||!prep.attachments?.some(r=>r.remoteUploadConfirmed===true&&r.verifiedInBrowser===true&&r.sha256===policy.approvedResumeSha256))blockers.push('Accurate complete form and correct attached PDF have not been verified');
 if(prep?.browserErrors?.length)blockers.push('Live browser errors require review before an unattended run');
 if(job.employerProcessValidated!==true)blockers.push('Employer submission, security challenge and confirmation process is unvalidated');
 return {key:job.key,company:job.company,title:job.title,score:job.matchScore,eligible:blockers.length===0,blockers};
}
export function planPilot(jobs,context){
 const evaluations=jobs.map(j=>evaluatePilotCandidate(j,context));
 return {schemaVersion:1,policyHash:policyHash(context.policy),submissionEnabled:false,evaluations,readyForSubmission:evaluations.filter(e=>e.eligible).slice(0,context.policy.maxApplications).map(e=>e.key),maximumApplications:context.policy.maxApplications};
}
