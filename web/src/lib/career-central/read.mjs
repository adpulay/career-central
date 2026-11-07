// Server IO boundary, imported only by server.ts or fixture tests. Native import
// keeps core import.meta.url/data-root semantics intact after the Next build.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {resolveCodeRoot} from '../core/code-root.mjs';
import {buildOverview,unavailableOverview} from './view-model.mjs';
export async function readOverview({codeRoot=resolveCodeRoot(process.cwd()),asOf}={}){
 try{
  const file=path.join(/* turbopackIgnore: true */ codeRoot,'lib/career-central/sources.mjs');
  const {readCareerProjection}=await import(/* webpackIgnore: true */ pathToFileURL(file).href);
  return buildOverview(readCareerProjection({asOf}));
 }catch{return unavailableOverview();}
}
