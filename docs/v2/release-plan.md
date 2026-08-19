# v2 release plan

Seventeen releases in two tracks. Each release is independently shippable,
tag-triggered through `release.yml`, and leaves the app in a state the owner can
use. Nothing here requires a big-bang cutover.

Read with [gap-analysis.md](gap-analysis.md) (what is missing) and
[open-decisions.md](open-decisions.md) (what is not yet decided). Decisions
marked **blocking** must be answered before the release that depends on them
starts.

---

## Dependency graph

```
R1 foundation: tokens ──┬─► R2 shell ──┬─► R3 Wallet adopt ──► R7 ─► R8 ─► R9   (Wallet complete)
                        │              │
                        │              ├─► R4 Tasks schema ─► R5 Tasks adopt ─► R10 ─► R11  (Tasks complete)
                        │              │
                        │              └─► R6 Trips + Day shells ─┬─► R12 ─► R13 ─► R14   (Trips complete)
                        │                                        └─► R15 ─► R16          (Day complete)
                        └─► (R0 e2e seams, folded into R1)                    all ─► R17 cross-cutting
```

R7–R16 are strictly module-local and can be reordered or run in parallel with
each other. R1→R2→R3/R4 is the only hard chain.

---

# Track A — adopt the design

## R1 · `v2.10.0` · Foundation: tokens, component layer, AA gate

**Goal.** Every colour, size, radius, shadow and transition in the app resolves
through the proposal's two-layer token model. No page layout changes.

Spec: [foundation/01-design-tokens.md](foundation/01-design-tokens.md),
[foundation/02-component-layer.md](foundation/02-component-layer.md),
[foundation/04-e2e-and-migration.md](foundation/04-e2e-and-migration.md).

**Ships**

1. `scripts/gen-theme-tokens.mjs` rewritten to emit the proposal's primitives
   (`--n-*`, `--g-*`, `--r-* --a-* --b-* --v-* --t-*`) and semantics, with
   backwards-compatible aliases (`--surface-sunken` → `--surface-sunk`,
   `--surface-inverted` → `--ink`, …) so no existing component breaks.
2. Emit **both** `.dark` and `[data-theme="dark"]` selectors, so ported
   proposal CSS and existing Tailwind `darkMode:'class'` both work (D-2).
3. `tailwind.config.js` gains the space / type / radius / shadow / easing
   scales and the six semantic hue roles (`pos neg warn info alt calm`).
4. `src/styles/` — the proposal's `theme.css` sections 4–5 ported and split by
   concern, imported from `index.css` in a `@layer components`.
5. `font-variant-numeric: tabular-nums` on every money value.
6. One `:focus-visible` ring; `prefers-reduced-motion` block.
7. **`scripts/check-contrast.mjs`** — computes every fg/bg pair and fails CI
   below 4.5:1 (3.0:1 for the icon-only `--fg-faint`). This is the gate that
   stops the failure REVIEW found in the current design.
8. **e2e seams**: `data-testid` added to every element the suite currently
   reaches by role, text or label on a page scheduled for reskin, and those
   specs converted. 1,423 lookups; do the ~400 that touch reskin targets.

**Done when** the app renders identically in structure, on the corrected ramp,
with every pair passing AA, 63/63 specs green, and `check-contrast` in CI.

**Risk.** The brand hue shifts visibly (161° → 162° ramp, different steps).
That is intended and should be shown to the owner before merge.

---

## R2 · `v2.11.0` · Foundation: the app shell

**Goal.** The Facebook-style app bar, module-scoped sidebar, two-pane account
menu and mobile chrome from `REVIEW.md` v5.

Spec: [foundation/03-app-shell.md](foundation/03-app-shell.md).

**Ships**

- Full-width `.appbar`: logo · global search field · **module tabs (Day, Tasks,
  Wallet, Trips)** · quick-add · notifications · avatar.
- Sidebar becomes **module-scoped**: it holds only the current module's nav,
  with a `module-head` naming the module. The Wallet groups
  (Daily/Planning/Analyse/Data) survive; Import CSV leaves it.
- Two-pane account menu: profile + ledger list + `Settings & privacy ›` pushing
  to a second pane split into global preferences and **module settings**.
