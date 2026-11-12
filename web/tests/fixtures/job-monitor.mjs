import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {configureSources, pollSource} from '../../../lib/career-central/job-monitor.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-web-'));
fs.writeFileSync(path.join(root, '.career-central-fixture'), 'fictional-only');
fs.writeFileSync(path.join(root, 'cv.md'), '# Fictional candidate\n');
const source = {id: 'fixture', provider: 'greenhouse', board: 'fixture', company: 'Fixture Cloud', intervalMinutes: 5};
const context = {policy: {discovery: {graduationYear: 2027, monitorHighPriorityScore: 60, searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}}},
  profile: {education: [{graduation_month: {value: '2027-05', verified: true}}], authorization: {us_work_authorized: {value: true, verified: true}},
    employerApplicationHistory: {'fixture cloud': {verified: true, neverApplied: true}},
    technicalSkills: {value: {cloud: ['AWS', 'Docker', 'Python', 'Linux', 'SQL']}, verified: true}, standardAnswers: {full_time_start: {value: '2027-06', verified: true}}, resumeVersions: []}, portals: {}};
const now = Date.now() - 900000;
await configureSources(root, [source]);
// Quiet baseline: a start-date-only posting (no alert/task) for the potentially-eligible label.
await pollSource({root, sourceId: source.id, context, now, random: () => 0, fetchSnapshot: async () => ({complete: true, jobs: [{externalId: '100', title: 'Platform Engineer I, New Grad 2027',
  location: 'Dallas, United States', url: 'https://example.invalid/jobs/100', description: 'Required: graduating in 2027. Build AWS Docker Python Linux SQL systems.'}]})});
await pollSource({root, sourceId: source.id, context, now: now + 360000, random: () => 0,
  fetchSnapshot: async () => ({complete: true, jobs: [{externalId: '100', title: 'Platform Engineer I, New Grad 2027',
  location: 'Dallas, United States', url: 'https://example.invalid/jobs/100', description: 'Required: graduating in 2027. Build AWS Docker Python Linux SQL systems.'}, {externalId: '101', title: 'Software Engineer I, New Grad 2027', location: 'Dallas, United States',
    url: 'https://example.invalid/jobs/101', description: 'Required: graduating in 2027. Starting in June 2027. Build AWS Docker Python Linux SQL systems.'}]})});
console.log(root);
