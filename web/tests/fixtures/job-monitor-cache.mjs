import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {configureSources, pollSource} from '../../../lib/career-central/job-monitor.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-cache-web-'));
fs.writeFileSync(path.join(root, '.career-central-fixture'), 'fictional-only');
fs.writeFileSync(path.join(root, 'cv.md'), '# Fictional candidate\n');
const source = {id: 'fixture', provider: 'greenhouse', board: 'fixture', company: 'Fictional Cache', intervalMinutes: 15};
const context = {policy: {discovery: {graduationYear: 2027, searchEmphasis: {cloudInfrastructure: .4, softwareEngineering: .4, consultingAI: .2}}},
  profile: {education: [{graduation_month: {value: '2027-05', verified: true}}], authorization: {us_work_authorized: {value: true, verified: true}},
    technicalSkills: {value: {skills: ['Python']}, verified: true}, standardAnswers: {}}, portals: {}};
await configureSources(root, [source]);
await pollSource({root, sourceId: source.id, context, mode: 'cache', now: Date.now() - 3600000,
  fetchSnapshot: async () => ({complete: true, jobs: Array.from({length: 30}, (_, index) => ({externalId: String(index + 1), title: `Software Engineer I, New Grad 2027 (${index + 1})`,
    location: 'Dallas, United States', url: `https://example.invalid/jobs/${index + 1}`, description: 'Graduating in 2027. Python development.'}))})});
console.log(root);
