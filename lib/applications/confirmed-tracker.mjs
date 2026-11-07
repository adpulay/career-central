import fs from 'node:fs';
import path from 'node:path';
import {resolveTrackerPathForWrite} from '../../path-resolver.mjs';
import {openTrackerTransaction,cell,rebuildRow} from '../../tracker-utils.mjs';
import {detectColumns,parseTrackerRow} from '../../tracker-parse.mjs';
export async function mirrorConfirmedSubmission(root,review,confirmation){
 const ledger=JSON.parse(fs.readFileSync(path.join(root,'data/application-automation/ledger.json'),'utf8'));
 if(ledger.jobs[review.jobKey]?.status!=='Submitted'||ledger.jobs[review.jobKey]?.lastSubmission?.confirmation?.reference!==confirmation.reference)throw Error('Confirmed ledger receipt required before tracker mirror');
 const file=resolveTrackerPathForWrite(root),tx=await openTrackerTransaction(file);
 try{
  const lines=tx.read().split('\n'),columns=detectColumns(lines);if(!columns)throw Error('Tracker header could not be resolved');
  const rows=lines.map((line,index)=>({row:parseTrackerRow(line,columns),index})).filter(x=>x.row);
  const matches=rows.filter(x=>x.row.notes.includes(review.jobKey)||(x.row.company.toLowerCase()===review.company.toLowerCase()&&x.row.role.toLowerCase()===review.title.toLowerCase()));
  if(matches.length>1)throw Error('Ambiguous existing tracker rows; confirmation retained in ledger');
  const existing=matches[0];
  if(existing&&existing.row.notes.includes(confirmation.reference))return {status:'already-recorded',trackerNumber:existing.row.num};
  if(existing&&!existing.row.notes.includes(review.jobKey)&&existing.row.url&&existing.row.url!==review.applicationUrl)throw Error('Same-title tracker row belongs to another posting; manual reconciliation required');
  const parts=existing?lines[existing.index].split('|').map(s=>s.trim()):Array(Math.max(...Object.values(columns))+2).fill('');
  const number=existing?.row.num??Math.max(0,...rows.map(x=>x.row.num))+1;
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:review.timezone||'UTC'}).format(new Date(confirmation.observedAt));
  const receipt=path.relative(path.dirname(file),path.join(root,confirmation.evidence,'confirmation.txt')).replaceAll(path.sep,'/');
  const pdf=path.relative(path.dirname(file),review.resumePath).replaceAll(path.sep,'/');
  const values={num:number,date,company:review.company,role:review.title,score:(review.matchScore/20).toFixed(2),status:'Applied',pdf:`[approved PDF](${pdf})`,report:existing?.row.report||'—',notes:[existing?.row.notes,`Confirmed ${confirmation.reference}; Automation key: ${review.jobKey}; Posting: ${review.applicationUrl}; [receipt](${receipt})`].filter(Boolean).join('; '),url:review.applicationUrl,location:review.location};
  for(const [key,value]of Object.entries(values))if(columns[key]!==undefined)parts[columns[key]]=cell(value);
  const rendered=rebuildRow(parts);if(existing)lines[existing.index]=rendered;else{while(lines.at(-1)==='')lines.pop();lines.push(rendered,'');}
  tx.replace(lines.join('\n'));return {status:'recorded',trackerNumber:number};
 }finally{tx.close();}
}
