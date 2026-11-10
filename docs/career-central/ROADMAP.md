# Milestones and dependencies

| Milestone | State | Acceptance / dependency |
|---|---|---|
| M0 Phase 0 audit | Reviewed by user | [Audit](../architecture/career-central-audit.md) |
| M0.5 context bootstrap | Complete locally | Durable context and unchanged original AGENTS instructions |
| M1 canonical read-only projection | Complete locally | [CC-001](tasks/CC-001.md); no canonical writes or external effects |
| M2 unified dashboard read slice | Complete locally | [CC-002](tasks/CC-002.md); canonical overview, Home link, read-only API, fixture/production validation |
| M3A durable evidence and health contracts | Complete locally | [CC-003](tasks/CC-003.md); strict versioned metadata, deterministic read states, no producer activation |
| M3B operational persistence and recovery | Complete locally | [CC-004](tasks/CC-004.md); metadata round trips, typed CAS/replay publishers, atomic/recovery tests and health display |
| M3C platform recovery and secure Microsoft Graph storage | Complete locally | [CC-005](tasks/CC-005.md); WSL/Linux tested, native Windows and working Linux Secret Service remain unvalidated; live Graph remains separate |
| Local M3D preparation | Implemented locally | [CC-006](tasks/CC-006.md); bounded sync coordinator with fictional integration and recovery tests; no live entry point |
| Interrupted sync reconciliation | Implemented locally | [CC-007](tasks/CC-007.md); explicit worker-stop acknowledgment and revision-guarded abandonment; no observation replay |
| M3D live read-only Outlook connection | Controlled command implemented; live acceptance pending | [CC-008](tasks/CC-008.md); session-only interactive first read or separately validated protected storage; user registration/sign-in/consent required; no live run yet |
| Native verification-session continuation | Proposed, not authorized | Live session retention, sender validation, exact code-use approval |
| Hybrid cloud vertical slice / worker transport | Proposed, not authorized | API/data ownership/auth/cost approval; no provisioning now |
| Structured interview/time planning and broader analytics | Proposed | Reliable identity/evidence and user-supplied time constraints |

See audit sections 11, 15.8 and 16 for proposed dependencies. Keep this index small; acceptance evidence lives in tasks, current state in STATUS, and historical changes in Git. A completed development task is not an application submission or permission to execute external actions.
