import { format, parseISO } from 'date-fns'
import { formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import type { Budget, Category } from '@/types/wallet.types'

interface BudgetPaceProps {
  budgets: Budget[]
  spending: Map<string, number>
  categories: Category[]
  /** Fraction of the period elapsed, 0–1. Ignored when `showPaceNotch` is false. */
  elapsed: number
  /** The day-of-month the notch sits on, e.g. 17. Ignored when `showPaceNotch` is false. */
  day?: number
  /** ISO date the period started on — used to project a run-out date. */
  periodStart?: string
  /**
   * False for any period that isn't a single calendar month — "day 17" has no
   * meaning across a 3-month or custom range. Limits are still monthly, so
   * `limitMultiplier` scales them to the period instead, and the meter drops
   * to a plain used/limit bar with no notch.
   */
  showPaceNotch?: boolean
  /** How many calendar months the period spans; each budget's limit is multiplied by this. */
  limitMultiplier?: number
  className?: string
}

/** A budget must be at least this far ahead of pace before it counts as "over pace" — a rounding error past the notch is normal noise. */
const AHEAD_OF_PACE_THRESHOLD = 0.08

/**
 * Budget meters with a pace notch — the mockup's literal `.budget` rows: a
 * name/value line, a track with a coloured fill and a notch mark, nothing
 * else per row. Colour follows position against the notch, not against 100%:
 * red once over the limit, amber once ahead of pace, green otherwise.
 */
export function BudgetPace({
  budgets,
  spending,
  categories,
  elapsed,
  day,
  periodStart,
  showPaceNotch = true,
  limitMultiplier = 1,
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

  const overPace = showPaceNotch
    ? rows.filter((r) => r.ratio <= 1 && r.ratio > elapsed + AHEAD_OF_PACE_THRESHOLD || r.ratio > 1)
    : []

  // The worst offender projects a "runs out ~<date>" callout — the mockup's
  // one-line footer, not a paragraph of numbers.
  const runOutCallout =
    showPaceNotch && periodStart && elapsed > 0 && overPace.length > 0
      ? (() => {
          const worst = overPace.reduce((a, b) => (b.ratio > a.ratio ? b : a))
          if (worst.spent <= 0) return null
          const daysToExhaust = Math.round((worst.limit / worst.spent) * elapsed * 30)
          const runOutDate = format(
            new Date(parseISO(periodStart).getTime() + daysToExhaust * 86_400_000),
            'd MMM',
          )
          return `${worst.name} runs out ~${runOutDate}.`
        })()
      : null

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
      title="Budget pace"
      subtitle={
        showPaceNotch
          ? `The line marks where you should be on day ${day}.`
          : limitMultiplier > 1
            ? `Each limit is scaled to ${limitMultiplier} months for this period.`
            : 'This month’s limits against what you’ve spent.'
      }
    >
      <div data-testid="budget-pace">
        {rows.map((row) => {
          const over = row.ratio > 1
          const ahead = showPaceNotch && !over && row.ratio > elapsed + AHEAD_OF_PACE_THRESHOLD
          const fill = over ? 'bg-neg' : ahead ? 'bg-warn' : 'bg-pos'

          return (
            <div key={row.id} className="budget">
              <div className="brow-top">
                <span className="brow-name">{row.name}</span>
                <span className="brow-val">
                  {formatMYR(row.spent)} of {formatMYR(row.limit)}
                </span>
              </div>
              <div
                className="budget-track"
                role="img"
                aria-label={
                  `${row.name}: ${Math.round(row.ratio * 100)}% of budget used` +
                  (showPaceNotch ? `, ${Math.round(elapsed * 100)}% of the month elapsed` : '') +
                  (over ? ' — over limit.' : ahead ? ' — ahead of pace.' : ' — on track.')
                }
              >
                <div className={`budget-fill ${fill}`} style={{ width: `${Math.min(100, row.ratio * 100)}%` }} />
                {showPaceNotch && (
                  <div className="budget-mark" style={{ left: `${Math.min(100, elapsed * 100)}%` }} />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {showPaceNotch && overPace.length > 0 && (
        <>
          <div className="divider" style={{ marginTop: 'auto' }} />
          <div className="flex items-center gap-2 text-sm text-fg-subtle">
            <span className="chip chip-neg">{overPace.length} over pace</span>
            {runOutCallout && <span>{runOutCallout}</span>}
          </div>
        </>
      )}
    </DashboardCard>
  )
}
