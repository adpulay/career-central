import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectPdfUpload} from '../lib/applications/upload-policy.mjs';
const pdf=Buffer.from('%PDF-1.7 fixture-approved-resume');
const authorization={approved:true,host:'grnhse-prod-jben-us-east-1.s3.amazonaws.com',sha256:createHash('sha256').update(pdf).digest('hex'),bytes:pdf.length,expiresAt:new Date(Date.now()+60000).toISOString()};
function request({extra='',file=pdf,url='https://grnhse-prod-jben-us-east-1.s3.amazonaws.com/',storagePolicy=null}={}){
 const policy=Buffer.from(JSON.stringify(storagePolicy||{expiration:new Date(Date.now()+60000).toISOString(),conditions:[{bucket:'grnhse-prod-jben-us-east-1'},{key:'fixture-signed-key'}]})).toString('base64');
 const signing='--fixture-boundary\r\nContent-Disposition: form-data; name=\"policy\"\r\n\r\n'+policy+'\r\n--fixture-boundary\r\nContent-Disposition: form-data; name=\"x-amz-signature\"\r\n\r\n'+'0'.repeat(64)+'\r\n';
 return {url,method:'POST',contentType:'multipart/form-data; boundary=fixture-boundary',body:Buffer.concat([Buffer.from('--fixture-boundary\r\nContent-Disposition: form-data; name="key"\r\n\r\nfixture-signed-key\r\n'+signing+extra+'--fixture-boundary\r\nContent-Disposition: form-data; name="file"; filename="fixture.pdf"\r\nContent-Type: application/pdf\r\n\r\n'),file,Buffer.from('\r\n--fixture-boundary--\r\n')])};
}
test('scoped upload accepts exactly approved PDF bytes in signed S3 multipart envelope',()=>assert.equal(inspectPdfUpload(request(),authorization).allowed,true));
test('scoped upload rejects missing, expired and malformed authorizations',()=>{
 assert.equal(inspectPdfUpload(request(),null).allowed,false);
 for(const expiresAt of ['yesterday','2020-01-01'])assert.equal(inspectPdfUpload(request(),{...authorization,expiresAt}).allowed,false);
});
test('scoped upload refuses application answers, even beside the approved PDF',()=>{
 const r=inspectPdfUpload(request({extra:'--fixture-boundary\r\nContent-Disposition: form-data; name="email"\r\n\r\nprivate@example.invalid\r\n'}),authorization);assert.equal(r.allowed,false);assert.equal(r.reason,'unexpected_non_file_field');
});
test('scoped upload rejects changed PDF, other hosts, query strings and application endpoints',()=>{
 assert.equal(inspectPdfUpload(request({file:Buffer.from('%PDF changed')}),authorization).allowed,false);
 for(const url of ['https://evil.invalid/','https://grnhse-prod-jben-us-east-1.s3.amazonaws.com/?leak=1','https://job-boards.greenhouse.io/fixture/jobs/123'])assert.equal(inspectPdfUpload(request({url}),authorization).allowed,false);
});
test('scoped upload rejects extra metadata and oversized multipart payloads',()=>{
 assert.equal(inspectPdfUpload(request({extra:'--fixture-boundary\r\nContent-Disposition: form-data; name="x-amz-meta-answer"\r\n\r\nprivate\r\n'}),authorization).allowed,false);
 assert.equal(inspectPdfUpload({...request(),body:Buffer.alloc(authorization.bytes+131073)},authorization).allowed,false);
});

test('observed S3 encoding and AES256 markers carry no application answers',()=>{
 const extra='--fixture-boundary\r\nContent-Disposition: form-data; name="utf8"\r\n\r\n✓\r\n--fixture-boundary\r\nContent-Disposition: form-data; name="x-amz-server-side-encryption"\r\n\r\nAES256\r\n';
 assert.equal(inspectPdfUpload(request({extra}),authorization).allowed,true);
 assert.equal(inspectPdfUpload(request({extra:extra.replace('AES256','private-answer')}),authorization).allowed,false);
});

test('S3 form carries bounded opaque CSRF metadata unchanged without guessing token syntax',()=>{
 const part=value=>'--fixture-boundary\r\nContent-Disposition: form-data; name="authenticity_token"\r\n\r\n'+value+'\r\n';
 for(const marker of ['', 'undefined', 'null', 'true'])assert.equal(inspectPdfUpload(request({extra:part(marker)}),authorization).allowed,true);
 assert.equal(inspectPdfUpload(request({extra:part('fixture_token_1234567890')}),authorization).allowed,true);
 assert.equal(inspectPdfUpload(request({extra:part('fixture~opaque:token')}),authorization).allowed,true);
 assert.equal(inspectPdfUpload(request({extra:part('x'.repeat(4097))}),authorization).allowed,false);
});

test('upload validation preserves all original body bytes and requires the signed policy',()=>{
 const r=request(),before=Buffer.from(r.body);assert.equal(inspectPdfUpload(r,authorization).allowed,true);assert.deepEqual(r.body,before);
 const changed={...r,body:Buffer.from(r.body.toString().replace('name="policy"','name="unknown"'))};assert.equal(inspectPdfUpload(changed,authorization).allowed,false);
 const duplicate=request({extra:'--fixture-boundary\r\nContent-Disposition: form-data; name="key"\r\n\r\nfixture-signed-key\r\n'});assert.equal(inspectPdfUpload(duplicate,authorization).allowed,false);
});

test('signed storage policies must be unexpired and bind the exact bucket and fields',()=>{
 const expiration=new Date(Date.now()+60000).toISOString();
 for(const storagePolicy of [{expiration:'2020-01-01',conditions:[{bucket:'grnhse-prod-jben-us-east-1'}]},{expiration,conditions:[{bucket:'other-bucket'}]},{expiration,conditions:[]},{expiration,conditions:[{bucket:'grnhse-prod-jben-us-east-1'},{key:'other-key'}]}])assert.equal(inspectPdfUpload(request({storagePolicy}),authorization).allowed,false);
});
