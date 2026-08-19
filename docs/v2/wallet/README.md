# Wallet — module plan

**Adoption: R3 (`v2.12.0`). Completion: R7–R9 (`v3.1`–`v3.3`).**

Wallet goes first because it is the only module where the proposal and the
codebase map 1:1 — eight designed pages, eight existing routes, same names, same
purposes. Nothing has to be invented to adopt the design here, which makes it
the right place to prove the token layer and the shell against real complexity.

| Doc | What it covers |
|---|---|
| [02-design-adoption.md](02-design-adoption.md) | R3 — the eight pages, page by page |
| [03-feature-waves.md](03-feature-waves.md) | R7–R9 — what the design shows that we do not compute |

There is no `01-data-model.md`: **R3 needs no schema change**, and R7–R9 need
at most one additive column. That is the whole reason Wallet is first.

---

## Page inventory

| Proposal | Route | Adopt (R3) | Complete |
|---|---|---|---|
| `dashboard.html` | `/wallet/dashboard` | PR 2 | R7 |
| `transactions.html` | `/wallet` | PR 1 | R7 (composer, chips) |
| `accounts.html` | `/wallet/accounts` | PR 1 | R8 |
| `shared.html` | `/wallet/shared` | PR 3 | R9 |
| `budgets.html` | `/wallet/budgets` | PR 4 | R8 |
| `goals.html` | `/wallet/goals` | PR 4 | R9 |
| `recurring.html` | `/wallet/recurring` | PR 4 | R9 |
| `reports.html` | `/wallet/reports` | PR 4 | R9 |
| — | `/wallet/import` | entry points move | — |
| — | `/wallet/canonicalize-merchants` | moves to profile menu (D-14) | — |

---

## Two invariants that outrank the mockup

**1. The mockup shows a simpler product than what ships.** `shared.html` draws
balances, a settle-up card and an activity list. What actually exists is partial
settlement, bilateral netting, CAS-guarded concurrent settlement, a claim
lifecycle with a derived state, and a compensating-batch rollback that was
verified by fault injection. **The redesign restyles that; it does not replace
it.** Anyone reading only the mockup will delete safety they cannot see.

Specifically, from CLAUDE.md §6:
- Lifecycle UI groups on a **derived claim state, never on `status`** — a
  claimed-but-unconfirmed split deliberately stays `pending`, and grouping on the
  raw column shows a paid claim as untouched and invites paying it twice.
- Paying implies agreeing; every post-settlement resting state is `approved`.

**2. Never read `t.amount` for anything a user compares.** A split
transaction's effective figure is not its gross. `countableAmount` exists and
the whole dashboard already routes through it (PR #106). Every new card in
R7–R9 must too.

Related open bug, worth closing during R3 PR 1 since the file is open anyway:
**`TransactionList.tsx` day-header totals are unaudited** for this (CLAUDE.md §13
risk 3). The proposal redesigns exactly that row into a `−RM90.60` overlay pill,
so the code is being touched regardless.

**And a third, from PR #101:** a TOTAL is yours alone. `GET /api/accounts`
returns own **plus shared-in** accounts. Sum `ownAccounts` for totals, and make
any "across N accounts" caption count the same set the figure was summed over.
The proposal's net-worth hero is precisely the surface that got this wrong
before — RM100 displayed as RM10,099.
