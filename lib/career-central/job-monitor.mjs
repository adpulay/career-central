// Local source/shortlist owner extension. No timers, network or browser on import.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {storeFor} from './monitor-store.mjs';
import {monitorHealth} from './monitor-scheduler.mjs';
import {checkPath} from '../../web/src/lib/core/operational-files.mjs';
import {getCareerOpsRoot, resolveTrackerPath} from '../../path-resolver.mjs';
import {resolveColumns, parseTrackerRow, extractReqNumber} from '../../tracker-parse.mjs';
import {createAdmissionGate} from '../admission-gate.mjs';
import {evaluateJob, canonicalJobKey} from '../applications/discovery.mjs';
import {loadYaml} from '../yaml-document.mjs';
import {loadBlacklist} from '../../scan.mjs';

const fail = code => Object.assign(Error(code), {code});
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = time => new Date(time).toISOString();
const text = (value, max = 200) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, max) : '';
const activeHistory = /^(Applied|Responded|Assessment|Interview|Hired|Submitted|Interviewing|Offer|Rejected|Application Started|Awaiting Approval)$/i;
export function validateSource(source) {
  if (!source || !/^[a-z0-9_-]{1,64}$/.test(source.id || '') || !/^[a-z0-9_-]{1,100}$/i.test(source.board || '') ||
      ['__proto__', 'constructor', 'prototype'].includes(source.id) ||
      !['greenhouse', 'lever', 'ashby'].includes(source.provider) || !text(source.company).trim() ||
      !Number.isInteger(source.intervalMinutes) || source.intervalMinutes < 5 || source.intervalMinutes > 1440) throw fail('MONITOR_SOURCE_INVALID');
}
export function sourceFeed(source) {
  validateSource(source);
  return source.provider === 'greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${source.board}/jobs` :
    source.provider === 'lever' ? `https://api.lever.co/v0/postings/${source.board}?mode=json` : `https://api.ashbyhq.com/posting-api/job-board/${source.board}`;
}
// Configured sources (kept, possibly unauthorized) are capped at 8; each has its
// own storage partition. Recurring polling is limited separately by the explicit
// authorization's source list and per-tick budget.
export const MAX_CONFIGURED_SOURCES = 8;
export async function configureSources(root, sources) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_CONFIGURED_SOURCES || new Set(sources.map(s => s.id)).size !== sources.length || new Set(sources.map(s => `${s.provider}:${s.board}`)).size !== sources.length) throw fail('MONITOR_SOURCE_INVALID');
  sources.forEach(validateSource);
  return storeFor(root).updateAll(monitor => {
    if (Object.keys(monitor.sources).length + sources.length > MAX_CONFIGURED_SOURCES) throw fail('MONITOR_SOURCE_INVALID');
    for (const source of sources) {
      if (monitor.sources[source.id] || Object.values(monitor.sources).some(existing => existing.definition.provider === source.provider && existing.definition.board === source.board)) throw fail('MONITOR_SOURCE_EXISTS');
      monitor.sources[source.id] = {definition: {id: source.id, board: source.board, provider: source.provider, company: text(source.company), intervalMinutes: source.intervalMinutes},
        checkpoint: null, nextDueAt: null, lastAttemptAt: null, lastSuccessAt: null, failures: 0, status: 'not_started', lease: null, cycles: 0, unchanged: 0};
    }
    monitor.revision++;
    return {configured: sources.length, recurringEnabled: false};
  });
}
export function readMonitor(root = getCareerOpsRoot()) {
  return storeFor(root).readAll();
}
export function loadMatchingContext(root = getCareerOpsRoot()) {
  function json(relative) {
    const file = path.join(root, relative); checkPath(file);
    const stat = fs.statSync(file); if (stat.size > 2 * 1024 * 1024) throw fail('MATCH_PROFILE_INVALID');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const policy = json('data/application-automation/policy.json'), profile = json('data/application-automation/profile.json');
  if (!policy.discovery || !profile.authorization || !profile.standardAnswers || !Array.isArray(profile.education)) throw fail('MATCH_PROFILE_INVALID');
  const portalsFile = path.join(root, 'portals.yml'); checkPath(portalsFile);
  const portals = loadYaml(fs.readFileSync(portalsFile, 'utf8'));
  const trackerFile = resolveTrackerPath(root); checkPath(trackerFile);
  let history = [];
  try {
    if (fs.statSync(trackerFile).size > 8 * 1024 * 1024) throw fail('MATCH_HISTORY_INVALID');
    const lines = fs.readFileSync(trackerFile, 'utf8').split(/\r?\n/), columns = resolveColumns(lines);
    history = lines.map(line => parseTrackerRow(line, columns)).filter(Boolean).map(row => ({url: row.url, company: row.company, status: row.status, requisitionId: extractReqNumber(row.notes)}));
    if (lines.some(line => line.trim()) && !history.length && !lines.some(line => /^\|.*(?:Status|Estado).*\|/i.test(line))) throw fail('MATCH_HISTORY_INVALID');
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
  const blacklistFile = path.join(root, 'data/blacklist.md'); checkPath(blacklistFile);
  return {policy, profile, portals, history, blacklist: loadBlacklist(blacklistFile)};
}
const skillPattern = skill => new RegExp(`(?<![a-z0-9])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i');
// "Experience with Rust isn't required", "willingness to learn", "preferred":
// the sentence names the skill without making it mandatory.
const NOT_MANDATORY = /(?:\bnot\b|n[’']t\b|\bno\b)[^.;]{0,40}\b(?:required|necessary|needed|mandatory|expected)\b|\bwillingness to learn\b|\bnice[- ]to[- ]have\b|\bpreferred\b|\ba plus\b|\bbonus\b/i;
// Negation is read only near each mention: bullet lists without punctuation
// arrive as one long "sentence", where a distant "preferred" says nothing
// about this skill. Any un-negated mention keeps the skill mandatory.
export const skillIsMandatory = (excerpt, skill) => [...excerpt.matchAll(new RegExp(skillPattern(skill).source, 'gi'))]
  .some(match => !NOT_MANDATORY.test(excerpt.slice(Math.max(0, match.index - 80), match.index + match[0].length + 100)));
export const START_UNCONFIRMED = 'Employer start date unconfirmed; confirm with employer before applying';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SEASONS = {spring: [1, 5], summer: [6, 8], fall: [9, 12], autumn: [9, 12]};
// Explicit posting graduation windows ("Graduation date in Fall 2027, Spring 2028
// ... or Summer 2029") compared with a verified YYYY-MM graduation. Returns null
// when no unambiguous window is stated, so silence never becomes a pass or a fail.
export function graduationWindow(textValue, graduationMonth) {
  const saved = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(String(graduationMonth || ''));
  if (!saved) return null;
  const target = Number(saved[1]) * 12 + Number(saved[2]);
  for (const clause of textValue.matchAll(/(?:graduat(?:ing|es?|ion)(?:\s+date)?|class of)([^\n.]{0,200})/gi)) {
    const body = clause[1];
    if (/\b(?:before|prior to|no later than|by|or earlier|winter)\b/i.test(body)) continue;
    const terms = [...body.matchAll(/\b(spring|summer|fall|autumn|january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/gi)].map(match => {
      const [label, term, year] = match, key = term.toLowerCase(), [from, to] = SEASONS[key] ?? [MONTHS.indexOf(key) + 1, MONTHS.indexOf(key) + 1];
      return {label, from: Number(year) * 12 + from, to: Number(year) * 12 + to, start: match.index, end: match.index + label.length};
    });
    // "Fall 2026-Summer 2027", "Fall 2026 to Summer 2027" and "between Fall 2026
    // and Summer 2027" are ranges covering every month between the two terms.
    const windows = [];
    for (let i = 0; i < terms.length; i++) {
      const next = terms[i + 1], gap = next ? body.slice(terms[i].end, next.start) : '';
      const range = next && (/^\s*(?:-|–|—|to|through|thru|until)\s*$/i.test(gap) || /^\s*and\s*$/i.test(gap) && /\bbetween\s*$/i.test(body.slice(0, terms[i].start)));
      if (range) {windows.push({label: `${terms[i].label}–${next.label}`, from: terms[i].from, to: next.to}); i++;}
      else windows.push(terms[i]);
    }
    if (!windows.length) continue;
    const openEnded = /\b(?:or later|or after|and beyond|onward|thereafter)\b/i.test(body);
    const inside = windows.some(w => target >= w.from && target <= w.to) || openEnded && target >= Math.min(...windows.map(w => w.from));
    return {inside, stated: windows.map(w => w.label).join(', ') + (openEnded ? ' or later' : ''), evidence: text(clause[0], 250)};
  }
  return null;
}
const monthKey = value => {
  const iso = /^(20\d{2})-(0[1-9]|1[0-2])/.exec(value);
  if (iso) return Number(iso[1]) * 12 + Number(iso[2]);
  const named = /^([a-z]+)\s+(20\d{2})$/i.exec(value.trim()), index = named ? MONTHS.indexOf(named[1].toLowerCase()) : -1;
  return index >= 0 ? Number(named[2]) * 12 + index + 1 : null;
};
const verifiedUsCitizen = authorization => {
  const citizenship = authorization?.citizenship, legacy = authorization?.us_citizen;
  // Same field and wording the Greenhouse answer mapper reads; work
  // authorization alone never implies citizenship.
  if (citizenship?.verified === true && typeof citizenship.value === 'string' &&
      /\bunited states citizen\b/i.test(citizenship.value) && !/\b(?:not|non)\b/i.test(citizenship.value)) return true;
  return legacy?.verified === true && legacy.value === true;
};
export function evaluateMonitoredJob(job, {policy, profile, portals = {}, history = [], blacklist = new Map()}, ledgerJobs = {}, now = Date.now()) {
  const skills = profile.technicalSkills?.verified === true ? Object.values(profile.technicalSkills.value || {}).flat().filter(skill => typeof skill === 'string') : [];
  const verifiedPolicy = {...policy, discovery: {...policy.discovery, resumeSkills: skills}};
  const base = evaluateJob(job, verifiedPolicy, now, profile), unknowns = [], exclusions = [...base.exclusions];
  const description = job.description || '', combined = `${job.title}\n${description}`;
  // Shared scanner filters; unknown geography remains reviewable rather than a
  // false eligibility pass. Seen history is evaluated with status separately.
  const gate = createAdmissionGate({config: portals, seen: new Set(), blacklist});
  const admission = gate.check(job);
  if (admission === 'title') exclusions.push('Configured title filter');
  if (admission === 'blacklisted') exclusions.push('Saved blacklist exclusion');
  if (admission === 'location' && !exclusions.some(value => /outside United States/i.test(value))) unknowns.push('Configured location filter requires review');
  const graduation = profile.education.find(item => item.graduation_month?.verified)?.graduation_month?.value;
  const gradYear = String(graduation || '').slice(0, 4);
  const window = graduationWindow(combined, graduation);
  if (window && !window.inside) exclusions.push(`Posting graduation window (${window.stated}) excludes saved graduation ${graduation}; verify quoted requirement`);
  const graduationKnown = window ? window.inside : gradYear && /graduat|new.grad|university.grad/i.test(combined) && combined.includes(gradYear);
  if (!graduationKnown) unknowns.push('Graduation window not explicitly confirmed by posting');
  const early = /new.grad|university.grad|early.career|entry.level|associate|junior|engineer\s*(?:I|1)\b/i.test(job.title);
  if (!early) unknowns.push('Entry-level seniority requires review');
  if (base.concerns.some(value => /experience minimum|Three.year requirement|Multiple internships/i.test(value))) unknowns.push('Experience minimum needs source-backed review');
  if (base.concerns.some(value => value.startsWith('Security clearance eligibility required'))) unknowns.push('Security clearance eligibility requires review');
  if (!skills.length) unknowns.push('Verified skills unavailable');
  const mentionedGaps = base.concerns.filter(value => value.startsWith('Technologies not established in resume')).flatMap(value => value.split(': ')[1]?.split(', ') ?? [])
    .filter(skill => !skills.some(known => known.toLowerCase() === skill.toLowerCase()));
  const mandatoryGaps = mentionedGaps.filter(skill => (base.requirements?.essentialExcerpts ?? []).some(excerpt => skillIsMandatory(excerpt, skill)));
  if (mandatoryGaps.length) unknowns.push('Required technical skill evidence needs review');
  const auth = profile.authorization?.us_work_authorized;
  if (auth?.verified !== true || auth.value !== true) unknowns.push('Verified work authorization unavailable');
  const citizenshipRequired = /\b(?:U\.?S\.? citizenship|U\.?S\.? citizen)\b/i.test(description), citizenVerified = verifiedUsCitizen(profile.authorization);
  if (citizenshipRequired && !citizenVerified) unknowns.push('Citizenship requirement requires verified answer');
  if (!job.location || /^(remote|hybrid|on.site|worldwide)$/i.test(job.location.trim())) unknowns.push('US geographic eligibility not explicit');
  if (!description.trim()) unknowns.push('Job description missing');
  if (job.descriptionTruncated) unknowns.push('Job description exceeds evaluation bound; full requirements need review');
  // Explicit earlier cohort/start constraints block readiness, without guessing
  // that any mention of an older year is a requirement.
  const cohorts = [...combined.matchAll(/(?:graduat(?:ing|es?|ion)?|class of)([^\n.]{0,100})/gi)].flatMap(match => [...match[1].matchAll(/\b(20\d{2})\b/g)].map(value => Number(value[1])));
  if (cohorts.length && gradYear && cohorts.every(year => year < Number(gradYear))) exclusions.push('Posting graduation cohort precedes saved graduation');
  const availability = profile.standardAnswers?.full_time_start;
  // Job start phrasing only ("start date: June 2027", "starting in June 2027");
  // "Starting January 2027, we will match 401(k)..." describes benefits, not a start.
  const start = description.match(/(?:\bstart date\s*(?:is|of)?\s*:?|\bstart(?:ing)?\s+(?:in|on)|\bbegin(?:ning)?\s+(?:in|on))\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2})/i);
  // Month precision on both sides (no local-timezone Date.parse). The saved
  // full-time availability never resolves an internship's start; an unstated
  // or month-less employer start stays unresolved.
  const internshipRole = /\bintern(?:ship)?\b/i.test(job.title);
  const startMonth = start ? monthKey(start[1]) : null, availableMonth = availability?.verified === true && typeof availability.value === 'string' ? monthKey(availability.value) : null;
  // Candidate-side and employer-side gaps are distinct: missing verified
  // availability needs the user; an unstated employer start is confirmed with
  // the employer and is never treated as ineligibility.
  const availabilityKnown = availableMonth !== null && availability.provisional !== true;
  if (!availabilityKnown) unknowns.push('Verified availability unavailable or provisional');
  const startEvidence = internshipRole ? 'internship_not_compared' : !start ? 'employer_unspecified' : !startMonth ? 'employer_month_unparsed'
    : !availabilityKnown ? 'availability_unverified' : startMonth < availableMonth ? 'conflict' : 'compatible';
  if (['internship_not_compared', 'employer_unspecified', 'employer_month_unparsed'].includes(startEvidence)) unknowns.push(START_UNCONFIRMED);
  if (startEvidence === 'conflict') exclusions.push('Explicit start precedes verified availability');
  // A cached or excerpted description is not current eligibility evidence.
  if (job.descriptionProvenance === 'cached_snapshot') unknowns.push('Cached job description is not current eligibility evidence; verify the live posting');
  if (job.descriptionProvenance === 'stored_excerpt') unknowns.push('Only a stored description excerpt is available; full current requirements need review');
  const prior = [...history, ...Object.values(ledgerJobs)].filter(row => {
    if (!activeHistory.test(row.status || '') && !row.lastSubmission?.mayHaveBeenAccepted && !row.lastSubmission?.verificationRequired && !row.activeSubmission) return false;
    try {if (canonicalJobKey(row) === canonicalJobKey(job)) return true;} catch { /* no URL: requisition evidence below */ }
    const req = row.requisitionId || row.requisitionGroup?.split(':').slice(1).join(':');
    return req && job.requisitionId && String(req).toLowerCase() === String(job.requisitionId).toLowerCase() && String(row.company).toLowerCase() === job.company.toLowerCase();
  });
  if (prior.length) unknowns.push('Existing application or unresolved attempt: reconciliation required');
  const externalHistory = profile.applicationHistory?.[canonicalJobKey(job)] ?? profile.employerApplicationHistory?.[job.company.toLowerCase()];
  if (!prior.length && !(externalHistory?.verified === true && externalHistory.neverApplied === true)) unknowns.push('Outside-ledger application history requires confirmation');
  if (/\bintern(?:ship)?\b/i.test(job.title)) unknowns.push('Internship enrollment/after-graduation eligibility requires review');
  const weights = policy.discovery?.searchEmphasis;
  const family = /cloud|devops|platform|infrastructure|site reliability|\bsre\b/i.test(job.title) ? 'cloudInfrastructure' : /consult|\bAI\b|machine learning|solutions|implementation/i.test(job.title) ? 'consultingAI' : 'softwareEngineering';
  const weight = weights?.[family];
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) unknowns.push('Saved role-family weight missing');
  const allWeights = ['cloudInfrastructure', 'softwareEngineering', 'consultingAI'].map(key => weights?.[key]);
  if (allWeights.some(value => !Number.isFinite(value) || value < 0 || value > 1) || Math.abs(allWeights.reduce((a, b) => a + b, 0) - 1) > .001) unknowns.push('Saved role weights require review');
  const score = Math.min(95, Math.max(0, base.matchScore + Math.round((Number.isFinite(weight) ? weight : 0) * 10)));
  // potentially_eligible: every other check passed and the employer start date
  // is the only open item. It may rank, alert and receive a preparation
  // proposal, but the start date stays a submission blocker.
  const openItems = unknowns.filter(value => value !== START_UNCONFIRMED);
  const status = exclusions.length ? 'excluded' : openItems.length || base.eligibility === 'needs_information' ? 'needs_review'
    : unknowns.includes(START_UNCONFIRMED) ? 'potentially_eligible' : 'qualified';
  const submissionBlockers = status === 'excluded' ? ['Excluded'] : [...new Set(unknowns)];
  return {status, score, method: 'existing-heuristic+saved-role-weight:v1', profileDigest: hash({discovery: policy.discovery, profile}),
    reasons: [...base.reasons, `Saved role-family emphasis: ${family} (${Math.round((Number.isFinite(weight) ? weight : 0) * 100)}%)`],
    gaps: [...base.concerns.filter(value => !value.startsWith('Technologies not established in resume')), ...(mentionedGaps.length ? [`Posting technologies not established in verified skills: ${mentionedGaps.join(', ')}`] : []),
      ...(mandatoryGaps.length ? [`Stated as required: ${mandatoryGaps.join(', ')}`] : [])], exclusions: [...new Set(exclusions)], unknowns: [...new Set(unknowns)], family,
    highPriority: ['qualified', 'potentially_eligible'].includes(status) && score >= (policy.discovery?.monitorHighPriorityScore ?? 70),
    submissionReady: false, submissionBlockers, startDate: startEvidence,
    evidence: {graduation: window ? `${window.inside ? 'posting_window' : 'posting_window_conflict'}+verified_profile: ${window.evidence}` : graduationKnown ? 'posting_year+verified_profile' : 'unknown',
      description: job.descriptionProvenance ?? 'live_or_fixture_feed', citizenship: citizenshipRequired ? citizenVerified ? 'verified_profile' : 'unknown' : 'not_mentioned', location: admission === 'location' ? 'review' : 'configured_filter',
      authorization: auth?.verified ? 'verified_profile; employer answers still require review' : 'unknown',
      requiredExcerpts: (base.requirements?.essentialExcerpts ?? []).slice(0, 6).map(value => text(value, 250)), preferredExcerpts: (base.requirements?.preferredExcerpts ?? []).slice(0, 4).map(value => text(value, 250)),
      compensation: job.salary || 'Not supplied; no inferred salary', priorApplicationCount: prior.length}};
}

function normalized(raw, source, now) {
  if (!raw || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 500 || typeof raw.location !== 'string' ||
      typeof raw.url !== 'string' || raw.description != null && typeof raw.description !== 'string') throw fail('MONITOR_POSTING_INVALID');
  const url = new URL(raw.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw fail('MONITOR_POSTING_INVALID');
  const listing = raw.listingIdentity;
  const native = raw.externalId || listing?.posting_id || raw.requisitionId;
  if (!native || !/^[a-zA-Z0-9_.:-]{1,150}$/.test(String(native))) throw fail('MONITOR_POSTING_ID_REQUIRED');
  if (listing && (listing.ats_provider !== source.provider || listing.board_slug !== source.board)) throw fail('MONITOR_POSTING_INVALID');
  const id = hash([source.provider, source.board, String(native)]);
  const published = typeof raw.postedAt === 'number' && Number.isFinite(raw.postedAt) && raw.postedAt > 0 && raw.postedAt <= now ? iso(raw.postedAt) : null;
  const job = {id, company: source.company, title: text(raw.title, 500), location: text(raw.location, 500), url: url.href,
    requisitionId: raw.requisitionId ? String(raw.requisitionId) : null, postingId: String(raw.externalId || listing?.posting_id || native),
    description: (raw.description || '').slice(0, 40000), descriptionTruncated: (raw.description || '').length > 40000, salary: text(raw.salary, 300) || null};
  return {...job, canonicalKey: canonicalJobKey(job), employerPublishedAt: published,
    publicationProvenance: published ? source.provider === 'lever' ? 'provider_createdAt; not verified publication' : 'provider_publication_field' : 'unknown',
    contentHash: hash([job.title, job.location, raw.description || '', job.salary])};
}

export async function pollSource({root, sourceId, context, fetchSnapshot, mode = 'fixture', authorizeLiveRead = false,
  now = Date.now(), random = Math.random, signal, phaseHook, requireFirstLiveBaseline = false}) {
  if (!['fixture', 'cache', 'live'].includes(mode)) throw fail('MONITOR_MODE_INVALID');
  if (mode === 'live' && authorizeLiveRead !== true) throw fail('MONITOR_LIVE_NOT_AUTHORIZED');
  if (signal?.aborted) throw fail('MONITOR_CANCELLED');
  const token = randomUUID(), cycleStarted = performance.now();
  const store = storeFor(root);
  const claim = await store.updateSource(sourceId, monitor => {
    const source = Object.hasOwn(monitor.sources, sourceId) ? monitor.sources[sourceId] : null;
    if (!source) throw fail('MONITOR_SOURCE_UNKNOWN');
    if (requireFirstLiveBaseline && source.checkpoint?.provenance === 'live_feed') return {skipped: 'live_baseline_exists'};
    if (source.lastSuccessAt && Date.parse(source.lastSuccessAt) > now) throw fail('MONITOR_CLOCK_REVIEW_REQUIRED');
    if (source.paused) return {skipped: 'paused'};
    if (source.lease && source.lease.until > now) return {skipped: 'busy'};
    if (source.nextDueAt && Date.parse(source.nextDueAt) > now) return {skipped: 'not_due'};
    source.lease = {token, until: now + 90000}; source.lastAttemptAt = iso(now); source.status = 'polling'; monitor.revision++;
    const baseline = mode === 'live' ? source.checkpoint?.provenance !== 'live_feed' : !source.checkpoint;
    return {definition: structuredClone(source.definition), checkpoint: mode === 'live' && baseline ? null : structuredClone(source.checkpoint), baseline};
  });
  if (claim.skipped) return claim;
  try {
    phaseHook?.('claimed');
    const snapshot = await fetchSnapshot(claim.definition, claim.checkpoint, signal);
    if (signal?.aborted) throw fail('MONITOR_CANCELLED');
    if (!snapshot || snapshot.notModified !== true && (!Array.isArray(snapshot.jobs) || snapshot.jobs.length > 2000 || snapshot.complete !== true)) throw fail('MONITOR_SNAPSHOT_INVALID');
    const descriptionProvenance = mode === 'cache' ? 'cached_snapshot' : mode === 'live' ? 'live_feed' : 'fixture_feed';
    const rows = snapshot.notModified ? [] : snapshot.jobs.map(row => ({...normalized(row, claim.definition, now), descriptionProvenance}));
    const grouped = new Map();
    for (const row of rows) {
      if (grouped.has(row.id) && grouped.get(row.id).contentHash !== row.contentHash) throw fail('MONITOR_CONFLICTING_DUPLICATE');
      if ([...grouped.values()].some(other => other.id !== row.id && other.canonicalKey === row.canonicalKey)) continue;
      grouped.set(row.id, row);
    }
    phaseHook?.('fetched');
    return await store.updateSource(sourceId, (monitor, ledgerJobs) => {
      const source = monitor.sources[sourceId];
      if (source.lease?.token !== token || source.lease.until < now + Math.max(0, performance.now() - cycleStarted)) throw fail('MONITOR_LEASE_LOST');
      if (source.paused) throw fail('MONITOR_PAUSED');
      if (snapshot.notModified && (!source.checkpoint || claim.baseline)) throw fail('MONITOR_SNAPSHOT_INVALID');
      const counts = {new: 0, updated: 0, duplicates: rows.length - grouped.size, alerts: 0, preparationTasks: 0};
      const seen = new Set();
      for (const incoming of grouped.values()) {
        const alias = Object.values(monitor.postings).find(other => other.sourceId === sourceId && other.canonicalKey === incoming.canonicalKey);
        const row = alias && !monitor.postings[incoming.id] ? {...incoming, id: alias.id} : incoming;
        seen.add(row.id);
        const previous = monitor.postings[row.id], returned = previous?.availability === 'expired';
        const changed = previous && previous.contentHash !== row.contentHash;
        const related = Object.values(monitor.postings).find(other => other.id !== row.id && other.company === row.company && other.title === row.title);
        const event = claim.baseline ? 'baseline' : !previous ? row.publicationProvenance === 'provider_publication_field' && row.employerPublishedAt && Date.parse(row.employerPublishedAt) >= Date.parse(source.checkpoint.checkedAt) ? 'newly_published' : 'newly_discovered' : returned ? 'reappeared' : changed ? 'updated' : 'unchanged';
        const match = evaluateMonitoredJob(row, context, ledgerJobs, now);
        const version = previous ? previous.version + (changed || returned ? 1 : 0) : 1;
        const posting = {...row, description: row.description.slice(0, 1000), sourceId, firstSeenAt: previous?.firstSeenAt ?? iso(now),
          // Last change or (re)appearance; snapshot-level observation is source.lastObservedAt.
          lastSeenAt: previous && !changed && !returned && previous.availability === 'listed' ? previous.lastSeenAt : iso(now),
          version, event, relatedPostingId: related?.id ?? null, relationship: returned ? 'reappeared; possible repost, not independently verified' : related ? 'possible_repost_or_distinct_opening; review' : null,
          decision: previous?.decision ?? 'unreviewed', availability: 'listed', missingCount: 0, match};
        if (match.status === 'excluded') {
          posting.description = '';
          posting.match = {...match, reasons: [], gaps: [], unknowns: [], evidence: {...match.evidence, requiredExcerpts: [], preferredExcerpts: []}};
        }
        monitor.postings[row.id] = posting;
        if (!previous) counts.new++; else if (changed || returned) counts.updated++;
        if (!['baseline', 'unchanged'].includes(event) && match.status !== 'excluded' && posting.decision !== 'dismissed') {
          const eventId = hash([row.id, version]);
          if (!monitor.alerts[eventId]) {monitor.alerts[eventId] = {id: eventId, postingId: row.id, version, createdAt: iso(now), status: 'unread', event, highPriority: match.highPriority}; counts.alerts++;}
          if (match.highPriority && !Object.values(monitor.preparationTasks).some(task => task.postingId === row.id)) {
            const resume = context.profile.resumeVersions?.find(item => item.approved === true && /^[a-f0-9]{64}$/i.test(item.sha256 || ''));
            monitor.preparationTasks[row.id] = {id: row.id, postingId: row.id, eventId, createdAt: iso(now), status: 'proposal',
              resume: resume ? {id: text(resume.id), sha256: resume.sha256, integrity: 'selection_only; verify bytes before use'} : null,
              requiredQuestions: 'Not inspected; no employer form accessed', missing: [...match.unknowns, ...(!resume ? ['Approved resume required'] : [])],
              approvals: ['Review opportunity', 'Verify resume and answers', 'Authorize preparation before employer access', 'Final submission approval']}; counts.preparationTasks++;
          }
        }
      }
      if (!snapshot.notModified) for (const posting of Object.values(monitor.postings)) {
        if (posting.sourceId === sourceId && !seen.has(posting.id)) {
          if (posting.availability === 'expired') continue; // already expired: nothing new to record
          posting.missingCount++;
          if (mode === 'live' && claim.baseline) {posting.availability = 'not_seen_in_live_baseline'; posting.event = 'baseline_absent';}
          if (posting.missingCount >= 2) {posting.availability = 'expired'; posting.event = 'expired';}
        }
      }
      phaseHook?.('before_checkpoint');
      source.checkpoint = {checkedAt: iso(now), provenance: mode === 'cache' ? 'existing_discovery_cache' : mode === 'fixture' ? 'synthetic' : 'live_feed', etag: snapshot.notModified ? source.checkpoint?.etag ?? null : snapshot.etag ?? null, lastModified: snapshot.notModified ? source.checkpoint?.lastModified ?? null : snapshot.lastModified ?? null};
      if (mode !== 'cache') source.lastObservedAt = iso(now); // a 304 also confirms the listed postings
      source.lastSuccessAt = mode === 'cache' ? null : iso(now); source.status = mode === 'cache' ? 'cached_baseline' : snapshot.notModified ? 'unchanged' : 'healthy'; source.failures = 0;
      source.errorCategory = null;
      source.cycles++; if (snapshot.notModified) source.unchanged++;
      source.quietCycles = !claim.baseline && !counts.new && !counts.updated ? (source.quietCycles ?? 0) + 1 : 0;
      source.adaptiveMinutes = Math.min(1440, source.definition.intervalMinutes * Math.min(4, 1 + Math.floor(source.quietCycles / 4)));
      source.pollLagSeconds = claim.checkpoint && source.nextDueAt ? Math.max(0, (now - Date.parse(source.nextDueAt)) / 1000) : 0;
      source.nextDueAt = mode === 'cache' ? null : iso(now + source.adaptiveMinutes * 60000 + Math.floor(random() * 15000));
      source.lease = null; monitor.revision++;
      source.lastCycle = {at: iso(now), baseline: claim.baseline, new: counts.new, updated: counts.updated, alerts: counts.alerts, notModified: snapshot.notModified === true};
      return {state: source.status, baseline: claim.baseline, ...counts, recurringEnabled: false, submittedApplications: 0};
    }, {capacityCheck: true});
  } catch (error) {
    await store.updateSource(sourceId, monitor => {
      const source = monitor.sources[sourceId];
      if (source?.lease?.token !== token) return;
      source.failures = Math.min(12, source.failures + 1); source.status = signal?.aborted ? 'cancelled' : error.status === 429 ? 'rate_limited' : 'failed';
      source.errorCategory = failureCategory(error);
      const retryAfter = Number(error.retryAfter), retryDate = Date.parse(error.retryAfter);
      const retryMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Number.isFinite(retryDate) ? Math.max(0, retryDate - now) : 0;
      source.nextDueAt = iso(now + Math.max(retryMs, Math.min(86400000, source.definition.intervalMinutes * 60000 * 2 ** Math.min(8, source.failures))) + Math.floor(random() * 15000));
      source.lease = null; monitor.revision++;
    });
    return {state: 'failed', errorCategory: error.code === 'OPERATION_COMMIT_UNCERTAIN' ? 'persistence_outcome_uncertain' : error.status === 429 ? 'rate_limit' : 'poll_failed', checkpointAdvanced: error.code === 'OPERATION_COMMIT_UNCERTAIN' ? 'unknown' : false};
  }
}

// Sanitized, specific failure category: never provider response text.
export function failureCategory(error) {
  const enrichment = error?.monitorPhase === 'enrichment' ? 'enrichment_' : '';
  if (error?.status === 429) return 'rate_limit';
  if (Number.isFinite(error?.maxBytes)) return `${enrichment}response_too_large`;
  if (['AbortError', 'TimeoutError'].includes(error?.name) || /\b(abort|timed? ?out)/i.test(error?.message || '') && !/^MONITOR_/.test(error?.code || '')) return `${enrichment}timeout`;
  if (Number.isInteger(error?.status)) return `${enrichment}http_${error.status}`;
  if (/^MONITOR_/.test(error?.code || '')) return error.code;
  return `${enrichment}provider_unavailable`;
}

export async function setMonitorDecision(root, {postingId, decision, alertId, alertStatus, pausedSource, paused}) {
  if ([postingId, alertId, pausedSource].filter(Boolean).length !== 1) throw fail('MONITOR_DECISION_INVALID');
  return storeFor(root).updateAll(monitor => {
    if (pausedSource) {
      if (!Object.hasOwn(monitor.sources, pausedSource) || typeof paused !== 'boolean') throw fail('MONITOR_DECISION_INVALID');
      monitor.sources[pausedSource].paused = paused;
    } else if (alertId) {
      if (!Object.hasOwn(monitor.alerts, alertId) || !['read', 'dismissed', 'unread'].includes(alertStatus)) throw fail('MONITOR_DECISION_INVALID');
      monitor.alerts[alertId].status = alertStatus;
    } else {
      if (!Object.hasOwn(monitor.postings, postingId) || !['interested', 'dismissed', 'awaiting_application', 'unreviewed'].includes(decision)) throw fail('MONITOR_DECISION_INVALID');
      monitor.postings[postingId].decision = decision;
    }
    monitor.revision++; return {ok: true};
  });
}

// Paged read model: `offset`/`limit` (1–100, default 100) page through every
// reviewable posting; `page` reports the window so the UI can reach all of them.
export function monitorView(root = getCareerOpsRoot(), {now = Date.now(), offset = 0, limit = 100} = {}) {
  const monitor = readMonitor(root), all = Object.values(monitor.postings);
  const tier = {qualified: 0, potentially_eligible: 1, needs_review: 2};
  const jobs = all.filter(job => job.match.status !== 'excluded' && job.availability === 'listed')
    .sort((a, b) => (tier[a.match.status] ?? 3) - (tier[b.match.status] ?? 3) || b.match.score - a.match.score || a.id.localeCompare(b.id));
  const health = monitorHealth(monitor, now);
  return {available: true, revision: monitor.revision, recurringEnabled: !!health.authorization, recurringInstalled: false, storage: storeFor(root).backend(), health,
    sources: Object.entries(monitor.sources).map(([id, source]) => ({id, company: source.definition.company, provider: source.definition.provider,
      intervalMinutes: source.definition.intervalMinutes, status: source.status, paused: source.paused ?? false, lastSuccessAt: source.lastSuccessAt,
      adaptiveMinutes: source.adaptiveMinutes ?? source.definition.intervalMinutes,
      nextDueAt: source.nextDueAt, errorCategory: source.errorCategory ?? null, failures: source.failures, cycles: source.cycles, unchanged: source.unchanged, pollLagSeconds: source.pollLagSeconds ?? null})),
    ...(() => {
      const size = Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 100;
      const start = Number.isInteger(offset) && offset >= 0 ? Math.min(offset, Math.max(0, jobs.length - 1)) : 0;
      // A listed posting was last seen at its source's latest complete observation.
      const seen = job => job.availability === 'listed' && monitor.sources[job.sourceId]?.lastObservedAt > (job.lastSeenAt ?? '') ? monitor.sources[job.sourceId].lastObservedAt : job.lastSeenAt;
      return {jobs: jobs.slice(start, start + size).map(({description, ...job}) => ({...job, lastSeenAt: seen(job)})), page: {offset: start, limit: size, total: jobs.length}};
    })(),
    totalJobs: jobs.length,
    alerts: Object.values(monitor.alerts).filter(alert => alert.status !== 'dismissed').slice(-100).reverse()
      .map(alert => ({...alert, title: monitor.postings[alert.postingId]?.title ?? null, company: monitor.postings[alert.postingId]?.company ?? null})),
    tasks: Object.values(monitor.preparationTasks).slice(-100),
    counts: {discovered: all.length, qualified: all.filter(job => job.match.status === 'qualified').length, potentiallyEligible: all.filter(job => job.match.status === 'potentially_eligible').length, review: all.filter(job => job.match.status === 'needs_review').length,
      excluded: all.filter(job => job.match.status === 'excluded').length, highPriority: jobs.filter(job => job.match.highPriority).length},
    submittedApplications: 0};
}

export async function seedCachedShortlist({root = getCareerOpsRoot(), sourceId}) {
  const monitor = readMonitor(root), source = Object.hasOwn(monitor.sources, sourceId) ? monitor.sources[sourceId] : null;
  if (!source || source.checkpoint) throw fail('MONITOR_CACHE_BASELINE_ONLY');
  const cacheFile = path.join(root, 'data/discovery/raw-latest.json'); checkPath(cacheFile, {allowMissing: false});
  if (fs.statSync(cacheFile).size > 128 * 1024 * 1024) throw fail('MONITOR_CACHE_INVALID');
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')), asOf = Date.parse(cache.generatedAt);
  if (!Array.isArray(cache.jobs) || cache.jobs.length > 30000 || !Number.isFinite(asOf) || asOf > Date.now()) throw fail('MONITOR_CACHE_INVALID');
  const jobs = cache.jobs.filter(job => job.listingIdentity?.ats_provider === source.definition.provider && job.listingIdentity?.board_slug === source.definition.board);
  if (!jobs.length) throw fail('MONITOR_CACHE_NO_MATCH');
  return pollSource({root, sourceId, context: loadMatchingContext(root), mode: 'cache', now: asOf,
    fetchSnapshot: async () => ({jobs, complete: true})});
}

// Full descriptions from the existing discovery cache, keyed by provider/board/posting.
export function loadCachedDescriptions(root = getCareerOpsRoot()) {
  const cacheFile = path.join(root, 'data/discovery/raw-latest.json'); checkPath(cacheFile, {allowMissing: true});
  if (!fs.existsSync(cacheFile)) return new Map();
  if (fs.statSync(cacheFile).size > 128 * 1024 * 1024) throw fail('MONITOR_CACHE_INVALID');
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  if (!Array.isArray(cache.jobs) || cache.jobs.length > 30000) throw fail('MONITOR_CACHE_INVALID');
  return new Map(cache.jobs.filter(job => typeof job.description === 'string' && job.listingIdentity)
    .map(job => [`${job.listingIdentity.ats_provider}:${job.listingIdentity.board_slug}:${job.externalId || job.listingIdentity.posting_id}`, job.description]));
}

// Offline re-evaluation of saved postings with the current evaluator/profile. No
// network, alerts, tasks, decisions, checkpoints or application records change.
// Text is used as full evidence only when its content hash equals the stored
// latest-observed hash; live content is current for 24 hours (the same bound
// evaluation-cache.mjs uses), after which it is a stale snapshot.
export async function reevaluatePostings({root = getCareerOpsRoot(), context = loadMatchingContext(root), descriptions = loadCachedDescriptions(root), now = Date.now(), maxLiveAgeMs = 86400000} = {}) {
  return storeFor(root).updateAll((monitor, ledgerJobs) => {
    if (Object.values(monitor.sources).some(source => source.lease && source.lease.until > now)) throw fail('MONITOR_SOURCE_BUSY');
    const counts = {reevaluated: 0, unavailable: 0, qualified: 0, potentially_eligible: 0, needs_review: 0, excluded: 0, changedStatus: 0, evidence: {}};
    for (const posting of Object.values(monitor.postings)) {
      const source = monitor.sources[posting.sourceId]?.definition;
      if (!source) {counts.unavailable++; continue;}
      const cached = descriptions.get(`${source.provider}:${source.board}:${posting.postingId}`);
      const verify = value => typeof value === 'string' && hash([posting.title, posting.location, value, posting.salary]) === posting.contentHash;
      const full = verify(cached) ? cached : verify(posting.description) ? posting.description : null;
      if (full === null && !posting.description) {counts.unavailable++; continue;}
      const checkpoint = monitor.sources[posting.sourceId].checkpoint;
      const live = checkpoint?.provenance === 'live_feed' && posting.availability === 'listed' && posting.descriptionProvenance !== 'cached_snapshot';
      const fresh = live && now - Date.parse(checkpoint.checkedAt) <= maxLiveAgeMs;
      const descriptionProvenance = full === null ? 'stored_excerpt' : fresh ? 'live_feed' : 'cached_snapshot';
      const job = {...posting, description: full ?? posting.description, descriptionTruncated: posting.descriptionTruncated, descriptionProvenance};
      const before = posting.match?.status, match = {...evaluateMonitoredJob(job, context, ledgerJobs, now), evaluatedAt: iso(now),
        descriptionAsOf: checkpoint?.checkedAt ?? null};
      posting.match = match.status === 'excluded' ? {...match, reasons: [], gaps: [], unknowns: [], evidence: {...match.evidence, requiredExcerpts: [], preferredExcerpts: []}} : match;
      if (match.status === 'excluded') posting.description = '';
      counts.reevaluated++; counts[match.status]++; if (before !== match.status) counts.changedStatus++;
      counts.evidence[descriptionProvenance] = (counts.evidence[descriptionProvenance] ?? 0) + 1;
    }
    monitor.revision++;
    return counts;
  });
}

export async function setMonitorInterval(root, sourceId, intervalMinutes) {
  return storeFor(root).updateAll(monitor => {
    if (!Object.hasOwn(monitor.sources, sourceId)) throw fail('MONITOR_SOURCE_UNKNOWN');
    const source = monitor.sources[sourceId];
    validateSource({...source.definition, intervalMinutes});
    if (source.lease) throw fail('MONITOR_SOURCE_BUSY');
    source.definition.intervalMinutes = intervalMinutes; source.quietCycles = 0; source.adaptiveMinutes = intervalMinutes;
    source.nextDueAt = source.lastSuccessAt ? iso(Date.now() + intervalMinutes * 60000) : null;
    monitor.revision++; return {configured: true, recurringEnabled: false};
  });
}
