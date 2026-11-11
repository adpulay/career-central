import { createHash } from 'node:crypto';
export function canonicalJobKey(job){
 const u=new URL(job.url);u.hash='';
 for(const k of [...u.searchParams.keys()])if(/^(utm_|source$|src$|gh_src$|lever-source$)/i.test(k))u.searchParams.delete(k);
 u.pathname=u.pathname.replace(/\/(application|apply)\/?$/,'').replace(/\/$/,'');u.searchParams.sort();
 return createHash('sha256').update(u.href).digest('hex');
}
const US=/\b(united states|USA|U\.S\.|US remote|remote[ ,–-]+US|Dallas|Plano|Richardson|Irving|Frisco|McKinney|Addison|Austin|Houston|College Station|New York|San Francisco|Seattle|Boston|Chicago|Denver|Atlanta|San Jose|Sunnyvale|Mountain View|Palo Alto|San Mateo|Redwood City|Washington|Los Angeles|San Diego|Bellevue|Reston|Arlington|Raleigh|Durham|Philadelphia|Pittsburgh|Minneapolis|Phoenix|Salt Lake City|Charlotte|Portland|Boulder|San Antonio)\b|,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i;
const FOREIGN=/\b(Canada|Toronto|Vancouver|Montreal|London|United Kingdom|UK|Germany|Berlin|Munich|India|Bangalore|Bengaluru|Singapore|Australia|Sydney|Dublin|Ireland|Paris|France|Poland|Warsaw|Israel|Tel Aviv|Netherlands|Amsterdam|Brazil|Mexico|Japan|Tokyo|China|Spain|Barcelona|Madrid|Switzerland|Zurich|Sweden|Stockholm|Portugal|Lisbon|Denmark|Aarhus|Copenhagen|Finland|Helsinki|Norway|Oslo|Austria|Vienna|Italy|Milan|Belgium|Brussels|Czech|Prague|Romania|Bucharest|Hungary|Budapest|South America|LATAM|EMEA|APAC|Europe|South Korea|Seoul|South Africa|Cape Town|Taiwan|Taipei|Hong Kong|Indonesia|Jakarta|Malaysia|Kuala Lumpur|New Zealand|Auckland)\b/i;
// `\bcloud\b`: an employer name such as Cloudflare is not a role family.
const FAMILY=/\bcloud\b|devops|platform|site reliability|\bsre\b|infrastructure|software|\bsde\b|backend|back.end|full.stack|systems? engineer|technology (consultant|analyst)|technical consultant|solutions? engineer|implementation engineer|\bAI engineer|machine learning engineer/i;
// Business functions whose titles can carry a technical word ("Cloud Finance",
// "Infrastructure Business Operations") but are not engineering roles. They
// exclude only when the title has no engineering function noun, so "Software
// Engineer, Finance Platform" or "Infrastructure Engineer, Business Systems"
// stay in scope.
const NON_TECHNICAL=/\b(?:finance|financial|FP&A|accounting|accountant|treasury|payroll|GTM|go[- ]to[- ]market|sales|account executive|marketing|recruit(?:er|ing)|talent acquisition|people business partner|human resources|legal|counsel|paralegal|business operations|bizops|strategy\s*(?:&|and)\s*operations|procurement|supply chain|sourcing)\b/i;
const ENGINEERING_FUNCTION=/\b(?:engineer(?:ing)?|developer|programmer|sre|devops|architect|administrator|sysadmin)\b/i;
export function evaluateJob(job,policy={},now=Date.now(),profile={}){
 const preferences=policy.discovery||{};
 const graduationYear=String(preferences.graduationYear||'');
 const primaryCity=(preferences.preferredCities||[]).some(c=>(job.location||'').toLowerCase().includes(c.toLowerCase()));
 const secondaryCity=(preferences.secondaryCities||[]).some(c=>(job.location||'').toLowerCase().includes(c.toLowerCase()));
 const title=job.title||'',d=job.description||'',loc=job.location||'';
 const reasons=[],concerns=[],exclusions=[];
 if(/\b(master'?s|Ph\.?D\.?|doctoral)\b/i.test(title))exclusions.push('Graduate-degree-specific title incompatible with saved undergraduate profile');
 if(!FAMILY.test(title))exclusions.push('Title outside configured technical role families');
 if(NON_TECHNICAL.test(title)&&!ENGINEERING_FUNCTION.test(title))exclusions.push('Title indicates non-technical business function');
 if(/\b(senior|sr\.?|staff|principal|director|head|manager|distinguished|(?:vice\s+)?president|[se]?vp|chief)\b|\b(engineer|developer)\s*(III|IV|[3-9])\b/i.test(title))exclusions.push('Title indicates substantial seniority');
 const canadaOnly=/Toronto|Vancouver|Montreal|\bOntario\b|\bQuebec\b/i.test(loc)&&!/(?:United States|USA|Remote US|New York|Austin|Dallas|San Francisco|Seattle)/i.test(loc);
 if((FOREIGN.test(loc)&&!US.test(loc))||canadaOnly)exclusions.push('Listed location outside United States');
 // "Active clearance, or eligibility and willingness to obtain one" does not
 // require an active clearance: that is an eligibility question, not an exclusion.
 const clearance=d.match(/\b(active|current(?:ly)?)\b.{0,45}\b(security clearance|TS\/SCI|top secret clearance)\b[^.\n]{0,120}/i);
 if(clearance){if(/\bor\b[^.\n]{0,40}\b(eligib|ability to obtain|willing(?:ness)? to obtain)/i.test(clearance[0]))concerns.push('Security clearance eligibility required (active clearance not required); verify');else exclusions.push('Active clearance requirement; verify quoted requirement');}
 if(/\bunpaid\b/i.test(d)&&/intern/i.test(title))exclusions.push('Unpaid internship');
 const years=[...d.matchAll(/\b(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\+?\s+years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|industry\s+|software\s+|engineering\s+|work\s+)*experience/gi)].map(m=>({minimum:Number(m[1]),evidence:m[0]}));
 if(years.length&&years.every(y=>y.minimum>3)&&!/new grad|entry.level|university grad/i.test(title))exclusions.push('All extracted experience minima exceed 3 years; manual alternatives review needed');
 let score=35;
 const early=/new.grad|university.grad|early.career|entry.level|associate|junior|\b(engineer|developer)\s*(I|1)\b/i.test(title);
 if(early){score+=12;reasons.push('Explicit early-career title');}else concerns.push('Title alone does not confirm entry-level seniority');
 if(graduationYear&&(title+' '+d).includes(graduationYear)){score+=3;reasons.push('Graduation year mentioned; exact window still needs evidence');}
 if(graduationYear&&new RegExp(`(?:start date|starting|start in)\\s*:?\\s*(?:January|February|March|April)\\s*${graduationYear}`,'i').test(title+' '+d))concerns.push('Earlier stated start requires user review; do not assume availability');
 const matchedSkills=(preferences.resumeSkills||[]).filter(s=>new RegExp(`(?<![a-zA-Z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![a-zA-Z0-9])`,'i').test(d));
 score+=Math.min(18,matchedSkills.length*2);if(matchedSkills.length)reasons.push(`Resume skill overlap: ${matchedSkills.join(', ')}`);
 if(/\bcloud\b|devops|infrastructure|platform|backend|software/i.test(title)){score+=6;reasons.push('Matches primary cloud/software search family');}
 if(primaryCity){score+=6;reasons.push('Preferred local geography');}else if(secondaryCity){score+=3;reasons.push('Secondary preferred geography');}
 if(years.some(y=>y.minimum<=2)){score+=4;reasons.push('Extracted experience range includes 0–2 years');concerns.push('Professional experience minimum may exceed the saved internship; verify alternatives');}
 if(years.some(y=>y.minimum===3)){score-=5;concerns.push('Three-year requirement: internship is not three years of full-time work');}
 if(/\b(engineer|developer)\s*II\b/i.test(title)){score-=8;concerns.push('Level II: review actual experience expectations');}
 if(!d){score-=15;concerns.push('Description missing; requirements cannot be evaluated');}
 const us=US.test(loc);if(!us){score-=10;concerns.push('US eligibility needs verification; remote/ambiguous location is not proof');}
 const internship=/intern/i.test(title);if(internship){score-=12;concerns.push('Secondary internship: confirm Summer 2027 timing and post-graduation eligibility');}
 if(!graduationYear||!(title+' '+d).includes(graduationYear))concerns.push('Saved graduation and post-graduation start compatibility unconfirmed');
 const missingSkills=['Kubernetes','Terraform','Go','Golang','Azure','GCP','React','Rust'].filter(s=>new RegExp(`\\b${s}\\b`,'i').test(d));
 if(missingSkills.length)concerns.push(`Technologies not established in resume (may be preferred): ${missingSkills.join(', ')}`);
 const authorization=profile.authorization||{};
 if(authorization.us_work_authorized?.verified===true&&authorization.us_work_authorized.value===true){reasons.push('Verified unrestricted U.S. work authorization; no inferred clearance or export-control eligibility');}else concerns.push('Work authorization not verified; do not answer automatically');
 if(/immediate start/i.test(title))concerns.push('Immediate start conflicts with provisional future availability; review employer requirement');
 if(/(?:at least )?two (?:previous )?software engineering internships|2 (?:previous )?(?:software engineering )?internships/i.test(d))concerns.push('Multiple internships requested; only one internship is documented; assess explicit equivalent-experience alternative');
 if(/(?:return.*(?:school|university)|semester remaining|quarter.*remaining)/i.test(d)&&internship)concerns.push('Post-internship enrollment requirement may conflict with saved graduation');
 const age=job.postedAt==null?null:Math.floor((now-job.postedAt)/86400000);if(age!==null&&age>=0&&age<=7){score+=3;reasons.push('Posted within last 7 days');}
 const lines=d.split(/\n|(?<=[.;])\s+/).map(s=>s.trim()).filter(Boolean);
 const requirements={essentialExcerpts:lines.filter(s=>/\brequir|\bmust\b|minimum qualification/i.test(s)).slice(0,8),preferredExcerpts:lines.filter(s=>/prefer|nice.to.have|bonus/i.test(s)).slice(0,6),note:'Keyword-extracted excerpts; verify context in full posting. These are not an exhaustive requirement parser.'};
 return {eligibility:exclusions.length?'excluded':us?'review_required':'needs_information',matchScore:Math.max(0,Math.min(95,score)),priority:exclusions.length?'Low':score>=75&&!internship&&us?'High':score>=55?'Medium':'Low',reasons,concerns,exclusions,experienceRequirements:years,requirements,workArrangement:/hybrid/i.test(loc)?'Hybrid':/remote/i.test(loc)?'Remote':/on.site|in.office/i.test(loc)?'On-site':'Unspecified',postingDate:job.postedAt?new Date(job.postedAt).toISOString().slice(0,10):null};
}
export function renderReport(run){
 const esc=s=>String(s??'Unknown').replace(/[\r\n]+/g,' ').replaceAll('|','\\|');
 return `# Ranked opportunities\n\nGenerated ${run.generatedAt}. ${run.returned}/${run.requested} requested jobs; ${run.collected} feed records, ${run.unique} unique. Listed in live employer feeds, not guaranteed form availability. Scores are heuristic fit assessments, not hiring probabilities. All require eligibility review; none submitted.\n\n| Rank | Company | Role | Location | Score | Priority |\n|---|---|---|---|---|---|\n`+run.jobs.map((j,i)=>`| ${i+1} | ${esc(j.company)} | [${esc(j.title)}](${j.url}) | ${esc(j.location)} | ${j.matchScore} | ${j.priority} |`).join('\n')+'\n\n'+run.jobs.map((j,i)=>`## ${i+1}. ${j.company} — ${j.title}\n\n- Official URL: ${j.url}\n- Location: ${j.location||'Unknown'}; arrangement: ${j.workArrangement}\n- Posting date: ${j.postingDate||'Unknown'}; observed: ${j.observedAt}\n- Availability check: ${j.availabilityCheck?JSON.stringify(j.availabilityCheck):'Live feed listing; individual check pending'}\n- Disclosed salary: ${j.salary?JSON.stringify(j.salary)+' (provider-normalized; verify currency, interval and base/total classification)':'Unknown'}\n- Experience: ${j.experienceRequirements.map(x=>x.evidence).join('; ')||'No numeric minimum extracted; review posting'}\n- Match: ${j.matchScore}/100; priority: ${j.priority}; eligibility: ${j.eligibility}\n- Rationale: ${j.reasons.join('; ')}\n- Concerns: ${j.concerns.join('; ')}\n- Essential excerpts: ${j.requirements.essentialExcerpts.join(' / ')||'Not automatically identified'}\n- Preferred excerpts: ${j.requirements.preferredExcerpts.join(' / ')||'Not automatically identified'}\n`).join('\n');
}