- Mobile: bottom tab bar + FAB, sidebar as off-canvas drawer.
- Search field is a shell only — focus animation, no results panel (R17).
- Day and Trips tabs are present but **disabled with a tooltip** until R6.
  Advertising a dead tab is worse than not showing it; disabled-with-a-reason is
  honest and it makes the shell's final shape visible from R2.

**Done when** every existing route renders inside the new shell on desktop and
mobile, both themes, and the sidebar/topbar specs are rewritten.

**Watch.** `getByLabel()` matches substrings (CLAUDE.md §16 trap 3). The new bar
adds ~8 labelled controls. Grep every `getByLabel` string in `e2e/` against the
new names before merging.

---

## R3 · `v2.12.0` · Wallet: design adoption

**Goal.** All eight Wallet pages on the new grid and components, with today's
functionality intact. No new computation.

Spec: [wallet/02-design-adoption.md](wallet/02-design-adoption.md).

Sequenced as four PRs behind one tag:

| PR | Pages | Note |
|---|---|---|
| 1 | Transactions, Accounts | highest-traffic; establishes `.trow`, `.tday`, `.stat-card`, `.acct` |
| 2 | Overview | 12-column `.dash` grid; existing dashboard cards re-housed |
| 3 | Shared | **do not flatten the split lifecycle** — the mockup shows a simpler product than what ships |
| 4 | Budgets, Goals, Recurring, Reports | restyle only; their depth is R8/R9 |

**Done when** the four PRs merge, no Wallet behaviour changed, and the
Wallet-touching specs (~25 files) are green.

---

## R4 · `v2.13.0` · Tasks: minimum schema

**Goal.** Make the designed task row renderable. Adoption cost, not features.

Spec: [tasks/01-data-model.md](tasks/01-data-model.md). **Blocking: D-3, D-15.**

**Ships** — one additive migration + `worker/routes/tasks.ts`:

- `task_lists` table (name, colour, sort) + `tasks.list_id`
- `tasks.priority` (`none|low|med|high`), `tasks.due_time`, `tasks.completed_at`
- `tasks.assignee_id` and list-level sharing to a group (**D-15**)
- derived subtask progress (`n of m`) served with the row, not computed client-side
- default lists seeded per user, matching the existing category-seed pattern

**Done when** the API returns every field the designed row needs, existing
outliner behaviour is untouched, and `01-tasks.spec.ts` is green unchanged.

---

## R5 · `v2.14.0` · Tasks: design adoption

**Goal.** Four of the seven designed Tasks pages, on real data.

Spec: [tasks/02-design-adoption.md](tasks/02-design-adoption.md).

**Ships**: Today · All tasks · List detail · Completed (list only, no heatmap).
The Tasks sidebar (Today / Upcoming / All / Assigned, Lists, Review).
**The outliner survives as the list-detail view mode** (D-3) — it is the current
product and a working feature, and the proposal simply never drew it.

Upcoming / Assigned to me / Habits ship disabled-with-a-reason, like R2's tabs.

**Done when** `/tasks` lands on Today, the outliner is reachable and unchanged,
and the four pages render on both themes.

---

## R6 · **`v3.0.0`** · Trips + Day: routes, nav, first-run states

**Goal.** Make the four-tab bar true. Both new tabs become live routes with
their designed empty states.

Specs: [trips/02-design-adoption.md](trips/02-design-adoption.md),
[day/02-design-adoption.md](day/02-design-adoption.md).
**Blocking: D-4** (Trips is a module, not a lens).

**Ships**

- `/trips` and `/day` routes, module sidebars, mobile tabs.
- **Day** renders a real timeline from data that already exists — completed
  tasks and today's transactions — ordered by `created_at` as the interim time
  source (D-6). The band's two figures are real. Notes, Close the day, the
  usual-comparison and the month grid are R15/R16.
- **Trips** renders the `trips.html` first-run state: "travel as a category of
  your life", computed from existing transactions with no `trip_id` at all. This
  is the answer to REVIEW's own open question, *what the fourth tab does in
  January.*

**This is the v3.0 milestone**: design adopted across the product. Wallet and
Tasks are fully on it; Day and Trips exist and are honest about being early.

---

# Track B — complete the functionality

Module order follows the owner's: Wallet, Tasks, Trips, Day.

## Wallet

