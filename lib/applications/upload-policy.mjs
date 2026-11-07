import {createHash} from 'node:crypto';
// Accept precisely one PDF part and only standard S3 signing fields. No application answers.
export function inspectPdfUpload({url,method,contentType,body},authorization){
 if(!authorization||authorization.approved!==true||!Number.isFinite(Date.parse(authorization.expiresAt))||Date.parse(authorization.expiresAt)<=Date.now())return {allowed:false,reason:'missing_or_expired_upload_authorization'};
 const u=new URL(url);
 if(u.protocol!=='https:'||u.hostname!==authorization.host||u.pathname!=='/'||u.search||method!=='POST')return {allowed:false,reason:'upload_endpoint_not_authorized'};
 const boundary=String(contentType||'').match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)?.slice(1).find(Boolean);
 if(!/^multipart\/form-data\s*;/i.test(String(contentType||'')))return {allowed:false,reason:'unexpected_upload_content_type'};
 if(!boundary||boundary.length>200||!Buffer.isBuffer(body)||body.length>authorization.bytes+131072)return {allowed:false,reason:'invalid_upload_envelope'};
 const marker=Buffer.from('--'+boundary),separator=Buffer.from('\r\n\r\n');let cursor=0,file=null;const names=[];const parts=new Map();
 while(true){
  const start=body.indexOf(marker,cursor);if(start<0)break;
  const next=body.indexOf(marker,start+marker.length);if(next<0)break;
  const part=body.subarray(start+marker.length+2,next-2),headersEnd=part.indexOf(separator);cursor=next;
  if(headersEnd<0)return {allowed:false,reason:'malformed_multipart_part'};
  const headers=part.subarray(0,headersEnd).toString('utf8'),name=headers.match(/name="([^"]+)"/i)?.[1];
  if(!name)return {allowed:false,reason:'missing_part_name'};
  if(parts.has(name.toLowerCase()))return {allowed:false,reason:'duplicate_upload_field'};
  names.push(name);
  const payload=part.subarray(headersEnd+4);parts.set(name.toLowerCase(),payload);
  if(/filename=/i.test(headers)){
   if(name!=='file'||file||!payload.subarray(0,5).equals(Buffer.from('%PDF-')))return {allowed:false,reason:'unexpected_file_part'};
   file={sha256:createHash('sha256').update(payload).digest('hex'),bytes:payload.length};
  }else if(name==='authenticity_token'){
   // This is page-generated security metadata, not an application answer.
   // Preserve it verbatim: token syntax belongs to the employer, not this adapter.
   if(payload.length>4096)return {allowed:false,reason:'oversized_csrf_envelope'};
  }else if(name==='x-amz-server-side-encryption'){
   if(payload.toString('utf8')!=='AES256')return {allowed:false,reason:'unexpected_encryption_mode'};
  }else if(name==='utf8'){
   if(!['✓','&#x2713;'].includes(payload.toString('utf8')))return {allowed:false,reason:'invalid_encoding_marker'};
  }else if(!/^(key|acl|policy|success_action_status|content-type|content-disposition|x-amz-algorithm|x-amz-credential|x-amz-date|x-amz-signature|x-amz-security-token|AWSAccessKeyId|signature)$/i.test(name))return {allowed:false,reason:'unexpected_non_file_field',field:name};
 }
 if(!parts.has('policy')||!(parts.has('x-amz-signature')||parts.has('signature')))return {allowed:false,reason:'signed_storage_policy_required'};
 let signedPolicy;try{signedPolicy=JSON.parse(Buffer.from(parts.get('policy').toString('utf8'),'base64').toString('utf8'));}catch{return {allowed:false,reason:'invalid_signed_storage_policy'};}
 if(!Number.isFinite(Date.parse(signedPolicy.expiration))||Date.parse(signedPolicy.expiration)<=Date.now()||!Array.isArray(signedPolicy.conditions))return {allowed:false,reason:'expired_or_invalid_signed_storage_policy'};
 const bucket=u.hostname.split('.s3.')[0];let bucketBound=false;
 for(const condition of signedPolicy.conditions){
  if(Array.isArray(condition)){
   if(condition[0]==='content-length-range'){if(!file||file.bytes<condition[1]||file.bytes>condition[2])return {allowed:false,reason:'signed_file_length_condition_failed'};continue;}
   const name=String(condition[1]||'').replace(/^\$/,'').toLowerCase();const actual=name==='bucket'?bucket:parts.get(name)?.toString('utf8');
   if(name==='bucket')bucketBound=true;
   if(condition[0]==='starts-with'&&(actual===undefined||!actual.startsWith(String(condition[2]))))return {allowed:false,reason:'signed_prefix_condition_failed'};
   if(condition[0]==='eq'&&actual!==String(condition[2]))return {allowed:false,reason:'signed_equal_condition_failed'};
   if(!['eq','starts-with'].includes(condition[0]))return {allowed:false,reason:'unsupported_signed_policy_condition'};
  }else if(condition&&typeof condition==='object'){
   for(const [field,expected]of Object.entries(condition)){
    const name=field.toLowerCase(),actual=name==='bucket'?bucket:parts.get(name)?.toString('utf8');if(name==='bucket')bucketBound=true;
    if(actual!==String(expected))return {allowed:false,reason:'signed_policy_field_mismatch'};
   }
  }else return {allowed:false,reason:'invalid_signed_policy_condition'};
 }
 if(!bucketBound)return {allowed:false,reason:'signed_bucket_binding_required'};
 if(!file||file.sha256!==authorization.sha256||file.bytes!==authorization.bytes)return {allowed:false,reason:'resume_bytes_do_not_match_approval'};
 return {allowed:true,...file,fieldNames:names};
}
