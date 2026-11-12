# Career Central — start here

Career Central extends Career Ops into a personal career workspace. Develop locally; target a hybrid AWS dashboard/data plane with outbound-only Windows/WSL automation workers. No deployment or new external application actions are authorized by the current milestone.

Current continuation: the five-employer monitoring pilot is baselined and awaiting activation approval; CC-017 C0 is integrated and C1 cloud-adapter preparation is tested locally (no AWS resources). The local monitor's real data is migrated to the verified per-employer store, a gated scheduler and health states. Cloud monitoring is planned in [CLOUD_DEPLOYMENT_PLAN](CLOUD_DEPLOYMENT_PLAN.md), [ADR 0003](decisions/0003-cloud-monitoring-first.md) and [CC-017](tasks/CC-017.md); employer recommendations are in [EMPLOYER_COVERAGE](EMPLOYER_COVERAGE.md). See [STATUS](STATUS.md) and [HANDOFF](HANDOFF.md). Nothing is provisioned or activated.

Product vision and subsystem designs: [PRODUCT](PRODUCT.md) → [design/](design/) ([identity](design/CAREER_IDENTITY.md), [sources](design/JOB_SOURCES.md), [documents](design/DOCUMENT_INTELLIGENCE.md), [approvals](design/APPROVALS_AND_AUTONOMY.md), [networking](design/NETWORKING_AND_COMMUNICATIONS.md), [frontend](design/FRONTEND_DESIGN_SYSTEM.md)), plus [ADR 0004](decisions/0004-product-vision-expansion.md).

Read in this order:

1. Repository [AGENTS.md](../../AGENTS.md) and applicable scoped instructions remain authoritative; this entry point does not replace them.
2. [CURRENT_STATE.md](CURRENT_STATE.md) → [STATUS.md](STATUS.md): verified implementation/validation and limitations.
3. [HANDOFF.md](HANDOFF.md): latest work, results and safe next action.
4. [Completed task CC-005](tasks/CC-005.md) and [protected Microsoft storage contract](../../lib/email/PROTECTED_STORAGE.md), then [CC-004](tasks/CC-004.md) and only relevant [decisions](decisions/0001-development-and-deployment.md) and source/interface contracts.
5. M1 interface and source authority: [projection contract](../../lib/career-central/README.md).
6. [PRODUCT.md](PRODUCT.md) and [ROADMAP.md](ROADMAP.md) for requirements and dependencies. Consult the long [Phase 0 audit](../architecture/career-central-audit.md) by section, not as mandatory startup context.

Shared project documentation is not a source of candidate qualifications, application answers or submission approval. Canonical private data remains in the user layer; credentials remain outside Git. Never copy private logs, mail, codes or résumé contents into these documents.

The root instruction file exceeds typical default discovery budgets. This early pointer improves discoverability without truncating it: explicitly load relevant original sections and scoped rules as needed, not unrelated material. Do not create an overriding instruction file to bypass them. Root AGENTS is upstream-managed: preserve/review this small additive pointer after an upstream update; no updater behavior was changed.

ChatGPT and Codex coordinate through the task, STATUS and HANDOFF, not assumed shared chat memory. A session without repository access needs these compact files and a sanitized diff supplied explicitly. Verify actual source and Git state before repeating work or relying on old test results.
