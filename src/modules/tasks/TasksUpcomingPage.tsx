import { useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO, startOfWeek, addDays } from 'date-fns'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Check, CalendarClock } from 'lucide-react'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import type { TaskList } from '@/hooks/useTaskLists'
import { useToastStore } from '@/stores/toast.store'
import { cn, errorMessage } from '@/lib/utils'
import { DatePicker } from '@/components/ui/DatePicker'
import { TaskDetailModal } from '@/modules/tasks/TaskDetailModal'
import type { Task } from '@/types/tasks.types'

const UNSORTED_COLOR = '#6b7280'

interface BalanceProposal {
  fromDate: string
  toDate: string
  taskIds: string[]
}

/**
 * Sort candidates for "Balance the week": untimed tasks first, then
 * most-recently-created first — matches FEAT-026's spec so the tasks moved
 * off the busiest day are the ones least anchored to a specific time.
 */
function sortForBalancing(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aKey = a.dueTime === null ? 0 : 1
    const bKey = b.dueTime === null ? 0 : 1
    if (aKey !== bKey) return aKey - bKey
    return b.createdAt.localeCompare(a.createdAt)
  })
}

/**
 * Upcoming — `/tasks/upcoming` (FEAT-026). A 7-column week board (Mon→Sun,
 * current week) rather than another flat list — planning across a week is
 * spatial, so the layout is a canvas of day columns, each drag-and-drop
 * capable, plus a "Waiting for a date" section below for undated tasks and
 * a "Balance the week" helper that proposes moving tasks off the busiest day.
 *
 * One fetch: `loadTasks('all')` returns every incomplete task regardless of
 * due date and — unlike the outliner's unfiltered fetch — never touches the
 * Zustand store, so this page keeps its own local `tasks` state and mutates
 * it optimistically alongside every `rescheduleTasks`/`updateTask`/`completeTask` call.
 */
