import { formatMYR } from '@/lib/utils'
import {
  lockedIn, committedChipTone, leftThisMonth, categoryBreakdown, priceRiseStat,
  type PriceRise,
} from '@/modules/wallet/recurring/insights'
import type { Category, RecurringTransaction } from '@/types/wallet.types'

interface RecurringBandProps {
  rules: RecurringTransaction[]
  categories: Category[]
  income: number
  today: string
  monthLabel: string
  priceRises: PriceRise[]
  /** Transaction history hasn't loaded yet OR failed, so matched-charge rises (source a) couldn't be checked — shows '—' instead of 'None'. */
  historyUnavailable: boolean
  /** History load actively FAILED (not just still loading) — shows the "Couldn't check recent charges" foot text. */
  historyFailed: boolean
}

const CHIP_CLASS: Record<'pos' | 'warn' | 'neg', string> = { pos: 'chip-pos', warn: 'chip-warn', neg: 'chip-neg' }

/** "Locked in every month" — committed vs income, a per-category bar, and the Left/Annual/Price-rises stat row (FEAT-068). */
export function RecurringBand({ rules, categories, income, today, monthLabel, priceRises: rises, historyUnavailable, historyFailed }: RecurringBandProps) {
  const locked = lockedIn(rules)
  const pct = income > 0 ? locked / income : null
  const slices = categoryBreakdown(rules, categories)
  const totalSlices = slices.reduce((sum, s) => sum + s.monthly, 0) || 1
  const left = leftThisMonth(rules, today, monthLabel)
  const topCategory = slices[0] ?? null
  const stat = priceRiseStat(rises)

  return (
    <section className="card card-pad c8" data-testid="recurring-band">
      <div className="card-head">
        <div>
          <div className="card-title">Locked in every month</div>
          <div className="card-sub">What leaves before you decide anything</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s3)', flexWrap: 'wrap' }}>
        <div className="money" style={{ fontSize: 'var(--t-2xl)', fontWeight: 680, letterSpacing: '-.03em' }} data-testid="recurring-locked-in">
          {formatMYR(locked)}
        </div>
        {pct !== null && (
          <>
            <span style={{ fontSize: 'var(--t-md)', color: 'rgb(var(--fg-subtle))' }}>of {formatMYR(income)} income</span>
            <span className={`chip ${CHIP_CLASS[committedChipTone(pct)]}`} style={{ marginLeft: 'auto' }} data-testid="recurring-committed-chip">
              {Math.round(pct * 100)}% committed
            </span>
          </>
        )}
      </div>
      <div style={{ display: 'flex', height: 12, borderRadius: 'var(--r-full)', overflow: 'hidden', background: 'rgb(var(--track))', marginTop: 'var(--s4)' }}>
        {slices.map((s) => (
          <div key={s.key} style={{ width: `${(s.monthly / totalSlices) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="grid g4 g-tight-mobile" style={{ gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
        {slices.map((s) => (
          <div key={s.key} className="tag">
            <i style={{ background: s.color }} />{s.label} {formatMYR(s.monthly)}
          </div>
        ))}
      </div>
      <div className="divider" style={{ marginTop: 'auto' }} />
      <div className="grid g3 g-tight-mobile" style={{ gap: 'var(--s4)' }}>
        <div>
          <div className="stat-label">Left this month</div>
          <div className="stat-value money" style={{ fontSize: 'var(--t-lg)' }} data-testid="recurring-left-this-month">
            {formatMYR(left.amount)}
          </div>
          <div className="stat-foot">
            {left.count > 0 ? `${left.count} charge${left.count === 1 ? '' : 's'}, ${left.firstDay}–${left.lastDay} ${left.monthLabel}` : 'Nothing else due this month.'}
          </div>
        </div>
        <div>
          <div className="stat-label">Annual cost</div>
          <div className="stat-value money" style={{ fontSize: 'var(--t-lg)' }} data-testid="recurring-annual-cost">
            {formatMYR(locked * 12)}
          </div>
          <div className="stat-foot">
            {topCategory ? `${topCategory.label} alone: ${formatMYR(topCategory.monthly * 12)}` : '—'}
          </div>
        </div>
        <div>
          <div className="stat-label">Price rises</div>
          <div className="stat-value" style={{ fontSize: 'var(--t-lg)' }} data-testid="recurring-price-rises-count">
            {stat ? stat.count : historyUnavailable ? '—' : 'None'}
          </div>
          <div className="stat-foot">
            {stat && (
              <span className="chip chip-warn">
                +{formatMYR(stat.deltaPerMonth)}/mo since {stat.earliestMonth}
              </span>
            )}
            {historyFailed && (
              <span style={{ display: 'block' }}>Couldn't check recent charges</span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
