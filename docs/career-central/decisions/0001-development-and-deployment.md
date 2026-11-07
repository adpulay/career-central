# ADR 0001 — Local development, hybrid AWS deployment target

Date: 2026-11-06. Status: Accepted direction, bounded by the user's M0.5/M1 authorization. Specific infrastructure/authentication/migration designs remain proposed.

Context: Career Ops already has a substantial local file/CLI/web engine. Career Central must eventually offer an authenticated cloud dashboard and cloud data while retaining local Windows/WSL automation. A rewrite wastes working components; publishing the local command server is unsafe.

Decision: develop incrementally in this repository. Keep current Markdown/TSV and JSON owners intact; first implement a canonical read-only projection. Target a hybrid AWS data/dashboard plane and outbound-only local workers later, with explicit ownership migration, capability gates and offline task durability.

Alternatives: local-only access fails computer-off availability; an always-on VM is simpler initially but adds maintenance; managed Next.js hosting needs version/feature verification. The detailed comparison/cost assumptions remain in audit section 15.

Consequences: no cloud resources or dependencies in M0.5/M1; no changed approved résumé, mailbox access or submission authority. Shared docs contain sanitized project state only. Future hosting, token custody, task transport and write migration each require a scoped task/decision. This ADR is not a grant to provision or submit.

Evidence: user-approved Phase 0 audit and explicit milestone request. See [PRODUCT](../PRODUCT.md) and [CC-001](../tasks/CC-001.md).
