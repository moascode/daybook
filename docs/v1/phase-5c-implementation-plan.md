# Phase 5c — Implementation Plan (5 Waves)

> **Status:** Approved 2026-07-05. Companion to `docs/phase-5c-wallet-ux.md` (the backlog
> with per-item problem/fix/acceptance detail). This document sequences that backlog into
> five themed wave PRs and records what is already done.
>
> **Baseline:** `main` after PR #27 (`feat/share-transaction-revamp`, merged 2026-07-05).
> All waves branch from post-#27 main and merge **sequentially** in order below.

---

## Scope decisions

1. **B + C items only.** D1–D6 are excluded — each needs individual owner sign-off
   (CLAUDE.md §2 Rule 3) and stays parked in the backlog doc.
2. **No schema changes, no migrations.** Every B/C item is schema-free.
   (Next free migration prefix is `0006`, unused by this plan.)
3. **C9 (DB-side dashboard aggregation) stays deferred** per the backlog doc.
4. **E2E spec prefixes 28–32 are pre-reserved** per wave below. Duplicates already exist
   at 23–26 — do not create more, and do not renumber if waves land out of order.

## Already done / obsolete (backlog doc corrections)

| Item | Status | Evidence |
|---|---|---|
| B1 search | **PARTIAL** — store/hook/server `q` plumbing shipped in PR #27; only the UI input remains | `src/stores/wallet.store.ts:12`, `src/hooks/useWallet.ts:237,302`, `server/routes/wallet.ts:319-323` |
| B5 zero-account CTA | **DONE** | `WalletPage.tsx:465`, `AccountsPage.tsx:88` |
| C7 export dropdown → Radix | **OBSOLETE** — export is now an `ExportModal`, no hand-rolled dropdown exists | `WalletPage.tsx:517` |
| C4 export filters | **PARTIAL** — server export route accepts filters incl. `q`; client still builds CSV from the store | server `wallet.ts:350-368`; client `useWallet.ts:497-528` |

---

## Wave 1 — Daily-use wins

**Branch:** `feat/wallet-search-quick-add` · **Size:** ~300–400 lines · **Depends on:** post-#27 main

| Item | Implementation note |
|---|---|
| B1 search (UI-only, S) | Debounced (~300 ms) search input in the WalletPage filter bar (~lines 287–368) writing `filters.q`; server `LIKE` filter already live |
| B2 save & add another (S) | Third footer button in `TransactionForm.tsx`: submit, keep modal open, reset amount/merchant/description/tag, preserve date/account/type, refocus Amount |
| C4 export filters (S) | Point `exportTransactions` (`src/hooks/useWallet.ts:497-528`) at the existing server export route with active filters incl. `q` (prefer the server route over client-side `Papa.unparse`) |
| B12 caption (trivial) | Reword opening-balance helper text in `AccountForm.tsx:~151` |

- **E2E:** new `e2e/28-wallet-search.spec.ts` (substring narrows list, clear restores,
  combines with type/account filters); new `e2e/29-transaction-quick-add.spec.ts`
  (retains date/account/type, clears + focuses amount); new block in existing
  `e2e/15-wallet-export.spec.ts` (export with active filter yields only filtered rows).
- **Commits:** B1 / B2 / C4 / B12 — four commits.
- **Risks:** C4 changes the export source (client-built → server CSV) — diff a sample
  export against spec 15's column assertions first. Debounced search needs a
  deterministic e2e signal: `waitForResponse` on `/api/transactions?…q=`.

## Wave 2 — Mobile & accessibility

**Branch:** `fix/wallet-mobile-a11y` · **Size:** ~350–450 lines · **Depends on:** Wave 1 merged

