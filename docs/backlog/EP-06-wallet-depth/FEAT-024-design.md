> **Status:** Plan · **Last verified:** 2026-10-11 · **Item:** [FEAT-024](FEAT-024-shared-minimum-transfers.md)

# FEAT-024 — Group-wide minimum transfers: design

## The problem the item does not state

`POST /settlements` is **bilateral by construction**. It discharges
`transaction_splits` rows between one debtor and one creditor, and every
column of `settlements` (`from_user`, `to_user`, the four leg ids) names a pair.

A minimum-transfer plan routinely proposes a payment between two people who
share **no** splits. With A owing B RM40 and B owing C RM40, the plan is one
transfer, A → C. There is no claim between A and C for that payment to clear —
the money has to discharge **A→B and B→C at once**, and B's books move although
B neither paid nor received anything.

So FEAT-024 is two things, and only the first is cheap:

1. **The plan** — pure maths over balances that already exist.
2. **Executing an off-graph transfer** — a settlement that touches three or more
   people's books atomically, on top of the CAS-guarded path (CLAUDE.md §3).

> **Value today.** The household has two members. For two people the minimum
> plan *is* the existing bilateral net, so nothing here changes what kakon or
> tumpa see until a group has a third member.

## 1 · The algorithm (`worker/lib/min-transfers.ts`, pure)

Input: each member's **net position** in integer cents, derived from the same
query `GET /groups/:id/balances` runs (payable splits only — `pending`,
`approved`; anything in an `awaiting_confirmation` settlement is excluded, as
`outstandingSplitsFor` already does). Positions sum to zero by construction;
the function asserts it and throws on violation rather than emitting a plan that
cannot balance.

- **Exact for n ≤ 12.** Minimum transfers = `n − k`, where `k` is the largest
  number of disjoint zero-sum subgroups. Bitmask DP over subsets: `O(2ⁿ·n)`,
  ~50k steps at n = 12. Each subgroup is then settled greedily inside itself
  (largest debtor → largest creditor), which is optimal within a zero-sum group.
- **Greedy above 12**, guaranteed ≤ n − 1 transfers. Documented as approximate.
- **Tie-break toward existing edges.** Among equal-length plans, prefer the one
  whose transfers coincide with an existing net-debt pair (debtor already owes
  that creditor ≥ the amount). Those transfers execute through the **unchanged**
  bilateral `POST /settlements`; only the remainder need §3 below.
- Integer cents throughout — no `cents()` rounding inside the loop.

Unit tests (`node:test`, wired into `npm run test:unit`): empty / all-zero;
two people (== bilateral net); A→B→C chain collapses to one transfer; a cycle
A→B→C→A of equal amounts → zero transfers; two independent zero-sum pairs
inside a group of four → 2, not 3; positions not summing to zero → throws;
sub-cent residue; tie-break picks the on-graph edge; n = 13 uses greedy and
stays ≤ n − 1; property test — for random positions, applying the plan zeroes
every position.

## 2 · Showing the plan (read-only)

`GET /groups/:id/settle-plan` → `{ transfers: [{ fromUserId, toUserId, amount,
direct: boolean }] }`. `direct` = executable by the existing endpoint.

Shared page: a **"Settle the group"** card, rendered only when the plan has
**fewer** transfers than the current pairwise list (so it never appears for two
people). Each `direct` transfer's button opens the existing `SettleUpDialog`
for that pair. Non-direct transfers show their button disabled with the reason
in text until §3 ships — never a button that does nothing (rule 10).

## 3 · Executing an off-graph transfer — the three-party settlement

### Accounting: it is the existing netting, generalised

Clearing a set of debt edges with a set of cash transfers, each person P has
`O` (debt discharged), `I` (receivable discharged), `c_out`, `c_in`, with
`O − I = c_out − c_in`. P books exactly what the bilateral path books today:

| Leg | Amount | Flags | Bilateral equivalent |
|---|---|---|---|
| cash expense | `c_out` | — | debtor's cash leg |
| cash income | `c_in` | `is_balance_only` | creditor's receipt |
| netted expense | `O − c_out` | `is_non_cash` | the `offset` leg |

In the A→B→C example, B books a RM40 non-cash netted expense — the same leg B
would book if A and B owed each other. No new transaction shape, no new
`countableAmount` rule.

### Write set (one `batch()`, hand-built like §3 of CLAUDE.md demands)

1. Hoist every read: each discharged edge's `outstandingSplitsFor`, FIFO
   `allocate` per edge, each party's account and category.
2. Compute all split updates, all legs, all rows in JS.
3. One `batch()`: every split update **CAS-guarded on the exact
   `settled_amount` read** (same statement shape as today, including
   `status = approved` on partial — paying implies agreeing), then legs, then
   settlement rows, then `settlement_split_lines`.
4. Inspect `meta.changes` for every CAS; any 0 → compensate **every** survivor
   across all edges, delete all legs and rows, return 409. Fault-injected e2e,
   same as the bilateral path was.

### Consent

Today one party can never move the other's ledger without confirming. A chain
touches **every** party on it. Proposed: the initiator records the chain as
`awaiting_confirmation`; each other party on the chain confirms (picking their
own account, as `/confirm` does today); the **last** confirmation executes the
batch above. Before that, only a no-op probe CAS runs — exactly the debtor-claim
shape that exists now. Any party's reject releases everything.

### Undo

Whole chain only, by any party, within `UNDO_WINDOW_DAYS`. Partial undo of a
chain would leave B's netted leg balancing debts that are open again.

### Schema (needs sign-off — CLAUDE.md rule 3)

Additive only. One settlement row per discharged edge keeps every existing
reader (history, undo, the Shared activity feed) working on pairs. They are
grouped by:

```sql
-- 0028_settlement_chains.sql
CREATE TABLE settlement_chains (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'awaiting_confirmation',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE settlement_chain_parties (
  chain_id     TEXT NOT NULL REFERENCES settlement_chains(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  confirmed_at TEXT,
  PRIMARY KEY (chain_id, user_id)
);
ALTER TABLE settlements ADD COLUMN chain_id TEXT REFERENCES settlement_chains(id);
```

`server/` gets the mirror for schema-diff parity only.

## Delivery — three PRs

| PR | Contents | Risk |
|---|---|---|
| A | `min-transfers.ts` + unit tests. No wiring. | none |
| B | `settle-plan` endpoint + Shared card; direct transfers only | read-only |
| C | migration + chain create/confirm/reject/undo + e2e incl. fault injection | the CAS path |

## Decisions (owner, 2026-10-11)

1. **Consent — every party on the chain confirms**, as proposed in §3. Each
   picks their own account; any reject releases the chain. (Initiator + payee
   only was considered and dropped: it would let a chain discharge an
   intermediary's unreviewed claims and book a leg on an account they never
   chose.)
2. **Schema — approved** as above.
3. **Build A, B and C** — FEAT-024 ships complete.
