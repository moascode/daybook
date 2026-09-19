import type { Budget, Category } from '@/types/wallet.types'

/**
 * The suggestions engine (FEAT-018, EP-06 R8) — Budgets' reason to exist per
 * design.md: "the most-used judgement in budgeting is 'this number is
 * wrong' — the data to say so already exists." Pure functions only, the way
 * `dashboard/insights.ts` already is: every rule takes the month-by-month
 * spend history the caller already fetched and returns data, never touches
 * `fetch` or React state itself.
 */

/** Spend per category, keyed by 'YYYY-MM' — `getBudgetSpendingHistory`'s shape (useWallet.ts). */
export type CategorySpendHistory = Map<string, Map<string, number>>

export interface ReallocateSuggestion {
  type: 'reallocate'
  fromCategoryId: string
  fromCategoryName: string
  toCategoryId: string
  toCategoryName: string
  /** How much to move, in MYR — capped by both the donor's real slack and the receiver's real overage. */
  amount: number
  /** The donor's average usage over the consistency window, e.g. 45 for "run at 45%". */
  fromAvgPct: number
  lookbackMonths: number
}

export interface RightSizeSuggestion {
  type: 'right-size'
  categoryId: string
  categoryName: string
  currentLimit: number
  /** The average of actual spend over the consistency window — always higher than currentLimit; this rule only ever raises. */
  suggestedLimit: number
  lookbackMonths: number
}

export interface CreateMissingSuggestion {
  type: 'create-missing'
  categoryId: string
  categoryName: string
  /** Average spend over however many of the lookback months have any data. */
  avgMonthlySpend: number
  lookbackMonths: number
}

export type BudgetSuggestion = ReallocateSuggestion | RightSizeSuggestion | CreateMissingSuggestion

/** How many of the most recent months count as "consistent" — matches design.md's own examples ("run at 45% for three months"). */
const CONSISTENCY_WINDOW = 3

/** A budget averaging at or below this usage over the window is real, spare capacity — not just one quiet month. */
const UNDERUSE_THRESHOLD = 0.6

/** A right-size candidate must be over its limit in at least this many of the window's months — one spike shouldn't rewrite the limit. */
const RIGHT_SIZE_MIN_OVER_MONTHS = 2

/** Below this, a missing budget is noise — a RM3/month category doesn't need tracking. */
const CREATE_MISSING_MIN_SPEND = 20

/** Every month present anywhere in a history, oldest first, sorted lexicographically (safe for 'YYYY-MM'). */
function allMonths(history: CategorySpendHistory): string[] {
  const all = new Set<string>()
  for (const byMonth of history.values()) for (const month of byMonth.keys()) all.add(month)
  return [...all].sort()
}

/** The most recent `count` months present in a history, oldest first. */
function recentMonths(history: CategorySpendHistory, count: number): string[] {
  return allMonths(history).slice(-count)
}

function spendIn(history: CategorySpendHistory, categoryId: string, month: string): number {
  return history.get(categoryId)?.get(month) ?? 0
}

/**
 * Reallocate: a budget that has run consistently under-used for
 * `CONSISTENCY_WINDOW` months is real slack, moved to whichever OTHER budget
 * is over its limit this month by the largest amount. Right-size candidates
 * are excluded as receivers — a chronically-too-low limit needs raising, not
 * a one-off top-up that recurs every month forever.
 */
function reallocateSuggestions(
  budgets: Budget[],
  categoryName: Map<string, string>,
  history: CategorySpendHistory,
  window: string[],
  excludeAsReceiver: Set<string>,
): ReallocateSuggestion[] {
  if (window.length < CONSISTENCY_WINDOW) return []
  const currentMonth = window[window.length - 1]

  const donors = budgets
    .filter((b) => b.limitAmount > 0)
    .map((b) => {
      const ratios = window.map((m) => spendIn(history, b.categoryId, m) / b.limitAmount)
      const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length
      return { budget: b, avgRatio, slack: Math.round(b.limitAmount * (1 - avgRatio)) }
    })
    .filter((d) => d.avgRatio <= UNDERUSE_THRESHOLD && d.slack > 0)
    .sort((a, b) => b.slack - a.slack)

  const receivers = budgets
    .filter((b) => b.limitAmount > 0 && !excludeAsReceiver.has(b.categoryId))
    .map((b) => ({ budget: b, overage: Math.round(spendIn(history, b.categoryId, currentMonth) - b.limitAmount) }))
    .filter((r) => r.overage > 0)
    .sort((a, b) => b.overage - a.overage)

  const usedReceivers = new Set<string>()
  const suggestions: ReallocateSuggestion[] = []
  for (const donor of donors) {
    const receiver = receivers.find((r) => r.budget.categoryId !== donor.budget.categoryId && !usedReceivers.has(r.budget.categoryId))
    if (!receiver) continue
    usedReceivers.add(receiver.budget.categoryId)
    suggestions.push({
      type: 'reallocate',
      fromCategoryId: donor.budget.categoryId,
      fromCategoryName: categoryName.get(donor.budget.categoryId) ?? 'Unknown',
      toCategoryId: receiver.budget.categoryId,
      toCategoryName: categoryName.get(receiver.budget.categoryId) ?? 'Unknown',
      amount: Math.min(donor.slack, receiver.overage),
      fromAvgPct: Math.round(donor.avgRatio * 100),
      lookbackMonths: CONSISTENCY_WINDOW,
    })
  }
  return suggestions
}

