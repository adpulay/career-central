# ADR 0002 — Product workflows first, core monitoring early

Date: 2026-11-10. Status: accepted product-planning direction from the user's vision/priority and continuous-monitoring requests. Technical monitoring schemas, source activation, status transition policy and cloud choices remain proposed.

Context: M0.5–M3C and email tasks provide important local foundations, while the original audit describes a much broader career platform. Compact docs underrepresented user-facing application, resume, networking, interview and career-development outcomes. The user explicitly prioritizes useful discovery, approved applications and monitoring newly posted opportunities during the current search.

Decision: retain all existing architecture/owners/contracts and completed M milestones. Add a P product roadmap, evidence-linked feature inventory and outcome-based tasks. Deliver a minimum reliable shortlist (P1), then a small durable priority monitor/alert/preparation-proposal slice (P1b), then complete one approved application (P2) and evidence-backed confirmations (P3). Monitoring is core, not optional; target polling intervals are configurable best efforts under source policies/budgets. Keep first-seen and publication evidence distinct. User-specific preferences stay in private configuration.

Reuse providers, filters, document tools, application ledger/guards, email transports and Next.js UI. Embed needed recovery and thin UI in each journey. Do not spend another broad milestone on generalized queues, Outlook acceptance, token persistence or cloud before a bounded session/local workflow proves the need. Do not defer safety-critical durable intent or duplicate protection to optimize speed.

Consequences: preserve historical audit M4–M8 proposals with an explicit roadmap crosswalk. More ATS, document personalization, unified dashboard, networking, interview/learning and analytics remain visible planned work. Autonomy and PWA/cloud are later separately gated; cloud does not require autonomy. No new runtime, recurring polling, mailbox/application action, notification delivery, paid dependency, provisioning or push is authorized by this planning decision. ADR 0001's architecture direction remains unchanged.

Evidence: [PRODUCT](../PRODUCT.md), [ROADMAP](../ROADMAP.md), [CC-014](../tasks/CC-014.md), [CC-015](../tasks/CC-015.md), [CC-016](../tasks/CC-016.md).
