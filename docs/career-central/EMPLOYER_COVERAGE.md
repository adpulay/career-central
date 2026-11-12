# Monitored-employer coverage review — 2026-11-11

Proposal only. No source was added, polled or scheduled. Evidence: the live-checked monitor state of the three configured employers (last live check 2026-11-10), and the existing discovery cache (2026-11-05; 13,023 postings, 103 employers, Greenhouse/Ashby/Lever). Cached text is untrusted, stale evidence: every candidate must pass a bounded `first-poll` before it counts as a current opening. Candidate facts (graduation month, profile answers) stay in private configuration and are referred to only generically.

## Why none of the 27 shortlisted postings is high-priority-ready

1. **Main cause: no suitable openings at the current employers.** Across 1,242 currently listed postings at Cloudflare, Datadog and MongoDB, there is **no full-time, US-based, new-graduate engineering posting**. Their early-career technical roles are internships (most outside the US), and MongoDB's 2027 internship requires a later graduation window. The 27 reviewable postings are generic "Software/Systems Engineer" titles, so all of them lack both an explicit entry-level title and an explicit graduation window.
2. **Insufficient evidence on those generic postings.** The start-date-only `potentially_eligible` path can't apply while seniority and graduation are open, and the best score (58) is below the high-priority threshold (70).
3. **Employer selection follows from 1.** These are strong infrastructure employers, but they currently hire new graduates through programs that aren't open in the US right now.
4. **Fixed in this review: evaluator false exclusions.** Projecting the evaluator onto new-grad postings from other employers exposed three defects:
   - Graduation **ranges** ("Fall 2026–Summer 2027", "between … and …") were treated as discrete terms.
   - A **benefits** sentence ("Starting January 2027, … will match 401(k)") was read as a job start date.
   - "Active clearance **or eligibility and willingness to obtain**" was treated as requiring an active clearance.

   Before the fix, these excluded relevant Palantir infrastructure, Verkada and DoorDash roles. All three are fixed with regression tests. An only-"Active Full Scope Poly" requirement still excludes.
5. **Remaining unknown that you can resolve:** "Outside-ledger application history requires confirmation" appears for most new employers. Recording a verified "never applied" answer per employer in the private profile removes it; the system never infers it.

## Projection with the fixed evaluator (cached text treated as current, US roles only)

| Employer (feed) | US new-grad technical roles | Best projected status/score | Alignment and notes |
|---|---|---|---|
| Databricks (`greenhouse/databricks`) | 1 | **potentially_eligible**, 66 | Distributed data systems, platform. Explicit "Fall 2026 or Spring 2027" window. |
| Palantir (`lever/palantir`) | 21 (1 excluded: Full Scope Poly) | needs_review, 72 | Includes **Software Engineer, New Grad – Infrastructure / Production Infrastructure** and **Forward Deployed Infrastructure Engineer**, which fit Cloud/DevOps directly. Clearance-eligibility review applies. Many requisitions are evergreen, so posting dates are not publication evidence. |
| Pinterest (`greenhouse/pinterest`) | 1 | needs_review, 72 | University Grad SWE 2027 (USA), remote-US option. One required skill to review. |
| Roblox (`greenhouse/roblox`) | 1 | needs_review, 70 | [2027] Software Engineer, Early Career. |
| Scale AI (`greenhouse/scaleai`) | 2 | needs_review, 68 | Explicit Fall 2026/Spring 2027 window. |
| Verkada (`greenhouse/verkada`) | 1 | needs_review, 68 | Backend University Graduate 2027. Previously wrongly excluded by the benefits-date defect. |
| DoorDash (`greenhouse/doordashusa`) | 1 | needs_review, 66 | Entry-Level, Fall 2026–Summer 2027. Asks for two prior internships (experience review). |
| Stripe (`greenhouse/stripe`) | 2 | needs_review, 64 | New Grad (SF/Seattle/NYC). The "Immediate Start" variant conflicts with saved availability. |
| Sierra (`ashby/sierra`) | 1 | needs_review, 62 | New Grad 2027, SF. |
| Affirm (`greenhouse/affirm`) | 2 | needs_review, 57 | Early Career (NYC/SF). **An Affirm application record already exists in the application ledger; reconcile before any new action.** |

## Recommendation

**High-frequency monitor (the current design caps it at five sources; per-source storage now makes raising that cap technically safe, but it stays a separate decision):**
1. Databricks
2. Palantir
3. Stripe
4. Scale AI
5. Cloudflare (keep: strongest infrastructure alignment; new-grad requisitions may still open)

Suggested intervals: 15 minutes, or 5 minutes for at most two sources whose feed policy and request budget allow it.

**Daily scan tier** (add to `portals.yml` after approval and after `verify-portals`/`audit-portals` confirm board ownership): Pinterest, Roblox, Verkada, DoorDash, Sierra, Affirm. Move Datadog and MongoDB from the monitor to this tier.

**Cloud/DevOps employers to verify before proposing** (absent from the cache, feeds unverified, needs live checks): HashiCorp, Grafana Labs, Fastly, Cockroach Labs, Vercel, Snowflake, Confluent, GitLab, Elastic, PagerDuty.

Before adding any source:
1. Get approval of the exact feed and request budget.
2. Run one `first-poll` (quiet baseline).
3. Review a sample of matches.
4. Only then authorize it for recurring ticks.