export function TasksUpcomingPage() {
  const { loadTasks, addTask, updateTask, updateTaskList, rescheduleTasks, completeTask } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const addToast = useToastStore((s) => s.addToast)

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [proposal, setProposal] = useState<BalanceProposal | null>(null)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const openDetail = (task: Task) => {
    setDetailTask(task)
    setDetailOpen(true)
  }

  // See TasksListDetailPage.tsx for the same pattern/comment: `useTasks()` /
  // `useTaskLists()` re-derive `loadTasks`/`loadTaskLists`/`addToast` on every
  // render of ANY subscriber to the tasks store, including this page's own
  // store mutations (e.g. `addTask` inside `handleAddTask`). Depending on
  // those identities directly would re-fire the mount effect below every time
  // — once re-fetched, it can overwrite this page's local optimistic state
  // with a stale response. Refs keep the effect's dependency array empty.
  const loadTasksRef = useRef(loadTasks)
  const loadTaskListsRef = useRef(loadTaskLists)
  const addToastRef = useRef(addToast)
  useEffect(() => {
    loadTasksRef.current = loadTasks
    loadTaskListsRef.current = loadTaskLists
    addToastRef.current = addToast
  })

  useEffect(() => {
    let cancelled = false
    Promise.all([loadTasksRef.current('all'), loadTaskListsRef.current()])
      .then(([open]) => {
        if (cancelled) return
        setTasks(open)
      })
      .catch((err) => {
        if (cancelled) return
        addToastRef.current({ message: errorMessage(err, 'Could not load your upcoming tasks.') })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const listById = useMemo(() => new Map(taskLists.map((l) => [l.id, l])), [taskLists])

  const week = useMemo(() => {
    const monday = startOfWeek(new Date(), { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd'))
  }, [])

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const date of week) map.set(date, [])
    for (const t of tasks) {
      if (t.dueDate && map.has(t.dueDate)) map.get(t.dueDate)!.push(t)
    }
    return map
  }, [tasks, week])

  const undated = useMemo(() => tasks.filter((t) => t.dueDate === null), [tasks])

  const dayCounts = useMemo(
    () => week.map((date) => ({ date, count: tasksByDay.get(date)?.length ?? 0 })),
    [week, tasksByDay],
  )
  const maxEntry = dayCounts.reduce((a, b) => (b.count > a.count ? b : a))
  const minEntry = dayCounts.reduce((a, b) => (b.count < a.count ? b : a))
  const gap = maxEntry.count - minEntry.count
  const canBalance = gap >= 2

  // ── Mutations — optimistic on local state; rescheduleTasks/updateTask/
  // completeTask/addTask already toast + reconcile the outliner's store on
  // failure (CLAUDE.md rule 10), so a failure here still surfaces to the
  // user even though this page's own local list won't self-correct until
  // the next load.
  //
  // Due-date writes go through `rescheduleTasks` (POST /tasks/reschedule),
  // not `updateTask` (PATCH /tasks/:id): `updateTask` no-ops when the task
  // isn't already in the Zustand store, which is *always* true here — this
  // page loads via `loadTasks('all')`, which by design never populates that
  // store (see the doc comment above) — so `updateTask` would silently drop
  // every due-date change on a cold load. `dueDate` is non-null: the only
  // callers are the drag handler (always a day from `week`) and the
  // "Waiting for a date" DatePicker, whose `onChange` only forwards a
  // non-empty value (see WaitingRow below).
  const moveTaskToDate = async (taskId: string, dueDate: string) => {
    const previousDate = tasks.find((t) => t.id === taskId)?.dueDate ?? null
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate } : t)))
    try {
      const updated = await rescheduleTasks([taskId], dueDate)
      // `rescheduleTasks` is owner-scoped server-side (a shared task's due
      // date is the owner's call, not the assignee's) and silently updates 0
      // rows for a task this viewer doesn't own — no throw, since that's a
      // normal outcome, not an error. Reconcile against what the server
      // actually moved rather than trusting the optimistic update above, and
      // say so — the same rule 10 concern `rescheduleTasks` itself protects
      // against, just moved to the ownership boundary instead of the store.
      if (updated.length === 0) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate: previousDate } : t)))
        addToast({ message: "Couldn't move that task — you can only reschedule tasks you own." })
      }
    } catch {
      // rescheduleTasks already surfaced the error and reconciled the store.
    }
  }

  const handleComplete = async (id: string) => {
    try {
      const updated = await completeTask(id)
      if (updated.isCompleted) setTasks((prev) => prev.filter((t) => t.id !== id))
    } catch {
      // completeTask already surfaced the error and reconciled the store.
    }
  }

  const handleAddTask = async (date: string, content: string, listId: string | null) => {
    try {
      const newTask = await addTask(content, null, null)
      await updateTask(newTask.id, { dueDate: date })
      let finalTask: Task = { ...newTask, dueDate: date }
      if (listId) {
        // Guard-free direct-PATCH helper (see TaskDetailModal.tsx's saveList) —
        // this page's local `tasks` state is never backed by the Zustand
        // store (loadTasks('all') doesn't populate it), so `updateTask`'s
        // store-existence guard would silently drop this.
        const withList = await updateTaskList(newTask.id, listId)
        finalTask = { ...finalTask, listId: withList.listId }
      }
      setTasks((prev) => [...prev, finalTask])
    } catch {
      // addTask/updateTask/updateTaskList already surfaced the error and reconciled the store.
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const taskId = active.id as string
    const newDate = over.id as string
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.dueDate === newDate) return
    void moveTaskToDate(taskId, newDate)
  }

  const handleOpenBalance = () => {
    if (!canBalance) return
    const n = Math.floor(gap / 2)
    const maxDayTasks = tasksByDay.get(maxEntry.date) ?? []
    const chosen = sortForBalancing(maxDayTasks).slice(0, n)
    // Defensive: `canBalance` (gap >= 2) mathematically guarantees n >= 1 and
    // therefore chosen.length >= 1 today, but this guards against a future
    // change to the candidate-filtering logic silently opening a proposal
    // with nothing to move.
    if (chosen.length === 0) return
    setProposal({ fromDate: maxEntry.date, toDate: minEntry.date, taskIds: chosen.map((t) => t.id) })
  }

  const handleConfirmBalance = async () => {
    if (!proposal) return
    const { taskIds, toDate } = proposal
    const previousDates = new Map(tasks.filter((t) => taskIds.includes(t.id)).map((t) => [t.id, t.dueDate]))
    setProposal(null)
    setTasks((prev) => prev.map((t) => (taskIds.includes(t.id) ? { ...t, dueDate: toDate } : t)))
    try {
      const updated = await rescheduleTasks(taskIds, toDate)
      // Same ownership boundary as `moveTaskToDate` above: a task the viewer
      // doesn't own (assigned-to-me or shared-in) can be on this board but is
      // not reschedulable by them, and the server just omits it rather than
      // erroring — reconcile and say so instead of leaving the optimistic
      // move in place for a task that never actually persisted.
      const movedIds = new Set(updated.map((t) => t.id))
      const skipped = taskIds.filter((id) => !movedIds.has(id))
      if (skipped.length > 0) {
        setTasks((prev) =>
          prev.map((t) => (skipped.includes(t.id) ? { ...t, dueDate: previousDates.get(t.id) ?? null } : t)),
        )
        addToast({
          message:
            skipped.length === taskIds.length
              ? "Couldn't move those tasks — you can only reschedule tasks you own."
              : `Moved ${movedIds.size} of ${taskIds.length} tasks — the rest aren't yours to reschedule.`,
        })
      }
    } catch {
      // rescheduleTasks already surfaced the error and reconciled the store.
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Upcoming</h1>
          <p className="page-sub">This week's tasks, laid out day by day.</p>
        </div>
        <button
          type="button"
          data-testid="upcoming-balance-week"
          disabled={!canBalance}
          title={canBalance ? 'Move tasks off the busiest day' : 'The week is already balanced'}
          aria-label={canBalance ? 'Balance the week' : 'The week is already balanced'}
          onClick={handleOpenBalance}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
            canBalance
              ? 'text-fg-subtle hover:bg-surface-hover hover:text-fg'
              : 'cursor-not-allowed text-fg-faint',
          )}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          Balance the week
        </button>
      </div>

      {proposal && (
        <div
          data-testid="upcoming-balance-proposal"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
        >
          <span>
            Move {proposal.taskIds.length} task{proposal.taskIds.length === 1 ? '' : 's'} from{' '}
            {format(parseISO(proposal.fromDate), 'EEEE')} to {format(parseISO(proposal.toDate), 'EEEE')}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="upcoming-balance-confirm"
              onClick={() => void handleConfirmBalance()}
              className="btn btn-primary"
            >
              Confirm
            </button>
            <button
              type="button"
              data-testid="upcoming-balance-cancel"
              onClick={() => setProposal(null)}
              className="btn btn-quiet"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your upcoming tasks…</p>
      ) : (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
              {week.map((date) => (
                <DayColumn
                  key={date}
                  date={date}
                  tasks={tasksByDay.get(date) ?? []}
                  listById={listById}
                  taskLists={taskLists}
                  onComplete={handleComplete}
                  onAddTask={handleAddTask}
                  onOpenDetail={openDetail}
                />
              ))}
            </div>
          </DndContext>

          <div className="mt-6" data-testid="upcoming-waiting-section">
            <div className="tgroup-head">
              <span className="tg-date">Waiting for a date</span>
            </div>
            {undated.length === 0 ? (
              <p className="py-3 text-sm text-fg-subtle">Nothing is waiting on a date.</p>
            ) : (
              undated.map((t) => (
                <WaitingRow
                  key={t.id}
                  task={t}
                  list={t.listId ? listById.get(t.listId) : undefined}
                  onSetDate={(date) => {
                    if (!week.includes(date)) {
                      addToast({ message: `Scheduled for ${format(parseISO(date), 'd MMM')} — outside this week` })
                    }
                    void moveTaskToDate(t.id, date)
                  }}
                  onOpenDetail={openDetail}
                />
              ))
            )}
          </div>
        </>
      )}

      <TaskDetailModal
        task={detailTask}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        availableLists={taskLists}
        onSaved={(updated) => setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))}
      />
    </div>
  )
}