| Item | Implementation note |
|---|---|
| B3 modal scroll (S) | `max-h-[90vh] overflow-y-auto` in `src/components/ui/Modal.tsx:27-35`; optional small-screen bottom-sheet (`top-4 translate-y-0`) |
| B4 accessible rows/cards (S–M) | `role="button"` + `tabIndex={0}` + Enter/Space handlers + focus ring on `TransactionList.tsx:106` rows and `AccountCard.tsx` cards; nested action buttons keep `stopPropagation` |
| B6 visible card actions (S) | Replace `opacity-0 group-hover` (`AccountCard.tsx:123`) with the always-visible transaction-row pattern |
| B7 responsive grids (S) | `grid-cols-1 sm:grid-cols-3` at `Dashboard.tsx:257`, `grid-cols-1 sm:grid-cols-2` at `:340`; same for ReportsPage YoY chart; verify Recharts `ResponsiveContainer` min-heights |
| B11 touch targets (S) | ≥40 px hit areas: sidebar chevron (`Sidebar.tsx:~147`), row icon-buttons (`TransactionList.tsx:~140`) |
| C11 drawer height (S) | Scroll region in `Sidebar.tsx` so Settings stays reachable at 390 px |

- **E2E:** new `e2e/30-wallet-a11y.spec.ts` (Tab reaches row/card, Enter opens editor,
  card actions visible without hover); new blocks in `e2e/21-mobile-responsive.spec.ts`
  (390×~600: form Type + Save reachable via scroll; no horizontal dashboard overflow;
  sidebar Settings reachable).
- **Commits:** B3 alone (shared primitive, independently revertable) / B4+B6 / B7 / B11+C11.
- **Risks:** **B3 touches the shared Modal primitive — run the FULL e2e suite**, not just
  affected specs (every modal inherits the change, incl. 5b share dialogs, specs 23–27).
  B4's role/tabIndex changes may alter row-click selectors used by specs 03 and
  25-wallet-intuitiveness — grep those specs before changing markup.

## Wave 3 — Server hardening & perf

**Branch:** `feat/wallet-server-hardening` · **Size:** ~400–500 lines · **Depends on:** Wave 2 merged

| Item | Implementation note |
|---|---|
| C1 batched balances (M) | New `GET /api/accounts/balances` → `{id, balance}[]` from one grouped query (next to per-account route at `wallet.ts:87`); switch `WalletPage.tsx:128,134` + `AccountsPage.tsx:29` off the `Promise.all` fan-out; keep the per-account route for compat |
| C2 input validation (M) | POST/PATCH transactions (`wallet.ts:439-462` + PATCH): `type ∈ {income,expense,transfer}`, `amount` finite > 0, ISO date, transfer requires distinct `destinationAccountId` → 400 `{error}`; minimal amount checks on budgets/goals |
| C12 error middleware (S) | Express error middleware in `server/index.ts` returning consistent `{error}` JSON + minimal request logging — must land before Wave 5's C3 |
| C8 bounded budgets load (S) | Pass current-month `dateFrom/dateTo` to `loadTransactions` at `BudgetsPage.tsx:~33` |

- **E2E:** new `e2e/31-wallet-server-hardening.spec.ts` — API-level validation rejections
  via Playwright `request` (bad type / negative amount / transfer-to-self → 400) plus a
  UI parity check that hero net-worth still matches account sums after the C1 switch.
  Run `10-wallet-net-worth`, `26-opening-balance`, `24-shared-accounts` as the C1
  regression net.
- **Commits:** C1 (route + client switch together — an endpoint without a consumer is
  dead code) / C2 / C12 / C8.
- **Risks:** C1's grouped query must match the per-account query exactly — opening-balance
  inclusion (spec 26) and 5b shared-account visibility scoping (spec 24). C12 may change
  error bodies that auth/UI code string-matches — run `22-auth`. C2 could 400 the
  recurring-posting or CSV-import paths — run `24-recurring-posting`, `04-wallet-csv`.

## Wave 4 — Visual & labelling polish

**Branch:** `fix/wallet-visual-polish` · **Size:** ~250–350 lines · **Depends on:** Wave 3 merged

