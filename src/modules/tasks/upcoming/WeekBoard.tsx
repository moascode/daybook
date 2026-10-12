import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useClickUnlessDragged } from './useClickUnlessDragged'
import { recurrenceLabel } from '@/modules/tasks/taskRowFormat'
import { cn, todayISO } from '@/lib/utils'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

const UNSORTED_COLOR = '#6b7280'

/**
 * `.bcard-m`'s meta line (FEAT-057 mockup): a timed task shows "HH:MM ·
 * List"; otherwise recurrence, then a resolved Wallet chip, then bare list
 * name — whichever is the most specific thing true about the card.
 */
function cardMeta(task: Task, listName: string, walletChip: string | null): string {
  if (task.dueTime) return `${task.dueTime.slice(0, 5)} · ${listName}`
  const recurrence = recurrenceLabel(task)
  if (recurrence) return recurrence
  if (walletChip) return walletChip
  return listName
}

interface BCardProps {
  task: Task
  list: Pick<TaskList, 'id' | 'name' | 'color'> | undefined
  walletChip: string | null
  onOpenDetail: (task: Task) => void
}

function BCard({ task, list, walletChip, onOpenDetail }: BCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  const openDetailClick = useClickUnlessDragged(() => onOpenDetail(task))
  const color = list?.color ?? UNSORTED_COLOR
  const label = task.content || 'Untitled task'
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, borderLeftColor: color }
    : { borderLeftColor: color }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      aria-label={`${label} — drag to move`}
      {...openDetailClick}
      data-testid={`upcoming-card-${task.id}`}
      className={cn('bcard', isDragging && 'opacity-50')}
    >
      <div className="bcard-t">{label}</div>
      <div className="bcard-m">{cardMeta(task, list?.name ?? 'Unsorted', walletChip)}</div>
    </div>
  )
}

interface DayColumnProps {
  date: string
  tasks: Task[]
  listById: Map<string, TaskList>
  taskLists: TaskList[]
  resolveWalletChip: (walletRef: string | null) => string | null
  onAddTask: (date: string, content: string, listId: string | null) => Promise<void>
  onOpenDetail: (task: Task) => void
}

function DayColumn({ date, tasks, listById, taskLists, resolveWalletChip, onAddTask, onOpenDetail }: DayColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: date })
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [listId, setListId] = useState('')
  const isToday = date === todayISO()

  const commit = async () => {
    const text = draft.trim()
    const chosenListId = listId || null
    setAdding(false)
    setDraft('')
    setListId('')
    if (!text) return
    await onAddTask(date, text, chosenListId)
  }

  return (
    <div
      ref={setNodeRef}
      data-testid={`upcoming-day-column-${date}`}
      className={cn('bcol', isToday && 'today', isOver && 'ring-2 ring-brand-500/30 rounded-md')}
    >
      <div className="bcol-head">
        <span className="bcol-d">{format(parseISO(date), 'EEE d')}</span>
        <span className="bcol-n" data-testid={`upcoming-day-count-${date}`}>
          {tasks.length}
        </span>
      </div>
      <div className="bcol-body">
        {tasks.map((t) => (
          <BCard
            key={t.id}
            task={t}
            list={t.listId ? listById.get(t.listId) : undefined}
            walletChip={resolveWalletChip(t.walletRef)}
            onOpenDetail={onOpenDetail}
          />
        ))}

        {adding ? (
          <div
            className="flex flex-col gap-1"
            onBlur={(e) => {
              // The text input and the list <select> both live in this
              // wrapper; clicking from one to the other blurs the input —
              // committing there (as a bare input-level onBlur would) closes
              // the composer the moment someone picks a list before typing.
              // Only commit once focus leaves the whole composer.
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              void commit()
            }}
          >
            <input
              autoFocus
              data-testid={`upcoming-add-day-${date}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commit()
                else if (e.key === 'Escape') {
                  setAdding(false)
                  setDraft('')
                  setListId('')
                }
              }}
              placeholder="Add a task…"
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-brand-400"
            />
            <select
              data-testid={`upcoming-add-day-list-${date}`}
              value={listId}
              onChange={(e) => setListId(e.target.value)}
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-brand-400"
            >
              <option value="">Unsorted</option>
              {taskLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <button
            type="button"
            data-testid={`upcoming-add-day-${date}`}
            onClick={() => setAdding(true)}
            className="bcol-add"
          >
            + Add
          </button>
        )}
      </div>
    </div>
  )
}

interface WeekBoardProps {
  week: string[]
  tasksByDay: Map<string, Task[]>
  listById: Map<string, TaskList>
  taskLists: TaskList[]
  resolveWalletChip: (walletRef: string | null) => string | null
  onAddTask: (date: string, content: string, listId: string | null) => Promise<void>
  onOpenDetail: (task: Task) => void
}

/**
 * "The week" — the 7-column drag-and-drop board (FEAT-057 mockup parity).
 * `.board`/`.bcol`/`.bcard` etc. already live in tasks.css (ported from
 * proposal-v2/theme.css §4-5); this just wires tasks into them.
 */
export function WeekBoard({ week, tasksByDay, listById, taskLists, resolveWalletChip, onAddTask, onOpenDetail }: WeekBoardProps) {
  return (
    <section className="card card-pad">
      <div className="card-head">
        <span className="card-title">The week</span>
        <span className="card-sub ml-auto">Drag a card to move it — the day totals update as you go</span>
      </div>
      <div className="board">
        {week.map((date) => (
          <DayColumn
            key={date}
            date={date}
            tasks={tasksByDay.get(date) ?? []}
            listById={listById}
            taskLists={taskLists}
            resolveWalletChip={resolveWalletChip}
            onAddTask={onAddTask}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </div>
    </section>
  )
}
