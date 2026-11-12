import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {resolveCodeRoot} from '../core/code-root.mjs';

export async function monitorApi({codeRoot = resolveCodeRoot(process.cwd())} = {}) {
  const file = path.join(/* turbopackIgnore: true */ codeRoot, 'lib/career-central/job-monitor.mjs');
  const resolver = path.join(/* turbopackIgnore: true */ codeRoot, 'path-resolver.mjs');
  const [core, paths] = await Promise.all([import(/* webpackIgnore: true */ pathToFileURL(file).href), import(/* webpackIgnore: true */ pathToFileURL(resolver).href)]);
  return {core, root: paths.getCareerOpsRoot()};
}
export async function readMonitorView({offset = 0, limit = 100} = {}, options) {
  try {const {core, root} = await monitorApi(options); return core.monitorView(root, {offset, limit});}
  catch {return {available: false, error: 'Monitor data unavailable; no data was reset.'};}
}
