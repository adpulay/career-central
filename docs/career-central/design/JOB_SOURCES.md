# Job Sources and Provider Capabilities — design

Status: **capability register.** Authoritative definition for CC-R20 ([PRODUCT](../PRODUCT.md)). The ATS feasibility detail lives in [application-automation.md](../../architecture/application-automation.md#platform-feasibility-and-evidence). Monitoring behavior is in the [monitor runbook](../../JOB_MONITOR.md).

## Principles

1. **Integration order:** official APIs and supported feeds, employer career endpoints and email-based job alerts come first. Browser automation is secondary, used only where technically appropriate and permitted by the platform's terms.
2. **No assumptions:** no platform is assumed to offer a public job API or to permit automated applications. Each capability is verified per provider.
3. **Three independent capabilities per provider**, each with its own state:
   - **D:** job discovery.
   - **Prep:** application preparation, meaning inspecting and filling a form without submitting.
   - **Sub:** application submission plus receipt verification.

   Support for one never implies another.
4. **Aggregators are unconfirmed until matched at the employer** (AGENTS.md "Aggregator Listings — Confirm at the Employer"). A listing from LinkedIn, Indeed, Wellfound, Handshake, RippleMatch and similar is linked to the canonical employer posting when it can be reliably identified, and the employer URL becomes canonical.
5. **Normalization and deduplication** reuse [`url-key.mjs`](../../../url-key.mjs) (aggregator IDs, canonical keys), listing fingerprints and the monitor's posting identity. Cross-source links record which source saw a posting first, without overwriting first-seen evidence.

## States

Same legend as the [feature inventory](../FEATURE_INVENTORY.md#status-and-evidence-rules): **V** validated at a stated level · **I** implemented, not live-validated · **P** partial · **N** planned or not started · **X** not permitted or not available (record the reason).

## Register (2026-11-11)

| Source | D (discovery) | Prep | Sub | Evidence and notes |
|---|---|---|---|---|
| Greenhouse | **V** (local live monitor baselines: Cloudflare, Databricks, Scale AI; Datadog/MongoDB earlier) | P (schema inspection, verified field filling on one live form) | P (narrow reviewed path; earlier live attempt hit HTTP 428 verification, no confirmed receipt) | [monitor](../../JOB_MONITOR.md), [application-automation](../../architecture/application-automation.md). Stripe discovery baseline pending. |
| Lever | **V** (local live monitor baseline: Palantir) | N | N | Public postings API |
| Ashby | I (provider and monitor adapter; no monitor baseline yet) | N | N | Public posting feed |
| Workday | I (tenant provider) | N | N | Tenant adapters likely needed for preparation |
| iCIMS | I | N | N | Portal variance, login-gated forms |
| SmartRecruiters | I | N | N | Application API needs customer/partner access |
| Other ATS and employer career sites | I (many providers in [`providers/`](../../../providers/README.md)) | N | N | Stop as unsupported until a dedicated adapter passes tests |
| LinkedIn | P (manual paste-import of job-alert emails via [`linkedin-import.mjs`](../../../linkedin-import.mjs); bounded liveness checks per the LinkedIn JD loading guard) | N | X for automation by default (no automated Easy Apply; manual application only) | No scraping or account automation. Email alerts are the preferred feed; confirm postings at the employer. |
| RippleMatch | N | N | N | Account-based platform; evaluate email alerts and any authorized integration first. Confirm at the employer. |
| Handshake | N | N | N | University-gated account; evaluate email digests and any authorized export. Confirm at the employer. |
| Indeed | N (aggregator URL identity only in `url-key.mjs`) | N | N | Don't assume a public search API is available. Evaluate job-alert emails; confirm at the employer. |
| Wellfound | N (aggregator URL identity only) | N | N | Account-based. Evaluate alerts; confirm at the employer. |
| USAJOBS | N | N | N | An official public Search API exists (API key required), making it the strongest authorized discovery candidate. Applications run through the user's USAJOBS account, so submission stays manual unless an authorized path is verified. |
| Email job alerts (any provider) | P (LinkedIn paste import; reply-watch categories) | — | — | Planned: Gmail-label-scoped alert ingestion with the same untrusted-content rules |

Updating a row requires evidence (tests, a live acceptance record, or documented platform terms) and a STATUS entry. Each new source starts with discovery only.

## Expansion order (proposal)

1. USAJOBS Search API (authorized API).
2. Email-alert ingestion through Gmail labels (LinkedIn, Indeed, Handshake, RippleMatch, Wellfound alerts).
3. More employer ATS boards from the [employer coverage review](../EMPLOYER_COVERAGE.md).
4. Per-platform preparation adapters (P4), starting with the platform covering the most approved opportunities.

Discovery can scale independently; preparation and submission adapters follow P2's safety contract.
