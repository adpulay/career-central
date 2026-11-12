// Bundles the monitor-tick Lambda with esbuild and enforces packaging limits:
// size, forbidden modules (scanner, browser automation, web app), and an
// import smoke test of the built file. Writes dist/monitor-tick/index.mjs and a
// metafile report. No network, no AWS.
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), infra = path.resolve(here, '..');
const outfile = path.join(infra, 'dist/monitor-tick/index.mjs');
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
// Data files that bundled modules read relative to their own location
// (`new URL('./x', import.meta.url)`), copied next to the bundle.
const RUNTIME_ASSETS = ['tracker-aliases.json'];
// Every bundled module shares the bundle's import.meta.url, so CLI main-module
// guards (lib/is-main-module.mjs) could misfire. Inside the Lambda no bundled
// module is ever the program entry: the helper is replaced by a constant false.
export const noMainModule = {name: 'no-main-module', setup(builder) {
  builder.onResolve({filter: /(^|[\\/])is-main-module\.mjs$/}, () => ({path: 'is-main-module', namespace: 'cc-lambda'}));
  builder.onLoad({filter: /.*/, namespace: 'cc-lambda'}, () => ({contents: 'export function isMainModule() { return false; }', loader: 'js'}));
}};
// scan.mjs is reachable through the shared admission gate (pure filter helpers);
// browser automation is only a lazy runtime import there and is kept external.
export const FORBIDDEN = [/playwright/, /chromium-bidi/, /(^|\/)web\/src\/app\//, /(^|\/)generate-pdf\.mjs$/, /(^|\/)data\//];
export const EXTERNAL = ['playwright', 'playwright-core', 'chromium-bidi', 'chromium-bidi/*'];

export async function bundle({write = true} = {}) {
  const result = await build({
    entryPoints: [path.join(infra, 'lambda/monitor-tick.mjs')], outfile, bundle: true, platform: 'node', target: 'node22', format: 'esm',
    metafile: true, minify: false, sourcemap: false, legalComments: 'none', write, external: EXTERNAL, plugins: [noMainModule],
    // Some dependencies use require(); give the ESM bundle a CommonJS require.
    banner: {js: "import {createRequire as __ccRequire} from 'node:module'; const require = __ccRequire(import.meta.url);"},
  });
  const inputs = Object.keys(result.metafile.inputs);
  const forbidden = inputs.filter(input => FORBIDDEN.some(pattern => pattern.test(input.replaceAll('\\', '/'))));
  const bytes = Object.values(result.metafile.outputs)[0].bytes;
  if (write) for (const asset of RUNTIME_ASSETS) fs.copyFileSync(path.join(infra, '..', asset), path.join(path.dirname(outfile), asset));
  // CDK packages the whole directory, so anything else in it would ship to Lambda.
  // Fail closed instead of deleting: the operator removes stray files deliberately.
  const assetDir = path.dirname(outfile), allowed = new Set([path.basename(outfile), ...RUNTIME_ASSETS]);
  const unexpectedFiles = write ? fs.readdirSync(assetDir).filter(name => !allowed.has(name)).sort() : [];
  const mainGuardStubbed = inputs.includes('cc-lambda:is-main-module') && !inputs.some(input => input.endsWith('lib/is-main-module.mjs'));
  return {outfile, bytes, unexpectedFiles, inputs: inputs.length, forbidden, assets: RUNTIME_ASSETS, mainGuardStubbed, sdkPinned: inputs.some(input => input.includes('@aws-sdk/client-s3'))};
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await bundle();
  if (report.forbidden.length) {console.error('Forbidden modules in bundle:', report.forbidden); process.exit(1);}
  if (report.unexpectedFiles.length) {console.error(`Unexpected files in ${path.relative(infra, path.dirname(report.outfile))} (would be deployed; remove them and rebuild):`, report.unexpectedFiles); process.exit(1);}
  if (report.bytes > MAX_BUNDLE_BYTES) {console.error(`Bundle too large: ${report.bytes} bytes`); process.exit(1);}
  if (!report.mainGuardStubbed) {console.error('Main-module guard not stubbed'); process.exit(1);}
  const built = await import(pathToFileURL(report.outfile).href);
  if (typeof built.handler !== 'function' || typeof built.createLambdaHandler !== 'function') {console.error('Bundle exports missing'); process.exit(1);}
  // Written beside, not inside, the deployed asset directory, and with a relative
  // path: nothing local (paths, usernames) ships to Lambda.
  fs.writeFileSync(path.join(infra, 'dist/bundle-report.json'), JSON.stringify({...report, outfile: path.relative(infra, report.outfile)}, null, 2) + '\n');
  console.log(JSON.stringify({...report, outfile: path.relative(infra, report.outfile)}));
}
