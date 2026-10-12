import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import {
  DndContext,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useWalletRefChips } from '@/hooks/useWalletRefChips'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { errorMessage, todayISO } from '@/lib/utils'
import { TaskDetailModal } from '@/modules/tasks/TaskDetailModal'
import { TaskComposer, type TaskComposerDraft } from '@/modules/tasks/composer/TaskComposer'
import { TaskFormModal, type TaskFormDraft } from '@/modules/tasks/composer/TaskFormModal'
import { WeekHead } from '@/modules/tasks/upcoming/WeekHead'
import { BandStats } from '@/modules/tasks/upcoming/BandStats'
import { WeekBoard } from '@/modules/tasks/upcoming/WeekBoard'
import { WaitingSection } from '@/modules/tasks/upcoming/WaitingSection'
import { BalanceCard } from '@/modules/tasks/upcoming/BalanceCard'
import {
  bandTitle,
  describeAssignedDays,
  formatWeekRange,
  mondayOf,
  planAutoSchedule,
  shiftDate,
  usualWeek,
  weekDatesFrom,
} from '@/modules/tasks/upcoming/weekMath'
import type { Task } from '@/types/tasks.types'
import type { GroupMember } from '@/types/household.types'

/**
 * Drop onto the day column under the pointer; with no pointer (a keyboard
 * drag), fall back to whichever column the dragged card overlaps. Never
 * `closestCenter`: it always picks *some* column, so a "Waiting for a date"
 * row nudged past the 8px activation distance and let go where it was would
 * be scheduled onto whichever day happened to be nearest.
 */