// ── Subcomponents ──────────────────────────────────────

interface DayColumnProps {
  date: string
  tasks: Task[]
  listById: Map<string, TaskList>
  taskLists: TaskList[]
  onComplete: (id: string) => void
  onAddTask: (date: string, content: string, listId: string | null) => Promise<void>
  onOpenDetail: (task: Task) => void
}

function DayColumn({ date, tasks, listById, taskLists, onComplete, onAddTask, onOpenDetail }: DayColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: date })
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [listId, setListId] = useState('')
  const d = parseISO(date)

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
      className={cn(
        'flex min-h-[180px] flex-col gap-2 rounded-lg border border-line-subtle bg-surface-sunken p-2',
        isOver && 'border-brand-400 ring-2 ring-brand-500/20',
      )}
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-fg-muted">{format(d, 'EEE d')}</span>
        <span className="text-xs text-fg-faint" data-testid={`upcoming-day-count-${date}`}>
          {tasks.length}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {tasks.map((t) => (
          <UpcomingCard
            key={t.id}
            task={t}
            list={t.listId ? listById.get(t.listId) : undefined}
            onComplete={onComplete}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </div>

      {adding ? (
        <div
          className="flex flex-col gap-1"
          onBlur={(e) => {
            // Both the text input and the list <select> live in this
            // wrapper, and clicking from one to the other blurs the input —
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
            className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-fg outline-none focus:border-brand-400"
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
          className="rounded-md border border-dashed border-line-strong px-2 py-1.5 text-xs text-fg-faint transition-colors hover:border-brand-400 hover:text-brand-600"
        >
          + Add
        </button>
      )}
    </div>
  )
}

interface UpcomingCardProps {
  task: Task
  list: Pick<TaskList, 'id' | 'name' | 'color'> | undefined
  onComplete: (id: string) => void
  onOpenDetail: (task: Task) => void
}

function UpcomingCard({ task, list, onComplete, onOpenDetail }: UpcomingCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  const color = list?.color ?? UNSORTED_COLOR
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, borderLeftColor: color }
    : { borderLeftColor: color }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      data-testid={`upcoming-card-${task.id}`}
      className={cn(
        'flex items-center gap-2 rounded-md border border-line border-l-4 bg-surface px-2 py-1.5 text-sm',
        isDragging && 'opacity-50',
      )}
    >
      <button
        type="button"
        onClick={() => onComplete(task.id)}
        aria-label="Mark complete"
        className="tcheck shrink-0"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      {/*
        Plain onClick alongside dnd-kit's `listeners`/`attributes`: dnd-kit's
        PointerSensor listeners register only `onKeyDown`/`onPointerDown`
        (verified in @dnd-kit/core's source), never `onClick`, so there's no
        handler collision from spreading both on this node — a stationary
        click (under the 8px activation distance) never starts a drag, so it
        reaches this handler untouched.
      */}
      <span
        data-testid={`upcoming-card-open-${task.id}`}
        role="button"
        tabIndex={0}
        onClick={() => onOpenDetail(task)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenDetail(task)
          }
        }}
        title={task.content}
        className="min-w-0 flex-1 cursor-pointer truncate text-fg"
      >
        {task.content || 'Untitled task'}
      </span>
    </div>
  )
}

