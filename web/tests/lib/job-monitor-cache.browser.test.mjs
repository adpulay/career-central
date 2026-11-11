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
  // Snapshot every monitor/ledger byte: the page must not write anything.
  const snapshot = () => ['data/application-automation/ledger.json', 'data/job-monitor'].flatMap(rel => {
    const full = path.join(root, rel); if (!fs.existsSync(full)) return [[rel, null]];
    return fs.statSync(full).isDirectory() ? fs.readdirSync(full, {recursive: true}).map(name => path.join(full, name)).filter(name => fs.statSync(name).isFile()).map(name => [name, fs.readFileSync(name).toString('base64')]) : [[rel, fs.readFileSync(full).toString('base64')]];
  });
  const before = snapshot(), base = new URL(url);
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
    // Paged: every one of the 30 opportunities is reachable through Next, none twice.
    const seen = new Set();
    for (let pageNumber = 1; ; pageNumber++) {
      const summary = await page.getByTestId('monitor-page-summary').innerText();
      assert.match(summary, /30 qualified or reviewable opportunities\. Showing \d+–\d+ of 30/);
      for (const id of await page.getByTestId('monitor-opportunity').evaluateAll(cards => cards.map(card => card.id))) {assert.ok(!seen.has(id)); seen.add(id);}
      assert.equal(await page.getByTestId('monitor-eligibility-review').count(), await page.getByTestId('monitor-opportunity').count());
      const next = page.getByRole('button', {name: 'Next', exact: true});
      if (await next.isDisabled()) break;
      const first = await page.getByTestId('monitor-opportunity').first().getAttribute('id');
      await next.click(); await page.waitForFunction(id => document.querySelector('[data-testid="monitor-opportunity"]')?.id !== id, first);
      assert.ok(pageNumber < 5);
    }
    assert.equal(seen.size, 30);
    await page.getByTestId('monitor-cache-warning').waitFor();
    assert.equal(await page.getByRole('heading', {name: 'Local preparation tasks', exact: true}).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.equal(writes, 0); assert.equal(external, 0); assert.deepEqual(errors, []); assert.deepEqual(snapshot(), before);
});
