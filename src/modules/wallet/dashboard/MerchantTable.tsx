import { formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import { Sparkline } from './Sparkline'
import { useDashboardChartColors } from './chartColors'
import { transactionsLink } from './links'
import type { MerchantSpend } from './insights'

interface MerchantTableProps {
  rows: MerchantSpend[]
  trendMonths: number
  /** Period bounds for the "All merchants" action link. Omit either to skip the link. */
  dateFrom?: string
  dateTo?: string
  className?: string
}

/** A single visit isn't a "frequent, easy to miss" pattern. */
const MIN_FREQUENT_COUNT = 2

/**
 * The highest-count merchant that ISN'T already #1 by total.
 *
 * The #1-by-total row is already obviously visible at the top of the table —
 * there's nothing to reveal about it. What's easy to miss is the merchant
 * that never shows up as a big single transaction but adds up through sheer
 * frequency.
 */
function findFrequentButSmallCandidate(rows: MerchantSpend[]): MerchantSpend | null {
  if (rows.length < 2) return null
  const candidate = rows.slice(1).reduce<MerchantSpend | null>(
    (best, r) => (r.count > (best?.count ?? 0) ? r : best),
    null,
  )
  if (!candidate || candidate.count < MIN_FREQUENT_COUNT) return null
  return candidate
}

/**
 * The merchant list, ranked by total but reporting COUNT alongside it.
 *
 * Total on its own conflates two different problems: one RM 380 flight and
 * forty-two RM 9 rides land in the same place on the list and call for
 * completely different responses. The average column is what separates them,
 * and the small-and-frequent case is the one the old list made invisible.
 */
export function MerchantTable({ rows, trendMonths, dateFrom, dateTo, className }: MerchantTableProps) {
  const colors = useDashboardChartColors()

  if (rows.length === 0) {
    return (
      <DashboardCard title="Who you paid" subtitle="Merchants in this period." className={className}>
        <p className="py-6 text-center text-sm text-fg-subtle">
          No merchant names on this period’s spending yet.
        </p>
      </DashboardCard>
    )
  }

  const candidate = findFrequentButSmallCandidate(rows)

  return (
    <DashboardCard
      title="Who you paid"
      subtitle="Sorted by total — read the count column too: a small amount paid often is a different problem from one big purchase."
      action={dateFrom && dateTo ? { label: 'All merchants', to: transactionsLink({ dateFrom, dateTo }) } : undefined}
      className={className}
    >
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[30rem] text-[13px]" data-testid="merchant-table">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="pb-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                Merchant
              </th>
              <th scope="col" className="pb-2 pr-3 text-right text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                Total
              </th>
              <th scope="col" className="pb-2 pr-3 text-right text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                Times
              </th>
              <th scope="col" className="pb-2 pr-3 text-right text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                Average
              </th>
              <th scope="col" className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                Last {trendMonths} months
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((row) => (
              <tr key={row.merchant} data-testid="merchant-table-row" className="border-b border-line-subtle last:border-0">
                <td className="py-2.5 pr-3">
                  <span className="font-medium capitalize text-fg">{row.merchant}</span>
                  {row.isNew ? (
                    <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      new
                    </span>
                  ) : row.isRegular ? (
                    <span className="ml-2 rounded-full border border-line bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                      every month
                    </span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-3 text-right font-medium tabular-nums text-fg-muted">
                  {formatMYR(row.total)}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-fg-muted">{row.count}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-fg-muted">
                  {formatMYR(row.average)}
                </td>
                <td className="py-2.5">
                  <Sparkline values={row.trend} color={colors.magnitude} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {candidate && (
        <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-fg">
          <span className="font-semibold capitalize">{candidate.merchant}</span>: {candidate.count} visits,{' '}
          {formatMYR(candidate.average)} each, {formatMYR(candidate.total)} this period. It never shows up as a
          big transaction, which is exactly why it’s easy to miss.
        </p>
      )}
    </DashboardCard>
  )
}
