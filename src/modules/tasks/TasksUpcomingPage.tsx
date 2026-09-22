import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { Check } from 'lucide-react'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import type { TaskList } from '@/hooks/useTaskLists'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { cn, errorMessage } from '@/lib/utils'
import { DatePicker } from '@/components/ui/DatePicker'
import { TaskDetailModal } from '@/modules/tasks/TaskDetailModal'
import { TaskComposer, type TaskComposerDraft } from '@/modules/tasks/composer/TaskComposer'
import { TaskFormModal, type TaskFormDraft } from '@/modules/tasks/composer/TaskFormModal'
import type { Task } from '@/types/tasks.types'
import type { GroupMember } from '@/types/household.types'

const UNSORTED_COLOR = '#6b7280'

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
  const { loadTasks, addTask, updateTask, rescheduleTasks, completeTask } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const addToast = useToastStore((s) => s.addToast)
  const navigate = useNavigate()

  const [tasks, setTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  // FEAT-057: same shared "New task" modal FEAT-054 wired up on Today, opened
  // from the composer's "Task"/"Assign" shortcuts — see TaskComposer.tsx.
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskFormContent, setTaskFormContent] = useState<string | undefined>(undefined)
  const [taskFormFocusField, setTaskFormFocusField] = useState<'assignee' | undefined>(undefined)

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
    Promise.all([
      loadTasksRef.current('all'),
      loadTaskListsRef.current(),
      api.get<Record<string, unknown>[]>('/groups/members').then((rows) => rows.map(mapMember)),
    ])
      .then(([open, , memberRows]) => {
        if (cancelled) return
        setTasks(open)
        setMembers(memberRows)
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
  const coMembers = useMemo(() => members.map((m) => ({ userId: m.userId, username: m.username })), [members])

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

  // Band stats (FEAT-057): tasks due within `week`, split into "hard
  // deadlines" (no recurrence, no wallet link — the mockup's definition of
  // genuinely fixed) and "recurring" (recurrence set). Deliberately built
  // from `tasksByDay`'s values rather than filtering `tasks` directly, so
  // this only counts the same dated-within-the-displayed-week set the day
  // columns show — a dated task outside this week (out of range) doesn't
  // inflate either stat. The sub-line names real tasks (mockup: "insurance,
  // rent, review" / "standup, plants, run"), not a fabricated stat.
  //
  // Single source of truth for "how many tasks are scheduled this week":
  // `scheduledCount` (page-head summary line AND the band card's own
  // band-main figure) derives from this same array's length, rather than
  // separately re-summing `dayCounts` — both numbers can never drift apart.
  const weekTasks = useMemo(() => [...tasksByDay.values()].flat(), [tasksByDay])
  const scheduledCount = weekTasks.length

  // Headline callout ("Wednesday is doing too much") — same "is the busiest
  // day genuinely heavier than at least one other day" comparison
  // TasksTodayPage.tsx's `isHeaviestDay` chip uses for its own load strip,
  // just applied to the week's `dayCounts` instead: the two pages compare
  // different shapes (Today checks whether *today specifically* is the max
  // of a per-day-this-week strip; this page finds whichever day of the week
  // is the max), so this stays a local one-liner rather than a shared
  // extraction that would need to abstract over both call shapes for a
  // single boolean comparison.
  const isHeaviestDayGenuine = maxEntry.count > 0 && dayCounts.some((d) => d.count < maxEntry.count)

  const hardDeadlineTasks = useMemo(
    () => weekTasks.filter((t) => t.recurrence === null && t.walletRef === null),
    [weekTasks],
  )
  const recurringTasks = useMemo(() => weekTasks.filter((t) => t.recurrence !== null), [weekTasks])

  const summarizeTaskNames = (list: Task[], max = 3): string => {
    const names = list.map((t) => t.content || 'Untitled task').filter(Boolean)
    if (names.length === 0) return ''
    if (names.length <= max) return names.join(', ')
    return `${names.slice(0, max).join(', ')}…`
  }
  const hardDeadlineNames = useMemo(() => summarizeTaskNames(hardDeadlineTasks), [hardDeadlineTasks])
  const recurringNames = useMemo(() => summarizeTaskNames(recurringTasks), [recurringTasks])

  // Balance-the-week card (FEAT-057): recomputed from `tasksByDay` on every
  // render, so as candidates move off `maxEntry.date` the list shrinks (and
  // the card disappears once `canBalance` goes false) with no extra state —
  // unlike the old single-batch `proposal`, each row here acts independently
  // via `moveTaskToDate`. Same `Math.floor(gap / 2)` sizing and
  // `sortForBalancing` candidate order FEAT-026's original batch move used.
  const balanceCandidates = useMemo(() => {
    if (!canBalance) return []
    const n = Math.floor(gap / 2)
    const maxDayTasks = tasksByDay.get(maxEntry.date) ?? []
    return sortForBalancing(maxDayTasks).slice(0, n)
  }, [canBalance, gap, tasksByDay, maxEntry.date])

  // One-line reason per candidate — only what's honestly derivable from the
  // task/day data already in scope (CLAUDE.md rule 7: no fabricated reasons).
  // `sortForBalancing` already prefers untimed tasks, so most candidates hit
  // the first branch; the fallback still names the real target-day gap.
  const balanceReason = (task: Task): string => {
    const targetDay = format(parseISO(minEntry.date), 'EEEE')
    return task.dueTime === null
      ? `No deadline, and ${targetDay} is nearly empty`
      : `${targetDay} has ${minEntry.count} task${minEntry.count === 1 ? '' : 's'} — this has ${maxEntry.count}`
  }

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
      // `addTask` seeds the Zustand store with the new task, so this
      // `updateTask` (right after, same id) passes its store-existence
      // guard rather than silently no-opping — unlike this page's other
      // due-date/list writes (moveTaskToDate, etc.), which target tasks
      // loaded via `loadTasks('all')` and never touch the store at all.
      const newTask = await addTask(content, null, null)
      await updateTask(newTask.id, { dueDate: date, listId })
      setTasks((prev) => [...prev, { ...newTask, dueDate: date, listId }])
    } catch {
      // addTask/updateTask already surfaced the error and reconciled the store.
    }
  }

  // Composer wiring (FEAT-057), mirroring TasksTodayPage.tsx's
  // handleCreateTask — same addTask-then-combined-PATCH shape, but WITHOUT
  // Today's BUG-009 default-to-today: a task created from Upcoming with no
  // date word in it stays undated and lands in "Waiting for a date", which
  // is this page's whole point (unlike Today, whose composer intentionally
  // forces every task into today's group).
  const handleCreateTask = async (draft: TaskComposerDraft) => {
    let newTask: Task
    try {
      newTask = await addTask(draft.content, null, null)
    } catch {
      // addTask already surfaced the error and reconciled the store.
      return
    }

    const patch: Record<string, unknown> = {}
    if (draft.dueDate !== null) patch.dueDate = draft.dueDate
    if (draft.listId !== null) patch.listId = draft.listId
    if (draft.priority !== null) patch.priority = draft.priority
    if (draft.assigneeId !== null) patch.assigneeId = draft.assigneeId
    if (draft.dueTime !== null) patch.dueTime = draft.dueTime

    if (Object.keys(patch).length === 0) {
      setTasks((prev) => [...prev, newTask])
      return
    }

    try {
      const row = await api.patch<Record<string, unknown>>(`/tasks/${newTask.id}`, patch)
      const merged: Task = {
        ...newTask,
        listId: (row.list_id as string | null | undefined) ?? draft.listId ?? newTask.listId,
        priority: (row.priority as Task['priority'] | undefined) ?? draft.priority ?? newTask.priority,
        assigneeId: (row.assignee_id as string | null | undefined) ?? draft.assigneeId ?? newTask.assigneeId,
        dueDate: (row.due_date as string | null | undefined) ?? draft.dueDate ?? newTask.dueDate,
        dueTime: (row.due_time as string | null | undefined) ?? draft.dueTime ?? newTask.dueTime,
      }
      setTasks((prev) => [...prev, merged])
    } catch (err) {
      // The task itself was created — only the follow-up detail patch failed.
      addToast({
        message: errorMessage(err, 'Task added, but its details could not be saved — please edit it to fix that.'),
      })
      setTasks((prev) => [...prev, newTask])
    }
  }

  const handleOpenHabitModal = () => {
    navigate('/tasks/habits', { state: { openCreateHabit: true } })
  }

  const handleOpenTaskForm = (initialContent?: string) => {
    setTaskFormContent(initialContent)
    setTaskFormFocusField(undefined)
    setTaskFormOpen(true)
  }

  const handleOpenAssignForm = (initialContent?: string) => {
    setTaskFormContent(initialContent)
    setTaskFormFocusField('assignee')
    setTaskFormOpen(true)
  }

  // TaskFormModal's onSubmit — reuses handleCreateTask's addTask + combined
  // PATCH logic, since the two draft shapes already match.
  const handleTaskFormSubmit = async (draft: TaskFormDraft) => {
    await handleCreateTask(draft)
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
      </div>

      <TaskComposer
        lists={taskLists}
        coMembers={coMembers}
        onCreateTask={handleCreateTask}
        onOpenHabitModal={handleOpenHabitModal}
        onOpenTaskForm={handleOpenTaskForm}
        onOpenAssignForm={handleOpenAssignForm}
      />

      {!loading && weekTasks.length > 0 && (
        <section className="card card-pad mb-4" data-testid="upcoming-band-stats">
          <div className="card-head">
            <div>
              <span className="card-title">Next seven days</span>
              <div className="card-sub" data-testid="upcoming-summary-line">
                {scheduledCount} scheduled, {undated.length} waiting for a date
              </div>
            </div>
            {isHeaviestDayGenuine && (
              <span className="chip chip-warn ml-auto" data-testid="upcoming-heaviest-chip">
                {format(parseISO(maxEntry.date), 'EEEE')} is doing too much
              </span>
            )}
          </div>
          <div className="band">
            <div className="band-main">
              <div className="band-fig">
                <span className="v">{scheduledCount}</span>
                <span className="k">tasks across seven days</span>
              </div>
            </div>
            <div className="band-stats">
              <div className="band-stat" data-testid="upcoming-stat-hard-deadlines">
                <p className="k">Hard deadlines</p>
                <p className="v">{hardDeadlineTasks.length}</p>
                {hardDeadlineNames && <p className="s">{hardDeadlineNames}</p>}
              </div>
              <div className="band-stat" data-testid="upcoming-stat-recurring">
                <p className="k">Recurring</p>
                <p className="v">{recurringTasks.length}</p>
                {recurringNames && <p className="s">{recurringNames}</p>}
              </div>
            </div>
          </div>
        </section>
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

      {canBalance && (
        <section className="card card-pad mt-4" data-testid="upcoming-balance-card">
          <div className="card-head">
            <div>
              <span className="card-title">Balance the week</span>
              <div className="card-sub">
                {format(parseISO(maxEntry.date), 'EEEE')} has {maxEntry.count}, {format(parseISO(minEntry.date), 'EEEE')} has{' '}
                {minEntry.count}
              </div>
            </div>
          </div>
          <div>
            {balanceCandidates.map((task) => (
              <div key={task.id} className="sug">
                <div className="sug-main">
                  <p className="sug-title">
                    Move &quot;{task.content || 'Untitled task'}&quot; to {format(parseISO(minEntry.date), 'EEEE')}
                  </p>
                  <p className="sug-sub">{balanceReason(task)}</p>
                </div>
                <button
                  type="button"
                  data-testid={`upcoming-balance-move-${task.id}`}
                  onClick={() => void moveTaskToDate(task.id, minEntry.date)}
                  className="btn btn-secondary btn-sm"
                >
                  Move
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <TaskDetailModal
        task={detailTask}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        availableLists={taskLists}
        coMembers={coMembers}
        onSaved={(updated) => setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))}
      />

      <TaskFormModal
        open={taskFormOpen}
        onClose={() => setTaskFormOpen(false)}
        lists={taskLists}
        coMembers={coMembers}
        initialContent={taskFormContent}
        focusField={taskFormFocusField}
        onSubmit={handleTaskFormSubmit}
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
