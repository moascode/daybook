import { formatMYR } from '@/lib/utils'
import { useIsMobile } from '@/modules/wallet/reports/useIsMobile'
import type { CategoryTrendRow, TrendMeasure } from '@/modules/wallet/reports/insights'

interface CategoryTrendsProps {
  hasEnoughHistory: boolean
  rows: CategoryTrendRow[]
  measure: TrendMeasure
  onMeasureChange: (measure: TrendMeasure) => void
  windowLabel: string
  monthCount: number
}

const ROW_COLUMNS = '180px 1fr 100px 100px 100px'
export function CategoryTrends({ hasEnoughHistory, rows, measure, onMeasureChange, windowLabel, monthCount }: CategoryTrendsProps) {
  const isMobile = useIsMobile()
  const rowColumns = isMobile ? 'minmax(0,1fr) auto auto' : ROW_COLUMNS
  return (
    <section className="card card-pad c12" data-testid="category-trends">
      <div className="card-head">
        <div>
          <div className="card-title">Category trends</div>
          <div className="card-sub">Monthly spend per category, {windowLabel}</div>
        </div>
        <div className="segment" role="tablist" aria-label="Trend measure" style={{ marginLeft: 'auto' }}>
          <button type="button" role="tab" aria-selected={measure === 'amount'} onClick={() => onMeasureChange('amount')}>Amount</button>
          <button type="button" role="tab" aria-selected={measure === 'share'} onClick={() => onMeasureChange('share')}>Share</button>
        </div>
      </div>

      {!hasEnoughHistory ? (
        <p style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }}>Needs 3 months of history</p>
      ) : (
        <>
          <div className="lhead" style={{ gridTemplateColumns: ROW_COLUMNS }}>
            <span>Category</span><span>{monthCount}-month shape</span><span className="num">Average</span><span className="num">This month</span><span className="num">Change</span>
          </div>
          {rows.map((row) => (
            <div className="lrow" style={{ gridTemplateColumns: rowColumns }} key={row.key} data-testid="category-trend-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                <span className="cat-dot" style={{ background: row.color }} />
                <span className="tname" style={{ fontSize: 'var(--t-sm)', display: 'block' }}>{row.label}</span>
              </div>
              {!isMobile && <Sparkline values={row.sparkline} color={row.color} />}
              {!isMobile && (
                <div className="num money">{measure === 'amount' ? formatMYR(row.average) : `${row.average.toFixed(1)}%`}</div>
              )}
              <div className="num money" style={{ fontWeight: 600 }}>{measure === 'amount' ? formatMYR(row.current) : `${row.current.toFixed(1)}%`}</div>
              <div className="num">
                <span className={`chip ${row.chipClass}`} data-testid="trend-change">{row.changeLabel}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values)
  const width = 300
  const height = 32
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height, width: '100%' }}>
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