| Release | Tag | Ships |
|---|---|---|
| **R7** | v3.1.0 | **Composer** (Wallet syntax, `N` hotkey, shortcut row) · Overview: donut with direct-labelled legend, spend-pace axes + today rule + projection, week rhythm with average line, Recent activity 5-row, Coming up, safe-to-spend on the featured account |
| **R8** | v3.2.0 | **Accounts**: composition breakdown, per-account 30-day sparklines, credit utilisation, 12-month net-worth chart · **Budgets**: the `c12` summary band, pace marker, and the **Suggestions engine** (reallocate, right-size, create-missing) |
| **R9** | v3.3.0 | **Goals**: rings, funding rate, honest ETA, paused/behind, trajectory, next-milestone knock-on · **Recurring**: month calendar, annual cost, "Worth a look" anomalies (price rise, dormant subscription, same-day collision) · **Reports**: paired columns + savings gap, "What changed" vs 12-month average, category sparkline trends · **Shared**: group-wide minimum-transfer set, Split rules with staleness |

Spec: [wallet/03-feature-waves.md](wallet/03-feature-waves.md).

## Tasks

| Release | Tag | Ships |
|---|---|---|
| **R10** | v3.4.0 | Upcoming week board + "waiting for a date" + Balance the week · Assigned to me (two-way delegation ledger, turnaround times, gone-quiet detection) · **task recurrence** |
| **R11** | v3.5.0 | Habits (rings, 28-day grid, streaks, weekday chart) · Completed (year heatmap, time-to-finish, by-list breakdown) · **Worth knowing** insight engine · Wallet chips on task rows |

Spec: [tasks/03-feature-waves.md](tasks/03-feature-waves.md).

## Trips

| Release | Tag | Ships |
|---|---|---|
| **R12** | v3.6.0 | `trips` schema · `trip_id` on transactions and tasks (`ON DELETE SET NULL`) · `.tchip` in Wallet/Tasks/Day · `trips.html` and `trip.html` with the **burn-down** |
| **R13** | v3.7.0 | Itinerary (estimate/actual grammar, deltas, collapsed days) · Prep (phase-aware readiness) · bookings · wishlist · packing from `task_templates` |
| **R14** | v3.8.0 | **Trip mode** (`day-trip.html`: trip band, scoped composer, reversible) · **multi-currency** — per-transaction rate, local-leads-in-Trips / home-leads-in-Wallet, rate card separating FX overrun from choice overrun. **Blocking: D-5.** |

Spec: [trips/03-feature-waves.md](trips/03-feature-waves.md).

## Day

| Release | Tag | Ships |
|---|---|---|
| **R15** | v3.9.0 | Real time-of-day (**D-6**) · hour ribbon · solid/hollow `now` grammar · notes as timeline entries · date stepper · Day composer writing to either module |
| **R16** | v3.10.0 | **Close the day** · Against your usual · On this day · the month grid · This week / Calendar / Weekly review |

Spec: [day/03-feature-waves.md](day/03-feature-waves.md).

## R17 · **`v4.0.0`** · Cross-cutting

Spec: [cross-cutting/README.md](cross-cutting/README.md).

Global search results panel (grouped, cross-module) · command palette (⌘K, drawn
in the bar since v2 and still inert) · notifications · empty / loading / error
states for every page · density toggle · number-formatting rules (D-9).

Plus the two long-standing risks from CLAUDE.md §13 that a public v4 should not
ship without: **rate limiting on the public URL** and the **impossible-calendar-date
validation bug** present in both backends.

---

## Estimating

Deliberately in relative terms — the owner sets the calendar.

| Release | Relative size | Dominated by |
|---|---|---|
| R1 | L | token rewrite + 400 e2e selector conversions |
| R2 | M | new shell, mobile chrome |
| R3 | XL | 8 pages, ~4,500 lines of Wallet UI |
| R4 | M | migration + route rewrite |
| R5 | L | 4 new pages on a new model |
| R6 | M | two module shells, two honest empty states |
| R7–R9 | L each | new computation, each card needs its own e2e |
| R10–R11 | L each | recurrence and sharing are the hard parts |
| R12–R14 | XL total | a whole new module + a currency decision |
| R15–R16 | L each | schema (time), then the ritual |
| R17 | M | mostly wiring things already drawn |

**The two that will overrun** are R3 (volume) and R14 (multi-currency touches
every money surface in the app). Both are worth splitting further at the point
they start.
