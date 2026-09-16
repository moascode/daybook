> **Status:** Archived · **Last verified:** 2026-09-16

# Archive

Plans that shipped, analyses that informed them, and proposals that were
abandoned. **Nothing here describes the system as it is** — read it for the
reasoning, never as instructions.

Every row below was checked against the code on 2026-09-16. Where a plan is
only partly built, the unbuilt remainder is tracked in
[../backlog/](../backlog/) rather than left buried in a 600-line document.

## Shipped

| Doc | What it shipped | Proof |
|---|---|---|
| [auto-categorisation-plan.md](auto-categorisation-plan.md) | Rule-based category suggestion | `worker/lib/merchant.ts`, spec 59 |
| [ai-bulk-categorize-feature.md](ai-bulk-categorize-feature.md) | "Ask AI" fallback in bulk edit | `POST /transactions/suggest-categories-ai`, spec 60 |
| [flow-plan.md](flow-plan.md) | AI merchant-name resolution | `POST /merchants/resolve`, migration 0013, spec 64 |
| [split-settlement-plan.md](split-settlement-plan.md) | Split review + settlement lifecycle | migrations 0010–0011, `worker/routes/settlements.ts`, spec 53 |
| [wallet-split-enhancements.md](wallet-split-enhancements.md) | Percentage auto-adjust, uniform bulk split | `redistributePercents()`, spec 27 |
| [csv-transfer-linking-plan.md](csv-transfer-linking-plan.md) | "Link as transfer", absorbed import hashes | migration 0009, specs 49–51 |
| [shared-review-improvements.md](shared-review-improvements.md) | Unified review queue | `SharedActivity.tsx`, spec 54 |
| [shared-review-implementation-plan.md](shared-review-implementation-plan.md) | R1–R3 of that queue | migration 0011, `SettleUpDialog` |
| [phase-4-plan.md](phase-4-plan.md) | Multi-user Node + SQLite backend | superseded by `worker/` |
| [phase-5b-sharing-plan.md](phase-5b-sharing-plan.md) | Groups, shared accounts, splits | v1.0.1 |
| [phase-6-online-plan.md](phase-6-online-plan.md), [option-2-workers-d1-plan.md](option-2-workers-d1-plan.md), [option-2-spike-findings.md](option-2-spike-findings.md) | The Workers + D1 migration | v2 |
| [pwa/](pwa/) | P1–P5: install quality, offline shell, code-splitting, push, themed splash | all five verified shipped |
| [design-adoption/](design-adoption/) | R1–R7 and R18: the token layer, the app shell, and design adoption across Wallet, Tasks, Trips and Day | see [its index](design-adoption/README.md) |

> **`shared-review-implementation-plan.md` says "not merged".** It shipped. The
> line is a point-in-time status that was never updated — exactly the drift the
> status headers now exist to make visible.

> **`pwa/audit.md` says the offline fallback "cannot ever work".** It was fixed.
> `public/sw.js` now precaches the shell on install and serves it on navigation
> failure.

## Partly built — remainder in the backlog

| Doc | Built | Not built |
|---|---|---|
| [phase-5c-wallet-ux.md](phase-5c-wallet-ux.md) | B1–B6, B8, B9, B12, C1, C2, C4, C5, C10, C13 | B7 responsive grids · B10 recurring-card badges · B11 ≥40px touch targets · C3 error toasts (partial) · C6 dead-code cleanup (partial) |
| [phase-5c-implementation-plan.md](phase-5c-implementation-plan.md) | Waves 1, 3, 4, 5 | Wave 2 remainder (B7, B11) |
| [deferred-items-plan.md](deferred-items-plan.md) | CD-05⁺, U-16, CD-20 | Waves F1–F3, §4.4 per-claim timeline |
| [feature-consistency-plan.md](feature-consistency-plan.md) | — | 8 waves, never started |

## Never built

| Doc | Why it's here |
|---|---|
| [business-module-plan.md](business-module-plan.md) (604 lines) | Invoices, customers, products, purchases, sales. No `worker/routes/business.ts`, no `src/modules/business/`, no migrations. Tracked as an epic in the backlog so the question "do we still want this?" is asked somewhere visible. |

## Analyses

| Doc | |
|---|---|
| [project-history.md](project-history.md) | The session-by-session narrative and the release record |
| [adversarial-review-2026-07-20.md](adversarial-review-2026-07-20.md) | Security/robustness review |
| [feature-consistency-review.md](feature-consistency-review.md) | The findings behind `feature-consistency-plan.md` |
| [apple-wallet-capture-plan.md](apple-wallet-capture-plan.md) | Background for the capture inbox. **Recovered 2026-09-16** — it was written on an unmerged branch and never reached `main`, while shipped code cited it as the Apple-specific reference |
| [UAT-FEEDBACK.md](UAT-FEEDBACK.md) | Alpha feedback, all items resolved or superseded |
| [manual-smoke-checklist.md](manual-smoke-checklist.md) | Manual sharing/split checklist, superseded by specs 27, 35, 36, 54 |