const dropOnDay: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : rectIntersection(args)
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
 * Upcoming — `/tasks/upcoming` (FEAT-026, mockup parity FEAT-057). A 7-column
 * week board (Mon→Sun, navigable ±1 week at a time) rather than another flat
 * list — planning across a week is spatial, so the layout is a canvas of day
 * columns, each drag-and-drop capable, plus a "Waiting for a date" section
 * below for undated tasks and a "Balance the week" helper that proposes
 * moving tasks off the busiest day.
 *
 * Two fetches: `loadTasks('all')` (every incomplete task) and
 * `loadTasks('completed')` (for "Your usual week"'s historical baseline) —
 * neither touches the Zustand store (unlike the outliner's unfiltered
 * fetch), so this page keeps its own local `tasks`/`completedTasks` state
 * and mutates it optimistically alongside every
 * `rescheduleTasks`/`updateTask`/`completeTask` call.
 */
export function TasksUpcomingPage() {
  const { loadTasks, addTask, updateTask, rescheduleTasks, completeTask } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const { ensureLoaded: ensureWalletChips, resolveChip } = useWalletRefChips()
  const currentUser = useAppStore((s) => s.user)
  const addToast = useToastStore((s) => s.addToast)
  const navigate = useNavigate()

  const [tasks, setTasks] = useState<Task[]>([])
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [autoScheduling, setAutoScheduling] = useState(false)
  // Weeks offset from the current one — 0 = this week, ±1 = next/previous, etc.
  const [weekOffset, setWeekOffset] = useState(0)

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
      loadTasksRef.current('completed'),
      loadTaskListsRef.current(),
      api.get<Record<string, unknown>[]>('/groups/members').then((rows) => rows.map(mapMember)),
    ])
      .then(([open, done, , memberRows]) => {
        if (cancelled) return
        setTasks(open)
        setCompletedTasks(done)
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

  // Wallet-linked chips (board cards + waiting rows): resolved once for the
  // page, only fetched when a loaded task actually links to Wallet — same
  // pattern as TasksAllPage.tsx.
  const anyWalletRef = tasks.some((t) => t.walletRef)
  useEffect(() => {
    if (!anyWalletRef) return
    ensureWalletChips().catch((err: unknown) => {
      addToastRef.current({ message: errorMessage(err, 'Could not load the Wallet links on these tasks.') })
    })
  }, [anyWalletRef, ensureWalletChips])

  const listById = useMemo(() => new Map(taskLists.map((l) => [l.id, l])), [taskLists])
  const coMembers = useMemo(() => members.map((m) => ({ userId: m.userId, username: m.username })), [members])

  const today = todayISO()
  const currentMonday = useMemo(() => mondayOf(today), [today])
  const monday = useMemo(() => shiftDate(currentMonday, weekOffset * 7), [currentMonday, weekOffset])
  const week = useMemo(() => weekDatesFrom(monday), [monday])

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

  // Band stats (FEAT-057 mockup parity): tasks due within the displayed
  // `week`, split into "hard deadlines" (owner-approved definition: has a
  // specific time, or is flagged high-priority — genuinely fixed points in
  // the week) and "recurring" (recurrence set; a task can be both). Built
  // from `tasksByDay`'s values rather than filtering `tasks` directly, so
  // this only counts the same dated-within-the-displayed-week set the day
  // columns show.
  const weekTasks = useMemo(() => [...tasksByDay.values()].flat(), [tasksByDay])
  const scheduledCount = weekTasks.length

  const isHeaviestDayGenuine = maxEntry.count > 0 && dayCounts.some((d) => d.count < maxEntry.count)

  const hardDeadlineTasks = useMemo(
    () => weekTasks.filter((t) => t.dueTime !== null || t.priority === 'high'),
    [weekTasks],
  )
  const recurringTasks = useMemo(() => weekTasks.filter((t) => t.recurrence !== null), [weekTasks])
  const usual = useMemo(() => usualWeek(completedTasks, monday, scheduledCount), [completedTasks, monday, scheduledCount])
  const bandTitleText = bandTitle(weekOffset, formatWeekRange(monday))

  // Balance-the-week card (FEAT-057): recomputed from `tasksByDay` on every
  // render, so as candidates move off `maxEntry.date` the list shrinks (and
  // `canBalance` goes false) with no extra state — each row acts
  // independently via `moveTaskToDate`. Same `Math.floor(gap / 2)` sizing and
  // `sortForBalancing` candidate order FEAT-026's original batch move used.
  const balanceCandidates = useMemo(() => {
    if (!canBalance) return []
    const n = Math.floor(gap / 2)
    const maxDayTasks = tasksByDay.get(maxEntry.date) ?? []
    return sortForBalancing(maxDayTasks).slice(0, n)
  }, [canBalance, gap, tasksByDay, maxEntry.date])

  // One-line reason per candidate — only what's honestly derivable from the
  // task/day data already in scope (CLAUDE.md rule 7: no fabricated reasons).
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
  // Returns whether the move actually persisted, so a batch caller
  // (handleAutoSchedule) can tally successes without re-deriving the same
  // ownership check — the toast on failure still fires here, once, either way.
  const moveTaskToDate = async (taskId: string, dueDate: string): Promise<boolean> => {
    const previousDate = tasks.find((t) => t.id === taskId)?.dueDate ?? null
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate } : t)))
    try {
      const updated = await rescheduleTasks([taskId], dueDate)
      // `rescheduleTasks` is owner-scoped server-side (a shared task's due
      // date is the owner's call, not the assignee's) and silently updates 0
      // rows for a task this viewer doesn't own — no throw, since that's a
      // normal outcome, not an error. Reconcile against what the server
      // actually moved rather than trusting the optimistic update above.
      if (updated.length === 0) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate: previousDate } : t)))
        addToast({ message: "Couldn't move that task — you can only reschedule tasks you own." })
        return false
      }
      return true
    } catch {
      // rescheduleTasks already surfaced the error and reconciled the store.
      return false
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
      await updateTask(newTask.id, { dueDate: date, listId })
      setTasks((prev) => [...prev, { ...newTask, dueDate: date, listId }])
    } catch {
      // addTask/updateTask already surfaced the error and reconciled the store.
    }
  }

  // "Auto-schedule into the gaps" (FEAT-057): plan client-side (least-loaded
  // eligible day, ties to the earliest), then persist each assignment
  // through the same `moveTaskToDate` every other move on this page already
  // goes through — so the per-task ownership-failure toast ("you can only
  // reschedule tasks you own") is already handled there; this only adds the
  // batch-level summary and reports a day with no eligible slot at all
  // (CLAUDE.md rule 10: never resolve silently).
  const handleAutoSchedule = async () => {
    const currentCounts = new Map(week.map((d) => [d, tasksByDay.get(d)?.length ?? 0]))
    const { assignments, skipped } = planAutoSchedule(undated, week, today, currentCounts)
    if (assignments.length === 0) {
      addToast({
        message:
          skipped > 0
            ? "Couldn't auto-schedule — no day in this week is today or later."
            : 'Nothing to schedule.',
      })
      return
    }

    setAutoScheduling(true)
    const moved: typeof assignments = []
    try {
      for (const a of assignments) {
        const ok = await moveTaskToDate(a.taskId, a.date)
        if (ok) moved.push(a)
      }
    } finally {
      setAutoScheduling(false)
    }

    if (moved.length > 0) {
      const span = describeAssignedDays(moved)
      addToast({
        message: `Scheduled ${moved.length} task${moved.length === 1 ? '' : 's'} ${span.includes('–') ? 'across' : 'on'} ${span}.`,
      })
    }
    if (skipped > 0) {
      addToast({ message: `${skipped} task${skipped === 1 ? '' : 's'} left waiting — no eligible day this week.` })
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
      <WeekHead
        monday={monday}
        weekOffset={weekOffset}
        onPrev={() => setWeekOffset((o) => o - 1)}
        onNext={() => setWeekOffset((o) => o + 1)}
        onThisWeek={() => setWeekOffset(0)}
      />

      <TaskComposer
        lists={taskLists}
        coMembers={coMembers}
        onCreateTask={handleCreateTask}
        onOpenHabitModal={handleOpenHabitModal}
        onOpenTaskForm={handleOpenTaskForm}
        onOpenAssignForm={handleOpenAssignForm}
      />

      {!loading && weekTasks.length > 0 && (
        <BandStats
          bandTitleText={bandTitleText}
          scheduledCount={scheduledCount}
          undatedCount={undated.length}
          isHeaviestDayGenuine={isHeaviestDayGenuine}
          heaviestDayDate={maxEntry.date}
          hardDeadlineTasks={hardDeadlineTasks}
          recurringTasks={recurringTasks}
          usual={usual}
        />
      )}

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your upcoming tasks…</p>
      ) : (
        <>
          {/* One DndContext around the week AND the waiting list, so an
              undated task can be dragged straight onto a day — before, the
              waiting rows sat outside the context and could only be dated
              through their picker. */}
          <DndContext sensors={sensors} collisionDetection={dropOnDay} onDragEnd={handleDragEnd}>
            <WeekBoard
              week={week}
              tasksByDay={tasksByDay}
              listById={listById}
              taskLists={taskLists}
              resolveWalletChip={resolveChip}
              onAddTask={handleAddTask}
              onOpenDetail={openDetail}
            />

            <div className="dash mt-4">
              <div className="c8">
                <WaitingSection
                  undated={undated}
                  listById={listById}
                  coMembers={coMembers}
                  currentUser={currentUser}
                  onComplete={handleComplete}
                  onOpenDetail={openDetail}
                  onSetDate={(taskId, date) => {
                    if (!week.includes(date)) {
                      addToast({ message: `Scheduled for ${format(parseISO(date), 'd MMM')} — outside this week` })
                    }
                    void moveTaskToDate(taskId, date)
                  }}
                  onAutoSchedule={() => void handleAutoSchedule()}
                  autoScheduling={autoScheduling}
                />
              </div>
              <div className="c4">
                <BalanceCard
                  canBalance={canBalance}
                  candidates={balanceCandidates}
                  maxEntry={maxEntry}
                  minEntry={minEntry}
                  balanceReason={balanceReason}
                  onMove={(taskId) => void moveTaskToDate(taskId, minEntry.date)}
                />
              </div>
            </div>
          </DndContext>
        </>
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
