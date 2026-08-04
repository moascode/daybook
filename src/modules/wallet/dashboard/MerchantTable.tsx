import { formatMYR } from '@/lib/utils'
import { DashboardCard } from './DashboardCard'
import { Sparkline } from './Sparkline'
import { useDashboardChartColors } from './chartColors'
import type { MerchantSpend } from './insights'

interface MerchantTableProps {
  rows: MerchantSpend[]
  trendMonths: number
}

/**
 * The merchant list, ranked by total but reporting COUNT alongside it.
 *
 * Total on its own conflates two different problems: one RM 380 flight and
 * forty-two RM 9 rides land in the same place on the list and call for
 * completely different responses. The average column is what separates them,
 * and the small-and-frequent case is the one the old list made invisible.
 */
export function MerchantTable({ rows, trendMonths }: MerchantTableProps) {
  const colors = useDashboardChartColors()

  if (rows.length === 0) {
    return (
      <DashboardCard title="Who you paid" subtitle="Merchants in this period.">
        <p className="py-6 text-center text-sm text-fg-subtle">
          No merchant names on this period’s spending yet.
        </p>
      </DashboardCard>
    )
  }

  return (
    <DashboardCard
      title="Who you paid"
      subtitle="Sorted by total — read the count column too: a small amount paid often is a different problem from one big purchase."
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
              <tr key={row.merchant} className="border-b border-line-subtle last:border-0">
                <td className="py-2.5 pr-3">
                  <span className="font-medium capitalize text-fg">{row.merchant}</span>
                  {row.isNew ? (
                    <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-300">
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
    </DashboardCard>
  )
}
