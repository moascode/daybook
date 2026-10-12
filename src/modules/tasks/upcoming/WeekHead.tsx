import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatWeekRange } from '@/modules/tasks/upcoming/weekMath'

interface WeekHeadProps {
  monday: string
  weekOffset: number
  onPrev: () => void
  onNext: () => void
  onThisWeek: () => void
}

/**
 * Upcoming's page head (FEAT-057 mockup parity): title, the displayed
 * week's range as an inline `.page-sub`, and prev/"This week"/next nav —
 * shifting Monday ±7 days, never touching `new Date()` directly (the
 * caller derives `monday` from `todayISO()`).
 */
export function WeekHead({ monday, weekOffset, onPrev, onNext, onThisWeek }: WeekHeadProps) {
  const rangeLabel = formatWeekRange(monday)

  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">Upcoming</h1>
        <span className="page-sub" data-testid="upcoming-week-range">
          {rangeLabel}
        </span>
      </div>
      <div className="page-actions">
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous week"
          data-testid="upcoming-week-prev"
          onClick={onPrev}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="upcoming-week-this"
          disabled={weekOffset === 0}
          onClick={onThisWeek}
        >
          This week
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next week"
          data-testid="upcoming-week-next"
          onClick={onNext}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
