// Minimized, versioned eligibility projection (CC-017 C0 item 3).
//
// The monitor evaluator needs only a small allowlisted subset of the private
// profile, policy and application history. This module builds that subset so a
// cloud worker can evaluate postings without receiving résumé content, contact
// details, free-text answers, compensation, file paths, URLs of past
// applications or email data. History is reduced to hashes (canonical posting
// key, company+requisition key) plus status flags. Evaluating with the
// projection gives the same eligibility result as the full local context;
// tests verify this.
import {createHash} from 'node:crypto';
import {canonicalJobKey} from '../applications/discovery.mjs';
import {requisitionMatchKey} from './job-monitor.mjs';

export const ELIGIBILITY_PROJECTION_SCHEMA = 'career-central/eligibility-projection/v1';
const fail = code => Object.assign(Error(code), {code});
const flag = value => value && typeof value === 'object' ? {verified: value.verified === true, value: value.value ?? null, ...(value.provisional === true ? {provisional: true} : {})} : undefined;
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
const usCitizenStatement = value => value?.verified === true && typeof value.value === 'string' && /\bunited states citizen\b/i.test(value.value) && !/\b(?:not|non)\b/i.test(value.value);
const historyFlags = row => ({status: typeof row.status === 'string' ? row.status : null,
  ...(row.lastSubmission ? {lastSubmission: {mayHaveBeenAccepted: row.lastSubmission.mayHaveBeenAccepted === true, verificationRequired: row.lastSubmission.verificationRequired === true}} : {}),
  ...(row.activeSubmission ? {activeSubmission: true} : {})});
function historyRow(row) {
  // Exactly the evaluator's derivation: from the URL, or no key (requisition only).
  let canonicalKey = null;
  try {canonicalKey = canonicalJobKey(row);} catch { /* no usable URL: requisition evidence only */ }
  const req = row.requisitionId || row.requisitionGroup?.split(':').slice(1).join(':');
  return {...historyFlags(row), canonicalKey, requisitionMatchKey: requisitionMatchKey(row.company, req)};
}

export function buildEligibilityProjection({policy = {}, profile = {}, portals = {}, history = [], blacklist = new Map()}, ledgerJobs = {}, {now = Date.now()} = {}) {
  const auth = profile.authorization ?? {};
  const projected = {
    schema: ELIGIBILITY_PROJECTION_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    profile: {
      education: (profile.education ?? []).filter(item => item?.graduation_month).map(item => ({graduation_month: flag(item.graduation_month)})),
      authorization: {
        ...(auth.us_work_authorized ? {us_work_authorized: flag(auth.us_work_authorized)} : {}),
        // Only the evaluator's question survives: is a United States citizenship statement verified?
        ...(auth.citizenship ? {citizenship: {verified: auth.citizenship.verified === true, value: usCitizenStatement(auth.citizenship) ? 'United States citizen' : 'unconfirmed'}} : {}),
        ...(auth.us_citizen ? {us_citizen: flag(auth.us_citizen)} : {}),
      },
      standardAnswers: profile.standardAnswers?.full_time_start ? {full_time_start: flag(profile.standardAnswers.full_time_start)} : {},
      technicalSkills: profile.technicalSkills?.verified === true
        ? {verified: true, value: {skills: Object.values(profile.technicalSkills.value || {}).flat().filter(skill => typeof skill === 'string')}} : {verified: false, value: {}},
      employerApplicationHistory: Object.fromEntries(Object.entries(profile.employerApplicationHistory ?? {}).map(([name, value]) => [name, {verified: value?.verified === true, neverApplied: value?.neverApplied === true}])),
      applicationHistory: Object.fromEntries(Object.entries(profile.applicationHistory ?? {}).map(([key, value]) => [key, {verified: value?.verified === true, neverApplied: value?.neverApplied === true}])),
      resumeVersions: (profile.resumeVersions ?? []).filter(item => item?.approved === true && /^[a-f0-9]{64}$/i.test(item.sha256 || '')).map(item => ({id: String(item.id).slice(0, 80), approved: true, sha256: item.sha256})),
    },
    policy: {discovery: pick(policy.discovery ?? {}, ['graduationYear', 'graduationMonth', 'preferredCities', 'secondaryCities', 'searchEmphasis', 'monitorHighPriorityScore'])},
    portals: pick(portals ?? {}, ['title_filter', 'location_filter']),
    blacklist: [...(blacklist instanceof Map ? blacklist : new Map())],
    history: history.map(historyRow),
    ledger: Object.values(ledgerJobs ?? {}).map(historyRow),
  };
  projected.digest = createHash('sha256').update(JSON.stringify({...projected, generatedAt: null})).digest('hex');
  return projected;
}

// Rebuilds the evaluator's inputs from a projection (local or downloaded).
export function contextFromProjection(projection) {
  if (projection?.schema !== ELIGIBILITY_PROJECTION_SCHEMA) throw fail('ELIGIBILITY_PROJECTION_INVALID');
  return {context: {policy: projection.policy, profile: projection.profile, portals: projection.portals, history: projection.history, blacklist: new Map(projection.blacklist)},
    ledgerJobs: Object.fromEntries(projection.ledger.map((row, index) => [`projected-${index}`, row]))};
}
