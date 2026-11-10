import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {liveServerSkip} from '../helpers/live-server.mjs';
const url = process.env.JOB_MONITOR_CACHE_TEST_URL, root = process.env.JOB_MONITOR_CACHE_TEST_ROOT;
test('30 cached opportunities show explicit incomplete eligibility without writes or live requests', {skip: liveServerSkip('JOB_MONITOR_CACHE_TEST_URL', 'JOB_MONITOR_CACHE_TEST_ROOT'), timeout: 120000}, async t => {
  assert.ok(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
  assert.equal(fs.readFileSync(path.join(root, '.career-central-fixture'), 'utf8'), 'fictional-only');
  const file = path.join(root, 'data/application-automation/ledger.json'), before = fs.readFileSync(file), base = new URL(url);
  const {chromium} = await import('playwright-core');
  const browser = await chromium.launch({executablePath: process.env.CAREER_CENTRAL_CHROME_EXECUTABLE, headless: true}); t.after(() => browser.close());
  const page = await browser.newPage(), errors = []; let writes = 0, external = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request(), target = new URL(request.url());
    if (target.origin !== base.origin) {external++; return route.abort();}
    if (request.method() !== 'GET') {writes++; return route.abort();}
    if (target.pathname.startsWith('/api/') && !target.pathname.startsWith('/api/career-central')) return route.fulfill({status: 200, contentType: 'application/json', body: '{}'});
    return route.continue();
  });
  for (const width of [375, 1440]) {
    await page.setViewportSize({width, height: 900}); await page.goto(new URL('/career-central', base).href);
    await page.getByTestId('monitor-opportunity').last().waitFor();
    assert.equal(await page.getByTestId('monitor-opportunity').count(), 30);
    assert.equal(await page.getByTestId('monitor-eligibility-review').count(), 30);
    await page.getByTestId('monitor-cache-warning').waitFor();
    assert.equal(await page.getByRole('heading', {name: 'Local preparation tasks', exact: true}).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.equal(writes, 0); assert.equal(external, 0); assert.deepEqual(errors, []); assert.deepEqual(fs.readFileSync(file), before);
});