| Item | Implementation note |
|---|---|
| B8 label unification (trivial) | "Total Net Worth" app-wide (`WalletPage.tsx:~176`, `AccountsPage.tsx:~70`) |
| B9 positive-money colour (S) | One "positive money" token; align hero, Net summary, and income greens |
| B10 recurring card badges (S) | Type badge + category chip on rule cards (`RecurringPage.tsx:~177-224`) |
| C10 axis formatting (S) | `formatAxisMYR` helper in `src/lib/utils.ts` (plain number <10k, `k` above); replace hardcoded `/1000` at `Dashboard.tsx:330,377` and `ReportsPage.tsx:100` |
| C13 chart a11y (M) | `aria-label`/visually-hidden tabular summaries on Dashboard/Reports charts; glyph on the net figure so status isn't colour-only |

- **E2E:** no new spec file (no new route). **Update label assertions in specs 10 + 26 in
  the same commit as B8** — and grep all specs for both label strings first
  (25-wallet-intuitiveness likely asserts one). Add blocks to `05-wallet-dashboard`
  (plain-number axes for sub-1k data; chart aria summary) and `14-wallet-recurring`
  (badge/chip visible at rest).
- **Commits:** B8 + spec updates (atomic) / B9 / B10 / C10+C13.

## Wave 5 — Refactors & cleanup (highest risk, lands last)

**Branch:** `refactor/wallet-crud-modal-toasts` · **Size:** ~450–600 lines · **Depends on:** Waves 2 + 3 merged

| Item | Implementation note |
|---|---|
| C5 useCrudModal + ConfirmDeleteModal (M) | New `src/hooks/useCrudModal.ts` + `src/components/ui/ConfirmDeleteModal.tsx`; adopt in `BudgetsPage`, `GoalsPage`, `RecurringPage` — pure refactor; existing specs 13/14/16 must pass unchanged |
| C3 error toasts (M) | try/catch + `addToast` on all wallet CRUD handlers (today only `RecurringPage.tsx:43` + `CsvImport.tsx:25` have it); surface C12's `{error}` message; add a `useMutationWithToast` helper only if it stays thin |
| C6 dead code (S) | Delete or wire `processRecurringTransactions` and `getMonthlySpending` in `useWallet.ts` — re-grep for callers at implementation time |

- **E2E:** new `e2e/32-wallet-error-toasts.spec.ts` using `page.route()` to force a 500 on
  a mutation and assert the toast — the only reliable way to exercise the failure path.
- **Commits:** C5 (extraction + 3-page adoption atomic — splitting per page leaves the
  hook orphaned mid-history) / C3 / C6.
- **Risks:** highest of the plan — three pages' modal state change simultaneously.
  `ConfirmDeleteModal` inherits Wave 2's Modal max-height; C3 depends on Wave 3's error
  shape. Merge only after both.

---

## Cross-wave summary

| # | Branch | Items | New specs | Depends on |
|---|---|---|---|---|
| 1 | `feat/wallet-search-quick-add` | B1 B2 C4 B12 | 28, 29 (+block in 15) | main post-#27 |
| 2 | `fix/wallet-mobile-a11y` | B3 B4 B6 B7 B11 C11 | 30 (+blocks in 21) | Wave 1 |
| 3 | `feat/wallet-server-hardening` | C1 C2 C8 C12 | 31 | Wave 2 |
| 4 | `fix/wallet-visual-polish` | B8 B9 B10 C10 C13 | — (blocks in 05/10/14/26) | Wave 3 |
| 5 | `refactor/wallet-crud-modal-toasts` | C5 C3 C6 | 32 | Waves 2 + 3 |

**Per-wave gate** (CLAUDE.md §11/§16/§17): branch from fresh `main` → implement →
verify (`tsc`, `npm run typecheck:server`, lint, affected e2e specs — full suite for
Wave 2) → PR → owner merges before the next wave branches.

## Out of scope (parked)

- **D1–D6** — each needs individual owner sign-off; see `docs/phase-5c-wallet-ux.md` §D.
- **C9** — DB-side dashboard aggregation; deferred until data volume warrants it.
