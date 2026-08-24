import { Link } from 'react-router-dom'
import { formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import { transactionsLink } from './links'
import { useDashboardChartColors } from './chartColors'
import type { CategorySpend } from './insights'

interface CategoryBreakdownProps {
  rows: CategorySpend[]
  /** Same categories over the previous period, for the ghost bar. */
  previous: Map<string, number>
  total: number
  dateFrom: string
  dateTo: string
  className?: string
}

/**
 * Replaces the old pie. Bars rank accurately past three slices, where a pie
 * cannot, and every row is a link into the transactions behind it.
 *
 * The bars are one hue, not one-hue-per-category: colouring each bar by its
 * category would double-encode length as colour and burn the only free channel
 * on information the bar already carries — and user-chosen category colours
 * come with no colour-blindness guarantee. Category colour survives as the chip
 * beside the name, where it identifies without measuring.
 */
export function CategoryBreakdown({
  rows,
  previous,
  total,
  dateFrom,
  dateTo,
  className,
}: CategoryBreakdownProps) {
  const colors = useDashboardChartColors()
  const scale = Math.max(...rows.map((r) => Math.max(r.amount, previous.get(r.id) ?? 0)), 1)

  return (
    <DashboardCard
      className={className}
      title="Where it goes"
      subtitle="The thin bar behind each row is the same category last period."
      action={{ label: 'Transactions', to: transactionsLink({ dateFrom, dateTo }) }}
    >
      <ul className="flex flex-col gap-0.5" data-testid="category-breakdown">
        {rows.map((row) => {
          const prior = previous.get(row.id) ?? 0
          return (
            <li key={row.id} data-testid="category-breakdown-row">
              <Link
                to={transactionsLink({ categoryId: row.id, dateFrom, dateTo })}
                className="grid min-h-[2.25rem] grid-cols-[minmax(5rem,7rem)_minmax(0,1fr)_minmax(4.5rem,auto)] items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 sm:gap-3"
                aria-label={`${row.name}: ${formatMYR(row.amount)} this period, ${formatMYR(
                  prior,
                )} last period. Open transactions.`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {row.color ? (
                    <i
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: row.color }}
                      aria-hidden="true"
                    />
                  ) : (
                    <i
                      className="h-2.5 w-2.5 shrink-0 rounded-sm border border-dashed border-fg-faint"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate text-xs text-fg sm:text-[13px]">{row.name}</span>
                </span>

                <span className="relative h-5">
                  <span
                    className="absolute left-0 top-0 h-1.5 rounded-r"
                    style={{
                      width: `${(prior / scale) * 100}%`,
                      background: colors.ghost,
                    }}
                  />
                  <span
                    className="absolute left-0 top-2.5 h-2.5 rounded-r"
                    style={{
                      width: `${(row.amount / scale) * 100}%`,
                      background: colors.magnitude,
                    }}
                  />
                </span>

                <span className="text-right text-xs font-semibold tabular-nums text-fg">
                  {formatMYR(row.amount)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      <p className="mt-3 border-t border-line-subtle pt-3 text-xs text-fg-subtle">
        Totals to <span className="font-semibold text-fg">{formatMYR(total)}</span> — the same
        figure as the headline, uncategorised included.
      </p>
    </DashboardCard>
  )
}
