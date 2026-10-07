import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { formatMYR } from '@/lib/utils'
import { useIsMobile } from '@/modules/wallet/reports/useIsMobile'
import { formatSignedMYR, type CashFlowRow } from '@/modules/wallet/reports/insights'

interface CashFlowTableProps {
  rows: CashFlowRow[]
  anchorMonth: string
  totalKept: number
  monthCount: number
}

export function CashFlowTable({ rows, anchorMonth, totalKept, monthCount }: CashFlowTableProps) {
  // Owner call: on a phone the four money-wide columns don't fit, so In is
  // dropped and Out/Kept stay in view (Kept = In − Out is the figure that matters).
  const isMobile = useIsMobile()
  return (
    <section className="card card-pad c5" data-testid="cash-flow">
      <div className="card-head">
        <div className="card-title">Cash flow</div>
        <Link className="section-action" to="/wallet/transactions">
          Full ledger <ChevronRight className="icon-sm" />
        </Link>
      </div>
      <div>
        <table>
          <thead>
            <tr><th>Month</th>{!isMobile && <th className="num">In</th>}<th className="num">Out</th><th className="num">Kept</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month}>
                <td>{row.monthLabel}</td>
                {!isMobile && <td className="num money">{formatMYR(row.income)}</td>}
                <td className="num money">{formatMYR(row.expense)}</td>
                <td
                  className="num money"
                  style={{
                    fontWeight: 600,
                    color: row.month === anchorMonth ? 'rgb(var(--pos-fg))' : row.kept < 0 ? 'rgb(var(--neg-fg))' : undefined,
                  }}
                >
                  {formatMYR(row.kept)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divider" style={{ marginTop: 'auto' }} />
      <div className="kv" style={{ border: 'none', paddingTop: 0 }}>
        <span className="k">{monthCount}-month total kept</span>
        <span className="v" style={{ color: totalKept >= 0 ? 'rgb(var(--pos-fg))' : 'rgb(var(--neg-fg))' }} data-testid="cash-flow-total">
          {formatSignedMYR(totalKept, false)}
        </span>
      </div>
    </section>
  )
}
