# Daybook — Multi-Model Adversarial Review

**Date:** 2026-07-20
**Scope:** All shipped features as of `main` @ `1906f2a` (post Phase 5c, v1.0.1) — Tasks outliner; Wallet (transactions, accounts, CSV import, budgets, goals, recurring, dashboard, reports, export); Household sharing (groups, shared accounts, splits, settlements); Settings; Auth.
**Focus:** Usability, consistency, user experience, and behavioural correctness. Not a security-pentest or performance review (though cross-tenant issues found in behaviour testing are included).

---

## 1. Methodology

Three independent reviewers, each running on a **different Claude model** with a **different adversarial charter**, audited the full codebase (client + server + e2e suite). Each reviewer read source directly, cited `file:line` evidence for every finding, and cross-checked against `docs/UAT-FEEDBACK.md` and `docs/feature-consistency-review.md` to avoid re-reporting already-fixed items. No code was modified during the review.

| Reviewer | Model | Charter | Findings | Grade |
|---|---|---|---|---|
| R1 — Usability | Claude Opus | First-use experience, discoverability, flow friction, feedback, error recovery | 20 (U-xx) | **C+** |
| R2 — Consistency | Claude Sonnet | Terminology drift, visual/interaction consistency, design-system discipline, component reuse | 20 (CD-xx) | **C+** |
| R3 — Behaviour | Claude Fable | Money math, edge cases, state divergence, permissions, silent failures | 21 (B-xx) | **C−** |

**Combined: 61 findings — 2 Critical, 17 High, 26 Medium, 16 Low.**

Findings independently reported by two or more reviewers are treated as **high-confidence** (Section 3). The complete per-reviewer reports are preserved in Sections 5–7.

---

## 2. Executive Summary

Daybook is feature-complete, has a genuinely strong server foundation (per-user scoping, consistent balance math, validated inputs on core routes, atomic bulk writes), and shows clear evidence of deliberate UX investment: shared formatting helpers, undo toasts, accessible charts, 40px touch targets, and a well-executed progressive-disclosure filter bar. The Phase 5c consolidation work paid off — money and date plumbing has converged on single-sourced helpers.

Three problem clusters keep it from feeling professional end-to-end:

1. **The settlement/sharing subsystem — the newest and most money-sensitive code — has real correctness bugs.** "Mark Received" is direction-inverted and can debit the *creditor's* ledger (B-01). Partial settlements book real ledger transactions without reducing debt, permitting over-payment (B-02). Re-splitting resurrects already-paid shares (B-04), amount edits rewrite settled history (B-06), and a PATCH hole allows moving a transaction into another user's account (B-03). The e2e suite (38 specs) has **zero coverage** of Mark Received, partial settlements, or split rescaling — exactly where the bugs live.

2. **Polish is applied unevenly, and the gaps sit on the highest-traffic surfaces.** The Tasks page — the default landing page — has no error feedback at all and silently loses edits on a failed save. The Settings page presents three misleading controls (a dead AI section with an inaccurate privacy claim, a currency picker nothing reads, a half-built dark theme). Budgets/Goals/Recurring forms fail validation silently, making their primary buttons look broken.

3. **The interaction layer contradicts itself.** Delete confirmation has five distinct shapes. Error surfacing ranges from a standardized toast pattern (Wallet CRUD) to `window.alert()` (Sharing) to complete silence (Tasks, Settings). The Share→Split rename is half-done — one dialog says "Split 3 Transactions" and "Share with" on the same screen.

None of this is fatal — the bones are good — but the P0 money bugs should be fixed before the household features see real use, and the P1 feedback gaps are what stand between "works" and "something to be proud of."

---

## 3. High-Confidence Convergent Findings

Independently reported by two or more reviewers:

| Theme | Reviewers | Findings | Severity |
|---|---|---|---|
| Tasks module has zero error handling — failed saves silently lose edits on refresh | R1 + R2 | U-01, CD-06 | High |
| Settings page misleads: dead AI section with false privacy copy, currency picker nothing honours, save has no failure feedback | R1 + R2 | U-02, U-03, CD-14 | High |
| Sharing pages use `window.alert()` / swallow errors instead of the app's toast standard | R1 + R2 | U-08, CD-01, CD-02 | High |
| Shared/Sharing pages have no load-error handling — infinite spinner or blank page on failure | R1 + R3 | U-09, B-19 | Medium |
| CSV review table: merchant field read-only, contradicting the product spec | R1 + R2 | U-14, CD-12 | Medium |
| No double-submit guard / button loading state on forms — duplicate transactions possible | R1 + R3 | U-18, B-12 | Medium |
| Delete confirmation and undo policy inconsistent across entities | R1 + R2 | U-19, CD-03 | High (R2) |
| Empty-state copy has no shared voice ("Nothing here yet" vs "No limits configured" vs "No X yet") | R1 + R2 | U-17, CD-16 | Low |

---

## 4. Prioritized Improvement Roadmap

### P0 — Money correctness & data integrity (fix before further household use)

| ID | Fix | Effort |
|---|---|---|
| B-01 | Add explicit settlement direction (`fromUserId`) to the API; creditor-initiated "Mark Received" must record income on the caller side / expense on the debtor side. Add e2e coverage for the receipt flow. | M |
| B-02 | Reject partial settlements that don't clear whole shares (clear message), or support true partial settlement; reconcile `effectiveAmount` with shares actually settled. | M |
| B-03 | PATCH `/transactions/:id`: require `canWriteAccount` when `accountId` changes and visibility check on `destinationAccountId` (mirror the POST checks). | S |
| B-04 | Block re-splitting when any share is settled (409 → "undo the settlement first"), or preserve settled rows. | S |
| B-05 | Guard account deletion when its transactions carry unsettled shares or other users' rows (mirror the group-delete guard). | S |
| B-06 | Refuse (or scope to unsettled rows) split rescaling on amount edit; clamp rescaled shares > 0. | S |
| B-07 | Require write permission on the *destination* account for transfers (POST + import). | S |

### P1 — Trust & feedback (the "app feels broken" class)

