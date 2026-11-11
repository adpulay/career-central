'use client';
import {useCallback, useEffect, useState} from 'react';
import {Card} from '@/components/ui/card';

type Job = {id: string; title: string; company: string; location: string; salary: string | null; url: string; decision: string; firstSeenAt: string; employerPublishedAt: string | null; publicationProvenance: string;
  match: {score: number; status: string; highPriority: boolean; reasons: string[]; unknowns: string[]; gaps: string[]; method: string}};
type View = {available: boolean; error?: string; totalJobs?: number; jobs?: Job[];
  sources?: {id: string; company: string; status: string; paused: boolean; intervalMinutes: number; lastSuccessAt: string | null; nextDueAt: string | null; failures: number}[];
  alerts?: {id: string; postingId: string; event: string; status: string; highPriority: boolean}[];
  tasks?: {id: string; postingId: string; status: string; requiredQuestions: string; missing: string[]; approvals: string[]; resume: {id: string} | null}[]};
const STATUS_LABELS: Record<string, string> = {qualified: 'Qualified', potentially_eligible: 'Potentially eligible — start date unconfirmed', needs_review: 'Needs review'};
const statusLabel = (status: string) => STATUS_LABELS[status] ?? status.replaceAll('_', ' ');
const when = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Unknown';
export function JobMonitor() {
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {const response = await fetch('/api/career-central/monitor', {cache: 'no-store'}); const result = await response.json(); setView(result); setError(response.ok ? '' : 'Monitor data unavailable; existing records were preserved.');}
    catch {setError('Could not load monitoring data.');}
  }, []);
  useEffect(() => {void refresh();}, [refresh]);
  async function save(body: Record<string, unknown>) {
    setBusy(true); setError('');
    try {const response = await fetch('/api/career-central/monitor', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      if (!response.ok) throw Error(); await refresh();
    } catch {setError('Change was not confirmed. Refresh before retrying.');} finally {setBusy(false);}
  }
  const button = 'min-h-10 rounded border border-border px-3 py-1 text-sm disabled:opacity-50';
  return <section className="mx-auto w-full max-w-6xl space-y-4 px-4 pb-10 sm:px-6" aria-labelledby="monitor-heading" data-testid="job-monitor">
    <Card corner="br" className="space-y-3">
      <h2 id="monitor-heading" className="text-xl font-semibold">Job shortlist and posting monitor</h2>
      <p className="text-sm text-muted">Local dashboard alerts and preparation proposals. Recurring monitoring is not activated. No applications are submitted here.</p>
      <button className={button} onClick={() => void refresh()} disabled={busy}>Refresh saved results</button>
      {error && <p role="alert" className="text-sm">{error}</p>}
      {!view && <p>Loading saved results…</p>}
      {view?.available && <>
        {view.sources?.some(source => source.status === 'cached_baseline') && <p className="text-sm font-medium" data-testid="monitor-cache-warning">Cached snapshot: live availability and employer eligibility still need verification.</p>}
        {!view.sources?.length && <p>No sources configured. Use the local monitor setup after reviewing the proposed employers.</p>}
        {view.sources?.map(source => <div key={source.id} className="flex flex-wrap items-center gap-3 border-t border-border pt-2 text-sm">
          <span>{source.company}: {source.status.replaceAll('_', ' ')}{source.paused ? ' (paused)' : ''}</span><span>Target: {source.intervalMinutes} min</span><span>Last success: {when(source.lastSuccessAt)}</span><span>Failures: {source.failures}</span>
          <button className={button} disabled={busy} onClick={() => void save({pausedSource: source.id, paused: !source.paused})}>{source.paused ? 'Allow future manual polls' : 'Pause source'}</button>
        </div>)}
      </>}
    </Card>
    {!!view?.alerts?.length && <Card corner="br" className="space-y-3"><h3 className="font-semibold">Posting alerts</h3>
      {view.alerts.map(alert => <div key={alert.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <a href={`#posting-${alert.postingId}`} className="underline">{view.jobs?.find(job => job.id === alert.postingId)?.title ?? 'Posting no longer in active shortlist'}: {alert.event.replaceAll('_', ' ')}{alert.highPriority ? ' · High priority' : ''}</a>
        <button className={button} disabled={busy} onClick={() => void save({alertId: alert.id, alertStatus: 'dismissed'})}>Dismiss alert</button>
      </div>)}</Card>}
    {view?.available && <p className="text-sm text-muted">{view.totalJobs ?? 0} qualified or reviewable opportunities. Showing up to 100; fit scores are heuristic, not hiring probabilities.</p>}
    {view?.jobs?.map(job => <Card corner="br" key={job.id} className="space-y-3" id={`posting-${job.id}`} data-testid="monitor-opportunity">
      <h3 className="font-semibold">{job.company} · {job.title}</h3>
      <p className="text-sm">{job.location || 'Location unknown'} · {job.salary || 'Salary unknown'} · {job.match.score}/100 · <span data-testid="monitor-match-status">{statusLabel(job.match.status)}</span>{job.match.highPriority ? ' · High priority' : ''}</p>
      <p className="text-xs text-muted">First seen: {when(job.firstSeenAt)} · Employer date: {when(job.employerPublishedAt)} ({job.publicationProvenance})</p>
      <p className="text-sm">{job.match.reasons.join(' · ')}</p>
      {job.match.status === 'potentially_eligible' && <p className="text-sm" data-testid="monitor-start-unconfirmed"><strong>All other checks passed.</strong> Confirm the employer start date before applying; it is not a known ineligibility.</p>}
      {job.match.status !== 'potentially_eligible' && !!job.match.unknowns.length && <p className="text-sm" data-testid="monitor-eligibility-review"><strong>Eligibility evidence incomplete.</strong> Needs review: {job.match.unknowns.join(' · ')}</p>}
      <details className="text-sm"><summary>Match evidence and gaps</summary><p>{job.match.gaps.join(' · ') || 'No additional gaps extracted.'}</p><p className="text-xs">Method: {job.match.method}</p></details>
      <a href={job.url} target="_blank" rel="noopener noreferrer" className="inline-block text-sm underline">View employer posting</a>
      <label className="block text-sm">Your decision <select aria-label={`Decision for ${job.title}`} className="ml-2 rounded border border-border bg-background p-2" disabled={busy} value={job.decision}
        onChange={event => void save({postingId: job.id, decision: event.target.value})}>
        <option value="unreviewed">Unreviewed</option><option value="interested">Interested</option><option value="dismissed">Dismissed</option><option value="awaiting_application">Awaiting application</option>
      </select></label>
    </Card>)}
    {!!view?.tasks?.length && <Card corner="br" className="space-y-3"><h3 className="font-semibold">Local preparation tasks</h3>
      {view.tasks.map(task => <div key={task.id} className="border-t border-border pt-2 text-sm"><p>{view.jobs?.find(job => job.id === task.postingId)?.title ?? 'Review posting'} · {task.status}</p>
        <p>Resume selection: {task.resume?.id ?? 'Approval needed'}. {task.requiredQuestions}.</p><p>{task.missing.join(' · ')}</p><p>Required: {task.approvals.join(' · ')}</p>
      </div>)}</Card>}
  </section>;
}
