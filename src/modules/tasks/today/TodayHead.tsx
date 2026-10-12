import { CalendarDays } from 'lucide-react'
import type { TodayAudience } from '@/modules/tasks/today/useTodayTasks'

interface TodayHeadProps {
  todayLabel: string
  audience: TodayAudience
  onAudienceChange: (audience: TodayAudience) => void
  onPlanWeek: () => void
}

/** The Today page's header: title + date sub-line, and the Mine/Everyone segment + "Plan week" action (mockup: proposal-v2/tasks.html `.page-head`). */
export function TodayHead({ todayLabel, audience, onAudienceChange, onPlanWeek }: TodayHeadProps) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">Today</h1>
        <p className="page-sub">{todayLabel}</p>
      </div>
      <div className="page-actions items-center">
        <div className="segment" role="tablist" aria-label="Show tasks for">
          <button
            type="button"
            role="tab"
            aria-selected={audience === 'mine'}
            onClick={() => onAudienceChange('mine')}
            data-testid="today-audience-mine"
          >
            Mine
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={audience === 'everyone'}
            onClick={() => onAudienceChange('everyone')}
            data-testid="today-audience-everyone"
          >
            Everyone
          </button>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onPlanWeek} data-testid="today-plan-week-btn">
          <CalendarDays className="icon-sm" aria-hidden="true" />
          Plan week
        </button>
      </div>
    </div>
  )
}
