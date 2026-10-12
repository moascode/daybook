import { format, parseISO } from 'date-fns'
import { ArrowRight } from 'lucide-react'
import type { Task } from '@/types/tasks.types'

interface DayEntry {
  date: string
  count: number
}

interface BalanceCardProps {
  canBalance: boolean
  candidates: Task[]
  maxEntry: DayEntry
  minEntry: DayEntry
  balanceReason: (task: Task) => string
  onMove: (taskId: string) => void
}

/**
 * "Balance the week" (FEAT-057/FEAT-026 mockup): one `.sug` row per
 * candidate, each independently movable, plus a footer summary of what
 * applying every move would do. A calm "balanced" state replaces the old
 * behaviour of hiding the whole card — the section is always present, it
 * just has nothing to propose once the week is even.
 */
export function BalanceCard({ canBalance, candidates, maxEntry, minEntry, balanceReason, onMove }: BalanceCardProps) {
  const maxDayName = format(parseISO(maxEntry.date), 'EEEE')
  const minDayName = format(parseISO(minEntry.date), 'EEEE')

  return (
    <section className="card card-pad mt-4" data-testid="upcoming-balance-card">
      <div className="card-head">
        <div>
          <span className="card-title">Balance the week</span>
          {canBalance && (
            <div className="card-sub">
              {maxDayName} has {maxEntry.count}, {minDayName} has {minEntry.count}
            </div>
          )}
        </div>
      </div>

      {!canBalance ? (
        <p className="py-3 text-sm text-fg-subtle" data-testid="upcoming-balance-calm">
          This week is balanced.
        </p>
      ) : (
        <>
          <div>
            {candidates.map((task) => (
              <div key={task.id} className="sug">
                <div className="tavatar" style={{ background: 'rgb(var(--accent-bg))', color: 'rgb(var(--accent-fg))' }}>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="sug-main">
                  <p className="sug-title">
                    Move &quot;{task.content || 'Untitled task'}&quot; to {minDayName}
                  </p>
                  <p className="sug-sub">{balanceReason(task)}</p>
                </div>
                <button
                  type="button"
                  data-testid={`upcoming-balance-move-${task.id}`}
                  onClick={() => onMove(task.id)}
                  className="btn btn-secondary btn-sm"
                >
                  Move
                </button>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div className="text-sm text-fg-subtle">
            {candidates.length === 1 ? 'One move' : `${candidates.length} moves`} bring{candidates.length === 1 ? 's' : ''}{' '}
            {maxDayName} to <b className="text-fg">{maxEntry.count - candidates.length}</b> and {minDayName} to{' '}
            <b className="text-fg">{minEntry.count + candidates.length}</b>.
          </div>
        </>
      )}
    </section>
  )
}
