import { format, parseISO } from 'date-fns'
import { useDroppable } from '@dnd-kit/core'
import { cn, todayISO } from '@/lib/utils'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

const UNSORTED_COLOR = '#6b7280'
const MAX_CARDS = 3
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface MonthCellProps {
  date: string
  inMonth: boolean
  tasks: Task[]
  listById: Map<string, TaskList>
  onOpenDetail: (task: Task) => void
  onPickDay: (date: string) => void
}

function MonthCell({ date, inMonth, tasks, listById, onOpenDetail, onPickDay }: MonthCellProps) {
  // A droppable cell lets a "Waiting for a date" row be dragged straight onto a day.
  const { setNodeRef, isOver } = useDroppable({ id: date })
  const isToday = date === todayISO()
  const shown = tasks.slice(0, MAX_CARDS)
  const extra = tasks.length - shown.length

  return (
    <div
      ref={setNodeRef}
      data-testid={`upcoming-month-cell-${date}`}
      className={cn(
        'flex min-h-[72px] min-w-0 flex-col gap-1 rounded-md border border-line p-1 sm:min-h-[112px] sm:p-1.5',
        isToday ? 'bg-surface-hover' : 'bg-surface',
        !inMonth && 'opacity-50',
        isOver && 'ring-2 ring-brand-500/30',
      )}
    >
      <div className="flex items-baseline gap-1">
        <button
          type="button"
          data-testid={`upcoming-month-day-${date}`}
          aria-label={`Open the week of ${format(parseISO(date), 'd MMMM')}`}
          onClick={() => onPickDay(date)}
          className={cn('text-xs font-semibold hover:underline', isToday ? 'text-accent-fg' : 'text-fg-muted')}
        >
          {format(parseISO(date), 'd')}
        </button>
        {tasks.length > 0 && (
          <span className="ml-auto text-[10px] text-fg-subtle" data-testid={`upcoming-month-count-${date}`}>
            {tasks.length}
          </span>
        )}
      </div>
      {/* Phone: seven narrow columns can't carry titles, so the cell shows
          just its day number and count; tapping the number opens that week. */}
      <div className="hidden min-w-0 flex-col gap-1 sm:flex">
        {shown.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`upcoming-month-card-${t.id}`}
            onClick={() => onOpenDetail(t)}
            style={{ borderLeftColor: (t.listId ? listById.get(t.listId)?.color : undefined) ?? UNSORTED_COLOR }}
            className="truncate rounded border border-line border-l-[3px] bg-surface px-1.5 py-0.5 text-left text-[11px] text-fg hover:bg-surface-hover"
          >
            {t.content || 'Untitled task'}
          </button>
        ))}
        {extra > 0 && (
          <button
            type="button"
            data-testid={`upcoming-month-more-${date}`}
            onClick={() => onPickDay(date)}
            className="text-left text-[11px] text-fg-subtle hover:underline"
          >
            +{extra} more
          </button>
        )}
      </div>
    </div>
  )
}

interface MonthBoardProps {
  /** The full Monday-start grid, leading/trailing neighbour-month days included. */
  grid: string[]
  /** `YYYY-MM` of the displayed month — grid days outside it are muted. */
  month: string
  tasksByDay: Map<string, Task[]>
  listById: Map<string, TaskList>
  onOpenDetail: (task: Task) => void
  onPickDay: (date: string) => void
}

/** Month calendar grid for Upcoming's Month range. */
export function MonthBoard({ grid, month, tasksByDay, listById, onOpenDetail, onPickDay }: MonthBoardProps) {
  return (
    <section className="card card-pad" data-testid="upcoming-month-board">
      <div className="card-head">
        <span className="card-title">The month</span>
        <span className="card-sub ml-auto">Open a day to plan its week</span>
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold uppercase text-fg-subtle sm:text-xs">
            {d}
          </div>
        ))}
        {grid.map((date) => (
          <MonthCell
            key={date}
            date={date}
            inMonth={date.startsWith(month)}
            tasks={tasksByDay.get(date) ?? []}
            listById={listById}
            onOpenDetail={onOpenDetail}
            onPickDay={onPickDay}
          />
        ))}
      </div>
    </section>
  )
}
