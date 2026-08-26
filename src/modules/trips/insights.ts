/**
 * Pure aggregation for the Trips landing page (R6,
 * docs/v2/trips/02-design-adoption.md). No React, no fetching — same shape as
 * `src/modules/wallet/dashboard/insights.ts` so the arithmetic is reasoned
 * about (and tested) on its own, ahead of the `trips` schema (R12) existing
 * at all.
 *
 * Two rules carried over from the dashboard module apply here too: money
 * always goes through `countableAmount`, never raw `t.amount`, and a total is
 * only ever summed over the viewer's OWN accounts (CLAUDE.md §6 — a shared-in
 * account's spending is not the viewer's to report).
 */
import { countableAmount } from '@/hooks/useWallet'
import type { Account, Category, Transaction } from '@/types/wallet.types'

/** The one seeded travel-ish category (server/seed.ts). Matched by name, not
 *  a dedicated flag — there is no second candidate to disambiguate against. */
export const TRAVEL_CATEGORY_NAME = 'Travel'

export interface TravelSummary {
  /** Spend in the travel category, own accounts, within the period. */
  travelTotal: number
  /** All expense spend, own accounts, within the period — the denominator. */
  totalExpense: number
  /** 0–100; 0 when totalExpense is 0 rather than dividing by zero. */
  pctOfSpend: number
  /** Distinct calendar dates with at least one travel-category expense. */
  daysAway: number
}

/**
 * "Travel as a category of your life" — computed entirely from transactions
 * already in the ledger, no `trips` table required. `txns` should already be
 * scoped to the period the caller wants ("this year"); this function has no
 * opinion on date ranges.
 */
export function travelSummary(
  txns: Transaction[],
  accounts: Account[],
  categories: Category[],
): TravelSummary {
  const ownAccountIds = new Set(accounts.filter((a) => !a.isShared).map((a) => a.id))
  const travelCategoryIds = new Set(
    categories.filter((c) => c.name === TRAVEL_CATEGORY_NAME).map((c) => c.id),
  )

  let travelTotal = 0
  let totalExpense = 0
  const travelDays = new Set<string>()

  for (const t of txns) {
    if (t.type !== 'expense' || !ownAccountIds.has(t.accountId)) continue
    const amount = countableAmount(t)
    totalExpense += amount
    if (t.categoryId && travelCategoryIds.has(t.categoryId)) {
      travelTotal += amount
      travelDays.add(t.date)
    }
  }

  return {
    travelTotal,
    totalExpense,
    pctOfSpend: totalExpense > 0 ? (travelTotal / totalExpense) * 100 : 0,
    daysAway: travelDays.size,
  }
}
