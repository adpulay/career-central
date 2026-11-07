#!/usr/bin/env node
// Readiness assessment only. This command never enables autonomy or submits.
import fs from 'node:fs';
import path from 'node:path';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {planPilot} from '../lib/applications/pilot.mjs';
import {validateResumes} from '../lib/applications/browser.mjs';
const root=getCareerOpsRoot(),dir=path.join(root,'data','application-automation');
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
const operational=read('policy.json'),profile=validateResumes(root,read('profile.json'),operational),policy=read('pilot-policy.json'),ledger=read('ledger.json');
if(!profile.resumeVersions.some(r=>r.sha256===policy.approvedResumeSha256))throw Error('Pilot resume is not currently approved or changed');
const run=JSON.parse(fs.readFileSync(path.join(root,'data','discovery','latest.json'),'utf8'));
const candidates=run.jobs.filter(j=>j.provider==='greenhouse'&&j.matchScore>=policy.minimumMatchScore);
const manifest=planPilot(candidates,{policy,profile,ledger,authorization:null,mode:operational.mode,transportValidated:false});
manifest.generatedAt=new Date().toISOString();manifest.prioritizedValidationTargets=[];const selectedEmployers=new Set();
for(const item of manifest.evaluations){
 const job=candidates.find(j=>j.key===item.key);
 if(/Access Denied|blocks browser access/i.test(job.review?.concerns?.join(' ')||''))item.blockers.push('Employer page returned Access Denied; no bypass attempted');
 if(/one application in 30 days/i.test(job.description||'')&&selectedEmployers.has(job.company.toLowerCase())){item.blockers.push('Employer considers one application per 30 days; do not queue both requisitions');continue;}
 if(manifest.prioritizedValidationTargets.length<policy.maxApplications&&!item.blockers.some(b=>b.includes('Access Denied'))){manifest.prioritizedValidationTargets.push(item.key);selectedEmployers.add(job.company.toLowerCase());}
}
fs.writeFileSync(path.join(dir,'pilot-manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
const md='# Pilot readiness — submission disabled\n\nMaximum '+policy.maxApplications+' applications, minimum '+policy.minimumMatchScore+'/100. This is a blocked readiness manifest, not an execution queue. Separate confirmation of the limit, exact resume hash, confirmed start date and policy is required.\n\n'+manifest.evaluations.map(e=>`## ${e.company} — ${e.title} (${e.score}/100)\n\n${e.blockers.map(b=>'- '+b).join('\n')}\n`).join('\n');
fs.writeFileSync(path.join(dir,'pilot-readiness.md'),md,{mode:0o600});
console.log(JSON.stringify({evaluated:candidates.length,ready:manifest.readyForSubmission.length,submissionEnabled:false,maximumApplications:policy.maxApplications}));