/**
 * Right-size: a budget over its limit in at least `RIGHT_SIZE_MIN_OVER_MONTHS`
 * of the last `CONSISTENCY_WINDOW` months — the limit is the thing that's
 * wrong, not the spending. Suggests raising it to what's actually spent
 * (the window's average), never lowering — a category that's under isn't
 * "wrong", it's slack (reallocateSuggestions' job).
 */
function rightSizeSuggestions(
  budgets: Budget[],
  categoryName: Map<string, string>,
  history: CategorySpendHistory,
  window: string[],
): RightSizeSuggestion[] {
  if (window.length < CONSISTENCY_WINDOW) return []
  const suggestions: RightSizeSuggestion[] = []
  for (const b of budgets) {
    if (b.limitAmount <= 0) continue
    const spends = window.map((m) => spendIn(history, b.categoryId, m))
    const overMonths = spends.filter((s) => s > b.limitAmount).length
    if (overMonths < RIGHT_SIZE_MIN_OVER_MONTHS) continue
    const avgSpend = spends.reduce((s, v) => s + v, 0) / spends.length
    if (avgSpend <= b.limitAmount) continue
    suggestions.push({
      type: 'right-size',
      categoryId: b.categoryId,
      categoryName: categoryName.get(b.categoryId) ?? 'Unknown',
      currentLimit: b.limitAmount,
      suggestedLimit: Math.round(avgSpend),
      lookbackMonths: CONSISTENCY_WINDOW,
    })
  }
  return suggestions
}

/**
 * Create-missing: a category with real spend but no budget at all. Averaged
 * over however many of the lookback months actually have data — a category
 * first used last month still gets a suggestion from that one month, rather
 * than being diluted toward zero by months before it existed.
 */
function createMissingSuggestions(
  categories: Category[],
  budgetedCategoryIds: Set<string>,
  history: CategorySpendHistory,
  window: string[],
): CreateMissingSuggestion[] {
  const suggestions: CreateMissingSuggestion[] = []
  for (const cat of categories) {
    if (cat.type === 'income') continue
    if (budgetedCategoryIds.has(cat.id)) continue
    const spends = window.map((m) => spendIn(history, cat.id, m)).filter((s) => s > 0)
    if (spends.length === 0) continue
    const avgSpend = spends.reduce((s, v) => s + v, 0) / spends.length
    if (avgSpend < CREATE_MISSING_MIN_SPEND) continue
    suggestions.push({
      type: 'create-missing',
      categoryId: cat.id,
      categoryName: cat.name,
      avgMonthlySpend: Math.round(avgSpend),
      lookbackMonths: window.length,
    })
  }
  return suggestions
}

/** Every suggestion Budgets can currently generate, in the order design.md lists them: reallocate, right-size, create-missing. */
export function generateBudgetSuggestions(
  budgets: Budget[],
  categories: Category[],
  history: CategorySpendHistory,
): BudgetSuggestion[] {
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const window = recentMonths(history, CONSISTENCY_WINDOW)
  const rightSize = rightSizeSuggestions(budgets, categoryName, history, window)
  const excludeAsReceiver = new Set(rightSize.map((r) => r.categoryId))
  const reallocate = reallocateSuggestions(budgets, categoryName, history, window, excludeAsReceiver)
  const budgetedCategoryIds = new Set(budgets.map((b) => b.categoryId))
  // Uses the FULL fetched history, not the 3-month consistency window above —
  // more months of data means a steadier average for a brand-new suggestion.
  const createMissing = createMissingSuggestions(categories, budgetedCategoryIds, history, allMonths(history))
  return [...reallocate, ...rightSize, ...createMissing]
}
