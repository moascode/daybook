> **Status:** Shipped · **Filed:** 2026-09-16 · **Epic:** [EP-02](README.md)

# FEAT-008 — Type and category badges on recurring cards (B10)

**Shipped 2026-09-16 (verification found it already done).** Landed in
`2a8ec2a` ("R3 PR-4 — Budgets/Goals/Recurring/Reports design adoption",
2026-08-24), after this item's 2026-07 source note — `RecurringPage.tsx:210-231`
already renders type, frequency, and category badges via the shared `Badge`
component, with e2e coverage in `e2e/14-wallet-recurring.spec.ts:111-125`. One
cosmetic gap (category badge doesn't use `category.color` like
`TransactionList.tsx` does) is noted in [design.md](design.md) as an optional
follow-on, not scheduled separately.

**What.** A recurring-rule card shows its transaction type and category, as the
transaction rows elsewhere already do.

**Why now.** A recurring rule is invisible money that moves on a schedule; not
showing what kind of money it is makes the list hard to audit.

**Out of scope.** Any other recurring-rule changes.

**Notes.** Verified 2026-09-16: type and category are not surfaced on the cards.

**Still needed?** Probably — small
