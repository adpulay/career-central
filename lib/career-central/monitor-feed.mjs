// Reuse existing public ATS parsers and bounded SSRF-safe provider transport.
import greenhouse from '../../providers/greenhouse.mjs';
import lever from '../../providers/lever.mjs';
import ashby from '../../providers/ashby.mjs';
import {fetchResponse} from '../../providers/_http.mjs';
import {sourceFeed, validateSource} from './job-monitor.mjs';
const fail = code => Object.assign(Error(code), {code});
export function createFeedReader({request = fetchResponse} = {}) {
  return async (source, checkpoint, signal) => {
    validateSource(source);
    let calls = 0, etag = null, lastModified = null, transportError = null;
    const provider = {greenhouse, lever, ashby}[source.provider];
    const allowed = new URL(sourceFeed(source));
    const ctx = {log: () => {}, sleep: async () => {throw transportError ?? fail('MONITOR_RETRY_DEFERRED');},
      fetchText: () => {throw fail('MONITOR_FEED_ENDPOINT_REFUSED');}, fetchJson: async url => {
      if (signal?.aborted) throw fail('MONITOR_CANCELLED');
      const target = new URL(url), first = calls++ === 0;
      if (calls > 2 || target.origin !== allowed.origin ||
          !(target.pathname === allowed.pathname || source.provider === 'greenhouse' && target.pathname === allowed.pathname.replace(/\/jobs$/, '/offices'))) throw fail('MONITOR_FEED_ENDPOINT_REFUSED');
      const headers = {};
      if (first && checkpoint?.etag) headers['If-None-Match'] = checkpoint.etag;
      if (first && checkpoint?.lastModified) headers['If-Modified-Since'] = checkpoint.lastModified;
      let response;
      try {response = await request(target.href, {method: 'GET', redirect: 'error', timeoutMs: 20000, maxBytes: 8 * 1024 * 1024,
        headers, acceptNotModified: first && !!(checkpoint?.etag || checkpoint?.lastModified)});} catch (error) {transportError = error; throw error;}
      if (response.status === 304 && first && checkpoint) throw fail('MONITOR_NOT_MODIFIED');
      if (!response.ok) {transportError = Object.assign(fail('MONITOR_FEED_REQUEST_FAILED'), {status: response.status, retryAfter: response.headers.get('retry-after')}); throw transportError;}
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
      return body;
    }};
    try {
      const jobs = await provider.fetch({name: source.company, api: sourceFeed(source), careers_url: sourceFeed(source)}, ctx);
      if (transportError) throw transportError;
      return {jobs, complete: true, etag, lastModified};
    } catch (error) {if (error.code === 'MONITOR_NOT_MODIFIED') return {notModified: true}; throw error;}
  };
}
