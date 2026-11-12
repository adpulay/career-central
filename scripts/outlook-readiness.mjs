import {inspectOutlookReadiness} from '../lib/email/readiness.mjs';

const result = await inspectOutlookReadiness();
console.log(JSON.stringify(result, null, 2));
// This is a readiness gate, not a connectivity or authentication test.
process.exitCode = result.blockers.length ? 2 : 0;
