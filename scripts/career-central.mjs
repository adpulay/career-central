#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {isMainModule} from '../lib/is-main-module.mjs';
import {readCareerProjection} from '../lib/career-central/sources.mjs';
export function main(args=process.argv.slice(2)){
 const {values}=parseArgs({args,options:{'as-of':{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('Usage: node scripts/career-central.mjs [--as-of ISO_TIMESTAMP]\nRead-only private JSON view to stdout. Uses existing CAREER_OPS_* path overrides. No network, authentication, browser or writes.');return;}
 console.log(JSON.stringify(readCareerProjection({asOf:values['as-of']}),null,2));
}
if(isMainModule(import.meta.url))try{main();}catch{console.error('Career projection unavailable: invalid options or contract. No source changes were made.');process.exitCode=1;}
