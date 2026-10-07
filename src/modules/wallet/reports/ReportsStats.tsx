import type { CSSProperties } from 'react'
import { TrendingUp, TrendingDown, Percent, Scale } from 'lucide-react'
import { formatMYR } from '@/lib/utils'
import { formatSignedMYR, formatPercentSigned, type NetWorthChange } from '@/modules/wallet/reports/insights'

interface ReportsStatsProps {
  income: number
  incomeAvg: number
  incomeGrowth: number | null
  spending: number
  spendingAvg: number
  spendingGrowth: number | null
  savingsRatePct: number | null
  bestMonthPct: number | null
  worstMonthPct: number | null
  netWorth: NetWorthChange
}

const GROWTH_MUTE_THRESHOLD = 0.5 // ±0.5% reads as flat, per the spec.

// `.stat-value`'s font-size (data.css `.stat-card .stat-value { font-size:
// var(--t-xl) }`) beat the Tailwind `text-lg sm:text-[26px]` utilities tried
// first — both sit in CSS layers, but a compound-selector layered rule can
// still out-rank a utility depending on layer registration order, and it did
// here. An inline style always wins over any class, layered or not, so the
// mobile shrink moves there instead: clamp between a legible floor (18px)
// and the design's own --t-xl, scaling with viewport width so it only ever
// shrinks on a narrow screen. At 1400px, 5vw = 70px, so the clamp always
// tops out at --t-xl on desktop.
const STAT_VALUE_STYLE: CSSProperties = { fontSize: 'clamp(1.125rem, 5vw, var(--t-xl))' }

function growthChip(growthPct: number, favoursPositive: boolean): string {
  if (Math.abs(growthPct) < GROWTH_MUTE_THRESHOLD) return 'chip-mute'
  const up = growthPct > 0
  if (favoursPositive) return up ? 'chip-pos' : 'chip-warn'
  return up ? 'chip-warn' : 'chip-pos'
}

export function ReportsStats({
  income, incomeAvg, incomeGrowth,
  spending, spendingAvg, spendingGrowth,
  savingsRatePct, bestMonthPct, worstMonthPct,
  netWorth,
}: ReportsStatsProps) {
  return (
    <>
      <div className="card stat-card c3" data-testid="stat-income">
        <div className="stat-topline">
          <span className="stat-icon" style={{ background: 'rgb(var(--pos-bg))', color: 'rgb(var(--pos-fg))' }}>
            <TrendingUp className="icon-sm" />
          </span>
          <span className="stat-label">Income</span>
        </div>
        <div className="stat-value money whitespace-nowrap" style={STAT_VALUE_STYLE}>{formatMYR(income)}</div>
        <div className="stat-foot">
          <span>{formatMYR(incomeAvg)} average</span>
          {incomeGrowth !== null && (
            <span className={`chip ${growthChip(incomeGrowth * 100, true)}`}>{formatPercentSigned(incomeGrowth)}</span>
          )}
        </div>
      </div>

      <div className="card stat-card c3" data-testid="stat-spending">
        <div className="stat-topline">
          <span className="stat-icon" style={{ background: 'rgb(var(--info-bg))', color: 'rgb(var(--info-fg))' }}>
            <TrendingDown className="icon-sm" />
          </span>
          <span className="stat-label">Spending</span>
        </div>
        <div className="stat-value money whitespace-nowrap" style={STAT_VALUE_STYLE}>{formatMYR(spending)}</div>
        <div className="stat-foot">
          <span>{formatMYR(spendingAvg)} average</span>
          {spendingGrowth !== null && (
            <span className={`chip ${growthChip(spendingGrowth * 100, false)}`}>{formatPercentSigned(spendingGrowth)}</span>
          )}
        </div>
      </div>

      <div className="card stat-card c3" data-testid="stat-savings-rate">
        <div className="stat-topline">
          <span className="stat-icon" style={{ background: 'rgb(var(--accent-bg))', color: 'rgb(var(--accent-fg))' }}>
            <Percent className="icon-sm" />
          </span>
          <span className="stat-label">Savings rate</span>
        </div>
        <div
          className={`stat-value money whitespace-nowrap ${savingsRatePct !== null && savingsRatePct >= 0 ? 'pos' : ''}`}
          style={STAT_VALUE_STYLE}
        >
          {savingsRatePct === null ? '—' : `${savingsRatePct.toFixed(1)}%`}
        </div>
        <div className="stat-foot">
          {bestMonthPct === null || worstMonthPct === null
            ? <span>Not enough income months yet</span>
            : <span>Best month {Math.round(bestMonthPct)}% · worst {Math.round(worstMonthPct)}%</span>}
        </div>
      </div>

      <div className="card stat-card c3" data-testid="stat-net-worth">
        <div className="stat-topline">
          <span className="stat-icon" style={{ background: 'rgb(var(--calm-bg))', color: 'rgb(var(--calm-fg))' }}>
            <Scale className="icon-sm" />
          </span>
          <span className="stat-label">Net worth change</span>
        </div>
        <div
          className={`stat-value money whitespace-nowrap ${netWorth.amount >= 0 ? 'pos' : 'neg'}`}
          style={STAT_VALUE_STYLE}
        >
          {formatSignedMYR(netWorth.amount)}
        </div>
        <div className="stat-foot">
          <span>{formatMYR(netWorth.start)} → {formatMYR(netWorth.end)}</span>
        </div>
      </div>
    </>
  )
}
