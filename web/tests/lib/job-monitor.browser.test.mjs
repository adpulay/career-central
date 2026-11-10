import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {liveServerSkip} from '../helpers/live-server.mjs';
const url = process.env.JOB_MONITOR_TEST_URL, root = process.env.JOB_MONITOR_TEST_ROOT;
test('monitor dashboard renders end-to-end results and persists decisions without application writes', {skip: liveServerSkip('JOB_MONITOR_TEST_URL', 'JOB_MONITOR_TEST_ROOT'), timeout: 120000}, async t => {
  assert.ok(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
  assert.equal(fs.readFileSync(path.join(root, '.career-central-fixture'), 'utf8'), 'fictional-only');
  const base = new URL(url), file = path.join(root, 'data/application-automation/ledger.json');
  const read = () => JSON.parse(fs.readFileSync(file)), before = read();
  const response = await fetch(new URL('/api/career-central/monitor', base));
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  const view = await response.json(); assert.equal(view.jobs.length, 1); assert.equal(view.alerts.length, 1); assert.equal(view.tasks.length, 1);
  assert.equal((await fetch(new URL('/api/career-central/monitor', base), {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://example.invalid', 'Sec-Fetch-Site': 'cross-site'}, body: '{}'})).status, 403);
  assert.equal((await fetch(new URL('/api/career-central/monitor', base), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({postingId: 'x'.repeat(3000)})})).status, 413);
  assert.equal((await fetch(new URL('/api/career-central/monitor', base), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({source: 'x', authorizeLiveRead: true})})).status, 400);
  const {chromium} = await import('playwright-core');
  const browser = await chromium.launch({executablePath: process.env.CAREER_CENTRAL_CHROME_EXECUTABLE, headless: true}); t.after(() => browser.close());
  const page = await browser.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
  await page.route('**/api/**', route => new URL(route.request().url()).pathname.startsWith('/api/career-central') ? route.continue() : route.fulfill({status: 200, contentType: 'application/json', body: '{}'}));
  for (const width of [375, 1440]) {
    await page.setViewportSize({width, height: 900}); await page.goto(new URL('/career-central', base).href);
    await page.getByRole('heading', {name: 'Job shortlist and posting monitor', exact: true}).waitFor();
    await page.getByRole('combobox', {name: 'Decision for Software Engineer I, New Grad 2027'}).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  }
  const select = page.getByRole('combobox', {name: 'Decision for Software Engineer I, New Grad 2027'});
  for (const decision of ['interested', 'dismissed', 'awaiting_application']) {
    await select.selectOption(decision);
    await page.waitForFunction(value => (document.querySelector('select[aria-label^="Decision for"]')).value === value && !document.querySelector('select[aria-label^="Decision for"]').disabled, decision);
    assert.equal(Object.values(read().jobMonitor.postings)[0].decision, decision);
  }
  await page.reload(); assert.equal(await select.inputValue(), 'awaiting_application');
  await page.getByRole('button', {name: 'Dismiss alert', exact: true}).click();
  await page.getByRole('heading', {name: 'Posting alerts', exact: true}).waitFor({state: 'hidden'});
  assert.deepEqual(read().jobs, before.jobs); assert.deepEqual(read().events, before.events);
  assert.deepEqual(errors, []); assert.ok(requests.every(request => new URL(request).origin === base.origin));
});
