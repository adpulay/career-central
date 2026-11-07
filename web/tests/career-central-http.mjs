// Explicit post-build HTTP-only smoke test. No browser or server.mjs PDF worker.
// node --test web/tests/career-central-http.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {recordWorkerHeartbeat,recordMailboxHealth} from '../../lib/career-central/operational-store.mjs';
const WEB=fileURLToPath(new URL('..',import.meta.url)),CODE=path.dirname(WEB.replace(/\/$/,''));
test('production page and API render durable health through HTTP without browser automation',{timeout:45000},async()=>{
 assert.ok(fs.existsSync(path.join(WEB,'.next/BUILD_ID')),'Run npm run build --prefix web first');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cc-m3b-http-')),at=new Date().toISOString(),until=new Date(Date.now()+3600000).toISOString();let child,exit;
 try{
  await recordWorkerHeartbeat(root,{operationId:'http-worker',expectedRevision:0,previousSessionId:null,worker:{workerId:'http-worker',sessionId:'http-session',sequence:1,kind:'local',capabilities:['discovery'],lastHeartbeatAt:at,heartbeatTtlSeconds:3600,availability:'online'}},{now:at});
  await recordMailboxHealth(root,{operationId:'http-mail',expectedRevision:0,health:{accountId:'opaque-http-account',connection:{state:'connected',observedAt:at,expiresAt:until,errorCategory:null},synchronization:{state:'idle',observedAt:at,lastSuccessfulSyncAt:at,coverage:{from:at,through:at,complete:true},incomplete:false,errorCategory:null},folderScope:['inbox'],checkpoint:{id:'opaque-http-checkpoint',completedAt:at,coverage:{from:at,through:at,complete:true},folderScope:['inbox']},retry:{attempt:0,delaySeconds:0,nextAttemptAt:null}}},{now:at});
  fs.writeFileSync(path.join(root,'data/application-automation/outlook.json'),'CONFIG METADATA ONLY');
  const snapshot=()=>Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const f=path.join(e.parentPath||e.path,e.name);return[path.relative(root,f),fs.readFileSync(f,'base64')];})),before=snapshot();
  const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
  const env={...process.env,CAREER_OPS_ROOT:root,CAREER_OPS_CODE_ROOT:CODE,NEXT_TELEMETRY_DISABLED:'1'};for(const k of ['CAREER_OPS_DATA_DIR','CAREER_OPS_TRACKER','CAREER_OPS_PROFILE','CAREER_OPS_WEB_ALLOWED_HOSTS','CAREER_OPS_ALLOWED_ORIGINS'])delete env[k];
  child=spawn(process.execPath,[path.join(WEB,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:WEB,env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);exit=new Promise(r=>child.once('exit',r));
  const base=`http://127.0.0.1:${port}`;let response;const deadline=Date.now()+20000;
  while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Fixture server failed');try{response=await fetch(base+'/api/career-central',{signal:AbortSignal.timeout(2000)});if(response.status===200)break;await response.body?.cancel();}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.equal(response?.status,200,log);assert.match(response.headers.get('cache-control'),/private, no-store/);
  const v=await response.json();assert.equal(v.health.workers.records[0].availability,'Online');assert.equal(v.health.mailbox.connection,'Connected');assert.equal(v.health.mailbox.synchronization,'Idle');assert.equal(v.health.mailbox.quality,'fresh');assert.equal(v.metrics.find(m=>m.id==='confirmed').value,null);
  const page=await fetch(base+'/career-central');assert.equal(page.status,200);const html=await page.text();for(const label of ['Career Central','Recorded connection','Last successful sync','Online','Connected'])assert.ok(html.includes(label));assert.doesNotMatch(html,/opaque-http-account|opaque-http-checkpoint|CONFIG METADATA ONLY/);
  assert.equal((await fetch(base+'/api/career-central',{method:'POST'})).status,405);assert.equal((await fetch(base+'/api/career-central',{headers:{Origin:'https://example.invalid','Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.deepEqual(snapshot(),before);
 }finally{if(child){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await exit;clearTimeout(timer);}fs.rmSync(root,{recursive:true,force:true});}
});
