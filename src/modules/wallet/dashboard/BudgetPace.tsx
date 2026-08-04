import { formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import type { Budget, Category } from '@/types/wallet.types'

interface BudgetPaceProps {
  budgets: Budget[]
  spending: Map<string, number>
  categories: Category[]
  /** Fraction of the period elapsed, 0–1. */
  elapsed: number
  /** Human wording for the notch, e.g. "day 18 of 31". */
  elapsedLabel: string
}

/**
 * Budget meters with a pace notch.
 *
 * The notch is the whole point: 80% spent is comfortable on day 25 and alarming
 * on day 10, and a bare percentage bar cannot tell you which one you are looking
 * at. Colour follows position against the notch, not against 100%.
 */
export function BudgetPace({ budgets, spending, categories, elapsed, elapsedLabel }: BudgetPaceProps) {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const rows = budgets
    .map((b) => {
      const spent = spending.get(b.categoryId) ?? 0
      return {
        id: b.id,
        name: byId.get(b.categoryId)?.name ?? 'Deleted category',
        spent,
        limit: b.limitAmount,
        ratio: b.limitAmount > 0 ? spent / b.limitAmount : 0,
      }
    })
    .sort((a, b) => b.ratio - a.ratio)

  if (rows.length === 0) {
    return (
      <DashboardCard
        title="Budgets"
        subtitle="Set a monthly limit on a category to track it here."
        action={{ label: 'Manage', to: '/wallet/budgets' }}
      >
        <p className="py-6 text-center text-sm text-fg-subtle">No budgets set yet.</p>
      </DashboardCard>
    )
  }

  return (
    <DashboardCard
      title="Budgets"
      subtitle={`The notch is where you should be at ${elapsedLabel} — ${Math.round(elapsed * 100)}% of the month.`}
      action={{ label: 'Manage', to: '/wallet/budgets' }}
    >
      <div data-testid="budget-pace">
        {rows.map((row) => {
          const over = row.ratio > 1
          // "Ahead of pace" needs a margin, or every budget flickers into a
          // warning the moment it is a rounding error past the notch.
          const ahead = !over && row.ratio > elapsed + 0.08
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
                aria-label={`${row.name}: ${Math.round(row.ratio * 100)}% of budget used, ${Math.round(
                  elapsed * 100,
                )}% of the month elapsed — ${state}.`}
              >
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${fill}`}
                  style={{ width: `${Math.min(100, row.ratio * 100)}%` }}
                />
                <div
                  className="absolute -top-0.5 bottom-[-0.125rem] w-0.5 rounded-full bg-fg-muted opacity-60"
                  style={{ left: `${Math.min(100, elapsed * 100)}%` }}
                  aria-hidden="true"
                />
              </div>
              <p className="mt-1 text-[11px] text-fg-subtle">
                {Math.round(row.ratio * 100)}% used · {Math.round(elapsed * 100)}% of the month gone ·{' '}
                {state}
              </p>
            </div>
          )
        })}
      </div>
    </DashboardCard>
  )
}
