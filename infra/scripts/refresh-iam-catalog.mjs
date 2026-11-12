// Refreshes infra/test/fixtures/iam-catalog.json: the IAM action names and
// service condition keys, from AWS's machine-readable Service Authorization
// Reference (https://servicereference.us-east-1.amazonaws.com/), for every service
// prefix the policies in infra/policies/ use. Tests validate against this snapshot
// offline; run this script (network, read-only, no AWS account) to update it, and
// review the diff before committing.
//
//   node scripts/refresh-iam-catalog.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const infra = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = 'https://servicereference.us-east-1.amazonaws.com/';
export const CATALOG = path.join(infra, 'test/fixtures/iam-catalog.json');
export const POLICY_GLOB = /^(dev-(cfn-execution|role-boundary|operator)-policy|dev-role-boundary|scp-dev-.*)\.json$/;

export function policyPrefixes() {
  const prefixes = new Set(['s3', 'dynamodb', 'logs', 'lambda']); // runtime role actions from the stack
  for (const file of fs.readdirSync(path.join(infra, 'policies')).filter(f => POLICY_GLOB.test(f)))
    for (const s of JSON.parse(fs.readFileSync(path.join(infra, 'policies', file), 'utf8')).Statement)
      for (const action of [s.Action ?? s.NotAction].flat()) prefixes.add(action.split(':')[0].toLowerCase());
  return [...prefixes].sort();
}

async function getJson(url) {
  const response = await fetch(url, {headers: {'user-agent': 'career-central-iam-catalog'}});
  if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const index = new Map((await getJson(INDEX)).map(entry => [entry.service, entry.url]));
  const services = {};
  for (const prefix of policyPrefixes()) {
    if (!index.has(prefix)) throw Error(`service prefix ${prefix} is not in the Service Authorization Reference`);
    const doc = await getJson(index.get(prefix));
    services[prefix] = {actions: doc.Actions.map(a => a.Name).sort(), conditionKeys: (doc.ConditionKeys ?? []).map(k => k.Name).sort()};
  }
  fs.mkdirSync(path.dirname(CATALOG), {recursive: true});
  fs.writeFileSync(CATALOG, JSON.stringify({source: INDEX, retrieved: new Date().toISOString().slice(0, 10), services}, null, 1) + '\n');
  console.log(JSON.stringify({catalog: path.relative(infra, CATALOG), services: Object.keys(services).length,
    actions: Object.values(services).reduce((n, s) => n + s.actions.length, 0)}));
}
