import { formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import type { Budget, Category } from '@/types/wallet.types'

interface BudgetPaceProps {
  budgets: Budget[]
  spending: Map<string, number>
  categories: Category[]
  /** Fraction of the period elapsed, 0–1. Ignored when `showPaceNotch` is false. */
  elapsed: number
  /** Human wording for the notch, e.g. "day 18 of 31". Ignored when `showPaceNotch` is false. */
  elapsedLabel: string
  /**
   * False for any period that isn't a single calendar month — "day 18 of 31"
   * has no meaning across a 3-month or custom range. Limits are still monthly,
   * so `limitMultiplier` scales them to the period instead, and the meter
   * drops to a plain used/limit bar with no notch and no "ahead of pace" state.
   */
  showPaceNotch?: boolean
  /** How many calendar months the period spans; each budget's limit is multiplied by this. */
  limitMultiplier?: number
  /** Days left in the period. Only meaningful — and only supplied — alongside `showPaceNotch`. */
  daysLeft?: number
  className?: string
}

/** A budget must be at least this far ahead of pace before the callout calls it out — a few points over the notch is normal noise, not a warning. */
const AHEAD_OF_PACE_CALLOUT_THRESHOLD = 0.05

function buildPaceCallout(
  rows: { name: string; spent: number; limit: number; ratio: number }[],
  elapsed: number,
  daysLeft: number,
): string | null {
  if (rows.length === 0 || elapsed <= 0 || elapsed >= 1) return null
  const worst = rows.reduce((a, b) => (b.ratio - elapsed > a.ratio - elapsed ? b : a))
  if (worst.ratio - elapsed < AHEAD_OF_PACE_CALLOUT_THRESHOLD) return null

  const projected = worst.spent / elapsed
  return (
    `${worst.name} is at ${Math.round(worst.ratio * 100)}% with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left. ` +
    `On this pace it ends at ${formatMYR(projected)} against a ${formatMYR(worst.limit)} limit.`
  )
}

/**
 * Budget meters with a pace notch.
 *
 * The notch is the whole point: 80% spent is comfortable on day 25 and alarming
 * on day 10, and a bare percentage bar cannot tell you which one you are looking
 * at. Colour follows position against the notch, not against 100%.
 */
export function BudgetPace({
  budgets,
  spending,
  categories,
  elapsed,
  elapsedLabel,
  showPaceNotch = true,
  limitMultiplier = 1,
  daysLeft,
  className,
}: BudgetPaceProps) {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const rows = budgets
    .map((b) => {
      const spent = spending.get(b.categoryId) ?? 0
      const limit = b.limitAmount * limitMultiplier
      return {
        id: b.id,
        name: byId.get(b.categoryId)?.name ?? 'Deleted category',
        spent,
        limit,
        ratio: limit > 0 ? spent / limit : 0,
      }
    })
    .sort((a, b) => b.ratio - a.ratio)
  const callout =
    showPaceNotch && daysLeft !== undefined ? buildPaceCallout(rows, elapsed, daysLeft) : null

  if (rows.length === 0) {
    return (
      <DashboardCard
        className={className}
        title="Budget pace"
        subtitle="Set a monthly limit on a category to track it here."
        action={{ label: 'Manage', to: '/wallet/budgets' }}
      >
        <p className="py-6 text-center text-sm text-fg-subtle">No budgets set yet.</p>
      </DashboardCard>
    )
  }

  return (
    <DashboardCard
      className={className}
      title="Budgets"
      subtitle={
        showPaceNotch
          ? `The notch is where you should be at ${elapsedLabel} — ${Math.round(elapsed * 100)}% of the month.`
          : limitMultiplier > 1
            ? `Each limit is scaled to ${limitMultiplier} months for this period.`
            : 'This month’s limits against what you’ve spent.'
      }
      action={{ label: 'Manage', to: '/wallet/budgets' }}
    >
      <div data-testid="budget-pace">
        {rows.map((row) => {
          const over = row.ratio > 1
          // "Ahead of pace" needs a margin, or every budget flickers into a
          // warning the moment it is a rounding error past the notch.
          const ahead = showPaceNotch && !over && row.ratio > elapsed + 0.08
          const fill = over ? 'bg-red-500' : ahead ? 'bg-amber-500' : 'bg-brand-500'
          const state = over ? 'over limit' : ahead ? 'ahead of pace' : 'on track'

          return (
            <div key={row.id} className="border-t border-line-subtle py-2.5 first:border-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-medium text-fg">{row.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">
                  {formatMYR(row.spent)} of {formatMYR(row.limit)}
                </span>
              </div>
              <div
                className="relative mt-1.5 h-2 rounded-full bg-surface-hover"
                role="img"
                aria-label={
                  `${row.name}: ${Math.round(row.ratio * 100)}% of budget used` +
                  (showPaceNotch ? `, ${Math.round(elapsed * 100)}% of the month elapsed` : '') +
                  ` — ${state}.`
                }
              >
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${fill}`}
                  style={{ width: `${Math.min(100, row.ratio * 100)}%` }}
                />
                {showPaceNotch && (
                  <div
                    className="absolute -top-0.5 bottom-[-0.125rem] w-0.5 rounded-full bg-fg-muted opacity-60"
                    style={{ left: `${Math.min(100, elapsed * 100)}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
              <p className="mt-1 text-[11px] text-fg-subtle">
                {Math.round(row.ratio * 100)}% used
                {showPaceNotch ? ` · ${Math.round(elapsed * 100)}% of the month gone` : ''} · {state}
              </p>
            </div>
          )
        })}
      </div>

      {callout && (
        <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-fg">
          {callout}
        </p>
      )}
    </DashboardCard>
  )
}
