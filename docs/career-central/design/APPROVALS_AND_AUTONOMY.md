# Unified Approvals and Autonomy — design

Status: **proposed framework; existing approval mechanisms remain authoritative until migrated.** This is the authoritative definition for CC-R21 ([PRODUCT](../PRODUCT.md)), with the decision recorded in [ADR 0004](../decisions/0004-product-vision-expansion.md). It defines one authorization model for every action Career Central can take. Today's separate mechanisms are listed below and become instances of the model. Nothing here grants authority by itself.

## Action classes

| Class | Definition | Examples |
|---|---|---|
| A. Automatic internal research | Reads public or already-authorized data; no external side effect beyond bounded, policy-compliant reads | Feed polling under an active monitoring authorization, ranking, eligibility evaluation, company research |
| B. Automatic internal preparation | Produces drafts or proposals stored locally; nothing leaves the system | Tailored résumé drafts, cover-letter drafts, answer drafts, outreach drafts, preparation proposals |
| C. Approval-required external action | Any action that sends, submits, uploads, commits time, or speaks for the user | Application submission, recruiter email, referral request, reply, interview scheduling commitment, employer-site upload |
| D. Narrowly preauthorized action | A class-C action the user has authorized in advance under an exact, expiring, revocable policy | A future pilot: submit to an allowlisted employer only with an approved résumé hash and an answer set, with a cap of N per day |
| E. Prohibited or unresolved | Never automated, or not yet decided | Solving CAPTCHAs or assessments, accepting legal terms silently, bypassing login or security controls, inventing facts, scraping in violation of platform rules, entering verification codes without a bound session |

## Default policy by action type (user-configurable later)

| Action type | Default |
|---|---|
| Discovery, monitoring reads, ranking | Automatic (A), within an explicit monitoring authorization (sources, cadence, duration) |
| Internal document drafting | Automatic (B) |
| Application preparation (employer-site inspection, form filling without submission) | Scoped authorization: per employer/posting or a bounded policy, with expiry |
| Application submission | Explicit approval of the exact payload (C) |
| Recruiter outreach | Explicit approval (C) |
| Email replies | Explicit approval (C) |
| Referral requests | Explicit approval (C) |
| Interview scheduling commitments | Explicit approval (C) |
| Verification-code use | Prohibited (E) until a separately designed, application-bound session flow is approved |

Configuration may only make a default **stricter** without a new authorization. Relaxing anything to class D needs a separately approved policy (see Autopilot).

## Grant model

A grant is `{grantId, actionType, scope, constraints, issuedAt, expiresAt, revokedAt?, issuer: 'user', evidence, version}`:
- **Scope binds exactly what was reviewed:** employer, requisition/posting identity, payload hash, document hashes, recipient and thread, or a source list for monitoring.
- **Constraints:** caps per run/day, time windows, minimum score/eligibility state, required identity version, allowed platforms.
- **Exact approvals vs. policy grants:** an exact approval authorizes one payload. A class-D policy authorizes a narrow family and is checked per action.

Enforcement, at the moment of execution rather than when work is queued:
1. Global emergency stop (the existing `data/application-automation/STOP` / `CAREER_OPS_STOP_SUBMISSIONS`, plus a future cloud flag) blocks every new C/D action and stops pending automation at the next safe boundary.
2. Effective permission is the intersection of the global policy, the action-type policy and a valid unexpired, unrevoked grant whose scope matches the exact payload.
3. Revalidate before acting: job liveness, eligibility unknowns, identity version, document hashes and duplicate/prior-application checks.
4. An idempotency key per external effect is reserved with a conditional write before dispatch. A duplicate delivery fails the reservation.
5. Outcomes are recorded as evidence (receipt, message ID, confirmation page or email). An **ambiguous outcome becomes `reconciliation_required` and is never retried automatically.**
6. Per-action audit: who authorized what, which grant, payload digest, timestamps and outcome. Content stays in private storage; audit records hold digests and IDs.

Revocation takes effect for any action not yet dispatched. It cannot undo an effect already sent, and the UI says so.

## When the user is offline or unavailable

Opportunities appear while the user is asleep or busy. Classes A and B continue automatically: discovery, evaluation and preparation of a complete draft package. The system then notifies, with digest and quiet-hours rules from the [Frontend Design System](FRONTEND_DESIGN_SYSTEM.md#attention-model). Submission waits for approval unless a class-D policy exists. A prepared package expires if the posting changes, the identity version changes or the approval window lapses; resuming it re-runs eligibility and liveness. Speed comes from early discovery, ready-to-review packages and reliable notifications, not from dropping approval.

## Existing mechanisms mapped to the model (no behavior change now)

| Existing mechanism | Becomes |
|---|---|
| Monitor recurring authorization (`authorize-recurring`, expiring, revocable, exact sources, per-tick budget) | Class-A grant for monitoring reads |
| `--authorize-live-read` on one-shot polls | Class-A exact approval for a single read |
| Reviewed Greenhouse submission plan hash and exact approval ([reviewed-submission](../../../lib/applications/reviewed-submission.mjs)) | Class-C exact approval |
| Approved upload hashes ([upload-policy](../../../lib/applications/upload-policy.mjs)) | Document-hash scope constraint |
| Gmail reviewed send and reply approval ([runbook](../../GMAIL_SENDING.md)) | Class-C exact approval (recipient, thread, body digest) |
| Preparation proposals' approval checklist (monitor) | Approval Center items |
| `policy.json` `submissionEnabled=false`, limits 0, `killSwitch` | Global policy and class-D defaults (disabled) |

Migration is incremental. Each mechanism moves only when the unified store can express it with equal or stricter guarantees, and each move has regression tests proving no weaker check.

## Approval Center

One workspace (see the [Frontend Design System](FRONTEND_DESIGN_SYSTEM.md#workspaces)) lists pending decisions by urgency and expiry: applications ready for review, messages to send, preparation scopes requested, uncertain answers and eligibility to resolve, and reconciliation items. Each item shows the exact payload, its evidence and risks, and offers approve, edit, reject, snooze or expire. Bulk approval is not offered for class-C actions.

## Future application autopilot (P9, separately authorized)

Possible only after repeated successful P2/P3 live acceptance on the specific platform. It requires a written class-D policy (allowlisted employers/platforms, minimum eligibility with no unknowns, approved résumé and answer hashes, daily caps, time windows), a pilot, receipts and monitoring. Any unknown, challenge, changed fact or document, or uncertain outcome stops it. Configuration flags alone can never enable it.
