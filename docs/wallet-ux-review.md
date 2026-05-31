# Wallet Module — UX & Design Review

> Multi-expert review of the Wallet module (2026-05-31). Four reviewers: Information
> Architecture/Navigation, UX/Usability, Feature-completeness/Redundancy, and
> Visual/Interaction Design. This document is the consolidated brainstorm and a
> prioritized action list. No code was changed to produce it.
>
> **Status:** the core of this review (Phases A–D + opening balance) plus a second
> review round's correctness fixes have since shipped on branch
> `claude/wallet-design-ux-review-cTMY1` / PR #6. Remaining open items (UX wins,
> tech debt, and sign-off features) are tracked in
> [`wallet-backlog.md`](./wallet-backlog.md).

## TL;DR — where all four reviewers converged

1. **Navigation is the root problem.** Eight flat header tabs (`WalletTabNav.tsx`)
   with no overflow handling get clipped on narrow widths and are unusable on
   mobile. Move wallet navigation to a **grouped vertical left panel**.
2. **Recurring is a non-functional feature presented as if it works** — nothing
   ever posts a transaction or advances the due date, and nothing signals this to
   the user. This is the headline "incomplete feature not marked."
3. **Dashboard ↔ Reports overlap is real but narrow** — a duplicated custom
   date-picker and a second income-vs-expense-over-time chart. Split their roles
   rather than merge.
4. **The most important number — "how much money do I have right now" — is absent
   from the main screen.** The one well-executed element (the net-worth banner) is
   hidden on the Accounts tab.

---

## 1. Navigation / Information Architecture

### Current state
- Wallet uses a horizontal tab strip (`WalletTabNav.tsx`) mounted once in
  `WalletLayout.tsx`, shared across `/wallet/*` via `<Outlet/>`.
- **Eight tabs:** Transactions · Accounts · Dashboard · Budgets · Recurring ·
  Goals · Reports · Import CSV (`WalletTabNav.tsx:5-14`).
- The `<nav>` is a plain `flex` row with **no `overflow-x`, no wrap, no scroll
  affordance**, and every link is `whitespace-nowrap` (`WalletTabNav.tsx:18,27`).
- Ancestor containers are `overflow-hidden` / `overflow-y-auto`
  (`AppShell.tsx:14,29`), so overflowed tabs are **clipped and unreachable**, not
  scrollable.
- On mobile the global Sidebar collapses to a hamburger drawer, but the 8-tab row
  is unchanged and forced into ~390px — it fails badly below ~600px.

### Verdict: "tabs are getting squeezed" is confirmed
~700–820px of intrinsic tab width. Fine on a 1280px desktop today, but zero
headroom for a 9th item and already broken on mobile.

### Recommendation — nested expandable "Wallet" section in the global Sidebar
Group the eight destinations by frequency of use:

```
Tasks
Wallet ▾                      (auto-expands on /wallet/*)
  ── Daily ──
  • Transactions   /wallet
  • Dashboard      /wallet/dashboard
  • Accounts       /wallet/accounts
  ── Plan ──
  • Budgets        /wallet/budgets
  • Goals          /wallet/goals
  • Recurring      /wallet/recurring
  ── Analyse ──
  • Reports        /wallet/reports
  ── Action ──
  • Import CSV     /wallet/import   (better: a button on Transactions)
Settings
```

Why this over alternatives:
- **Permanently kills the squeeze** — vertical lists never run out of horizontal
  room and scale to N items.
- **Fixes desktop AND mobile in one move** — the drawer already reuses the same
  `navContent` (`Sidebar.tsx:110,124`).
- **Zero router changes** (`router.tsx` untouched) — all deep links and the
  back button keep working.
- Reuse the existing active-state styling (`Sidebar.tsx:48-55`).

