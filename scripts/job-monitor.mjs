#!/usr/bin/env node
import fs from 'node:fs';
import {parseArgs} from 'node:util';
import {getCareerOpsRoot} from '../path-resolver.mjs';
import {checkPath} from '../web/src/lib/core/operational-files.mjs';
import {configureSources, pollSource, loadMatchingContext, monitorView, setMonitorDecision, seedCachedShortlist, reevaluatePostings, setMonitorInterval} from '../lib/career-central/job-monitor.mjs';
import {createFeedReader} from '../lib/career-central/monitor-feed.mjs';
const fail = code => Object.assign(Error(code), {code});
const {values, positionals} = parseArgs({allowPositionals: true, options: {file: {type: 'string'}, source: {type: 'string'},
  'authorize-live-read': {type: 'boolean', short: 'a', default: false}, posting: {type: 'string'}, decision: {type: 'string'}, minutes: {type: 'string'}}});
async function main() {
  const root = getCareerOpsRoot(), command = positionals[0];
  if (positionals.length !== 1) throw fail('MONITOR_COMMAND_INVALID');
  if (command === 'status') return monitorView(root);
  if (command === 'configure') {
    if (!values.file) throw fail('MONITOR_SOURCE_INVALID');
    checkPath(values.file, {allowMissing: false});
    if (fs.statSync(values.file).size > 65536) throw fail('MONITOR_SOURCE_INVALID');
    return configureSources(root, JSON.parse(fs.readFileSync(values.file, 'utf8')));
  }
  if (command === 'decide') return setMonitorDecision(root, {postingId: values.posting, decision: values.decision});
  if (command === 'seed-cache') return seedCachedShortlist({root, sourceId: values.source});
  if (command === 'reevaluate') return reevaluatePostings({root});
  if (command === 'schedule') return setMonitorInterval(root, values.source, Number(values.minutes));
  if (command === 'pause' || command === 'resume') return setMonitorDecision(root, {pausedSource: values.source, paused: command === 'pause'});
  if (command === 'poll-once' || command === 'first-poll') {
    if (!values['authorize-live-read']) throw fail('MONITOR_LIVE_NOT_AUTHORIZED');
    const controller = new AbortController();
    const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {return await pollSource({root, sourceId: values.source, context: loadMatchingContext(root), fetchSnapshot: createFeedReader(),
      mode: 'live', authorizeLiveRead: true, signal: controller.signal, requireFirstLiveBaseline: command === 'first-poll'});}
    finally {process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);}
  }
  throw fail('MONITOR_COMMAND_INVALID');
}
main().then(result => {console.log(JSON.stringify(result, null, 2)); if (result.state === 'failed') process.exitCode = 2;}).catch(error => {
  console.error(JSON.stringify({error: /^MONITOR_[A-Z_]+$|^MATCH_[A-Z_]+$/.test(error.code || '') ? error.code : 'MONITOR_UNAVAILABLE', recurringEnabled: false, submittedApplications: 0})); process.exitCode = 1;
});
