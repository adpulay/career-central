const BASE='https://graph.microsoft.com/v1.0/me/messages';
export class GraphReadError extends Error{constructor(status){super(`Microsoft Graph read failed (${status}); reconnect for 401, wait before retrying for 429`);this.status=status;}}
export class OutlookReadClient{
 constructor({getToken,fetchFn=globalThis.fetch}){this.getToken=getToken;this.fetchFn=fetchFn;}
 async get(url){const u=new URL(url);if(u.origin!=='https://graph.microsoft.com'||u.username||u.password||u.hash||!/^\/v1\.0\/me\/messages(?:\/[^/]+)?$/.test(u.pathname))throw Error('Non-read mailbox endpoint refused');
  let response;try{response=await this.fetchFn(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${await this.getToken()}`,Prefer:'IdType="ImmutableId", outlook.body-content-type="text"'}});}catch{throw Error('Microsoft Graph read unavailable; no email changes were made');}if(!response.ok)throw new GraphReadError(response.status);return response.json();}
 async list({since,until=new Date().toISOString(),maxPages=5}){if(!Number.isFinite(Date.parse(since))||!Number.isFinite(Date.parse(until))||Date.parse(since)>Date.parse(until)||!Number.isInteger(maxPages)||maxPages<1||maxPages>20)throw Error('Invalid bounded mailbox window');
  const u=new URL(BASE);u.searchParams.set('$select','id,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,isDraft');u.searchParams.set('$filter',`receivedDateTime ge ${new Date(since).toISOString()} and receivedDateTime le ${new Date(until).toISOString()}`);u.searchParams.set('$orderby','receivedDateTime desc');u.searchParams.set('$top','50');let next=u.href;const seen=new Set(),messages=[];
  for(let page=0;next&&page<maxPages;page++){if(seen.has(next))throw Error('Repeated Graph page refused');seen.add(next);const data=await this.get(next);if(!Array.isArray(data.value))throw Error('Invalid Graph message list');messages.push(...data.value);next=data['@odata.nextLink']||null;}
  return {messages,hasMore:!!next};
 }
 detail(id){if(typeof id!=='string'||!id||id.length>4096)throw Error('Invalid message ID');return this.get(BASE+'/'+encodeURIComponent(id)+'?$select=id,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,isDraft,body,internetMessageHeaders');}
}
