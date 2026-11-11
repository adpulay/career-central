import {monitorApi, readMonitorView} from '@/lib/career-central/monitor-read.mjs';
import {checkRequest} from '@/lib/origin-guard.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'};
export async function GET(request: Request) {
  // Optional paging: ?offset=N&limit=M (integers; limit 1–100). Anything else is ignored.
  const params = new URL(request.url).searchParams, int = (value: string | null) => value !== null && /^\d{1,6}$/.test(value) ? Number(value) : undefined;
  const view = await readMonitorView({offset: int(params.get('offset')) ?? 0, limit: int(params.get('limit')) ?? 100});
  return Response.json(view, {status: view.available ? 200 : 503, headers});
}
export async function POST(request: Request) {
  const guard = checkRequest({host: request.headers.get('host'), origin: request.headers.get('origin'), secFetchSite: request.headers.get('sec-fetch-site'), allowedHosts: new Set()});
  if (!guard.ok) return Response.json({error: 'Request refused'}, {status: 403, headers});
  const reader = request.body?.getReader();
  if (!reader) return Response.json({error: 'Invalid decision'}, {status: 400, headers});
  const chunks: Uint8Array[] = []; let size = 0;
  try {for (;;) {const {value, done} = await reader.read(); if (done) break; size += value.length;
    if (size > 2048) {await reader.cancel(); return Response.json({error: 'Decision too large'}, {status: 413, headers});} chunks.push(value);}}
  catch {return Response.json({error: 'Invalid decision'}, {status: 400, headers});}
  let body: Record<string, unknown> | null = null;
  try {const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;} catch { /* fixed validation response below */ }
  const allowed = ['postingId', 'decision', 'alertId', 'alertStatus', 'pausedSource', 'paused'];
  if (!body || Object.keys(body).some(key => !allowed.includes(key)) ||
      ['postingId', 'decision', 'alertId', 'alertStatus', 'pausedSource'].some(key => body[key] !== undefined && (typeof body[key] !== 'string' || String(body[key]).length > 100))) return Response.json({error: 'Invalid decision'}, {status: 400, headers});
  try {
    const {core, root} = await monitorApi();
    // Core owner writes only monitor dispositions; this route cannot configure,
    // poll, prepare a form, approve a submission or change an application state.
    await core.setMonitorDecision(root, body);
    return Response.json({ok: true}, {headers});
  } catch {return Response.json({error: 'Decision not saved; refresh and inspect monitor state.'}, {status: 409, headers});}
}
