#!/usr/bin/env node
// Read-only Microsoft mailbox connection. This script has no submission transport.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {newOpaqueMailboxId} from '../lib/email/protected-persistence.mjs';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {acquireDirLock,releaseOrWarn} from '../lib/dir-lock.mjs';
import {createOutlookAuth,writePrivate,readPrivate} from '../lib/email/outlook-auth.mjs';
import {runControlledMailboxSync,validateOutlookConfiguration} from '../lib/email/controlled-sync.mjs';
const {values,positionals}=parseArgs({allowPositionals:true,options:{'client-id':{type:'string'},account:{type:'string'},since:{type:'string'},hours:{type:'string'},interactive:{type:'boolean',default:false},'job-key':{type:'string'},sender:{type:'string'}}});
const command=positionals[0],root=getCareerOpsRoot(),dir=path.join(root,'data/application-automation'),file=path.join(dir,'outlook.json');
async function main(){
 if(command==='init'){
  if(fs.existsSync(file))throw Error('Outlook configuration already exists');if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(values['client-id']||'')||!/^\S+@\S+\.\S+$/.test(values.account||''))throw Error('Supply --client-id UUID and --account email');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});writePrivate(file,JSON.stringify({schemaVersion:1,clientId:values['client-id'],account:values.account.toLowerCase(),accountId:newOpaqueMailboxId(),rules:[],maxPages:1,pageSize:10,mode:'observe',automaticCodeUse:false,automaticStatusChanges:false},null,2));console.log('Private Outlook configuration saved with a random opaque mailbox identity. No authentication or mailbox request made.');return;
 }
 if(!['connect','first-sync','preview','sync','trust-sender','disconnect','migrate-identity'].includes(command))throw Error('Use init, connect, first-sync, preview, sync, trust-sender, migrate-identity or disconnect; see docs/OUTLOOK.md');
 const config=JSON.parse(readPrivate(file));validateOutlookConfiguration(config,{requireAccountId:command!=='migrate-identity'});
 if(command==='migrate-identity'){
  const lock=await acquireDirLock(file+'.lock',{timeoutMs:5000,retryMs:25,maxWaitMs:5000});try{const fresh=JSON.parse(readPrivate(file));validateOutlookConfiguration(fresh,{requireAccountId:false});if(fresh.accountId)throw Error('Opaque mailbox identity already exists; refusing replacement');fresh.accountId=newOpaqueMailboxId();writePrivate(file,JSON.stringify(fresh,null,2));}finally{releaseOrWarn(lock);}console.log('Opaque mailbox identity added. No cache was migrated or opened.');return;
 }
 if(command==='trust-sender'){
  const ledger=JSON.parse(fs.readFileSync(path.join(dir,'ledger.json')));if(!ledger.jobs[values['job-key']]||!/^\S+@\S+\.\S+$/.test(values.sender||''))throw Error('Supply an existing --job-key and independently verified --sender email');
  const lock=await acquireDirLock(file+'.lock',{timeoutMs:5000,retryMs:25,maxWaitMs:5000});try{const fresh=JSON.parse(readPrivate(file));let rule=fresh.rules.find(r=>r.jobKey===values['job-key']);if(!rule){rule={jobKey:values['job-key'],senders:[]};fresh.rules.push(rule);}rule.senders=[...new Set([...rule.senders,values.sender.toLowerCase()])];writePrivate(file,JSON.stringify(fresh,null,2));}finally{releaseOrWarn(lock);}console.log('Exact sender rule saved for this job only. Sender authentication and code use remain unvalidated.');return;
 }
 const auth=createOutlookAuth({repo:root,clientId:config.clientId,opaqueAccountId:config.accountId}),lock=await acquireDirLock(path.join(auth.directory,'session.lock'),{timeoutMs:5000,retryMs:25,maxWaitMs:5000});
 try{
  if(auth.legacyCachePresent())console.error('A legacy plaintext cache exists and is ignored. Review/revoke it separately; it will not be opened or deleted.');
  if(command==='disconnect'){await auth.disconnect(config.account);console.log(`Active ${auth.credentialMode} authentication cache cleared where applicable. Revoke consent in your Microsoft account to revoke access.${auth.legacyCachePresent()?' A pre-existing legacy cache was left untouched; do not use it. Remove it only after reviewing/revoking it manually.':''}`);return;}
  if(command==='connect'){await auth.connect(config.account,url=>console.log('Open this Microsoft authorization URL in your browser on this computer (expires in five minutes):\n'+url));console.log(`Personal Microsoft account connected with Mail.Read. No mailbox messages retrieved. Credential mode: ${auth.credentialMode}.${auth.credentialMode==='session'?' Tokens will not persist after this process exits. Use first-sync to sign in and inspect a bounded window within one process.':''}`);return;}
  if(values.since&&values.hours)throw Object.assign(Error('INVALID_CONTROLLED_WINDOW'),{code:'INVALID_CONTROLLED_WINDOW'});
  const result=await runControlledMailboxSync({root,config,auth,mode:command==='preview'?'preview':'sync',
   interactive:command==='first-sync'||values.interactive,since:values.since,hours:values.hours===undefined?24:Number(values.hours),
   onUrl:url=>console.log('Open this Microsoft authorization URL on this computer; keep the terminal running:\n'+url)});
  console.log(JSON.stringify(result,null,2));
  if(result.incomplete)process.exitCode=2;
 }finally{releaseOrWarn(lock);}
}
main().catch(error=>{const codes=new Set(['SESSION_SIGN_IN_REQUIRED','INVALID_CONTROLLED_WINDOW','SYNC_RECONCILIATION_REQUIRED','SYNC_BACKOFF_ACTIVE','SYNC_CONTEXT_CONFLICT','LEGACY_MAILBOX_REVIEW_REQUIRED','PROTECTED_ACCOUNT_ID_REQUIRED','PROTECTED_BACKEND_UNAVAILABLE','WINDOWS_PRIVATE_ACL_UNVALIDATED','OAUTH_ACCOUNT_OR_SCOPE_REJECTED']);if(codes.has(error?.code))console.error(JSON.stringify({error:error.code}));console.error('Outlook operation did not complete. Check private configuration, owner-only file permissions, Microsoft consent/account selection, and network access. No application was submitted. Provider details are suppressed to protect credentials.');process.exitCode=1;});
