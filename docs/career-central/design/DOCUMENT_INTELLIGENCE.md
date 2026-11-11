# Document Intelligence — résumé, cover-letter and answer personalization

Status: **proposed integrated subsystem; components partially exist** ([F17–F23](../FEATURE_INVENTORY.md#resumeprofile--cc-r02r11)). Job-specific tailoring is **not** implemented as an integrated, evidence-checked workflow. This document is the authoritative definition for CC-R11 ([PRODUCT](../PRODUCT.md)). It obeys AGENTS.md's Source-of-Truth Boundary: keywords may be reformulated but never fabricated, and authorship claims require attribution in primary files.

## Pipeline

1. **Analyze the posting.** Extract requirements (required versus preferred), responsibilities, domain terms and seniority signals. The posting is untrusted data, and imperative text inside it is flagged, never followed.
2. **Retrieve evidence.** Select relevant `verified_fact` records and approved narrative stories from [Career Identity](CAREER_IDENTITY.md), each carrying its record ID.
3. **Select a base.** Choose the most appropriate *approved* résumé base by role family and evidence coverage.
4. **Plan tailoring.** Reorder, emphasize, condense and rephrase within the evidence; never add skills, metrics, titles, dates or authorship that the records don't support.
5. **Generate** an ATS-compatible variant (existing HTML/PDF/LaTeX renderers), plus an optional cover letter and role-specific answers in the user's style (`voice-dna.md`, writing samples are style-only).
6. **Verify claims.** Every sentence maps to record IDs or an explicit user approval. Unsupported or overstated claims, keyword stuffing and title or date drift are blocking findings, reusing the existing checks (`verify-cv-facts`, `verify-cv-structure`, `cv-title-check`, `keyword-match`, `ats-payload` lints).
7. **Review.** A diff against the base shows each change with its evidence. The user edits, approves or rejects.
8. **Approve and freeze.** An approved artifact is immutable: content hash, identity version, base version, posting identity and reviewer timestamp.
9. **Bind to the application.** The exact résumé, letter and answer set used for each application attempt are recorded by hash and retained (the existing upload policy already enforces approved hashes).

## Rules

- Generated documents are drafts (class B) until approved. Uploading or sending them is class C under [Approvals and Autonomy](APPROVALS_AND_AUTONOMY.md).
- No document is regenerated or replaced silently after approval. A changed fact invalidates pending approvals that depended on it.
- ATS optimization improves structure and truthful coverage only. Fit scores and ATS checks are not hiring predictions.

## Reuse

[`modes/pdf.md`](../../../modes/pdf.md), [`modes/cover.md`](../../../modes/cover.md), [CV Studio](../../../web/src/lib/cv-studio/studio.mjs), [`generate-cover-letter.mjs`](../../../generate-cover-letter.mjs), [`verify-cv-facts.mjs`](../../../verify-cv-facts.mjs), [`ats-payload.mjs`](../../../ats-payload.mjs), [`upload-policy.mjs`](../../../lib/applications/upload-policy.mjs) and [`outcome.mjs`](../../../outcome.mjs) snapshots.

## Delivery

P5 in the [roadmap](../ROADMAP.md), after the Career Identity read interface (I1/I2). Basic approved-base selection is enough for P2 and does not wait for full tailoring.
