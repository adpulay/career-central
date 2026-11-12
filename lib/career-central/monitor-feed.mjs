// Reuse existing public ATS parsers and bounded SSRF-safe provider transport.
import greenhouse from '../../providers/greenhouse.mjs';
import lever from '../../providers/lever.mjs';
import ashby from '../../providers/ashby.mjs';
import {fetchResponse} from '../../providers/_http.mjs';
import {sourceFeed, validateSource} from './job-monitor.mjs';
const fail = code => Object.assign(Error(code), {code});
// Greenhouse `content=true` embeds every posting's HTML-escaped body, so large
// boards (~900 postings) exceed 8 MiB. Still a hard cap; stored postings keep
// only bounded excerpts.
export const MONITOR_MAX_FEED_BYTES = 24 * 1024 * 1024;
// Request phase for sanitized failure categories: the job list, or the optional
// /offices enrichment. An enrichment failure still fails the cycle, because a
// snapshot without it would change remote postings' locations (and content
// hashes) and produce spurious "updated" alerts on the next successful poll.
const tag = (error, phase) => {try {error.monitorPhase ??= phase;} catch { /* frozen error objects keep their own fields */ } return error;};
// Greenhouse `content=true` list rows carry each job's offices[] inline. When
// every row has them, the provider's /offices lookup is answered from the list
// itself: same names, so identical location strings (verified 478/478 against
// the endpoint on a live board), with no second multi-megabyte download. Any row
// without offices[] falls back to the real request.
export function inlineOffices(listBody) {
  const rows = Array.isArray(listBody?.jobs) ? listBody.jobs : null;
  if (!rows?.length || !rows.every(row => Array.isArray(row?.offices))) return null;
  const byName = new Map();
  for (const row of rows) for (const office of row.offices) {
    const name = typeof office?.name === 'string' ? office.name.trim() : '';
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({id: row.id});
  }
  return {offices: [...byName].map(([name, jobs]) => ({name, departments: [{jobs}]}))};
}
export function createFeedReader({request = fetchResponse} = {}) {
  return async (source, checkpoint, signal) => {
    validateSource(source);
    let calls = 0, etag = null, lastModified = null, transportError = null, listBody = null, officeSource = null;
    const provider = {greenhouse, lever, ashby}[source.provider];
    const allowed = new URL(sourceFeed(source));
    const ctx = {log: () => {}, sleep: async () => {throw transportError ?? fail('MONITOR_RETRY_DEFERRED');},
      fetchText: () => {throw fail('MONITOR_FEED_ENDPOINT_REFUSED');}, fetchJson: async url => {
      if (signal?.aborted) throw fail('MONITOR_CANCELLED');
      const target = new URL(url);
      if (calls > 0 && source.provider === 'greenhouse' && target.pathname.endsWith('/offices') && target.origin === allowed.origin) {
        const inline = inlineOffices(listBody);
        if (inline) {officeSource = 'inline'; return inline;}
        officeSource = 'endpoint';
      }
      const first = calls++ === 0;
      if (calls > 2 || target.origin !== allowed.origin ||
          !(target.pathname === allowed.pathname || source.provider === 'greenhouse' && target.pathname === allowed.pathname.replace(/\/jobs$/, '/offices'))) throw fail('MONITOR_FEED_ENDPOINT_REFUSED');
      const headers = {};
      if (first && checkpoint?.etag) headers['If-None-Match'] = checkpoint.etag;
      if (first && checkpoint?.lastModified) headers['If-Modified-Since'] = checkpoint.lastModified;
      let response;
      try {response = await request(target.href, {method: 'GET', redirect: 'error', timeoutMs: 20000, maxBytes: MONITOR_MAX_FEED_BYTES,
        headers, acceptNotModified: first && !!(checkpoint?.etag || checkpoint?.lastModified)});} catch (error) {transportError = tag(error, first ? 'list' : 'enrichment'); throw error;}
      if (response.status === 304 && first && checkpoint) throw fail('MONITOR_NOT_MODIFIED');
      if (!response.ok) {transportError = Object.assign(fail('MONITOR_FEED_REQUEST_FAILED'), {status: response.status, retryAfter: response.headers.get('retry-after'), monitorPhase: first ? 'list' : 'enrichment'}); throw transportError;}
      const body = await response.json();
      if (first) {
        if (source.provider === 'lever' ? !Array.isArray(body) : !Array.isArray(body?.jobs)) throw fail('MONITOR_FEED_SHAPE_INVALID');
        // Reject malformed entries before legacy provider filtering could turn a
        // partial/broken response into an apparently complete empty snapshot.
        const rows = source.provider === 'lever' ? body : body.jobs;
        if (body?.nextPageToken || body?.hasMore === true || source.provider === 'greenhouse' && body.meta?.total !== undefined && body.meta.total !== rows.length) throw fail('MONITOR_FEED_INCOMPLETE');
        if (rows.length > 2000 || rows.some(row => !row?.id || !(source.provider === 'greenhouse' ? row.absolute_url : source.provider === 'lever' ? row.hostedUrl : row.jobUrl))) throw fail('MONITOR_FEED_SHAPE_INVALID');
        etag = response.headers.get('etag')?.slice(0, 512) ?? null;
        lastModified = response.headers.get('last-modified')?.slice(0, 128) ?? null;
      }
      if (first) listBody = body;
      return body;
    }};
    try {
      const jobs = await provider.fetch({name: source.company, api: sourceFeed(source), careers_url: sourceFeed(source)}, ctx);
      if (transportError) throw transportError;
      return {jobs, complete: true, etag, lastModified, officeSource, requests: calls};
    } catch (error) {if (error.code === 'MONITOR_NOT_MODIFIED') return {notModified: true}; throw error;}
  };
}
