import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {liveServerSkip} from '../helpers/live-server.mjs';
const url=process.env.CAREER_CENTRAL_TEST_URL,root=process.env.CAREER_CENTRAL_TEST_ROOT;
test('Career Central production read slice, API and responsive rendering', {skip:liveServerSkip('CAREER_CENTRAL_TEST_URL','CAREER_CENTRAL_TEST_ROOT'),timeout:120000},async t=>{
 const base=new URL(url);assert.ok(['127.0.0.1','localhost','[::1]'].includes(base.hostname));
 assert.ok(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));
 assert.equal(fs.readFileSync(path.join(root,'.career-central-fixture'),'utf8'),'fictional-only');
 const snapshot=()=>Object.fromEntries(fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const p=path.join(e.parentPath||e.path,e.name);return[path.relative(root,p),fs.readFileSync(p,'base64')];}));const before=snapshot();
 const response=await fetch(new URL('/api/career-central',base));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);const v=await response.json();assert.equal(v.metrics[0].value,1);assert.equal(v.metrics[1].value,null);assert.match(v.actions[0].title,/verification/);assert.doesNotMatch(JSON.stringify(v),/SECRET-/);assert.equal(v.mailbox.authentication,'Not checked by this view');
 assert.equal((await fetch(new URL('/api/career-central',base),{method:'POST'})).status,405);
 assert.equal((await fetch(new URL('/api/career-central',base),{headers:{Origin:'https://example.invalid','Sec-Fetch-Site':'cross-site'}})).status,403);
 const {chromium}=await import('playwright-core');const browser=await chromium.launch({...(process.env.CAREER_CENTRAL_CHROME_EXECUTABLE?{executablePath:process.env.CAREER_CENTRAL_CHROME_EXECUTABLE}:{channel:'chrome'}),headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();const requests=[];page.on('request',r=>requests.push({method:r.method(),url:r.url()}));const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Global shell polling is outside this read slice; block it in this isolated test.
 await page.route('**/api/**',route=>new URL(route.request().url()).pathname==='/api/career-central'?route.continue():route.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto(new URL('/',base).href);await page.getByRole('link',{name:'Open Career Central',exact:true}).waitFor();
 for(const width of [375,1440]){await page.setViewportSize({width,height:900});await page.goto(new URL('/career-central',base).href);await page.getByRole('heading',{name:'Career Central',exact:true}).waitFor();assert.equal(await page.getByText('Resolve application verification',{exact:true}).count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.equal(await page.getByRole('button',{name:/submit|apply|authenticate/i}).count(),0);}
 assert.ok(requests.every(r=>r.method==='GET'));assert.ok(requests.every(r=>new URL(r.url).origin===base.origin));assert.deepEqual(errors,[]);assert.deepEqual(snapshot(),before);
});