| ID(s) | Fix | Effort |
|---|---|---|
| U-01 / CD-06 | Route all task mutations through `errorMessage()` toasts; re-fetch to reconcile on failure. Extend the same pattern to Settings/Sharing flows (`PendingInvites`, `GroupCard`, `SharingPage`). | M |
| U-04 | Budgets/Goals/Recurring: per-field inline validation errors + `<form onSubmit>` (adopt the TransactionForm pattern). | S |
| U-02 / U-03 / CD-14 | Settings cleanup: hide/disable the AI section until Phase 5a, correct the storage copy, remove or disable the currency picker, wrap `handleSave` in try/catch. | S |
| CD-01 / CD-02 / U-08 | Group member removal/leave: `ConfirmDeleteModal` + toast on failure; replace `alert()` with the toast standard. | S |
| U-09 / B-19 | Shared/Sharing pages: try/catch + `finally` on loads, inline error + retry. | S |
| U-18 / B-12 | Add a `loading` prop to `Button`; disable all submit paths while a save is in flight. | S |
| B-15 | Budgets: compute "spent" from own/effective amounts (respect splits and exclude housemates' rows). | M |
| B-13 / B-14 | CSV: fix the dead MM/DD branch (file-level date-format heuristic), handle European decimals and trailing minus, pre-validate dates in review. | M |
| B-08 | Fix `/transactions/shares/status` to detect "Keep as-is" shares (drop the `AND user_id = ?` filter). | XS |

### P2 — Consistency & UX polish

| ID(s) | Fix |
|---|---|
| CD-03 / U-19 | One delete-confirmation pattern (`ConfirmDeleteModal`), one title convention, documented undo-vs-confirm policy; extend undo to bulk delete. |
| CD-05 / U-07 | Finish Share→Split terminology (nav label, dialog copy internal consistency); hide split affordance for users with no groups; label the action. |
| CD-04 / CD-13 | One row-action pattern (icon Button, contextual aria-label, 40px touch target) across Budgets/Goals/Recurring and Tasks (`BulletNode`). |
| U-05 | Mobile: show current page title in the top bar; consider a bottom tab bar. |
| U-06 | Persist theme immediately on change; disable Dark until the palette is complete. |
| U-10 | Visible removable filter chips (or auto-expand Filters) when `?account=` deep-link applies. |
| U-11 / U-12 | Budgets/Goals empty-state CTAs; explain the disabled "Add Budget" state. |
| U-13 | Plain-language help text in the Settle Up dialog; use the `Select` primitive. |
| U-14 / CD-12 | Make CSV merchant editable; add keyword-based category defaults pre-AI. |
| B-09 | `splitEqually` in integer cents (fixes RM8.20 ÷ 4 ≠ 2.05 class). |
| B-10 | Recurring monthly rules: store anchor day, clamp per occurrence (stop month-end drift). |
| B-11 | Settlements: use the local-date helper, not UTC (`toISOString`). |
| B-16 | Decide settlement transaction typing (income/expense vs transfer) and align doc + dashboard summaries. |
| B-18 | Surface the server's over-payment cap message in the Settle Up dialog. |
| CD-07 | SharedPage: use the `positive` colour token for "owed to you", red for "you owe"; drop orange. |
| CD-08 / CD-09 / CD-10 | Finish `useCrudModal` adoption (Accounts, Wallet); replace raw `<select>`/`<input>` with primitives; route pills through `Badge`. |
| U-15 | Namespace bill-reminder dismissals by user (or move server-side). |
| U-16 | Lightweight first-run welcome / 3-step checklist. |

### P3 — Low-severity polish

U-17/CD-16 (empty-state copy formula), U-20 (password minimum + confirm + reveal), CD-11 (validate account name on PATCH), CD-15 (shared `NetWorthBanner`), CD-17 (submit label casing), CD-18 ("Daybook Alpha" footer), CD-19 (Import CSV label mismatch), CD-20 (tasks bulk-select decision), B-17 (store reconciliation after account delete), B-20 (recurring catch-up surface/undo), B-21 (API-level validation on account `openingBalance`/`type`).

### Test coverage gaps to close alongside P0

- e2e for **Mark Received** (creditor-initiated settlement) — currently zero coverage.
- e2e for **partial settlement** amounts (RM50 against an RM100 share).
- e2e for **split rescaling** on amount edit, including with settled shares.
- e2e for **re-splitting** a transaction that has a settled share.
- Regression tests for CSV MM/DD and European-decimal files.

---

## 5. Reviewer 1 — Usability & First-Use Experience (Claude Opus)

### Verdict

**Grade: C+ (functional, feature-complete, unevenly polished).** Daybook is a dense, genuinely capable app that has clearly had targeted UX passes — action-oriented empty states on the main pages, undo toasts, 40px touch targets, chart aria-labels, a progressive-disclosure filter bar, and error toasts across the Wallet CRUD pages. But that polish is applied unevenly, and the places it's missing are exactly the ones a new user hits first. The Settings page presents three misleading/non-functional controls (a dead "AI" section with a false privacy claim, a multi-currency picker that does nothing, a half-built dark theme) that erode trust on day one. The Tasks module — the app's default landing page — has *no* error feedback at all, so a server hiccup silently loses edits. The three "Planning" pages (Budgets/Goals/Recurring) fail validation silently, making their primary buttons look broken. Mobile users get no page title and a multi-tap hamburger-only nav. None of these are hard blockers, so the app is usable, but the first-run journey is rougher than the feature list suggests.

**Severity counts:** Critical 0 · High 6 · Medium 10 · Low 4 — Total 20.

### High

**U-01 · High · Tasks module — no error feedback, silent data loss**
`src/modules/tasks/TasksPage.tsx:167-245` — every task mutation (`handleUpdate`, `handleUpdateNote`, `handleToggleComplete`, `handleEnter`, `handleBackspaceEmpty`, `handleIndent`, `handleDelete`) calls into `useTasks` with no `try/catch` and never raises a toast. The Wallet module wraps every mutation in `errorMessage()` toasts (e.g. `WalletPage.tsx:159-166`), but Tasks has none.
*What a user experiences:* On the home-network backend, if a save fails (server restart, dropped WiFi), the bullet keeps the typed text on screen because Zustand updated optimistically — then it vanishes on the next refresh with no warning that anything went wrong. The default landing page is the least resilient surface in the app.
*Recommendation:* Route task mutations through the same `errorMessage()` toast path the Wallet uses; on failure, re-fetch to reconcile the store so the UI reflects reality.

**U-02 · High · Settings — dead "AI (Claude)" section with a false privacy claim**
`src/modules/settings/SettingsPage.tsx:87-114` — a prominent "AI (Claude)" card invites the user to paste an Anthropic API key, with helper text: *"Stored only in your browser database — never sent to any third-party server."* Phase 5a (AI) is deferred, so no feature reads this key; and per CLAUDE.md §6 / Phase 4, settings are persisted to the server's SQLite via `PUT /api/settings`, not "your browser database."
*What a user experiences:* A first-time user does the work of getting an API key, pastes it, sees nothing happen anywhere, and is told an untrue thing about where it went.
*Recommendation:* Hide the AI section until Phase 5a ships (or gate it behind a "coming soon" disabled state), and correct the storage-location copy.

**U-03 · High · Settings — "Default Currency" offers 5 currencies, only MYR works**
`src/modules/settings/SettingsPage.tsx:146-157` — the picker offers USD/EUR/SGD/GBP/MYR and stores the choice, but the app is deliberately single-currency: `formatMYR` (in `lib/utils`) hardcodes `ms-MY`/MYR and the per-account currency selector was removed (`AccountForm.tsx:147-149`).
*What a user experiences:* Sets currency to USD, saves, and every amount everywhere still renders "RM". A stored setting that nothing honors.
*Recommendation:* Remove the control (or disable it with "Multi-currency is not yet supported").

**U-04 · High · Budgets/Goals/Recurring — silent validation failure makes the primary button look broken**
`src/modules/wallet/BudgetsPage.tsx:55-56`, `GoalsPage.tsx:56-57`, `RecurringPage.tsx:109-110` — each `handleSubmit` does an early `return` when required fields are missing/invalid, with no error state set and no toast. Contrast `TransactionForm.tsx:121-136` which sets per-field `errors`.
*What a user experiences:* User opens "New Budget", picks a category but leaves the limit blank (or types 0), clicks **Create Budget** — nothing happens, no message, modal stays open. The button appears dead. Same on Goals ("Create") and Recurring ("Create").
*Recommendation:* Adopt the TransactionForm pattern — per-field inline errors and a `<form onSubmit>` so Enter works too (these three are click-handler-only).

**U-05 · High · Mobile — no page title, hamburger-only navigation, 3 taps per hop**
`src/components/layout/AppShell.tsx:16-28` — the mobile top bar contains only a hamburger; `TopBar` (which renders the page title) is `hidden md:block`. The sidebar is a slide-in drawer where Wallet is a collapsible section (`Sidebar.tsx:143-199`).
*What a user experiences:* On a phone there is no visible indication of which page you're on. Switching from Transactions to Budgets is: tap hamburger → tap chevron to expand Wallet (if collapsed) → tap Budgets. No bottom tab bar, no title, no breadcrumb.
*Recommendation:* Show the current route title in the mobile top bar (reuse `routeTitles` from `TopBar.tsx:3-17`); consider a bottom tab bar for the top-level modules on small screens.

**U-06 · High · Theme change appears to apply but silently reverts; dark mode is half-built**
`src/modules/settings/SettingsPage.tsx:123-136` — the Theme `<Select>` calls `setTheme` on change (live effect via `App.tsx:102-117`), but persistence happens only inside `handleSave` (`:41-51`). On next load, `App.tsx:52-58` re-reads theme from the server.
*What a user experiences:* User picks "Dark", the class flips live, they navigate away without clicking "Save changes", and on reload it's back to light — with no hint that the visible change was unsaved. Worse, the page's own note (`:133-136`) admits dark styling is incomplete, so "Dark" produces a broken-looking, mostly-light UI anyway.
*Recommendation:* Persist theme immediately on change (it's a preference, not a form field), and disable the Dark option until the dark palette is complete.

### Medium

**U-07 · Medium · Splitting an expense is a hover-only unlabeled icon, shown even to solo users**
`src/modules/wallet/TransactionList.tsx:205-223` — the split action is a scissors icon inside a `group-hover` cluster, icon-only (label only via `title`/`aria-label`). `WalletPage.tsx:630-636` always renders `ShareDialog` regardless of group membership.
*What a user experiences:* A core household feature is invisible until you hover the right row on desktop, and it's presented with no text. A solo user (the day-one majority) who does find it lands in a dialog dead-end: *"No group members yet. Invite people in Settings → Sharing first."* (`ShareDialog.tsx:130-134`).
*Recommendation:* Hide the split affordance entirely when the user has no groups (the page already fetches `hasGroups`, `WalletPage.tsx:64-70`); add a visible label or make it part of an overflow menu.

**U-08 · Medium · Group deletion errors via native `alert()`; no success feedback**
`src/modules/settings/SharingPage.tsx:56-59` — delete-group failure calls `alert(msg)`; success gives no toast. The app otherwise has a polished toast system (`Toast.tsx`).
*What a user experiences:* A jarring browser alert box on failure, and silence on success — inconsistent with every other destructive action.
*Recommendation:* Replace with `addToast(errorMessage(...))` and a success toast.

**U-09 · Medium · Sharing/Shared pages have no load error handling — blank or infinite-spinner on failure**
`src/modules/settings/SharingPage.tsx:27-36` (`loadAll` has no `.catch`) and `src/modules/wallet/SharedPage.tsx:38-60` (`loadAll` has no `.catch`; `setLoading(false)` only runs on success, so a failed load leaves the spinner at `:85-91` forever).
*What a user experiences:* If the server hiccups while opening Settings → Sharing or Wallet → Shared, the page either renders empty (looks like "you have no groups") or spins indefinitely with no retry.
*Recommendation:* Wrap loads in try/catch, clear loading in a `finally`, and show an inline error + retry.

**U-10 · Medium · `?account=` deep-link silently narrows the list; the filter is hidden in a collapsed panel**
`src/modules/wallet/WalletPage.tsx:119-127` sets `accountId` from the URL, but the Account select lives inside the collapsed "Filters" section (`:443-469`). The only surface signal is the count badge on the Filters toggle (`:420-427`).
*What a user experiences:* Arriving at Transactions from an account card, the user sees a short, filtered list and no obvious reason why — the active filter is one collapsed level down. There are no removable active-filter chips.
*Recommendation:* Render active filters as visible removable chips under the bar, or auto-expand Filters when a URL param is applied.

**U-11 · Medium · Budgets and Goals empty states have no call-to-action button**
`src/modules/wallet/BudgetsPage.tsx:99-104` and `GoalsPage.tsx:92-97` pass no `action` to `EmptyState`, even though the component supports one (`EmptyState.tsx:33`) and Accounts/Wallet/Tasks all use it.
*What a user experiences:* A new user on Budgets sees "No limits configured" with a dead-ended card and must discover the small "Add Budget" button in the header.
*Recommendation:* Add an `action` button to these empty states, matching the other pages.

**U-12 · Medium · "Add Budget" silently disabled once all categories are budgeted, with no explanation**
`src/modules/wallet/BudgetsPage.tsx:92` — `disabled={availableCategories.length === 0}` with no tooltip or message.
*What a user experiences:* After budgeting every expense category, the primary button greys out for no visible reason; the user can't tell if it's a bug.
*Recommendation:* Keep it enabled and explain in the modal, or add a tooltip ("All categories already have a budget").

**U-13 · Medium · Settle Up dialog is jargon-heavy and unexplained for first-timers**
`src/modules/wallet/SettleUpDialog.tsx:86-120` — labels read "From account (your side)", "To account (their side — optional)", and an option "— leave blank (records payer side only) —", built on raw `<select>`s with no explanation of what recording each "side" does.
*What a user experiences:* A user settling their first debt has to reason about double-entry ledger mechanics with no guidance; it's unclear when/whether to fill "their side."
*Recommendation:* Add one line of plain-language help ("This records a transfer out of your account; optionally also credit an account they've shared with you"), and prefer the `Select` primitive for consistent styling/a11y.

**U-14 · Medium · CSV review — merchant is read-only and no category is auto-suggested; every row is manual**
`src/modules/wallet/CsvReviewTable.tsx:92-97` renders merchant as a read-only `<span>` (only date/amount/type/category are editable), contradicting CLAUDE.md §9.2 ("each row editable"). §9.2 step 6 also promises Claude category auto-suggestion, which is deferred with Phase 5a, so rows import with `categoryId: null` (`CsvImport.tsx:130`).
*What a user experiences:* Importing a real bank statement (dozens of rows) means hand-picking a category for every single row, and if the bank's merchant text is wrong/garbled you can't correct it in review.
*Recommendation:* Make merchant editable per the spec; add a lightweight keyword-based category default now (AI later), so common merchants pre-fill.

**U-15 · Medium · Bill-reminder dismissals are stored in a global, non-user-scoped localStorage key**
`src/modules/wallet/Dashboard.tsx:49-62` — `DISMISSED_KEY = 'daybook:dismissed_reminders'` is a single browser-global key.
*What a user experiences:* On the shared home-network machine, one user's dismissed reminders persist in the same browser bucket across logins; combined with per-user rule IDs the effect is inconsistent (dismissals don't reliably follow the account).
*Recommendation:* Namespace the key by user id, or move dismissal state server-side.

**U-16 · Medium · No onboarding or product orientation for a brand-new account**
`src/router.tsx:24` sends new users to `/tasks`; the empty state there (`TasksPage.tsx:546-560`) just says "Create your first task." Nothing introduces the two modules, the Wallet's "create an account first" requirement, or Sharing.
*What a user experiences:* After signup the user is dropped onto an empty outliner with no explanation that this is also a finance app, where the money lives, or how to begin. All cross-module discovery is self-serve via the sidebar.
*Recommendation:* A lightweight first-run welcome (dismissible card or a 3-step checklist) covering Tasks / Wallet / Sharing, shown once.

### Low

**U-17 · Low · Empty-state titles have no shared voice**
`BudgetsPage.tsx:102` "No limits configured", `GoalsPage.tsx:95` "Nothing here yet", `RecurringPage.tsx:186` "No scheduled rules yet", `Dashboard.tsx:200` "No data yet", `AccountsPage.tsx:115` "No accounts yet". Five different phrasings read as unpolished.
*Recommendation:* Standardize on one formula ("No X yet" + one-line action).

**U-18 · Low · Buttons have no loading state; double-submit is possible**
`src/components/ui/Button.tsx:1-48` has no `loading`/`disabled-while-pending` support; async handlers ad-hoc swap text ("Creating…", "Recording…") only in some places. E.g. `BudgetsPage.tsx:215` "Create Budget" has no in-flight disable, so a slow save can be clicked twice.
*Recommendation:* Add a `loading` prop that shows a spinner and disables the button; adopt it on all async submits.

**U-19 · Low · Undo coverage is inconsistent and ephemeral**
Task delete and single-transaction delete get a 5s undo toast (`TasksPage.tsx:138-151`, `WalletPage.tsx:196-224`), but bulk delete has none and its copy says "This cannot be undone" (`WalletPage.tsx:660-661`); account/budget/goal/recurring/group deletes are permanent. The undo toast is the only record — miss the 5s window and there's no trash/history.
*Recommendation:* Extend the undo-toast pattern to bulk delete (row data is already in memory), and standardize the confirm-vs-undo policy.

**U-20 · Low · Auth signup accepts any non-empty password; no confirm field or reveal**
`src/components/auth/AuthPage.tsx:25-28` only checks for non-empty username/password — no minimum length, no confirmation field, no show-password toggle.
*What a user experiences:* On the single-user home app, it's easy to set a one-character or fat-fingered password you can't reproduce, with no way to verify what you typed.
*Recommendation:* Add a minimum length, a show-password toggle, and (on signup) a confirm field.

### Strengths

- Primary pages (Accounts, Wallet, Tasks, CSV import) have action-oriented empty states that route the user to the correct next step (`AccountsPage.tsx:112-122`, `WalletPage.tsx:586-596`, `CsvImport.tsx:184-199`).
- Undo toasts for task and single-transaction deletes, plus an accessible `aria-live` toast container (`Toast.tsx:8-13`).
- Real accessibility investment: 40px touch targets on row actions, `role="img"` + data summaries on charts (`Dashboard.tsx:301-305`), and read-only shared rows correctly hide impossible edit/delete/split affordances (`TransactionList.tsx:78-124`).
- Transaction entry is low-friction: account + today's date pre-selected and a "Save & Add Another" fast path (`TransactionForm.tsx:46-50, 157-163`).
- The reorganized filter bar does progressive disclosure well — search-first, collapsible Filters with an active-count badge, and a Clear-all that only appears when filters are active (`WalletPage.tsx:388-505`).

---

## 6. Reviewer 2 — Consistency & Design-System Discipline (Claude Sonnet)

### Verdict

**Grade: C+.** The core money-formatting and date-range plumbing has genuinely converged on shared helpers (`formatMYR`, `monthRange`, `dateRangePreset`, `splitEqually`, `DateRangeControl`) — this is real, disciplined cleanup and should be credited. But the interaction layer built on top of that plumbing is still fragmented: delete confirmation has five distinct shapes, error handling ranges from a standardized toast pattern down to complete silence (Tasks, most of Settings/Sharing), row-action affordances differ by page for no functional reason, and the recent Share→Split terminology unification is only half-done — the nav item, component/file names, and API routes still say "Share" while the dialogs now say "Split", sometimes in the same modal. The newest surface (`Settings → Sharing`, `Wallet → Shared`) inherited old anti-patterns (`window.alert`, unconfirmed destructive actions) rather than the newer conventions established elsewhere in Wallet.

Note: `docs/feature-consistency-review.md` (2026-07-19) is materially stale — it references `HouseholdPage.tsx` and `SplitDialog.tsx`, neither of which exists anymore. All findings below were independently re-verified against current code.

**Severity counts:** Critical 0 · High 6 · Medium 8 · Low 6 — Total 20.

### High

**CD-01 — Removing/leaving a group has zero confirmation and swallows errors**
`src/modules/settings/GroupCard.tsx:27-35` — `handleRemove` fires `api.delete` directly from the button `onClick` (line 68), no modal, no `window.confirm`, and the `try { … } finally { … }` has **no `catch`** at all — a failed request is silently ignored.
Contrast: deleting a single *category* — a far less consequential action — gets an inline confirm panel (`CategoryManager.tsx:98-114`); deleting the *group itself* gets a full modal (`SharingPage.tsx:126-136`).
*User experience:* One misclick on the member row instantly removes a household member (or kicks the user out of their own group) with no "are you sure," and if the request fails, nothing tells the user it didn't work.
*Recommendation:* Route through `ConfirmDeleteModal`; add a `catch` that toasts via `errorMessage()`.

**CD-02 — Native `window.alert()` breaks the toast standard, right in the newest page**
`src/modules/settings/SharingPage.tsx:56-58` calls `alert(msg)` on delete-group failure. Every wallet CRUD page (`AccountsPage.tsx:71`, `BudgetsPage.tsx:65,74`, `GoalsPage.tsx:66,75`, `RecurringPage.tsx:135,151,162`, `WalletPage.tsx:160-233`) uses `addToast({ message: errorMessage(err, …) })`.
*User experience:* A blocking, unstyled OS dialog appears on this one page while every comparable failure elsewhere in Wallet is a dismissible toast.
*Recommendation:* Swap for `addToast({ message: errorMessage(err, 'Could not delete group — please try again.') })`.

**CD-03 — Delete confirmation still has five different shapes, with inconsistent modal titles**
- `ConfirmDeleteModal` (standard): `BudgetsPage.tsx:223`, `GoalsPage.tsx:195`, `RecurringPage.tsx:352`
- Hand-rolled `Modal` + `variant="danger"` Button: `AccountsPage.tsx:145-155`, `WalletPage.tsx:657-671` (bulk delete)
- Hand-rolled `Modal` + manual red classes instead of `variant="danger"`: `SharingPage.tsx:126-136`
- Inline in-list confirm panel, no modal: `CategoryManager.tsx:98-114`
- No confirmation at all: `GroupCard.tsx` (CD-01)
- Immediate delete + 5s undo toast, no confirm: single transaction delete (`WalletPage.tsx:186-225`), Tasks

Title formatting also inconsistent: `"Delete Account"` (Title Case, no `?`) vs `"Delete budget?"` / `"Delete goal?"` / `"Delete recurring rule?"` vs `"Delete Group?"` (Title Case + `?`).
*Recommendation:* Migrate all destructive confirms to `ConfirmDeleteModal`; standardize title convention; document which entities get undo-toast vs hard confirm and why.

**CD-04 — Row edit/delete affordances differ across three visually adjacent wallet pages**
- Icon `Button` (ghost), `aria-label`, 40px mobile touch target: `TransactionList.tsx:216-241`
- Raw `<button>`, no touch sizing, generic `aria-label="Edit"`/`"Delete"` (indistinguishable to screen readers across rows): `BudgetsPage.tsx:160-173`
- Plain text links, no icon, no `aria-label`: `GoalsPage.tsx:118-129`, `RecurringPage.tsx:251-263`

*Recommendation:* Pick the `TransactionList`/`AccountCard` pattern (icon `Button`, contextual `aria-label`, 40px mobile target) and apply it to Budgets/Goals/Recurring.

**CD-05 — "Share" vs "Split" terminology unification is half-done, and collides inside a single dialog**
Transaction-level copy has converged on "Split" — `ShareDialog.tsx:102` title `"Split Transaction"`, `TransactionList.tsx:166` badge `"Split"`, `TransactionList.tsx:217` `aria-label="Split transaction"`. But the component/route/nav layer never got the rename: files are still `ShareDialog.tsx` / `BulkShareDialog.tsx`, API routes are `POST /transactions/:id/share` and `POST /transactions/shares`, the field is `hasShares`, and the left-nav item is `"Shared"` (`Sidebar.tsx:39`). Worst case, inside `BulkShareDialog.tsx`: modal title `"Split N Transactions"` (line 161) with section label `"Share with"` (line 206) on the same screen.
*Recommendation:* Pick one word (accounts are *shared*, expenses are *split*) and propagate through component names, the nav label, and copy; at minimum make copy internally consistent within one dialog.

**CD-06 — Error handling: standardized in Wallet CRUD, absent almost everywhere else**
The `errorMessage()` + toast pattern (`src/lib/utils.ts:31-33`) is applied consistently across `AccountsPage`, `BudgetsPage`, `GoalsPage`, `RecurringPage`, `WalletPage`. Outside that set:
- `src/hooks/useTasks.ts` — zero `try/catch` blocks in the entire file; every task mutation is fire-and-forget.
- `src/modules/settings/PendingInvites.tsx:12-21` — `try { … } finally { … }`, no `catch`; an accept/decline failure is invisible.
- `src/modules/settings/GroupCard.tsx:27-35` — same pattern (CD-01).
- `src/modules/settings/SharingPage.tsx:38-49` — `handleCreate`/`loadAll` have no error handling.

*Recommendation:* Extend the `errorMessage()`/toast convention to Tasks and the Settings/Sharing flows; Tasks is the largest and most consequential gap.

### Medium

**CD-07 — `Wallet/Shared` bypasses the app's own "positive money" colour token, and introduces an unexplained third colour**
`src/lib/utils.ts:16-19` documents a dedicated `positive` Tailwind alias used correctly in `Dashboard.tsx:235`, `WalletPage.tsx:513,527`, `TransactionList.tsx:86,141,280`, `RecurringPage.tsx:213,237`, `TransactionForm.tsx:36`, `ExportModal.tsx:136`. `SharedPage.tsx` hardcodes `text-green-700`/`bg-green-50`/`border-green-200` (lines 130,166,170) for "owed to you" and `text-orange-700`/`bg-orange-50`/`border-orange-200` (lines 134,184,188) for "you owe" — a pairing used nowhere else (expenses elsewhere are red).
*Recommendation:* Use `positive` tokens for "owed to you" and red for "you owe"; drop orange.

**CD-08 — `useCrudModal` only half-adopted**
`BudgetsPage.tsx:24`, `GoalsPage.tsx:34`, `RecurringPage.tsx:48` use `useCrudModal<T>()`; `AccountsPage.tsx` and `WalletPage.tsx` hand-roll the identical state machine.
*Recommendation:* Migrate both.

**CD-09 — Raw `<select>`/`<input>` bypass the `Select`/`Input` primitives, including within a single file**
`AccountForm.tsx` uses `Select` at lines 141 and 168, then a raw `<select>` at line 240 in its own sharing section. Also raw `<select>`: `ShareDialog.tsx:138`, `SettleUpDialog.tsx:87,110`. Raw `<input type="number">`: `BulkShareDialog.tsx:270`.
*Recommendation:* Replace with `Select`/`Input` (shared focus ring, error state, label wiring).

**CD-10 — `Badge` primitive bypassed for near-duplicate hand-rolled pills, at a different shade**
`BudgetsPage.tsx:128` hand-rolls the "Over" pill with `bg-red-100` (vs Badge `danger`'s `bg-red-50`) — a visibly different chip. `RecurringPage.tsx:213-214` hand-rolls income/expense pills instead of `<Badge>`.
*Recommendation:* Route both through `Badge`; add a documented variant if a darker shade is wanted.

**CD-11 — Account name validated on create (400 if blank) but not on edit at the API layer**
`server/routes/wallet.ts:51-55` (POST) rejects blank `name`; `PATCH /accounts/:id` goes through generic `updateRow()` (`server/lib.ts:11-44`) with zero validation — `{ name: '' }` succeeds silently. Client validates, but any other API caller bypasses it, and it contradicts the create-path guarantee.
*Recommendation:* Add the same non-blank check to PATCH when `name` is present (goals/budgets already re-validate on edit).

**CD-12 — CSV review table's merchant field is still not editable, contradicting the product spec**
`CsvReviewTable.tsx:92-97` renders merchant as a plain `<span>`, while Date, Amount, Type, and Category in the same row are all editable controls. CLAUDE.md §9.2: "Show review table: all rows, each row editable."
*Recommendation:* Make merchant an editable `Input`, or update the spec language.

**CD-13 — Tasks kept the hover-only action pattern Wallet deliberately moved away from**
`BulletNode.tsx:119,212` — drag handle and row actions use `opacity-0 group-hover/node:opacity-100`. Wallet's equivalents additionally carry `min-h-[40px] min-w-[40px] md:min-h-0 md:min-w-0` (`TransactionList.tsx:213-241`) — the documented "B6 always-visible card actions" fix. `BulletNode` never got the same treatment, so task actions are unreachable on touch devices.
*Recommendation:* Apply the same touch-target treatment to `BulletNode`'s controls.

**CD-14 — Settings page: dead currency selector + stale privacy copy + unhandled save failures**
`SettingsPage.tsx:146-157` — currency selector nothing reads (`formatMYR` hardcoded). Lines 110-113 — API-key copy "Stored only in your browser database…" is false post-Phase-4 (keys stored server-side in SQLite). `handleSave` (41-51) loops sequential `api.put` calls with no try/catch — user gets nothing at all on failure.
*Recommendation:* Remove/disable the currency selector; correct the copy; wrap `handleSave` and toast failures via `errorMessage()`.

### Low

**CD-15 — Net Worth hero markup duplicated with differently-worded captions**
`WalletPage.tsx:365-379` and `AccountsPage.tsx:93-104` render identical hero structure but caption "across {n} account{s}" vs "{n} account{s}".
*Recommendation:* Extract a shared `NetWorthBanner`; one wording.

**CD-16 — Empty-state title formula still broken in two places**
Standard `"No X yet"` confirmed at `AccountsPage.tsx:115`, `Dashboard.tsx:200`, `RecurringPage.tsx:186`, `SharedPage.tsx:98`, `WalletPage.tsx:589`, `SharingPage.tsx:86`. Deviations: `GoalsPage.tsx:95` "Nothing here yet", `BudgetsPage.tsx:102` "No limits configured".
*Recommendation:* Rename to "No goals yet" / "No budgets yet".

**CD-17 — Submit-button label and casing drift across near-identical forms**
`"Save Changes"`/`"Create X"` (`AccountForm.tsx:292`, `TransactionForm.tsx:313`, `BudgetsPage.tsx:216`) vs `"Save"`/`"Create"` (`GoalsPage.tsx:189`, `RecurringPage.tsx:344-346`); `"Save changes"` lowercase at `SettingsPage.tsx:161`.
*Recommendation:* One verb pair, one casing.

**CD-18 — Sidebar footer still says "Daybook Alpha"**
`Sidebar.tsx:220` — while CLAUDE.md §13 records v1.0.1 with auth, sharing, splits, settlements shipped.
*Recommendation:* Update to the current milestone label or drop the qualifier.

**CD-19 — Nav label vs. page header mismatch for CSV import**
Sidebar `"Import CSV"` (`Sidebar.tsx:56`) vs page title `"Import from CSV"` (`CsvImport.tsx:179`).
*Recommendation:* Match the wording.

**CD-20 — Tasks has no bulk-select/bulk-delete, unlike Wallet's "Select" mode**
`WalletPage.tsx:341-349` has a `Select` toggle enabling multi-select + bulk delete; `TasksPage.tsx` has no equivalent. May be intentional scope, but worth a deliberate call (e.g. clearing a batch of completed sub-tasks).
*Recommendation:* Confirm out-of-scope and note it, or add parity.

### Strengths

- The money/date-formatting layer has genuinely converged: `formatMYR`, `monthRange`, `dateRangePreset`, `splitEqually` are single-sourced and consistently imported — the older "four implementations of month math" problem is resolved.
- `DateRangeControl` is genuinely shared across Transactions, Dashboard, and Reports.
- Server-side validation parity is mostly solid: `positiveAmountError`/`isoDateError` cover recurring amount/date; budgets/goals validate symmetrically on create.
- The Share/Split cleanup, while incomplete, landed correctly in the highest-traffic surfaces (row badge, dialog title, CLAUDE.md §6).
- Empty states are correctly built on the shared `EmptyState` component everywhere — no hand-rolled empty-state markup found.

---

## 7. Reviewer 3 — Behavioural Correctness & Edge Cases (Claude Fable)

### Verdict

**Grade: C−.** Daybook's server has genuinely good bones — per-user scoping, C2-era input validation, atomic bulk writes, and a correct account-balance formula that handles transfers and opening balances consistently in both the batched and per-account routes. But the sharing/settlement lifecycle, the newest and most money-sensitive subsystem, has serious correctness holes a household hits within weeks: the creditor-side "Mark Received" flow is functionally broken (and can silently take money *out of the creditor's ledger*), partial settlements book real ledger transactions without reducing debt, re-splitting resurrects already-paid shares, and PATCH lets a transaction be moved into another user's account with no ownership check. The e2e suite (38 specs) covers happy paths well but has zero coverage of partial settlements, split rescaling, or the Mark Received path — exactly where the bugs live.

**Severity counts:** Critical 2 · High 5 · Medium 8 · Low 6 — Total 21.

### Critical

**B-01 — "Mark Received" settlement is direction-inverted; can debit the creditor's own account**
*Area:* Settlements
*Evidence:* `src/modules/wallet/SharedPage.tsx:172` (Mark Received passes a balance where `toUserId === currentUserId`), `src/modules/wallet/SettleUpDialog.tsx:49-56` (posts `toUserId: balance.toUserId` — i.e. the caller themselves), `server/routes/settlements.ts:31-46` (owed-check and expense leg are always computed as *caller pays toUserId*).
*Failure scenario:* Bob owes Alice RM100. Alice clicks "Mark Received" → dialog says "Recording receipt from Bob" → POST `/settlements` with `toUserId = Alice`. Server queries shares where `ts.user_id = Alice AND t.user_id = Alice` — that matches Alice's *own payer-participation rows* from equal splits she created (never settled, always present). If any exist, the server records an **expense from Alice's account**, a settlement "Alice → Alice", and marks Alice's own payer shares settled — Bob's debt is untouched and Alice's balance drops. If none exist, she gets a baffling 400 "no outstanding balance owed to this user". There is no server concept of receipt direction at all. `e2e/36-settlement.spec.ts` never exercises Mark Received.
*Recommendation:* Add an explicit direction (`fromUserId`) to the API; when the caller is the creditor, create income on the caller side / expense on the debtor side, and compute the owed-check as debtor→creditor. Add an e2e test for the receipt flow.

**B-02 — Partial settlements create real money movements but don't reduce debt (leads to over-payment)**
*Area:* Settlements / money math
*Evidence:* `server/routes/settlements.ts:98-118` — a share is only marked settled `if (remaining >= share.share_amount)`; no partial-share tracking. The expense/income transactions (lines 67-94) and the settlement record (line 121) are always written for `effectiveAmount`.
*Failure scenario:* Bob owes Alice one RM100 share. Bob settles RM50 → RM50 expense (Bob) + RM50 income (Alice) are booked and settlement history shows RM50 paid — but the share stays unsettled, so the group still shows "Bob owes Alice RM100". The cap at line 42 (`min(amount, owedRow.total)`) is computed from unsettled shares only, so Bob can then pay RM100 more: **RM150 paid against an RM100 debt**, with the app confirming both payments. Variant: shares [60, 50], pay 100 → 60 settled, 50 skipped, RM40 of the recorded payment applies to nothing.
*Recommendation:* Either reject payments that don't exactly clear whole shares (clear message), or support partial settlement (e.g. split the share row). At minimum, reduce `effectiveAmount` to the sum of shares actually settled so ledger and debt stay reconciled.

### High

**B-03 — PATCH /transactions allows moving a transaction into any user's account**
*Area:* Permissions / cross-tenant integrity
*Evidence:* `server/routes/wallet.ts:271-281` (`TRANSACTION_COLS` includes `accountId` and `destinationAccountId`), `:577-634` — the handler checks edit permission on the *existing* `account_id` and category ownership only; a new `accountId`/`destinationAccountId` in the body is never checked against `canWriteAccount`/`visibleAccountIds` (contrast POST at `:557-571`). FKs are on (`server/db.ts:70`), so any existing account id — including another user's — is accepted.
*Failure scenario:* A household member who knows an account id PATCHes their own RM5,000 expense with `accountId: <spouse's private account>`. The transaction now drains the spouse's balance (`/accounts/balances` sums by `account_id`, not owner) while remaining owned/editable by the attacker. Same hole for `destinationAccountId`: pointing a transfer's destination at any account inflates it.
*Recommendation:* In the PATCH handler, when `accountId` changes require `canWriteAccount(db, userId, b.accountId)`; when `destinationAccountId` changes require it be in `visibleAccountIds` (as POST does).

**B-04 — Re-splitting a transaction deletes settled shares and orphans settlement history**
*Area:* Splits / settlement consistency
*Evidence:* `server/routes/wallet.ts:735` and `:839` — `DELETE FROM transaction_shares WHERE transaction_id = ?` with no `settled_at IS NULL` filter; `settlement_share_lines` cascade away with the shares (migration 0004). `src/modules/wallet/ShareDialog.tsx:123` only warns "Saving will replace these shares."
*Failure scenario:* Alice splits RM100 dinner with Bob ("Keep as-is", Bob owes 100). Bob settles — real transfer transactions created, share marked settled. A week later Alice reopens the split dialog to change it to 50/50 and saves → the settled share row is deleted and fresh unsettled rows are written: **Bob now owes RM50 again despite having paid RM100**, and undoing the old settlement (`settlements.ts:210-213`) restores nothing because its share-lines are gone (it *would* still delete the two money transactions, silently un-balancing the books).
*Recommendation:* Block re-splitting when any share is settled (409 with guidance to undo the settlement first), or preserve settled rows and only replace unsettled ones.

**B-05 — Deleting an account silently erases household debts and other members' transactions**
*Area:* Sharing / deletion cascades
*Evidence:* `server/routes/wallet.ts:84-87` — bare `DELETE FROM accounts` with no guard; schema cascades `transactions` → `transaction_shares`; `settlements.from_transaction_id/to_transaction_id` go NULL. `src/modules/wallet/AccountsPage.tsx:149` confirm text mentions only "All transactions in this account will be permanently deleted."
*Failure scenario:* Alice shared her "Joint card" account with can_write; Bob posted his own transactions to it; several of Alice's transactions on it have unsettled splits where Bob owes RM300. Alice deletes the account → Bob's RM300 debt vanishes from group balances with no trace, Bob's *own* transactions posted to that account are deleted from his history too, and past settlement records lose their ledger links. Group deletion and member removal both guard against unsettled shares (`groups.ts:111-122`, `:176-186`) — account deletion, the easier path, does not.
*Recommendation:* Block (409) or at least explicitly warn when the account's transactions carry unsettled shares or other users' rows, mirroring the group-delete guard.

**B-06 — Amount-edit rescaling rewrites settled shares and can produce RM0.00 shares**
*Area:* Splits / money math
*Evidence:* `server/routes/wallet.ts:604-629` — the rescale SELECT has no `settled_at IS NULL` filter, and the last row absorbs `newAmount - allocated`, which rounds to 0.00 in edge cases (e.g. shares [9.99, 0.01] rescaled to 0.02 → [0.02, 0.00]).
*Failure scenario:* RM100 split 50/50 with Bob; Bob settles his RM50 (settlement + transfers for RM50 recorded). Alice later corrects the amount to RM80 → Bob's *settled* share row is rewritten to RM40, so history now says Bob owed RM40 but the settlement and its ledger transactions say RM50 — books can never reconcile, and an undo restores a RM40 debt after an RM50 refund. Also triggered by a can_write co-member editing the amount.
*Recommendation:* Refuse amount edits when settled shares exist (or rescale only unsettled shares and re-validate the sum); clamp rescaled shares to > 0.

**B-07 — Read-only share members can alter the owner's balance via transfers**
*Area:* Permissions
*Evidence:* `server/routes/wallet.ts:557-571` — source account requires `canWriteAccount`, but the destination only needs to be in `visibleAccountIds` (`lib/sharing.ts:7-28`), which includes read-only shared-in accounts. The client offers all accounts as transfer destinations (`TransactionForm.tsx:109-111`).
*Failure scenario:* Alice shares her savings account read-only so the family can *see* it. Bob creates a transfer from his own cash account into Alice's savings → Alice's displayed balance rises by an amount she never received, recorded by a transaction she cannot see the other side of. Read-only means "cannot add/edit transactions" per CLAUDE.md §6 — violated.
*Recommendation:* Require `canWriteAccount` on the destination account for transfers (both POST and import).

### Medium

**B-08 — Share-status endpoint contradicts the transaction list for "Keep as-is" shares**
*Evidence:* `server/routes/wallet.ts:870-874` filters `transaction_shares ... AND user_id = ?` (the caller/owner) — but "Keep as-is" writes only the *recipient's* row, so the owner gets `hasShares: false`; meanwhile GET `/transactions` (line 430) uses an unfiltered EXISTS and reports `has_shares: 1`.
*Failure scenario:* Alice bulk-shares 10 receipts with "recipient owes 100%". The list view badges them as shared; the BulkShareDialog pre-check says they aren't — she shares them again, and per B-04 the DELETE+INSERT resets `created_at`, reshuffling settlement FIFO order.
*Recommendation:* Drop the `AND user_id = ?` from the share lookup (ownership already established by the `ownedIds` filter).

**B-09 — splitEqually produces unequal shares for cleanly divisible amounts (FP floor)**
*Evidence:* `src/lib/utils.ts:74-79` and `server/lib.ts:59-64`: `Math.floor((amount / n) * 100) / 100`. For `amount=8.2, n=4`: `8.2/4 = 2.0499999999999998` → floor → base 2.04, owner 2.08.
*Failure scenario:* "Split equally" RM8.20 four ways shows RM2.08 / 2.04 / 2.04 / 2.04 when RM2.05 each is exact. Sums are correct, but users see the app "failing at division" on ordinary amounts.
*Recommendation:* Work in integer cents: `Math.floor(Math.round(amount*100)/n)`, distribute remainder.

**B-10 — Monthly recurring rules permanently drift off month-end**
*Evidence:* `server/routes/wallet.ts:1006-1018` — `advanceDate` clamps 31→28/29 but derives the next month's day from the *clamped* date, so the original day-of-month is lost.
*Failure scenario:* Rent rule due 2026-01-31 → posts 31 Jan, next due 28 Feb → 28 Mar → 28 Apr… The "last day of month" bill silently shifts to the 28th forever after the first February.
*Recommendation:* Store the anchor day on the rule and clamp per-occurrence (`min(anchorDay, lastDayOfMonth)`).

**B-11 — Settlements use UTC dates; everything else uses local dates**
*Evidence:* `server/routes/settlements.ts:48` and `:195` use `new Date().toISOString().slice(0,10)` while transactions/recurring use local `todayISO()`/`todayStr()` (`src/lib/utils.ts:81-87`, `wallet.ts:1024-1027` — the latter's comment explicitly says "NOT UTC").
*Failure scenario:* In Malaysia (UTC+8), any settlement recorded before 8:00 AM is dated *yesterday* — it lands in the previous day's transaction group and, at month boundary, in the previous month's dashboard/budget totals. The "same-day undo" window is also a UTC day.
*Recommendation:* Use the shared local-date helper in both places.

**B-12 — No double-submit guard on the transaction form**
*Evidence:* `src/modules/wallet/TransactionForm.tsx:148-163` and buttons at `:294-315` — `handleSubmit`/`handleSaveAndAddAnother` await `onSubmit` but never disable the buttons or track a pending flag (contrast `SettleUpDialog`'s `settling` state).
*Failure scenario:* On a slow phone connection, double-tapping "Add Transaction" fires two POSTs → duplicate transactions (no import_hash to dedupe manual entries).
*Recommendation:* Add a `saving` state that disables all three action buttons during submit.

**B-13 — CSV MM/DD/YYYY branch is dead code; US-format files are transposed or rejected**
*Evidence:* `src/lib/csv.ts:279-293` — the DD/MM regex at :279 is identical to the MM/DD regex at :286 and returns unconditionally, so the American branch never runs.
*Failure scenario:* A bank CSV with `03/04/2025` (Mar 4) imports as 3 April — silent date corruption for every row with day ≤ 12; rows like `12/31/2025` become `2025-31-12`, which passes the shape check client-side and then 400s the *entire* atomic import at confirm.
*Recommendation:* Delete the dead branch or add a file-level heuristic (if any first-component > 12, whole file is DD/MM; if any second-component > 12, MM/DD); pre-validate dates in the review table.

**B-14 — CSV amount parsing corrupts European-formatted numbers**
*Evidence:* `src/lib/csv.ts:317-339` — commas are stripped as thousands separators unconditionally, so `1.234,56` → `1.23456` → RM1.23; trailing-minus (`123.45-`, common in bank exports) is read as positive income.
*Failure scenario:* A statement using `1.234,56` imports a RM1,234.56 expense as RM1.23 — silently understating spending by 1000×.
*Recommendation:* Detect decimal convention per file (last separator wins) and handle trailing minus.

**B-15 — Budget "spent" counts housemates' transactions and full split amounts**
*Evidence:* `src/modules/wallet/BudgetsPage.tsx:32,39` loads `loadTransactions(monthRange(0))` (server default `view='all'` includes other members' rows on shared accounts, `wallet.ts:383-388`) and `getMonthlySpending` (`useWallet.ts:434-443`) sums the full `t.amount`, ignoring `transaction_shares` (the server's `effectiveAmount` helper in `lib/sharing.ts:57-76` is never used here).
*Failure scenario:* Alice's RM800 "Food" budget: Bob logs RM300 of groceries on the shared joint account, and Alice's RM200 dinner is split so Bob owes half. Alice's budget shows RM500+ consumed for RM100 of her own money — budgets become useless the week a household starts sharing.
*Recommendation:* Compute budget spending from own/effective amounts (server-side aggregate using `effectiveAmount` semantics).

### Low

**B-16 — Settlements are booked as income/expense, contradicting the documented "two real transfer transactions" invariant**
*Evidence:* `server/routes/settlements.ts:74,91` (`type: 'expense'` / `'income'`) vs CLAUDE.md §6 ("settlements create two real transfer transactions") and the SettleUpDialog docstring. Net totals stay correct, but gross monthly income/expense on the Dashboard summary are inflated by reimbursements, and the recipient sees "income" that is repayment.
*Recommendation:* Decide and align: amend the doc/UI or introduce a settlement category excluded from summaries.

**B-17 — Store not reconciled after account delete; stale transactions until next fetch**
*Evidence:* `src/hooks/useWallet.ts:352-356` removes only the account; cascaded transaction deletions aren't mirrored (contrast `deleteCategory` at `:288-296`). Mitigated by refetch-on-mount, but any summary computed from the store before remount includes ghost rows.

**B-18 — Server's over-payment cap warning never reaches the user**
*Evidence:* `settlements.ts:147-152` returns `message: "Only X was outstanding. Recording Y."`; `SettleUpDialog.tsx:49-57` discards the response body. User types RM200, ledger records RM120, nothing explains the difference.

**B-19 — SharedPage has no error handling; one failed request = infinite spinner**
*Evidence:* `src/modules/wallet/SharedPage.tsx:38-60` — `loadAll` has no catch; `setLoading(false)` only on success. Any 5xx/network error leaves the spinner forever plus an unhandled promise rejection.

**B-20 — Recurring catch-up posts up to 120 transactions from a fat-fingered past date, silently**
*Evidence:* `wallet.ts:1043-1081` — `nextDueDate` accepts any valid ISO date years in the past; on next app boot `/recurring-transactions/process` posts up to 120 back-dated transactions per rule per boot (guard at :1056), continuing on subsequent boots. No user-facing "posted 120 transactions" surface or undo.

**B-21 — Account PATCH/POST accept unvalidated `openingBalance` and `type`**
*Evidence:* `wallet.ts:13-21,51-82` — no amount/enum check; `normalizeBind` passes strings through, so `openingBalance: "abc"` stores TEXT in a REAL column, which SQLite coerces to 0 in the balance SUM while round-tripping the garbage to the client. UI forms guard this; the API does not.

### Strengths

- **Balance math is right where it counts:** both `/accounts/balances` and `/accounts/:id/balance` implement opening + income − expense − transfers-out + transfers-in identically (`wallet.ts:92-141`); transfers correctly excluded from income/expense summaries everywhere checked.
- **Cross-tenant reference guarding** (`ownsAllRefs`, `updateRow`'s user_id scope) is applied consistently across budgets, goals, recurring, and categories — B-03 is the one gap.
- **Local-date discipline** in the client (`monthRange`, `todayISO` with explicit "never toISOString" comments) shows the timezone lesson was institutionalized — settlements (B-11) just missed the memo.
- **Group lifecycle guards** (block group delete / member removal with unsettled shares, last-owner protection, invite state machine with re-invite upsert) are thorough and mostly correct.
- **Recurring "post now" does not consume the upcoming scheduled occurrence** (`wallet.ts:1106-1109`) — a subtle edge case handled deliberately, and monthly advancement correctly clamps leap-year February.

---

## 8. Suggested Sequencing

If the roadmap above is adopted, a natural wave structure (matching the Phase 5c PR-wave convention):

1. **Wave A (P0):** Settlement direction + partial-settlement semantics (B-01, B-02) with new e2e specs; PATCH ownership checks (B-03); transfer-destination permission (B-07).
2. **Wave B (P0):** Settled-share lifecycle guards — re-split block, amount-edit block, account-delete guard (B-04, B-05, B-06) with e2e coverage.
3. **Wave C (P1):** Feedback everywhere — Tasks/Sharing/Settings error toasts, form validation, load-error states, button loading/double-submit guard (U-01, U-04, CD-01/02/06/14, U-09/B-19, U-18/B-12).
4. **Wave D (P1):** Data honesty — budget effective amounts (B-15), CSV date/amount parsing (B-13/B-14), share-status fix (B-08), Settings control cleanup (U-02/U-03).
5. **Wave E (P2/P3):** Consistency sweep — delete-confirm unification, Share→Split completion, row-action pattern, mobile title, colour tokens, copy standardization.

Each wave stays within the existing conventions: branch per wave, e2e coverage for every behaviour change, additive-only migrations (none of the P0 fixes require schema changes except optionally partial-settlement tracking).

---

*Review produced by a three-model adversarial panel (Claude Opus, Claude Sonnet, Claude Fable) on 2026-07-20. All findings verified against source with file:line evidence; no code was modified.*
