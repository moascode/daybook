import { formatMYR } from '@/lib/utils'
import type { CompositionRow } from './insights'

export interface NetWorthChange {
  amount: number
  /** Percent vs. last month's end balance; null when that balance was ~0 (a percent would be meaningless). */
  percent: number | null
  /** "1 September" — the date this month's tracking started from. */
  sinceLabel: string
}

interface BalanceSummaryProps {
  netWorth: number | null
  accountCount: number
  /** Real month-to-date movement — omitted (no chip/line) when there isn't a full prior month of history. */
  netWorthChange: NetWorthChange | null
  composition: CompositionRow[]
}

/**
 * Literal port of the mockup's "Total balance" card — hero figure + change
 * chip and "X% since 1 <Month>" line on the left, a composition bar + legend
 * on the right. Both figures are real: the chip/percent are this month's
 * actual movement (not the mockup's invented "$1,012 · 2.1% since 1 August"),
 * and the composition buckets are our own account types
 * (cash/card/e-wallet/bank/investment/other), not the mockup's fictional
 * Savings/Investments/Cash/Card debt categories.
 */
export function BalanceSummary({ netWorth, accountCount, netWorthChange, composition }: BalanceSummaryProps) {
  const showChange = netWorthChange !== null && Math.abs(netWorthChange.amount) >= 0.005
  return (
    <div className="card card-pad" data-testid="balance-summary">
      <div className="summary">
        <div className="summary-main">
          <div className="eyebrow">Total balance</div>
          <div className="figure money" data-testid="balance-summary-total">
            {netWorth === null ? '…' : formatMYR(netWorth)}
          </div>
          <div className="figure-meta">
            {showChange ? (
              <>
                <span className={`chip ${netWorthChange.amount >= 0 ? 'chip-pos' : 'chip-neg'}`}>
                  {netWorthChange.amount >= 0 ? '↑ ' : '↓ '}
                  {formatMYR(Math.abs(netWorthChange.amount))}
                </span>
                <span>
                  {netWorthChange.percent !== null && `${Math.abs(netWorthChange.percent).toFixed(1)}% `}
                  since {netWorthChange.sinceLabel}
                </span>
              </>
            ) : (
              <span>
                across {accountCount} account{accountCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {composition.length > 0 && (
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="u-label" style={{ marginBottom: 'var(--s2)' }}>Composition</div>
            <div
              style={{
                display: 'flex',
                height: 10,
                borderRadius: 'var(--r-full)',
                overflow: 'hidden',
                background: 'rgb(var(--track))',
              }}
            >
              {composition.map((row) => (
                <div
                  key={row.type}
                  style={{ width: `${row.share}%`, background: `rgb(var(${row.colorVar}))` }}
                />
              ))}
            </div>
            <div className="grid g2" style={{ gap: 'var(--s2) var(--s4)', marginTop: 'var(--s3)' }}>
              {composition.map((row) => (
                <div
                  key={row.type}
                  style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 'var(--s1) var(--s2)', fontSize: 'var(--t-sm)' }}
                >
                  <span className="tag">
                    <i style={{ background: `rgb(var(${row.colorVar}))` }} />
                    {row.label}
                  </span>
                  <span className="money" style={{ fontWeight: 550 }}>
                    {row.amount < 0 ? '−' : ''}
                    {formatMYR(Math.abs(row.amount))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
