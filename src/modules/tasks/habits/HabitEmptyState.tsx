import { Plus } from 'lucide-react'

/** Empty state (item #9) — shown when there are no habits at all (archived
 * or active). Explains what a habit IS (not a to-do, a repeated commitment
 * tracked by day) rather than just saying "nothing here", and offers the
 * same primary action as the page header. */
export function HabitEmptyState({ onNewHabit }: { onNewHabit: () => void }) {
  return (
    <section className="card card-pad c12" data-testid="habits-empty">
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm font-medium text-fg">No habits yet</p>
        <p className="max-w-sm text-sm text-fg-subtle">
          Start with something you already do. A habit tracks whether you kept it, day by day — not whether it's on
          your to-do list today.
        </p>
        <button type="button" className="btn btn-primary" onClick={onNewHabit} data-testid="habits-empty-new-btn">
          <Plus className="h-4 w-4" />
          New habit
        </button>
      </div>
    </section>
  )
}
