#!/usr/bin/env node
// Public GET-only collection using the existing, tested ATS providers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { loadYaml } from '../lib/yaml-document.mjs';
import { loadProviders, resolveProvider } from '../providers/_registry.mjs';
import { fetchJson, fetchText } from '../providers/_http.mjs';
import { checkLivenessViaApi } from '../liveness-api.mjs';
import { evaluateJob, canonicalJobKey, renderReport } from '../lib/applications/discovery.mjs';
const root=getCareerOpsRoot();
const code=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config=loadYaml(fs.readFileSync(path.join(root,'portals.yml'),'utf8'));
const providers=await loadProviders(path.join(code,'providers'));
const policy=JSON.parse(fs.readFileSync(path.join(root,'data','application-automation','policy.json'),'utf8'));
const applicationProfile=JSON.parse(fs.readFileSync(path.join(root,'data','application-automation','profile.json'),'utf8'));
const entries=[...config.tracked_companies,...(policy.discovery?.additionalSources||[])].filter(e=>e.enabled!==false);
const supported=new Set(['greenhouse','lever','ashby']);
const targetKeys=new Set();
const targets=entries.filter(e=>{const key=e.api||e.careers_url;if(targetKeys.has(key))return false;targetKeys.add(key);return true;}).map(entry=>({entry,provider:resolveProvider(entry,providers)?.provider})).filter(x=>supported.has(x.provider?.id));
const diagnostics=[]; const jobs=[]; let cursor=0;
if(!process.argv.includes('--rerank'))await Promise.all(Array.from({length:4},async()=>{
 while(cursor<targets.length){
  const {entry,provider}=targets[cursor++];
  try{
   const found=await provider.fetch(entry,{fetchJson:(u,o={})=>fetchJson(u,{...o,timeoutMs:20000}),fetchText:(u,o={})=>fetchText(u,{...o,timeoutMs:20000}),log:()=>{}});
   diagnostics.push({company:entry.name,provider:provider.id,status:'ok',count:found.length});
   jobs.push(...found.map(j=>({...j,company:j.company||entry.name,provider:provider.id,observedAt:new Date().toISOString(),availability:'listed_in_live_employer_feed'})));
  }catch(e){diagnostics.push({company:entry.name,provider:provider.id,status:'failed',error:e.message});}
  console.error(`Collected ${diagnostics.length}/${targets.length} boards`);
 }
}));
if(process.argv.includes('--rerank')){const cached=JSON.parse(fs.readFileSync(path.join(root,'data','discovery','raw-latest.json'),'utf8'));jobs.push(...cached.jobs);diagnostics.push(...cached.diagnostics);}
const unique=new Map();
for(const job of jobs){ const key=canonicalJobKey(job); if(!unique.has(key))unique.set(key,{...job,key,...evaluateJob(job,policy,Date.now(),applicationProfile)}); }
const ranked=[...unique.values()].filter(j=>j.eligibility==='review_required').sort((a,b)=>b.matchScore-a.matchScore||a.key.localeCompare(b.key));
const selected=[];
const boardCache=new Map();
for(const job of ranked){
 if(selected.length>=50)break;
 if(process.argv.includes('--verify')){
  const verdict=await checkLivenessViaApi(job.url,{boardCache});
  job.availabilityCheck={checkedAt:new Date().toISOString(),...(verdict||{result:'uncertain',reason:'Individual API check inconclusive; live feed listing only'})};
  if(verdict?.result==='expired'){job.eligibility='excluded';job.exclusions.push('Individual ATS liveness check reports expired');continue;}
 }
 selected.push(job);
}
const out=path.join(root,'data','discovery');fs.mkdirSync(out,{recursive:true,mode:0o700});
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const result={schemaVersion:1,runId,generatedAt:new Date().toISOString(),requested:50,collected:jobs.length,unique:unique.size,eligibleOrReview:ranked.length,returned:selected.length,heldForLocationReview:[...unique.values()].filter(j=>j.eligibility==='needs_information').length,scoreMethod:'Transparent heuristic fit score, not hiring probability; see docs/architecture/application-automation.md',diagnostics,jobs:selected};
fs.writeFileSync(path.join(out,`${runId}.json`),JSON.stringify(result,null,2),{mode:0o600});
fs.writeFileSync(path.join(out,'latest.json'),JSON.stringify(result,null,2),{mode:0o600});
fs.writeFileSync(path.join(out,'raw-latest.json'),JSON.stringify({generatedAt:result.generatedAt,diagnostics,jobs:[...unique.values()]},null,2),{mode:0o600});
fs.writeFileSync(path.join(out,'latest.md'),renderReport(result),{mode:0o600});
console.log(JSON.stringify({returned:selected.length,collected:jobs.length,boards:diagnostics.length,failures:diagnostics.filter(d=>d.status==='failed').length,report:path.join(out,'latest.md')}));
if(selected.length<50)process.exitCode=2;
