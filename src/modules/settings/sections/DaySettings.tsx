import { Calendar } from 'lucide-react'
import { useDayStore } from '@/stores/day.store'

/**
 * Settings → Day: the "Show on the timeline" toggles, previously only
 * reachable as checkboxes inside ModuleSidebar's Day nav group. Same
 * session-only state (`day.store.ts`, no server persistence) and the same
 * `toggle()` action — this is an additional entry point, not a new control.
 *
 * Labels are deliberately NOT "Tasks" / "Money" — `getByLabel()` matches
 * substrings (docs/reference/testing.md trap #3), and those bare words would
 * be a hazard for any current or future lookup elsewhere in the suite.
 */
export function DaySettings() {
  const { showTasks, showMoney, toggle } = useDayStore()

  return (
    <div className="mx-auto max-w-lg md:mx-0 md:max-w-xl">
      <h1 className="page-title mb-6">Day</h1>

      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="mb-4 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-fg-faint" />
          <h3 className="text-sm font-semibold text-fg">Show on the timeline</h3>
        </div>
        <p className="text-sm text-fg-muted">
          Choose what shows up in the Day timeline. This is saved for this browser session,
          the same toggle as the one in the Day sidebar.
        </p>
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-fg" htmlFor="settings-day-show-tasks">
            <input
              id="settings-day-show-tasks"
              type="checkbox"
              checked={showTasks}
              onChange={() => toggle('showTasks')}
              className="h-4 w-4 rounded border-line-strong text-brand-600 cursor-pointer"
              data-testid="settings-day-show-tasks"
              aria-label="Show tasks and habits on the Day timeline"
            />
            Tasks &amp; habits
          </label>
          <label className="flex items-center gap-2 text-sm text-fg" htmlFor="settings-day-show-money">
            <input
              id="settings-day-show-money"
              type="checkbox"
              checked={showMoney}
              onChange={() => toggle('showMoney')}
              className="h-4 w-4 rounded border-line-strong text-brand-600 cursor-pointer"
              data-testid="settings-day-show-money"
              aria-label="Show money on the Day timeline"
            />
            Money
          </label>
        </div>
      </section>
    </div>
  )
}
