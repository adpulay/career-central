# Frontend Design System — calm career workspace

Status: **design direction; not implemented.** Authoritative definition for CC-R23 ([PRODUCT](../PRODUCT.md)). The current dashboard (Next.js 16, Tailwind CSS v4, upstream career-ops theme tokens) remains in use, and this document doesn't rebuild it.

## Intent

The interface should reduce cognitive load and protect the user's time and well-being — *"I need more of me, but I also need to maintain me."* It feels calm, light and encouraging, closer to a wellness companion than a trading terminal. **Wii Fit is an aesthetic reference only.** No Nintendo assets, characters, sounds, logos, trade dress or layouts are copied. All visuals, icons and motion are original.

## Visual language

| Token family | Direction (values are starting proposals, validated for contrast before use) |
|---|---|
| Surfaces | Soft whites and very light grey-greens (`--cc-bg` ≈ `#F7FAF8`, `--cc-surface` ≈ `#FFFFFF`, `--cc-surface-muted` ≈ `#EEF4F0`) |
| Primary accent | Pale-to-medium greens for progress and positive states (`--cc-green-100` ≈ `#E3F4E8`, `--cc-green-500` ≈ `#4FA86A`, text-safe `--cc-green-700` ≈ `#2F6B42`) |
| Secondary accent | Restrained blues for information and navigation (`--cc-blue-100` ≈ `#E4EFF8`, `--cc-blue-600` ≈ `#2F6FA8`) |
| Attention | Muted amber for "decision needed" and soft red only for failures or blocked items. Color is never the only signal: always paired with text and an icon. |
| Shape | Generous radii (12–20 px cards, pill buttons and tags), soft low-contrast shadows, 1 px hairline borders |
| Space | 4 px base scale with generous section spacing; one primary column on mobile, two on desktop |
| Typography | A rounded humanist sans for UI, with calm sizes and clear hierarchy (≤ 3 weights). Numbers in tabular figures. Font licensing is checked when chosen. |
| Dark mode | A low-glare dark variant (deep green-grey surfaces), tokenized from the start |

**Motion:** gentle ambient motion (a slow breathing or idle state on Home, ≤ 1 subtle loop per screen), small response animations on press, save and complete (120–220 ms, ease-out), and subtle achievement feedback (a soft check bloom when a decision is completed). Under `prefers-reduced-motion`, ambient motion stops and transitions become instant or fades. No auto-playing sound.

**Accessibility:** WCAG 2.2 AA contrast (pale accents are fills, never text), visible focus rings, full keyboard operation, 44 px touch targets, semantic landmarks, screen-reader labels for state, and responsive layouts from 320 px. PWA install, offline shell and push are a later phase ([F50](../FEATURE_INVENTORY.md#infrastructureexperience--cc-r03r04r07r08r16)).

## Attention model

- **Urgent** (top of Home and the Approval Center): decisions with deadlines or expiring approvals, failed or blocked actions needing the user, reconciliation items, interview responses due.
- **Routine** (quiet feeds and digests): background discovery, unchanged sources, new reviewable postings below the priority threshold, completed automatic preparation.
- Notifications are budgeted (a daily cap and quiet hours from user preferences), coalesced and snoozable. Failures that need nothing from the user are not notifications.
- Achievement feedback acknowledges real progress (applications sent, practice completed). There are no streaks, guilt prompts or engagement mechanics.

## Workspaces

| Workspace | Purpose | Builds on |
|---|---|---|
| Home | Today: a few urgent items, gentle progress summary, what the system did while away | `/career-central` overview |
| Opportunities | Ranked, paginated shortlist with fit explanations, eligibility unknowns, sources and freshness | Job monitor panel, `/explore`, `/jobs` |
| Applications | Lifecycle from prepared to approved, submitted, confirmed or reconciled, with exact artifacts used | `/pipeline`, application ledger |
| Approval Center | Every pending decision ([Approvals and Autonomy](APPROVALS_AND_AUTONOMY.md#approval-center)) | Preparation proposals, reviewed send/submit flows |
| Networking | Contacts, conversations, drafts awaiting approval ([Networking](NETWORKING_AND_COMMUNICATIONS.md)) | `contacts.tsv`, Gmail context |
| Career Identity | Facts, evidence and verification prompts ([Career Identity](CAREER_IDENTITY.md)) | Profile files (read adapter first) |
| Career Development | Interview prep, DSA practice, skills, certifications, projects | Interview and training modes |
| Analytics | Funnel, response rates, source effectiveness, monitor health, with denominators and unknowns | `/analytics` |
| Settings | Sources and cadence, autonomy defaults, notifications and quiet hours, connected accounts (handles only) | `/config`, monitor CLI |

## Migration strategy

1. **Scope.** The new tokens and components apply only under Career Central routes (a route-group layout with a `cc` theme scope), so upstream career-ops pages and their auto-updated theme are unaffected. No global `globals.css` rewrite.
2. **Tokens first.** Add `--cc-*` CSS variables and Tailwind v4 theme bindings in a Career-Central-only stylesheet, then a small component set (card, pill button, tag, status badge, empty state, progress ring) with accessibility tests.
3. **Incremental pages.** Convert one workspace at a time, starting with Home and Opportunities (the highest daily use), keeping existing routes working. Each step needs a browser suite at 375/1440 px, a reduced-motion check, a contrast check and no data-path changes.
4. **Information architecture.** Introduce workspace navigation once at least three workspaces exist. Old routes redirect or link.
5. **PWA later:** manifest, service worker (shell-only cache, no personal data cached), then push, per the audit's PWA privacy rules.

Design and frontend work can proceed in parallel with backend milestones when it doesn't change data contracts.
