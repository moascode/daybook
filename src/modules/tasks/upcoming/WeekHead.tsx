import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, format, parseISO } from 'date-fns'
import { formatWeekRange, mondayOf } from '@/modules/tasks/upcoming/weekMath'
import { UPCOMING_RANGES, formatMonthLabel, type UpcomingRange } from '@/modules/tasks/upcoming/rangeMath'

interface WeekHeadProps {
  anchor: string
  range: UpcomingRange
  /** True when the displayed range already contains today (disables "This …"). */
  atCurrent: boolean
  onRangeChange: (range: UpcomingRange) => void
  onPrev: () => void
  onNext: () => void
  onThisRange: () => void
}

const RANGE_LABEL: Record<UpcomingRange, string> = { week: 'Week', fortnight: 'Fortnight', month: 'Month' }

function headLabel(anchor: string, range: UpcomingRange): string {
  if (range === 'month') return formatMonthLabel(anchor)
  const monday = mondayOf(anchor)
  if (range === 'week') return formatWeekRange(monday)
  const start = parseISO(monday)
  return `${format(start, 'd MMM')} – ${format(addDays(start, 13), 'd MMM')}`
}

/**
 * Upcoming's page head (FEAT-057 mockup parity): title, the displayed
 * range as an inline `.page-sub`, the Week / Fortnight / Month segment, and
 * prev/"This …"/next nav. The caller derives `anchor` from `todayISO()`,
 * never `new Date()`.
 */
export function WeekHead({ anchor, range, atCurrent, onRangeChange, onPrev, onNext, onThisRange }: WeekHeadProps) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">Upcoming</h1>
        <span className="page-sub" data-testid="upcoming-week-range">
          {headLabel(anchor, range)}
        </span>
      </div>
      <div className="page-actions page-actions--nav" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <div className="segment" role="tablist" aria-label="Upcoming range">
          {UPCOMING_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === range}
              data-testid={`upcoming-range-${r}`}
              onClick={() => onRangeChange(r)}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Previous ${range}`}
          data-testid="upcoming-week-prev"
          onClick={onPrev}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="upcoming-week-this"
          disabled={atCurrent}
          onClick={onThisRange}
        >
          This {range}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Next ${range}`}
          data-testid="upcoming-week-next"
          onClick={onNext}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
