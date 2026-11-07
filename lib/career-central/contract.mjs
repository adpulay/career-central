import {validateSchema} from './schema-validation.mjs';
import {validateOperationalEvidence,operationalSchema} from './operational-contract.mjs';
import schema from './projection.schema.json' with {type:'json'};
export {schema as projectionSchema};
// Dependency-free validator for the exact JSON Schema subset used by v1.
// Error paths only: source values (potentially sensitive) are never diagnostics.
export function validateProjection(value){
 const errors=validateSchema(value,schema,{[operationalSchema.$id]:operationalSchema});
 if(errors.length)return errors;
 for(const name of ['sources','jobs','applications','attempts','evidence','conflicts','pendingReviews'])if(new Set(value[name].map(x=>x.id)).size!==value[name].length)errors.push('/'+name+':duplicate_id');
 const jobs=new Set(value.jobs.map(x=>x.id)),apps=new Set(value.applications.map(x=>x.id)),sources=new Set(value.sources.map(x=>x.id));
 for(const app of value.applications)if(!jobs.has(app.jobId))errors.push('/applications:unknown_job');
 for(const name of ['attempts','evidence','pendingReviews'])for(const item of value[name])if(!apps.has(item.applicationId))errors.push('/'+name+':unknown_application');
 const refs=x=>{if(!x||typeof x!=='object')return;if(Object.hasOwn(x,'sourceId')&&x.sourceId!==null&&!sources.has(x.sourceId))errors.push(':unknown_source');for(const child of Object.values(x))if(child&&typeof child==='object')refs(child);};refs(value);
 if(value.counts.jobs!==value.jobs.length||value.counts.applications!==value.applications.length)errors.push('/counts:mismatch');
 if(value.operationalEvidence)errors.push(...validateOperationalEvidence(value.operationalEvidence,value));
 return errors;
}
export function assertProjection(value){if(validateProjection(value).length)throw Error('Invalid Career Central projection contract');return value;}
