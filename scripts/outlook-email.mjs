#!/usr/bin/env node
// Read-only Microsoft mailbox connection. This script has no submission transport.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {newOpaqueMailboxId} from '../lib/email/protected-persistence.mjs';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {acquireDirLock,releaseOrWarn} from '../lib/dir-lock.mjs';
import {createOutlookAuth,writePrivate,readPrivate} from '../lib/email/outlook-auth.mjs';
import {OutlookReadClient} from '../lib/email/outlook-client.mjs';
import {inspectMailbox,recordMailObservations} from '../lib/email/application-mail.mjs';
const {values,positionals}=parseArgs({allowPositionals:true,options:{'client-id':{type:'string'},account:{type:'string'},since:{type:'string'},'job-key':{type:'string'},sender:{type:'string'}}});
const command=positionals[0],root=getCareerOpsRoot(),dir=path.join(root,'data/application-automation'),file=path.join(dir,'outlook.json');
async function main(){
 if(command==='init'){
  if(fs.existsSync(file))throw Error('Outlook configuration already exists');if(!/^[0-9a-f-]{36}$/i.test(values['client-id']||'')||!/^\S+@\S+\.\S+$/.test(values.account||''))throw Error('Supply --client-id UUID and --account email');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});writePrivate(file,JSON.stringify({schemaVersion:1,clientId:values['client-id'],account:values.account.toLowerCase(),accountId:newOpaqueMailboxId(),rules:[],maxPages:5,mode:'observe',automaticCodeUse:false,automaticStatusChanges:false},null,2));console.log('Private Outlook configuration saved with a random opaque mailbox identity. No authentication or mailbox request made.');return;
 }
 if(!['connect','preview','sync','trust-sender','disconnect'].includes(command))throw Error('Use init, connect, preview, sync, trust-sender or disconnect; see docs/OUTLOOK.md');
 const config=JSON.parse(readPrivate(file));if(config.schemaVersion!==1||config.mode!=='observe'||config.automaticCodeUse!==false||config.automaticStatusChanges!==false)throw Error('Only observe mode is supported');
 if(command==='trust-sender'){
  const ledger=JSON.parse(fs.readFileSync(path.join(dir,'ledger.json')));if(!ledger.jobs[values['job-key']]||!/^\S+@\S+\.\S+$/.test(values.sender||''))throw Error('Supply an existing --job-key and independently verified --sender email');
  const lock=await acquireDirLock(file+'.lock');try{const fresh=JSON.parse(readPrivate(file));let rule=fresh.rules.find(r=>r.jobKey===values['job-key']);if(!rule){rule={jobKey:values['job-key'],senders:[]};fresh.rules.push(rule);}rule.senders=[...new Set([...rule.senders,values.sender.toLowerCase()])];writePrivate(file,JSON.stringify(fresh,null,2));}finally{releaseOrWarn(lock);}console.log('Exact sender rule saved for this job only. Sender authentication and code use remain unvalidated.');return;
 }
 const auth=createOutlookAuth({repo:root,clientId:config.clientId,opaqueAccountId:config.accountId}),lock=await acquireDirLock(path.join(auth.directory,'session.lock'),{maxWaitMs:5000});
 try{
  if(command==='disconnect'){await auth.disconnect(config.account);console.log(`Active ${auth.credentialMode} authentication cache cleared where applicable. Revoke consent in your Microsoft account to revoke access.${auth.legacyCachePresent()?' A pre-existing legacy cache was left untouched; do not use it. Remove it only after reviewing/revoking it manually.':''}`);return;}
  if(command==='connect'){await auth.connect(config.account,url=>console.log('Open this Microsoft authorization URL in your browser on this computer (expires in five minutes):\n'+url));console.log(`Personal Microsoft account connected with Mail.Read. No mailbox messages retrieved. Credential mode: ${auth.credentialMode}.${auth.credentialMode==='session'?' Tokens will not persist after this process exits. Set CAREER_OPS_OUTLOOK_CREDENTIAL_MODE=protected only after the OS credential backend is available.':''}`);return;}
  const ledger=JSON.parse(fs.readFileSync(path.join(dir,'ledger.json'))),since=values.since||new Date(Date.now()-7*86400000).toISOString();
  const client=new OutlookReadClient({getToken:()=>auth.token(config.account)}),result=await inspectMailbox({client,config,ledger,since});
  const recorded=command==='sync'?await recordMailObservations(root,result.observations):null;
  console.log(JSON.stringify({mode:'observe',...result,recorded,automaticCodeUse:false,submittedApplications:0},null,2));
 }finally{releaseOrWarn(lock);}
}
main().catch(()=>{console.error('Outlook operation did not complete. Check private configuration, owner-only file permissions, Microsoft consent/account selection, and network access. No application was submitted. Provider details are suppressed to protect credentials.');process.exitCode=1;});
