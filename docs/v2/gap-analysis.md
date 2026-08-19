# Gap analysis — the proposal against the codebase

Measured 2026-08-19 against `main` at `bfcbfc7`. Source of truth for the
codebase side is `src/` on disk, not CLAUDE.md §5.

---

## 1. Headline numbers

| | Proposal | Codebase today |
|---|---|---|
| Modules in the app bar | 4 (Day, Tasks, Wallet, Trips) | 2 (Tasks, Wallet) |
| Designed pages | 24 | 20 routes, 11 of which map 1:1 |
| Design tokens | 2-layer (primitives → semantics), 3 scales, motion | 1-layer semantics + mirrored Tailwind ramps, no space/type/motion scale |
| Component CSS | 2,185 lines, ~80 named components | Tailwind utilities inline, ~20 UI primitives |
| Dark mode selector | `[data-theme="dark"]` | `.dark` class |
| e2e specs | — | 63 files; 507 `getByTestId` vs **1,423** role/text/label lookups |

The last row is the single biggest execution risk and is handled in
[foundation/04-e2e-and-migration.md](foundation/04-e2e-and-migration.md).

---

## 2. Page-by-page map

### Wallet — near-perfect 1:1. This is why it goes first.

| Proposal page | Route today | Component | Verdict |
|---|---|---|---|
| `dashboard.html` (Overview) | `/wallet/dashboard` | `Dashboard.tsx` (692 L) + 12 `dashboard/*` cards | **Restyle.** Most content cards already exist: `SpendPace`, `WeekRhythm`, `BudgetPace`, `CategoryBreakdown`, `UpcomingBills`, `MerchantTable`, `SharedSummary`, `CommittedSpend`, `WhatChanged`, `StatTiles`, `Sparkline`. |
| `transactions.html` | `/wallet` | `WalletPage.tsx` (997 L) + `TransactionList.tsx` | **Restyle + chips.** Filters exist; visible removable chips and day-net pills do not. |
| `accounts.html` | `/wallet/accounts` | `AccountsPage.tsx`, `AccountCard.tsx` | **Restyle + 3 new cards** (composition, per-account sparkline, utilisation, 12-month net worth). |
| `shared.html` | `/wallet/shared` | `SharedPage.tsx` (523 L), `SettleUpDialog.tsx` | **Restyle + 2 features.** Bilateral netting exists per pairing; group-wide *minimum transfer set* and Split rules do not. |
| `budgets.html` | `/wallet/budgets` | `BudgetsPage.tsx` (250 L) | **Restyle + Suggestions engine.** |
| `goals.html` | `/wallet/goals` | `GoalsPage.tsx` (223 L) | **Restyle + rings, funding rate, ETA, paused/behind, trajectory.** Today it is CRUD + a bar. |
| `recurring.html` | `/wallet/recurring` | `RecurringPage.tsx` (368 L) | **Restyle + month calendar + "Worth a look" anomalies + annual cost.** Today it is CRUD + a list. |
| `reports.html` | `/wallet/reports` | `ReportsPage.tsx` (181 L) | **Restyle + paired columns/savings gap, "What changed" diverging bars, category sparkline trends.** Today it is YoY bars. |
| — | `/wallet/import` | `CsvImport.tsx` | Design moves Import CSV **off the sidebar** onto the Transactions page and the profile menu. Route stays; entry points move. |
| — | `/wallet/canonicalize-merchants` | `CanonicalizeMerchantsPage.tsx` | Not in the proposal. See D-14. |

### Tasks — one page today, seven designed. The largest single gap.

| Proposal page | Exists? | What it needs |
|---|---|---|
| `tasks.html` (Today) | ✗ | list, priority, due time, assignee, subtask count, 7-day load strip, Wallet chips |
| `tasks-upcoming.html` (week board) | ✗ | week bucketing, drag-to-schedule, "waiting for a date" set |
| `tasks-all.html` | ✗ | stat cards, filter chips, date grouping, age breakdown |
| `tasks-assigned.html` | ✗ | **task sharing across the household** — does not exist at all (D-15) |
| `tasks-list.html` (per-list) | ✗ | lists as a first-class entity, list activity feed, per-member completion split |
| `tasks-completed.html` | ✗ | `completed_at`, year heatmap, time-to-finish |
| `tasks-habits.html` | ✗ | habits entity, 28-day grid, streaks |
| — | `/tasks` = `TasksPage.tsx` (792 L) outliner | The Workflowy bullet tree. **Not in the proposal at all.** See D-3. |

Current `tasks` table: `id, user_id, parent_id, content, note, is_completed,
is_collapsed, sort_order, due_date, created_at, updated_at`. Every designed row
attribute except content and due date is missing.

### Trips — greenfield, 5 pages, new schema, new cross-module thread.

`trips.html`, `trip.html`, `trip-itinerary.html`, `trip-prep.html`,
`day-trip.html`. Nothing exists. `travel-module-plan.md` is referenced by
`REVIEW.md` but is **not in this repo** — the design is the only surviving
specification, which is why `trips/01-data-model.md` reconstructs it.

