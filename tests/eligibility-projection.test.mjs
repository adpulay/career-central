import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMonitoredJob} from '../lib/career-central/job-monitor.mjs';
import {buildEligibilityProjection, contextFromProjection, ELIGIBILITY_PROJECTION_SCHEMA} from '../lib/career-central/eligibility-projection.mjs';

const now = Date.parse('2026-11-10T12:00:00Z');
// Fictional private context with sentinel values that must never leave.
const SENTINELS = ['SENTINEL_NAME_Q7', 'sentinel-email-q7@example.invalid', '+1-555-0100-Q7', 'SENTINEL_STREET_Q7', '/private/resumes/SENTINEL_Q7.pdf',
  'SENTINEL_ANSWER_TEXT_Q7', 'SENTINEL_SALARY_Q7', 'https://job-boards.greenhouse.io/priorco/jobs/777', 'SENTINEL_PRIOR_EMPLOYER_Q7', 'SENTINEL_AUTH_BASIS_Q7', 'SENTINEL_NOTE_Q7'];
const fullContext = () => ({
  policy: {discovery: {graduationYear: 2027, graduationMonth: '2027-05', preferredCities: ['Dallas'], secondaryCities: ['Austin'], resumeSkills: ['IGNORED'],
    searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}, monitorHighPriorityScore: 60, salaryTarget: 'SENTINEL_SALARY_Q7'},
    submission: {limits: 0}},
  profile: {
    personal: {name: 'SENTINEL_NAME_Q7', email: 'sentinel-email-q7@example.invalid', phone: '+1-555-0100-Q7', address: 'SENTINEL_STREET_Q7'},
    education: [{school: 'Fictional University', graduation_month: {value: '2027-05', verified: true, source: 'SENTINEL_NOTE_Q7'}}],
    authorization: {us_work_authorized: {verified: true, value: true}, citizenship: {verified: true, value: 'United States citizen'},
      authorization_basis: {verified: true, value: 'SENTINEL_AUTH_BASIS_Q7'}, needs_sponsorship: {verified: true, value: false}},
    standardAnswers: {full_time_start: {value: '2027-06', verified: true, provisional: false, note: 'SENTINEL_NOTE_Q7'}, salary_expectation: {value: 'SENTINEL_SALARY_Q7'}},
    employerSpecificAnswers: {any: 'SENTINEL_ANSWER_TEXT_Q7'},
    technicalSkills: {verified: true, value: {cloud: ['AWS', 'Docker'], languages: ['Python', 'SQL', 'Linux']}},
    employerApplicationHistory: {'fictional cloud': {verified: true, neverApplied: true, note: 'SENTINEL_NOTE_Q7'}},
    resumeVersions: [{id: 'approved-base', approved: true, sha256: 'a'.repeat(64), path: '/private/resumes/SENTINEL_Q7.pdf'}, {id: 'draft', approved: false, sha256: 'b'.repeat(64)}],
  },
  portals: {title_filter: {positive: ['Engineer'], negative: ['Senior']}, location_filter: {allow: ['United States']}, tracked_companies: [{name: 'SENTINEL_NOTE_Q7'}]},
  history: [{url: 'https://job-boards.greenhouse.io/priorco/jobs/777', company: 'SENTINEL_PRIOR_EMPLOYER_Q7', status: 'Applied', requisitionId: null}],
  blacklist: new Map([['avoidco', {company: 'avoidco', reason: 'preference'}]]),
});
const ledgerJobs = {
  k1: {key: 'c'.repeat(64), company: 'SENTINEL_PRIOR_EMPLOYER_Q7', title: 'Role', url: 'https://example.invalid/jobs/1', status: 'Submitted', requisitionGroup: 'sentinel_prior_employer_q7:REQ-9'},
  k3: {key: 'e'.repeat(64), company: 'Nourl Co', status: 'Applied', requisitionGroup: 'nourl co:R-1'},
  k2: {key: 'd'.repeat(64), company: 'Other Co', url: 'https://example.invalid/jobs/2', status: 'Evaluated', lastSubmission: {mayHaveBeenAccepted: true, notes: 'SENTINEL_NOTE_Q7'}},
};
const base = {id: 'x', company: 'Fictional Cloud', title: 'Software Engineer I, New Grad 2027', location: 'Dallas, Texas, United States', url: 'https://job-boards.greenhouse.io/fictional/jobs/1',
  requisitionId: null, description: 'Required: graduating in 2027. Starting in June 2027. AWS Docker Python Linux SQL.'};