Companion cleanups:
- Demote **Import CSV** from a top-level destination to an action button on the
  Transactions page (it's a one-off task, not a place).
- Fix `TopBar.tsx:3-15` — it's missing title entries for budgets/recurring/goals/
  reports (they fall through to "Daybook"). Title each page by its sub-page name.

---

## 2. Incomplete features not marked

| # | Feature | Location | What's missing | Signals incompleteness? |
|---|---------|----------|----------------|-------------------------|
| 1 | **Recurring never fires** | `RecurringPage.tsx`; `server/routes/wallet.ts:256-317` | No cron / boot pass / "Post now" — rules never post a transaction or advance `nextDueDate`. Only feeds the Dashboard "Upcoming Bills" reminder, so a past-due rule shows "overdue" forever. | **NO** |
| 2 | **Recurring rule can't set type/category** | `RecurringPage.tsx:36-213` | Schema + server INSERT carry `type`/`category_id`, but the form never collects them. | **NO** |
| 3 | **Budget "Period" selector is a dead stub** | `BudgetsPage.tsx:205-211` | One hardcoded "Monthly" option, `onChange={() => {}}`. The `Budget` type has no period field. | **NO** |
| 4 | **Dark mode** | `SettingsPage.tsx:123-136` | Applies a class but no dark styles exist. | **YES** — explicit "coming soon" note. This is the model to copy. |
| 5 | **Goals are display-only** | `GoalsPage.tsx:97-100` | "Saved" is derived from linked account balance; no independent contributions. Possibly by design. | **NO** (low severity) |

**Action:** implement-or-mark Recurring (highest), remove/mark the Budget period
dropdown, add type+category to the recurring form, and apply the dark-mode
"coming soon" honesty pattern to anything not finished.

---

## 3. Dashboard vs Reports redundancy

| Element | Dashboard | Reports |
|---|---|---|
| Date-range selector | This/Last month **+ Custom** | **Custom only** |
| Income/Expense/Net cards | Yes | No |
| Cash flow chart | Bar, by **week** | YoY bar, by **month, 2 years** |
| Spending by category (pie) | Yes | No |
| Spending by account (bar) | Yes | No |
| Top merchants | Yes | No |
| Bill reminders | Yes | No |
| Raw transaction list for range | No | Yes |

**Real duplication:** the custom date-range picker (both pages) and the
income-vs-expense-over-time bar chart (weekly vs monthly — same concept twice).

**Recommended split (no merge needed — pages are ~70% distinct):**
- **Dashboard = "at a glance, current period."** Drop the Custom range option;
  keep This Month / Last Month. Keep summary cards, reminders, weekly cash flow,
  category pie, account bar, top merchants.
- **Reports = "deep dive, historical."** Owns all custom/arbitrary ranges, the
  YoY comparison, and the raw transaction list.

**Other redundancy:** Budgets/Goals/Recurring share near-identical CRUD shells and
a byte-near-identical delete-confirm modal — candidates for a shared
`<ConfirmDeleteModal>` / `<CrudListPage>` primitive (maintenance debt, not
user-facing).

---

## 4. UX / intuitiveness

### First-run
- Good: the `/wallet` empty state routes to Accounts (`WalletPage.tsx:226-236`),
  and the Accounts empty state has an inline Add button (`AccountsPage.tsx:86-96`).
- Bad: before the empty state, the user sees a full 5-field filter bar + three
  RM 0.00 summary cards (`WalletPage.tsx:158-222`). Hide these when there are no
  accounts.
- Bad: "Add Transaction" stays active with no accounts → opens a form with an
  empty account dropdown → dead end. Disable it (with a hint) when no accounts.
- Bad: Dashboard empty state is a dead end with no CTA (`Dashboard.tsx:215-220`).

### Core loop — adding a transaction
- **Only reachable from the Transactions tab** (`WalletPage.tsx:150`). The most
  frequent action in a finance app should be reachable everywhere (persistent
  header "+" / FAB).
- **Account has no default** (`TransactionForm.tsx:43`) even though
  `default_account_id` exists in the schema (§6). Pre-select it — saves a click on
  every entry.
- **Merchant vs Description** are two near-identical optional free-text fields
  (`TransactionForm.tsx:226-241`); the list even falls back `merchant || description`
  (`TransactionList.tsx:108`). Merge or relabel Description as "Note (optional)".
- No "save and add another" for bulk manual entry.
- Transfers don't explain they're excluded from income/expense totals.

### Confusion points
- **No opening/starting balance on accounts.** Balance is computed purely from
  transactions (`AccountCard.tsx:52-58`). A real bank account isn't RM 0 — this is
  the most likely "this app is wrong" moment.
- **Edit-by-clicking-the-row is undiscoverable** (`TransactionList.tsx:82`) — no
  affordance, while delete is a (hover-only) icon.
- **Hover-only actions** on rows and account cards are invisible on touch
  (`TransactionList.tsx:142`, `AccountCard.tsx:107`).
- Account-card click filters the list with no visible "Showing: <Account> ✕" chip.
- No free-text search.
- CSV "Map Columns" step uses technical column-mapping language.

### Convenience wins (impact ÷ effort)
1. Default the account in TransactionForm. *(one line, highest ROI)*
2. Add an opening-balance field to accounts.
3. Hide filter bar + summary when no accounts; add Dashboard empty CTA.
4. Make "Add Transaction" reachable everywhere; disable when no accounts.
5. Visible edit affordance on rows (pencil, not hover-only).
6. "Showing: <Account> ✕" chip on account-filtered lists.
7. Free-text search in the filter bar.
8. Merge/relabel Merchant/Description.

---

## 5. Visual & interaction design

- **No "total balance" hero on the main screen.** Net worth only lives on the
  Accounts tab (`AccountsPage.tsx:66-84`) — the best-designed element in the
  module, hidden one click away. Promote it to the top of `WalletPage.tsx`.
- **Everything is the same visual weight.** Income/Expense/Net cards are three
  identical tiles (`WalletPage.tsx:200-222`, `Dashboard.tsx:263-287`); Net (the
  decision number) gets no emphasis. Row amounts are only `text-sm`
  (`TransactionList.tsx:136`); day-header totals are `text-xs` (`:193`).
- **Two different greens** — brand teal-green `#1D9E75` vs generic Tailwind
  `green-600/700` for income, sitting next to each other.
- **"Net" color rule conflicts** — gray/red on WalletPage vs green/red on
  Dashboard for the same metric.
- **Blue does three jobs** — transfer, "Net" icon, and account-spend chart.
- **Inconsistent padding/radius** across cards (`p-4`/`p-5`/`px-4 py-3`,
  `rounded-lg`/`rounded-xl`) — not encoding hierarchy, just author preference.
- **Weak/absent affordances & a11y:** clickable rows/cards are `div`s with onClick,
  no focus ring, not keyboard-reachable; export dropdown
  (`WalletPage.tsx:130-148`) is hand-rolled with no outside-click/Escape — use the
  approved Radix popover/dropdown (§4).
- **No loading states** — balances show `'...'` / `'…'` (two different glyphs);
  dashboard flashes empty→populated.
- Chart axes use `${(v/1000)}k` (`Dashboard.tsx:336,383`) — reads "0k" for most
  personal-finance values; use real MYR formatting.

### Top visual wins (impact / effort)
1. Total-balance hero on the main screen (reuse the net-worth banner).
2. Persistent (not hover-only) row/card actions.
3. Unify the two greens and the conflicting Net color rule.
4. Give the primary number more weight per surface.
5. Make clickable things look clickable and keyboard-reachable.
6. Skeleton/loading states; unify the ellipsis glyph.
7. Replace the hand-rolled export dropdown with Radix.
8. Standardize a spacing/radius scale; collapse the filter bar by default; fix
   chart axis currency.

---

## Suggested delivery order

1. **Left-panel grouped navigation** — fixes the squeeze + mobile, zero router risk.
2. **Mark/implement Recurring + kill the Budget period stub** — honesty about
   what works.
3. **Dashboard/Reports role split** — remove the duplicated date picker.
4. **Quick intuitiveness wins** — default account, opening balance, hero balance,
   persistent edit affordance, hide empty-state clutter.
5. **Visual polish pass** — color/weight/spacing consistency, loading states,
   Radix dropdown.

Each step is independently shippable with its own Playwright coverage per
CLAUDE.md §16.