### Day — greenfield, 1 designed page + 3 promised sidebar destinations.

`day.html` exists as a mockup; `This week`, `Calendar`, `Weekly review` are
named in its sidebar and were never drawn. Day needs a **time of day** on
transactions, which the schema does not have (D-6), and **notes** as an entity,
which do not exist.

---

## 3. Design-system gap

The good news is that the semantic *names* already agree in the places that
matter, so this is a re-map rather than a rewrite.

| Proposal token | Codebase equivalent | Action |
|---|---|---|
| `--canvas` `--surface` `--fg` `--fg-muted` `--fg-subtle` `--fg-faint` `--line` `--line-subtle` `--line-strong` | identical names | keep, re-value |
| `--surface-sunk` | `--surface-sunken` | alias |
| `--surface-hover` | same | keep |
| `--surface-active` | — | add |
| `--surface-raised` | — (proposal has no equivalent; it uses `--e2`/`--e3`) | keep as alias of `--surface` |
| `--ink` / `--on-ink` / `--on-ink-dim` | `--surface-inverted` / `--fg-inverted` / `--fg-inverted-muted` | alias |
| `--accent` `--accent-hi` `--accent-fg` `--accent-bg` `--accent-bd` | `--c-brand-*` numeric ramp | add semantic layer over the ramp |
| `--pos --neg --warn --info --alt --calm` (× `-fg -bg -bd`) | `--c-red-*`, `--c-amber-*`, `--c-blue-*` numeric only | **add** — 24 new roles |
| `--n-*` `--g-*` `--r-*` `--a-*` `--b-*` `--v-*` `--t-*` primitives | — | **add** — the whole primitive layer |
| `--s1…--s12`, `--t-micro…--t-3xl`, `--r-sm/md/lg/full` | — | **add** — no space/type/radius scale exists |
| `--e1 --e2 --e3`, `--ring` | Tailwind defaults | **add** |
| `--ease`, `--dur-fast/base/slow` | — | **add** — no motion system |
| `font-variant-numeric: tabular-nums` | not applied anywhere | **add** — REVIEW calls this "the single most visible *not a real finance product* tell" |

Two concrete corrections the proposal makes that the codebase currently has
wrong, both already documented in `REVIEW.md`:

- **The brand ramp has a hue break.** `--c-brand-500: #1D9E75` (hue 161°) sits
  between two Tailwind greens at 142° and 151°. It is in
  `scripts/gen-theme-tokens.mjs` today and in `theme.ts`'s
  `META_THEME_COLOR.light`. The proposal replaces the whole ramp with one
  continuous emerald at ~162°.
- **Contrast failures.** `--fg-faint` at 2.54:1 and white-on-brand-500 at 3.39:1
  both fail AA, and both are in production use — the second is the primary
  button.

---

## 4. What the proposal needs that no backend supports

Ordered by how much new backend each implies.

| Capability | Needed by | Backend work |
|---|---|---|
| Task lists, priority, due time, assignee, `completed_at` | Tasks (all pages) | migration + `worker/routes/tasks.ts` (currently 124 L) |
| **Task sharing across household members** | Tasks/Assigned to me, Lists | new — tasks are strictly `user_id`-scoped today (D-15) |
| Habits + completion log | Tasks/Habits | new tables |
| Task recurrence | Tasks (rows say "Repeats weekly") | new — Wallet has recurrence, Tasks does not |
| Trips, itinerary, bookings, wishlist, packing | Trips (all) | new module, ~6 tables |
| `trip_id` on `transactions` and `tasks` | the cross-module chip | 2 nullable FKs, `ON DELETE SET NULL` |
| Per-transaction FX rate + original currency | Trips multi-currency | breaks the MYR-only decision (D-5) |
| Time of day on a transaction | Day timeline | D-6 |
| Notes as timeline entries | Day | new table |
| Notifications | app bar badge | new — nothing exists |
| Cross-module search | app bar | new — no search endpoint exists |
| Natural-language composer parsing | Wallet, Tasks, Day | rules or Claude (D-11; Phase 5a needs sign-off per CLAUDE.md rule 10) |
| Ledger switching (Household / Personal) | account menu | new concept; `groups` is adjacent but not the same (D-7) |

---

## 5. What is *already* better than the proposal assumes

Worth knowing so these are not rebuilt:

- **Splits and settlement are far deeper than the mockup.** Partial settlement,
  bilateral netting, CAS-guarded concurrent settlement, a claim lifecycle with
  derived state. `shared.html` shows none of it. The redesign must not flatten
  it — see `wallet/02-design-adoption.md`.
- **CSV import** has duplicate detection, transfer linking, absorbed hashes,
  bulk edit, bulk split, and an AI categorisation fallback. The proposal reduces
  Import to a composer shortcut; keep the existing flow behind it.
- **`countableAmount`** already exists and already routes the whole dashboard
  through one pure module (PR #106). Every new card must use it — a split
  transaction's effective figure is not its gross.
- **Charts already read theme colours** through `useChartTheme()`. The proposal's
  hand-rolled SVG charts should adopt the same hook rather than inlining hexes.