const corpus = [
  base,
  {...base, description: base.description + ' Remote for a candidate with US citizenship.'},
  {...base, url: 'https://job-boards.greenhouse.io/priorco/jobs/777', company: 'SENTINEL_PRIOR_EMPLOYER_Q7'},
  {...base, company: 'SENTINEL_PRIOR_EMPLOYER_Q7', requisitionId: 'REQ-9', url: 'https://example.invalid/jobs/other'},
  {...base, company: 'Other Co', url: 'https://example.invalid/jobs/2'},
  {...base, company: 'Nourl Co', requisitionId: 'R-1', url: 'https://example.invalid/jobs/nourl'},
  {...base, title: 'Software Engineer Intern 2027', description: 'Graduation date in Fall 2027 or later.'},
  {...base, description: 'Required: graduating in 2027. Start date: May 2027. Rust experience is required.'},
  {...base, location: 'Doha, Qatar'}, {...base, location: 'Remote'}, {...base, title: 'Senior Platform Engineer'},
  {...base, company: 'avoidco'}, {...base, title: 'Backend Software Engineer', description: 'Graduating between Fall 2026 and Summer 2027. Active US Security clearance, or eligibility and willingness to obtain one.'},
];

test('projection gives the same eligibility results as the full private context', () => {
  const projection = buildEligibilityProjection(fullContext(), ledgerJobs, {now}), {context, ledgerJobs: projectedLedger} = contextFromProjection(projection);
  for (const job of corpus) {
    const {profileDigest: a, ...full} = evaluateMonitoredJob(job, fullContext(), ledgerJobs, now);
    const {profileDigest: b, ...minimal} = evaluateMonitoredJob(job, context, projectedLedger, now);
    assert.deepEqual(minimal, full, `${job.title} @ ${job.company} / ${job.location}`);
  }
  // Prior-application matching survives hashing (by URL and by company + requisition).
  assert.ok(evaluateMonitoredJob(corpus[2], context, projectedLedger, now).unknowns.includes('Existing application or unresolved attempt: reconciliation required'));
  assert.ok(evaluateMonitoredJob(corpus[3], context, projectedLedger, now).unknowns.includes('Existing application or unresolved attempt: reconciliation required'));
});

test('projection contains no private values outside the allowlist', () => {
  const projection = buildEligibilityProjection(fullContext(), ledgerJobs, {now}), text = JSON.stringify(projection);
  for (const sentinel of SENTINELS) assert.ok(!text.includes(sentinel), `leaked ${sentinel}`);
  const allowed = [/^schema$/, /^generatedAt$/, /^digest$/, /^profile\.education\.\d+\.graduation_month\.(verified|value|provisional)$/,
    /^profile\.authorization\.(us_work_authorized|citizenship|us_citizen)\.(verified|value|provisional)$/, /^profile\.standardAnswers\.full_time_start\.(verified|value|provisional)$/,
    /^profile\.technicalSkills\.verified$/, /^profile\.technicalSkills\.value\.skills\.\d+$/, /^profile\.(employerApplicationHistory|applicationHistory)\.[^.]+\.(verified|neverApplied)$/,
    /^profile\.resumeVersions\.\d+\.(id|approved|sha256)$/, /^policy\.discovery\.(graduationYear|graduationMonth|monitorHighPriorityScore)$/,
    /^policy\.discovery\.(preferredCities|secondaryCities)\.\d+$/, /^policy\.discovery\.searchEmphasis\.(cloudInfrastructure|softwareEngineering|consultingAI)$/,
    /^portals\.(title_filter|location_filter)\./, /^blacklist\.\d+\./, /^(history|ledger)\.\d+\.(status|canonicalKey|requisitionMatchKey|activeSubmission)$/,
    /^(history|ledger)\.\d+\.lastSubmission\.(mayHaveBeenAccepted|verificationRequired)$/];
  const paths = (value, prefix = '') => value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => paths(child, prefix ? `${prefix}.${key}` : key)) : [prefix];
  for (const leaf of paths(projection)) assert.ok(allowed.some(pattern => pattern.test(leaf)), `unexpected field ${leaf}`);
  assert.equal(projection.schema, ELIGIBILITY_PROJECTION_SCHEMA); assert.match(projection.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(projection.profile.resumeVersions.map(item => item.id), ['approved-base'], 'only approved résumé references, by hash');
  assert.throws(() => contextFromProjection({schema: 'other'}), {code: 'ELIGIBILITY_PROJECTION_INVALID'});
});

test('projection digest is stable across rebuilds and changes when an eligibility input changes', () => {
  const a = buildEligibilityProjection(fullContext(), ledgerJobs, {now}), b = buildEligibilityProjection(fullContext(), ledgerJobs, {now: now + 1000});
  assert.equal(a.digest, b.digest);
  const changed = fullContext(); changed.profile.standardAnswers.full_time_start.value = '2027-08';
  assert.notEqual(buildEligibilityProjection(changed, ledgerJobs, {now}).digest, a.digest);
});
