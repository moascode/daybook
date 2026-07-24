# Deferred Items — Implementation Plan

**Context:** The multi-model adversarial review (`docs/adversarial-review-2026-07-20.md`)
produced 61 findings. Waves A1–E3 (PRs #43–#51, all merged) fixed both Criticals,
all 17 Highs, and the large majority of Medium/Low items. A handful of items were
**deliberately scoped down** at the time — either because they were larger UX
features, internal-only refactors with no user-visible benefit, or changes needing
owner sign-off. This document plans each of them.

**Status legend:** 🔴 needs owner decision before starting · 🟡 ready to build · 🟢 quick win

---

## 1. Summary table

| ID | Item | Type | Effort | Risk | Owner sign-off? |
|----|------|------|--------|------|-----------------|
| CD-03 | Unify remaining delete-confirm modals | Refactor | S | Low | — |
| CD-08 | Finish `useCrudModal` adoption (Accounts/Wallet) | Refactor | S | Low | — |
| CD-09 | Replace raw `<select>`/`<input>` with primitives | Refactor | S | Low | — |
| CD-15 | Extract shared `NetWorthBanner` component | Refactor | XS | Low | — |
| U-13 | Settle-Up dialog plain-language help (residual) | UX copy | XS | Low | — |
| U-10 | Removable active-filter chips | UX feature | M | Low | — |
| B-15 | Budget spending uses *effective* split amount | Correctness | M | Medium | — |
| U-16 | First-run onboarding | UX feature | M–L | Low | 🔴 design |
| CD-20 | Tasks bulk-select / bulk-delete | Feature/scope | M | Low | 🔴 scope |
| CD-05⁺ | Internal Split identifier rename (routes/field/table) | Contract + schema | M–L | Medium | 🔴 schema |
| — | CSV parse unit coverage (parseAmount/parseDate) | Tests | S | Low | — |

Proposed grouping into 5 follow-up waves (F1–F5) + 2 decisions is in §4.

---

## 2. Ready-to-build items (no sign-off needed)

### CD-03 — Unify the remaining delete-confirmation modals 🟡
**Finding:** Delete confirmation has five shapes. Waves C1/E-series moved Budgets,
Goals, Recurring, groups, and members onto `ConfirmDeleteModal`, but two hand-rolled
`Modal` + `variant="danger"` dialogs remain.
**Current state:** hand-rolled danger modals still in `AccountsPage.tsx` (delete account)
and `WalletPage.tsx` (bulk delete).
**Approach:**
1. Replace the account-delete `Modal` in `AccountsPage.tsx` with `ConfirmDeleteModal`
   (title "Delete account?", description carrying the existing "all transactions will
   be permanently deleted" warning + the new B-05 guard messaging).
2. Replace the bulk-delete `Modal` in `WalletPage.tsx` similarly (`title="Delete N
   transactions?"`). Keep the existing single-transaction *undo-toast* pattern as-is.
3. Add a one-paragraph note to `CLAUDE.md` §10 documenting the policy: **undo-toast**
   for single/low-consequence deletes (task, single transaction); **ConfirmDeleteModal**
   for high-consequence/bulk/cascading deletes (account, group, member, budget, goal,
   recurring, bulk transactions).
**Files:** `AccountsPage.tsx`, `WalletPage.tsx`, `CLAUDE.md`.
**Tests:** specs 02 (accounts delete), 03/28 (bulk delete) — update confirm-button
selectors if the label changes; add a regression asserting the ConfirmDeleteModal
renders.
**Effort:** S · **Risk:** Low (title/label changes ripple to a few e2e selectors).

### CD-08 — Finish `useCrudModal` adoption 🟡
**Finding:** `useCrudModal` is used in Budgets/Goals/Recurring; Accounts and Wallet
hand-roll the identical open/edit/delete state machine.
**Approach:** migrate `AccountsPage.tsx` (`formOpen`/`editingAccount`/`deleteTarget`)
and `WalletPage.tsx` (`formOpen`/`editingTransaction`) to `useCrudModal<Account>()` /
`useCrudModal<Transaction>()`. Pairs naturally with CD-03 (same two files, same modals)
— **do them in one PR.**
**Files:** `AccountsPage.tsx`, `WalletPage.tsx`.
**Tests:** existing 02/03/26 cover the flows; no new behaviour, so green suite = success.
**Effort:** S · **Risk:** Low.

### CD-09 — Replace raw `<select>`/`<input>` with primitives 🟡
**Finding:** raw controls bypass the shared focus ring / error state / label wiring.
**Current state:** raw `<select>` remains in `SettleUpDialog.tsx`, `AccountForm.tsx`
(sharing section), `ShareDialog.tsx`; raw number `<input>` in `BulkShareDialog.tsx`.
**Approach:** swap each for `Select` / `Input`. `SettleUpDialog` has two selects
(your-side / their-side) — map both to `Select` with `options`. Watch the e2e that
uses `dialog.locator('select')` (spec 36) — `Select` still renders a native `<select>`
underneath, so those selectors keep working; verify.
**Files:** `SettleUpDialog.tsx`, `AccountForm.tsx`, `ShareDialog.tsx`, `BulkShareDialog.tsx`.
**Tests:** 35 (splits), 36 (settlement), 34 (shares), 02 (account form).
**Effort:** S · **Risk:** Low.

### CD-15 — Extract a shared `NetWorthBanner` 🟢
**Finding:** `WalletPage` and `AccountsPage` render byte-identical net-worth hero markup
with two differently-worded captions.
**Approach:** create `src/components/ui/NetWorthBanner.tsx` taking `netWorth: number`
and `accountCount: number`; render one canonical caption ("across N accounts"). Use it
in both pages.
**Files:** new `NetWorthBanner.tsx`, `WalletPage.tsx`, `AccountsPage.tsx`.
**Tests:** 10 (net-worth), 26 — assert the shared caption text.
**Effort:** XS · **Risk:** Low.

### U-13 — Settle-Up plain-language help (residual) 🟢
**Finding:** the Settle-Up dialog was jargon-heavy. Wave A1's rewrite already relabelled
the fields ("Pay from (your account)", direction sentence). **Residual:** add one
plain-language help line under the account selectors, e.g. *"This books a real transfer
in your ledger; add their account too if they've shared one with you."*
**Files:** `SettleUpDialog.tsx`.
**Effort:** XS · **Risk:** Low. (Fold into the CD-09 PR — same file.)

### U-10 — Removable active-filter chips 🟡
**Finding:** a `?account=` deep-link silently narrows the list; the active filter is one
collapsed level down, with no visible, removable indicator.
**Approach:**
1. Derive an "active filters" array from `filters` (account, type, category, tag,
   date-range-if-not-default, q) in `WalletPage.tsx`.
2. Render a chip row under the filter bar: each chip shows the filter label + an × that
   clears just that key; reuse `Badge` for styling.
3. Auto-expand the Filters section when arriving with any URL-applied filter.
**Files:** `WalletPage.tsx` (+ maybe a small `FilterChips` subcomponent).
**Tests:** new cases in spec 37 (filter bar) — chip appears for `?account=`, × clears it.
**Effort:** M · **Risk:** Low.

### B-15 — Budget spending should use the *effective* split amount 🟡
**Finding (residual):** Wave D scoped budget spending to the user's own transactions
(`view:'mine'`), which fixed housemates' rows inflating the budget. **Still open:** when
the user splits *their own* expense (e.g. a RM200 dinner split 50/50), the budget counts
the full RM200 rather than their RM100 share.
**Approach (server-side aggregate — cleanest):**
1. Add `GET /api/budgets/spending?month=YYYY-MM` in `server/routes/wallet.ts` returning
   `{ categoryId, spent }[]`, where `spent` sums **effective** amounts: for a transaction
   the caller owns that has split rows, use their `share_amount`; otherwise the full
   amount. The server already has an `effectiveAmount` helper in `lib/sharing.ts` — lift
   its logic into a `GROUP BY category_id` aggregate.
2. In `BudgetsPage.tsx`, replace the client-side `getMonthlySpending` sum with a call to
   the new endpoint (removes the need to load the full transaction list just for budgets).
**Files:** `server/routes/wallet.ts`, `server/lib/sharing.ts` (reuse), `BudgetsPage.tsx`,
`useWallet.ts` (drop/trim `getMonthlySpending`).
**Tests:** new spec — own split expense counts only the owner's share against the budget.
**Effort:** M · **Risk:** Medium (money aggregation; needs a focused test).

### Test coverage — CSV parse edge cases 🟢
**Context:** Wave D fixed `parseAmount` (European decimals, trailing minus) and
`parseDateToISO` (DD/MM vs MM/DD) but they're only covered indirectly via the CSV import
e2e. These are pure functions — lock the fixes in with focused cases.
**Approach:** either a Playwright spec that imports fixtures with `1.234,56`, `123.45-`,
and `12/31/2025` and asserts the parsed values, or (preferred) a lightweight unit test if
a runner is added. Given the repo is e2e-only today, add CSV fixtures + a spec.
**Files:** `e2e/fixtures/*.csv`, `e2e/04-…` or a new spec.
**Effort:** S · **Risk:** Low.

---

## 3. Items needing owner sign-off

### CD-05⁺ — Internal Split identifier rename 🔴 (schema)
**What's done:** the *user-facing* Share→Split rename shipped in Wave E3 (all UI copy,
the affordance behaviour). **What's deferred:** the internal identifiers —
- API route paths: `/transactions/:id/share` → `/split`, `/transactions/shares` →
  `/splits`, `/transactions/shares/status` → `/splits/status`, GET
  `/transactions/:id/shares` → `/splits`;
- response field `hasShares` → `hasSplits`;
- the DB table `transaction_shares` → `transaction_splits` (+ `settlement_share_lines`);
- component/file names `ShareDialog`→`SplitDialog`, `BulkShareDialog`→`BulkSplitDialog`,
  and the `SharedPage`/nav (kept as "Shared" — those are shared *balances*, arguably fine).
**Why it needs sign-off:** the table rename is a **schema change** (CLAUDE.md §2 rule 3
requires explicit owner instruction) and needs a migration; the route/field renames are a
**client↔server contract change** that ripples through ~6 API-level e2e specs. Zero
user-visible benefit — this is purely internal tidiness.
**Approach if approved:**
1. Migration `0007_rename_transaction_shares.sql`: since SQLite has no clean table rename
   with FKs, create `transaction_splits` (+ `settlement_split_lines`), copy rows, and keep
   the old tables as views OR do a create-copy-drop within one migration (drop is normally
   forbidden — this is the one case that needs explicit approval).
2. Rename routes in `wallet.ts`/`settlements.ts`; update `src/lib/api.ts` call sites and
   `hasShares`→`hasSplits` in types/mappers/`TransactionList`.
3. Rename the two dialog files/components + `data-testid`s; update every e2e spec that
   POSTs to the old paths or references the testids (33/34/35/36/39/41/42/27, and 03/35 UI).
**Files:** migration, `server/routes/wallet.ts`, `settlements.ts`, `src/lib/api.ts`,
types, mappers, `TransactionList.tsx`, `ShareDialog`/`BulkShareDialog`, ~8 e2e specs.
**Effort:** M–L · **Risk:** Medium (schema + broad contract change).
**Recommendation:** **only do this if internal consistency is worth a schema migration.**
It carries real risk for no user benefit; the user-facing rename is already complete.
Reasonable to leave permanently deferred.

### U-16 — First-run onboarding 🔴 (design)
**Finding:** a brand-new account lands on an empty outliner with no orientation across
Tasks / Wallet / Sharing.
**Decision needed:** what form should it take? Options:
- (a) A dismissible welcome **card** on first visit to each empty module (lowest effort,
  no new routes; store "seen" in a per-user setting).
- (b) A one-time **3-step checklist** (create a task → add an account → invite household)
  surfaced on the Tasks landing page until dismissed/completed.
- (c) A short **modal tour** on first login.
**Approach (assuming (a)/(b)):** add a `onboarding_dismissed` per-user setting; render a
lightweight `WelcomeCard`/`OnboardingChecklist` gated on it; wire the "seen" write.
**Files:** new component(s), `App.tsx` or module pages, settings key, seed default.
**Effort:** M (card) – L (checklist/tour) · **Risk:** Low.
**Blocked on:** owner choosing a/b/c and the copy.

### CD-20 — Tasks bulk-select / bulk-delete 🔴 (scope)
**Finding:** Wallet has a multi-select "Select" mode + bulk delete; Tasks has no
equivalent. The review flagged it as *possibly* intentional.
**Decision needed:** build parity, or formally record it as out-of-scope?
- **Build:** add a select mode to `TasksPage`/`BulletNode` (checkbox affordance, bulk
  delete with undo). Non-trivial in a nested tree (selecting a parent implies children).
  Effort M–L.
- **Document:** add a line to CLAUDE.md noting Tasks intentionally has no bulk-select
  (bullet trees favour keyboard flow; Backspace-on-empty + undo covers rapid deletion).
  Effort XS.
**Recommendation:** document as out-of-scope unless you specifically want it — the
keyboard-first outliner model makes bulk-select a poor fit.

---

## 4. Proposed sequencing

| Wave | Contents | Rationale |
|------|----------|-----------|
| **F1 — Consistency refactors** | CD-03 + CD-08 (same two files) + CD-09 + CD-15 + U-13 | All internal/low-risk, no behaviour change; one cohesive "polish" PR. Green suite = done. |
| **F2 — Filter chips** | U-10 (+ CSV parse test coverage) | Small self-contained UX win. |
| **F3 — Budget effective amounts** | B-15 | Money-correctness; isolated server endpoint + test. |
| **F4 — Onboarding** | U-16 | After you pick a/b/c and copy. |
| **F5 — Split identifier rename** | CD-05⁺ | Only if approved; schema + contract change, do last and in isolation. |
| **Decision** | CD-20 | One-line answer: build or document. |

**Recommended order:** F1 → F2 → F3, then F4 once the onboarding shape is chosen. F5 is
optional and I'd leave it unless internal naming consistency is a priority for you. CD-20
just needs a yes/no.

**Nothing here is a correctness blocker** — the merged `main` is production-ready. These
are polish, one small correctness refinement (B-15 residual), and one optional internal
rename.

---

*Plan produced 2026-07-24 as the follow-up to the multi-model adversarial review. Each
item traces back to a finding ID in `docs/adversarial-review-2026-07-20.md`.*