interface WaitingRowProps {
  task: Task
  list: Pick<TaskList, 'id' | 'name' | 'color'> | undefined
  onSetDate: (date: string) => void
  onOpenDetail: (task: Task) => void
}

function WaitingRow({ task, list, onSetDate, onOpenDetail }: WaitingRowProps) {
  const color = list?.color ?? UNSORTED_COLOR

  return (
    <div className="task" data-task-id={task.id}>
      <span
        className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
        style={{ background: color }}
        aria-hidden="true"
        title={list?.name ?? 'Unsorted'}
      />
      <div className="min-w-0 flex-1">
        <p
          data-testid={`upcoming-waiting-open-${task.id}`}
          role="button"
          tabIndex={0}
          onClick={() => onOpenDetail(task)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpenDetail(task)
            }
          }}
          title={task.content}
          className="task-title cursor-pointer"
        >
          {task.content || 'Untitled task'}
        </p>
      </div>
      <DatePicker
        aria-label={`Schedule ${task.content || 'task'}`}
        value=""
        onChange={(e) => {
          // The picker starts (and stays) empty, so there's nothing
          // meaningful to do when it reports an empty value back —
          // the task is already undated.
          if (e.target.value) onSetDate(e.target.value)
        }}
        data-testid={`upcoming-schedule-${task.id}`}
        className="w-auto py-1"
      />
    </div>
  )
}
