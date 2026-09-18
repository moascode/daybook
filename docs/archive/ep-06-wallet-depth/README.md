> **Status:** Archived · **Last verified:** 2026-09-18

# EP-06 — Wallet depth (partial archive)

Two items from the still-open [EP-06](../../backlog/EP-06-wallet-depth/README.md)
epic, archived here because they had already shipped. **Read for reasoning,
never as instructions** — EP-06 itself is not closed; nine items remain open
in the backlog.

## What shipped

| Item | What it was | How it shipped |
|---|---|---|
| [FEAT-015](FEAT-015-accounts-composition.md) | Accounts: composition breakdown and sparklines | [PR #166/#168](https://github.com/moascode/daybook/pull/168), 2026-09-06 — `BalanceSummary.tsx`, `AccountCard.tsx`, `insights.ts` |
| [FEAT-016](FEAT-016-accounts-networth-chart.md) | Accounts: credit utilisation and 12-month net-worth chart | Same PR — `AccountCard.tsx`, `NetWorthHistoryChart.tsx` |

Both were filed to the backlog 2026-09-16 as "unstarted", ten days after they
had already landed — the exact stale-conversion trap
[`docs/backlog/README.md`](../../backlog/README.md) warns about elsewhere.
Verified against the code and archived 2026-09-18, with the one real gap
found — no e2e spec covered this rendering specifically — closed by
`e2e/87-wallet-accounts-depth.spec.ts`.
