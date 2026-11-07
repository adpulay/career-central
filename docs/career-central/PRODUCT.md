# Product vision and bounded requirements

Purpose: improve job-search effectiveness while reducing repetitive work and protecting time outside the search. Existing working components should be reused.

| Requirement | Intent |
|---|---|
| CC-R01 | Integrate Home, Job Intelligence, Application Studio, Interview Preparation, Career Development, Analytics, Personal Profile and Automation Control. |
| CC-R02 | Keep verified facts, source evidence, generated drafts and unknown information separate. Never invent qualifications/outcomes/statistics or treat fit as a hiring probability. |
| CC-R03 | Preserve canonical Markdown/TSV and application JSON ownership until a separately approved migration. Normalize through read adapters first. |
| CC-R04 | Target an authenticated AWS desktop/mobile dashboard available while the PC is off; local outbound-only workers may wait offline. Hosting/service/budget decisions require later implementation approval. |
| CC-R05 | Treat personal Microsoft Graph mail as first-class, initially read-only. No mail/body/token/code enters shared docs or general analytics. Authentication, code use and submission are separate permissions. |
| CC-R06 | Keep explicit application approval, duplicate prevention, confirmation evidence, approved-PDF integrity and kill switches. Unknown or uncertain submissions require reconciliation. |
| CC-R07 | Preserve time budgets/quiet periods; unset constraints remain unknown, never assumed available time. |
| CC-R08 | Maintain compact version-controlled context, evidence-based feature state, ADRs, task acceptance criteria and session handoffs. |

Current authorization: M0.5 context bootstrap, then M1 read-only projection with fictional tests. No new dashboard, cloud provisioning, dependency, live network/browser/mail/authentication, document rewriting or submission work. See [CC-001](tasks/CC-001.md). The [audit](../architecture/career-central-audit.md) contains detailed proposed scope; proposals are not completed features or new authorization.
