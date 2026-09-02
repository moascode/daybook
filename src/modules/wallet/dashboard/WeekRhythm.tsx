import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatMYR } from '@/lib/utils'
import { useChartTheme } from '@/hooks/useChartTheme'
import { DashboardCard } from './DashboardCard'
import { useDashboardChartColors } from './chartColors'
import { WEEKDAY_LABELS } from './insights'

interface WeekRhythmProps {
  /** Seven averages, Monday first. */
  averages: number[]
  months: number
  className?: string
}

/** Bars are nudged up by this many px on hover — see `renderBar` below. */
const HOVER_LIFT = 3

interface WeekRhythmDatum {
  day: string
  value: number
}

/**
 * Average spend by weekday, as a real column chart — the timing axis nothing
 * else in the app touches. A reference line marks the weekly average so each
 * bar reads against a fixed baseline rather than only against each other.
 */
export function WeekRhythm({ averages, months, className }: WeekRhythmProps) {
  const chart = useChartTheme()
  const colors = useDashboardChartColors()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const total = averages.reduce((a, b) => a + b, 0)
  const average = total / 7
  const weekend = averages[4] + averages[5] + averages[6]
  const weekendShare = total > 0 ? (weekend / total) * 100 : 0
  const weekendDayShare = (3 / 7) * 100
  const busiest = averages.indexOf(Math.max(...averages))

  const data = useMemo<WeekRhythmDatum[]>(
    () => WEEKDAY_LABELS.map((day, i) => ({ day, value: averages[i] })),
    [averages],
  )

  const renderBar = (props: unknown) => {
    const { x, y, width, height, index } = props as {
      x: number
      y: number
      width: number
      height: number
      index: number
    }
    const lifted = index === hoveredIndex
    return (
      <rect
        x={x}
        y={lifted ? y - HOVER_LIFT : y}
        width={width}
        height={height}
        fill={colors.magnitude}
        rx={4}
        data-testid="week-rhythm-bar"
        style={{ transition: 'y 0.15s ease-out' }}
      />
    )
  }

  return (
    <DashboardCard
      className={className}
      title="Your week"
      subtitle={`Average spend per weekday over the last ${months} month${months === 1 ? '' : 's'}.`}
    >
      <div
        role="img"
        aria-label={`Average spend by weekday. ${WEEKDAY_LABELS.map(
          (d, i) => `${d}: ${formatMYR(averages[i])}`,
        ).join('; ')}. Weekly average: ${formatMYR(average)} per day.`}
        data-testid="week-rhythm"
      >
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
            <XAxis
              dataKey="day"
              stroke={chart.axis}
              tick={{ fill: chart.axis }}
              fontSize={11}
              tickLine={false}
            />
            <YAxis
              stroke={chart.axis}
              tick={{ fill: chart.axis }}
              fontSize={11}
              tickLine={false}
              width={48}
              tickFormatter={(value: number) => formatMYR(value)}
            />
            <Tooltip
              contentStyle={chart.tooltip.contentStyle}
              labelStyle={chart.tooltip.labelStyle}
              itemStyle={chart.tooltip.itemStyle}
              formatter={(value: number) => formatMYR(value)}
            />
            <ReferenceLine
              y={average}
              stroke={colors.usual}
              strokeDasharray="4 4"
              label={{
                value: 'Avg',
                position: 'insideTopRight',
                fill: chart.axis,
                fontSize: 11,
              }}
            />
            <Bar
              dataKey="value"
              name="Average spend"
              shape={renderBar}
              isAnimationActive={false}
              onMouseEnter={(_, index) => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <LabelList
                dataKey="value"
                position="top"
                fill={chart.axis}
                fontSize={11}
                formatter={(value: number) => Math.round(value)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {total > 0 && (
        <p className="mt-4 rounded-lg bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-fg">
          <span className="font-semibold">Fri–Sun is {weekendShare.toFixed(0)}%</span> of your
          weekly spending in {weekendDayShare.toFixed(0)}% of the days.{' '}
          {WEEKDAY_LABELS[busiest]} is your heaviest day at {formatMYR(averages[busiest])} on
          average.
        </p>
      )}
    </DashboardCard>
  )
}
