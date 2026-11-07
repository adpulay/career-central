// The only M1 IO boundary. Fixed source paths; bounded reads; never creates files.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {getCareerOpsRoot,getProfilePath,resolveTrackerPath} from '../../path-resolver.mjs';
import {loadYaml} from '../yaml-document.mjs';
import {validateProfile} from '../career-profile.mjs';
import {validateScheduledStore} from '../../web/src/lib/scheduled-jobs-store.mjs';
import {detectColumns,resolveColumns,parseTrackerRow} from '../../tracker-parse.mjs';
import {parseAssessments} from '../../assessment-log.mjs';
import {projectCareer} from './projection.mjs';
import {assertProjection} from './contract.mjs';
const CODE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const boundedArray=x=>Array.isArray(x)&&x.length<=50000;
export const MAX_SOURCE_BYTES=8*1024*1024;
export function parseSource(id,content){
 if(id==='statusHistory')return content;
 if(id==='assessments')return parseAssessments(content);
 if(id==='tracker'){const lines=content.split(/\r?\n/);if(content.trim()&&!detectColumns(lines)&&!lines.some(line=>parseTrackerRow(line,resolveColumns(lines))))throw Error('Unparseable tracker');return content;}
 const data=['profile','careerProfile','states'].includes(id)?loadYaml(content):JSON.parse(content);
 if(!object(data))throw Error('Source must be a mapping');
 if(['ledger','discovery','applicationProfile','policy'].includes(id)&&data.schemaVersion!==1)throw Error('Unsupported source version');
 if(id==='ledger'&&(!object(data.jobs)||Object.keys(data.jobs).length>10000||!Object.values(data.jobs).every(object)||!boundedArray(data.events)||data.emailInbox!==undefined&&!object(data.emailInbox)))throw Error('Invalid ledger');
 if(id==='discovery'&&(!boundedArray(data.jobs)||!data.jobs.every(object)))throw Error('Invalid discovery');
 if(id==='careerProfile'&&validateProfile(data).length)throw Error('Invalid source-backed profile');
 if(id==='states'&&(!Array.isArray(data.states)||!data.states.every(s=>object(s)&&typeof s.id==='string'&&typeof s.label==='string'&&Array.isArray(s.aliases))))throw Error('Invalid states');
 if(id==='schedule')validateScheduledStore(data,{extensions:false});
 return data;
}
function observed(id,data){
 if(['discovery','applicationProfile'].includes(id))return data.generatedAt||data.updatedAt||null;
 // Do not use filesystem mtime as a claim of a live availability/eligibility check.
 return null;
}
export function sourceDescriptors({root,explicitRoot=false}){
 const tracker=resolveTrackerPath(root),profile=explicitRoot?getProfilePath(root):getProfilePath();
 return [
  {id:'states',file:path.join(CODE_ROOT,'templates/states.yml'),ownership:'system',external:true},
  {id:'tracker',file:tracker,ownership:'canonical',external:true},
  {id:'statusHistory',file:path.join(path.dirname(tracker),'status-log.tsv'),ownership:'canonical',external:true},
  {id:'profile',file:profile,ownership:'canonical',external:true},
  ...[['discovery','data/discovery/latest.json','derived'],['ledger','data/application-automation/ledger.json','operational'],['policy','data/application-automation/policy.json','configuration'],['applicationProfile','data/application-automation/profile.json','canonical'],['careerProfile','data/career-profile.yml','canonical'],['schedule','data/scheduled-jobs.json','operational'],['outlook','data/application-automation/outlook.json','configuration'],['assessments','data/assessments.tsv','canonical']].map(([id,file,ownership])=>({id,file:path.join(root,file),ownership,external:false}))
 ];
}
const forbidden=p=>p.split(path.sep).some(x=>/^(?:\.aws|\.codex|\.env|credentials?|secrets?|oauth|tokens?|msal-cache(?:.*)?)$/i.test(x))||/\.(?:pdf|pem|key)$/i.test(p);
function readDescriptor(d,root){
 const base={id:d.id,state:'missing',revision:null,observedAt:null,ownership:d.ownership,coverage:'unknown'};
 let fd;
 try{
  const file=path.resolve(d.file);if(forbidden(file))return {...base,state:'refused'};
  const real=fs.realpathSync(file),realRoot=fs.realpathSync(root);
  // Only the core-selected tracker/history/profile and system states may be external.
  if(forbidden(real)||!d.external&&real!==realRoot&&!real.startsWith(realRoot+path.sep))return {...base,state:'refused'};
  if(d.external&&d.id==='profile'&&!/\.ya?ml$/i.test(real)||d.external&&['tracker','statusHistory'].includes(d.id)&&!(/\.md$/i.test(real)||d.id==='statusHistory'&&/\.tsv$/i.test(real)))return {...base,state:'refused'};
  fd=fs.openSync(real,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>MAX_SOURCE_BYTES)return {...base,state:'refused'};
  if(d.id==='outlook')return {...base,state:'available',revision:hash(JSON.stringify([stat.dev,stat.ino,stat.size,stat.mtimeMs])),data:{configured:true}};
  const buffer=Buffer.alloc(MAX_SOURCE_BYTES+1);let bytes=0,n;while(bytes<buffer.length&&(n=fs.readSync(fd,buffer,bytes,buffer.length-bytes,null))>0)bytes+=n;
  if(bytes>MAX_SOURCE_BYTES)return {...base,state:'refused'};
  const end=fs.fstatSync(fd),pathStat=fs.statSync(real);if(fs.realpathSync(file)!==real||stat.dev!==pathStat.dev||stat.ino!==pathStat.ino||stat.size!==end.size||stat.mtimeMs!==end.mtimeMs)return {...base,state:'unreadable'};
  const revision=hash(buffer.subarray(0,bytes));let data;
  try{data=parseSource(d.id,buffer.subarray(0,bytes).toString('utf8'));}catch{return {...base,state:'invalid',revision};}
  return {...base,state:'available',revision,observedAt:observed(d.id,data),coverage:d.id==='discovery'?'bounded_snapshot':d.id==='ledger'?'recorded_history':d.id==='outlook'?'configuration_only':'unknown',data};
 }catch(e){return {...base,state:e.code==='ENOENT'?'missing':'unreadable'};}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function readPass(descriptors,root){return descriptors.map(d=>readDescriptor(d,root));}
const signature=sources=>JSON.stringify(sources.map(s=>[s.id,s.state,s.revision]));
/** Same asOf + source bytes => same output. reader is a test-only IO seam. */
export function readCareerProjection(options={}){
 const explicitRoot=options.root!==undefined,root=options.root||getCareerOpsRoot(),asOf=options.asOf||new Date().toISOString(),descriptors=sourceDescriptors({root,explicitRoot}),reader=options.reader||readPass;
 let previous=reader(descriptors,root),current,consistency='changed';
 for(let i=0;i<2;i++){current=reader(descriptors,root);if(signature(previous)===signature(current)){consistency='stable';break;}previous=current;}
 const projection=projectCareer({sources:current,asOf,consistency});assertProjection(projection);return projection;
}
