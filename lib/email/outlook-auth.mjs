import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {PublicClientApplication,CryptoProvider,LogLevel} from '@azure/msal-node';
import {createMicrosoftProtectedPersistence} from './protected-persistence.mjs';
import {privateDirectory} from './private-storage.mjs';
export {privateDirectory} from './private-storage.mjs';
export const MAIL_SCOPES=['https://graph.microsoft.com/Mail.Read'];
export function readPrivate(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const s=fs.fstatSync(fd);if(!s.isFile()||s.size>4*1024*1024||s.mode&0o077||process.getuid&&s.uid!==process.getuid())throw Error('Private file must be owner-only and regular');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
}
export function writePrivate(file,value){
 const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,value,{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export function validateScopes(scopes){
 const normalized=scopes.map(s=>s.toLowerCase().replace('https://graph.microsoft.com/',''));
 if(!normalized.includes('mail.read')||normalized.some(s=>!['mail.read','openid','profile','offline_access'].includes(s)))throw Error('Unexpected OAuth permissions; reconnect using Mail.Read only');
}
export function createOutlookAuth({repo,clientId,opaqueAccountId,storageDir=process.env.CAREER_OPS_OUTLOOK_AUTH_DIR||path.join(os.homedir(),'.local/state/career-ops/outlook'),credentialMode=process.env.CAREER_OPS_OUTLOOK_CREDENTIAL_MODE||'session',clientFactory=config=>new PublicClientApplication(config),protectedPersistenceFactory=createMicrosoftProtectedPersistence}){
 if(!/^[0-9a-f-]{36}$/i.test(clientId||''))throw Error('A Microsoft Application (client) ID is required');
 if(!['session','protected'].includes(credentialMode))throw Error('Unsupported credential storage mode');
 const directory=privateDirectory(storageDir,repo),legacyCacheFile=path.join(directory,'msal-cache.json');
 let clientPromise,boundAccount;
 const getClient=async expected=>{
  if(!/^\S+@\S+\.\S+$/.test(expected||''))throw Error('A verified mailbox account is required');
  if(boundAccount&&boundAccount!==expected.toLowerCase())throw Error('Protected account context cannot be changed within an authentication session');
  boundAccount=expected.toLowerCase();
  if(!clientPromise)clientPromise=(async()=>{
   let cache;
   if(credentialMode==='session')cache={};
   else {
    if(!/^acct_[A-Za-z0-9_-]{16,96}$/.test(opaqueAccountId||''))throw Object.assign(Error('A stored opaque mailbox identity is required for persistent mode'),{code:'PROTECTED_ACCOUNT_ID_REQUIRED'});
    const accountName=opaqueAccountId;
    const protectedStore=await protectedPersistenceFactory({repo,storageDir:directory,serviceName:'CareerCentral-Outlook-MSAL',accountName});
    cache={cachePlugin:protectedStore.cachePlugin};
   }
   return clientFactory({auth:{clientId,authority:'https://login.microsoftonline.com/consumers'},cache,system:{loggerOptions:{piiLoggingEnabled:false,logLevel:LogLevel.Error,loggerCallback:()=>{}}}});
  })();
  return clientPromise;
 };
 const validate=(r,expected)=>{if(!r?.account||r.account.username.toLowerCase()!==expected.toLowerCase())throw Error('Signed-in account does not match configured mailbox; disconnect and use the intended account');validateScopes(r.scopes||[]);return r;};
 return {directory,credentialMode,legacyCachePresent:()=>fs.existsSync(legacyCacheFile),async disconnect(expected){const c=await getClient(expected);if(credentialMode==='protected'){try{return await c.getTokenCache().clear();}catch{throw Error('PROTECTED_BACKEND_UNAVAILABLE');}}return false;},async token(expected){const client=await getClient(expected),accounts=await client.getTokenCache().getAllAccounts(),matches=accounts.filter(a=>a.username.toLowerCase()===expected.toLowerCase());if(matches.length!==1)throw Error('Connect the configured personal Microsoft account first');return validate(await client.acquireTokenSilent({account:matches[0],scopes:MAIL_SCOPES}),expected).accessToken;},async connect(expected,onUrl){
  const client=await getClient(expected);
  const {verifier,challenge}=await new CryptoProvider().generatePkceCodes(),state=randomUUID();let finish,timer;
  const codePromise=new Promise((resolve,reject)=>{finish={resolve,reject};});
  const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');if(req.method!=='GET'||u.pathname!=='/callback'||u.searchParams.get('state')!==state){res.writeHead(400);res.end('Invalid OAuth callback');return;}if(u.searchParams.has('error')||!u.searchParams.get('code')){res.end('Sign-in was not completed. Return to the terminal.');finish.reject(Error('Microsoft sign-in was denied'));return;}res.end('Sign-in received. Return to the terminal.');finish.resolve(u.searchParams.get('code'));});
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const redirectUri=`http://localhost:${server.address().port}/callback`;timer=setTimeout(()=>finish.reject(Error('OAuth sign-in timed out')),5*60*1000);
   const url=await client.getAuthCodeUrl({scopes:MAIL_SCOPES,redirectUri,state,codeChallenge:challenge,codeChallengeMethod:'S256',prompt:'select_account',loginHint:expected});onUrl(url);
   const code=await codePromise;return validate(await client.acquireTokenByCode({code,scopes:MAIL_SCOPES,redirectUri,codeVerifier:verifier}),expected);
  }finally{clearTimeout(timer);server.close();server.closeAllConnections();}
 }};
}
