import { ChevronUp, ArrowRight, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatMYR } from '@/lib/utils'
import type { WorthALookRow } from '@/modules/wallet/recurring/insights'
import type { RecurringTransaction } from '@/types/wallet.types'

interface WorthALookProps {
  rows: WorthALookRow[]
  onUpdateRule: (rule: RecurringTransaction, newAmount: number) => void
  updatingRuleId: string | null
  onReview: (rule: RecurringTransaction) => void
}

/** "Worth a look" — price rises, a same-day collision, and the costliest-subscription nudge, at most 4 rows (FEAT-068). Never blank. */
export function WorthALook({ rows, onUpdateRule, updatingRuleId, onReview }: WorthALookProps) {
  return (
    <section className="card card-pad c4" data-testid="worth-a-look">
      <div className="card-head">
        <div>
          <div className="card-title">Worth a look</div>
          <div className="card-sub">
            {rows.length === 0 ? 'Nothing the data noticed' : `${rows.length} thing${rows.length === 1 ? '' : 's'} the data noticed`}
          </div>
        </div>
      </div>

      {rows.length === 0 && (
        <p style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }}>Nothing worth a look right now</p>
      )}

      {rows.map((row, i) => {
        if (row.kind === 'priceRise') {
          const { rule, source, newAmount, delta, changedMonth } = row.data
          return (
            <div className="prow" style={{ alignItems: 'flex-start' }} key={`rise-${rule.id}`} data-testid="worth-a-look-row">
              <div className="tavatar" style={{ background: 'rgb(var(--warn-bg))', color: 'rgb(var(--warn-fg))' }}>
                <ChevronUp className="h-3.5 w-3.5" />
              </div>
              <div style={{ minWidth: 0 }}>
                {source === 'a' ? (
                  <>
                    {/* (a) a real charge above the rule — unacknowledged, so it gets the fix-it button. */}
                    <div className="pname">{rule.merchant || '(no merchant)'} charged {formatMYR(newAmount)}</div>
                    <div className="psub">Rule says {formatMYR(newAmount - delta)} · seen in {changedMonth}</div>
                    <Button
                      variant="secondary" size="sm" style={{ marginTop: 'var(--s2)' }}
                      loading={updatingRuleId === rule.id}
                      onClick={() => onUpdateRule(rule, newAmount)}
                    >
                      Update rule
                    </Button>
                  </>
                ) : (
                  <>
                    {/* (b) a rise the user already recorded by editing the rule — informational only. */}
                    <div className="pname">{rule.merchant || '(no merchant)'} went up {formatMYR(delta)}</div>
                    <div className="psub">
                      {formatMYR(newAmount - delta)} → {formatMYR(newAmount)} in {changedMonth}
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        }
        if (row.kind === 'collision') {
          const { day, count, total, beforePayday } = row.data
          const ordinal = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th'
          const label = count === 2 ? 'Two' : count === 3 ? 'Three' : String(count)
          return (
            <div className="prow" style={{ alignItems: 'flex-start' }} key={`collision-${i}`} data-testid="worth-a-look-row">
              <div className="tavatar" style={{ background: 'rgb(var(--info-bg))', color: 'rgb(var(--info-fg))' }}>
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="pname">{label} charges land on the {day}{ordinal}</div>
                <div className="psub">{formatMYR(total)} {beforePayday ? 'the day before payday clears' : 'on the same day'}</div>
              </div>
            </div>
          )
        }
        const { rule, annual, monthly, sinceLabel } = row.data
        return (
          <div className="prow" style={{ alignItems: 'flex-start' }} key="nudge" data-testid="worth-a-look-row">
            <div className="tavatar" style={{ background: 'rgb(var(--surface-sunk))', color: 'rgb(var(--fg-subtle))' }}>
              <Receipt className="h-3.5 w-3.5" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="pname">{rule.merchant || '(no merchant)'} costs {formatMYR(annual)} a year</div>
              <div className="psub">{formatMYR(monthly)}/mo · running since {sinceLabel}</div>
              <Button variant="secondary" size="sm" style={{ marginTop: 'var(--s2)' }} onClick={() => onReview(rule)}>
                Review
              </Button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
