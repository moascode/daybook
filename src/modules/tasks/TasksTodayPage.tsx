import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { cn, errorMessage, todayISO } from '@/lib/utils'
import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react'
import { TaskRow } from '@/modules/tasks/TaskRow'
import { TaskDetailModal } from '@/modules/tasks/TaskDetailModal'
import { TaskComposer, type TaskComposerDraft } from '@/modules/tasks/composer/TaskComposer'
import { TaskFormModal, type TaskFormDraft } from '@/modules/tasks/composer/TaskFormModal'
import type { Task } from '@/types/tasks.types'
import type { GroupMember } from '@/types/household.types'

/** `days` from today, using local date parts — never toISOString() (CLAUDE.md §3 Traps). */
function isoDatePlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

type TodayAudience = 'mine' | 'everyone'

/**
 * Today — the Tasks module's landing page (R5 PR-1,
 * docs/archive/design-adoption/tasks-design-adoption.md §Today). Band (done-today progress +
 * overdue/assigned/finished-this-week + a 7-day load strip), the full
 * Wallet-syntax composer (FEAT-054), the Overdue/Today/Done-today grouped
 * list, and an "Up next" + "Lists" + "Worth knowing" right rail.
 */
export function TasksTodayPage() {
  const { loadTasks, addTask, completeTask, rescheduleTasks } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const addToast = useToastStore((s) => s.addToast)

  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [doneCollapsed, setDoneCollapsed] = useState(false)
  const [audience, setAudience] = useState<TodayAudience>('mine')
  const composerInputRef = useRef<HTMLInputElement>(null)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  // FEAT-054 follow-up: one shared "New task" modal for both the composer's
  // "Task" (blank) and "Assign" (assignee field focused) shortcuts — see
  // TaskFormModal.tsx.
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskFormContent, setTaskFormContent] = useState<string | undefined>(undefined)
  const [taskFormFocusField, setTaskFormFocusField] = useState<'assignee' | undefined>(undefined)

  // BUG-005 (docs/backlog/EP-07-tasks-depth/BUG-005-quick-add-task-noop.md):
  // the global quick-add's "Task" action navigates here with
  // `{ focusComposer: true }` so the cursor lands straight in the composer
  // instead of just changing the route. Same one-shot nav-state +
  // `location.key` guard WalletPage.tsx uses for its own quick-add flag — a
  // navigation to the route we're already on updates `location` without
  // remounting, so a lazy `useState` initializer would miss it.
  const location = useLocation()
  const navigate = useNavigate()
  const shouldFocusComposer = (location.state as { focusComposer?: boolean } | null)?.focusComposer
  const [handledFocusKey, setHandledFocusKey] = useState<string | null>(null)
  if (shouldFocusComposer && location.key !== handledFocusKey) {
    setHandledFocusKey(location.key)
  }
  useEffect(() => {
    // Gated on `!loading` too: the composer only exists once the initial
    // fetch resolves (below, inside the `loading ? ... : ...` branch), so
    // running this before then would find `composerInputRef.current` still
    // null and never get another chance once the nav state is cleared.
    if (shouldFocusComposer && handledFocusKey === location.key && !loading) {
      composerInputRef.current?.focus()
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [shouldFocusComposer, handledFocusKey, location, navigate, loading])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadTasks('all'),
      loadTasks('completed'),
      loadTaskLists(),
      api.get<Record<string, unknown>[]>('/groups/members').then((rows) => rows.map(mapMember)),
    ])
      .then(([open, done, , memberRows]) => {
        if (cancelled) return
        setOpenTasks(open)
        setCompletedTasks(done)
        setMembers(memberRows)
      })
      .catch((err) => {
        if (cancelled) return
        addToast({ message: errorMessage(err, 'Could not load your tasks.') })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadTasks, loadTaskLists, addToast])

  const today = todayISO()
  const todayLabel = format(parseISO(today), 'EEEE d MMMM')

  const listById = useMemo(() => new Map(taskLists.map((l) => [l.id, l])), [taskLists])
  const coMembers = useMemo(() => members.map((m) => ({ userId: m.userId, username: m.username })), [members])

  // "Mine" filters both arrays to tasks owned by or assigned to the current
  // user; "Everyone" leaves the already-loaded own+assigned+shared-list set
  // (GET /tasks already scopes that server-side) untouched. No new fetch.
  const mineFilter = (t: Task) => t.ownerId === currentUserId || t.assigneeId === currentUserId
  const visibleOpen = audience === 'mine' ? openTasks.filter(mineFilter) : openTasks
  const visibleCompleted = audience === 'mine' ? completedTasks.filter(mineFilter) : completedTasks

  const overdueTasks = visibleOpen.filter((t) => t.dueDate !== null && t.dueDate < today)
  const todayTasks = visibleOpen.filter((t) => t.dueDate === today)
  const doneTodayTasks = visibleCompleted.filter((t) => t.completedAt?.slice(0, 10) === today)
  const upNext = visibleOpen
    .filter((t) => t.dueDate !== null && t.dueDate > today)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
    .slice(0, 5)

  // "oldest is N days" (mockup: proposal-v2/tasks.html's Overdue band-stat
  // subline) — the other two mockup sublines aren't added here: "2 to Priya,
  // 3 to Jordan" is a breakdown of tasks *delegated to others*, a different
  // stat than "Assigned to me" (tasks assigned to the viewer, which has only
  // one possible assignee — nothing to break down); "best week since June"
  // needs historical completion data this page doesn't load.
  const oldestOverdueDays =
    overdueTasks.length > 0
      ? Math.max(
          ...overdueTasks.map((t) => {
            const [y1, m1, d1] = t.dueDate!.split('-').map(Number)
            const [y2, m2, d2] = today.split('-').map(Number)
            return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
          }),
        )
      : null

  const assignedCount = visibleOpen.filter((t) => t.assigneeId === currentUserId).length
  const weekStart = isoDatePlus(-6)
  const finishedThisWeekCount = visibleCompleted.filter(
    (t) => t.completedAt && t.completedAt.slice(0, 10) >= weekStart && t.completedAt.slice(0, 10) <= today,
  ).length

  const totalToday = overdueTasks.length + todayTasks.length + doneTodayTasks.length
  const doneCount = doneTodayTasks.length
  const donePct = totalToday > 0 ? Math.round((doneCount / totalToday) * 100) : 0
  const lateOfDueTodayCount = overdueTasks.length

  const loadStrip = Array.from({ length: 7 }, (_, i) => {
    const date = isoDatePlus(i)
    const count = visibleOpen.filter((t) => t.dueDate === date).length
    return { date, label: format(parseISO(date), 'EEE'), count }
  })
  const maxLoad = Math.max(1, ...loadStrip.map((d) => d.count))
  const isHeaviestDay = loadStrip[0].count > 0 && loadStrip[0].count === maxLoad && loadStrip.some((d) => d.count < loadStrip[0].count)

  const openDetail = (task: Task) => {
    setDetailTask(task)
    setDetailOpen(true)
  }

  const handleToggleComplete = async (id: string) => {
    try {
      const updated = await completeTask(id)
      if (updated.isCompleted) {
        setOpenTasks((prev) => prev.filter((t) => t.id !== id))
        setCompletedTasks((prev) => [updated, ...prev])
      } else {
        setCompletedTasks((prev) => prev.filter((t) => t.id !== id))
        setOpenTasks((prev) => [...prev, updated])
      }
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not update that task — please try again.') })
    }
  }

  const handleContentChange = (taskId: string, content: string) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, content } : t)))
    setCompletedTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, content } : t)))
  }
  const handleDueDateChange = (taskId: string, dueDate: string | null) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate } : t)))
    setCompletedTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate } : t)))
  }
  const handleDelete = (taskId: string) => {
    setOpenTasks((prev) => prev.filter((t) => t.id !== taskId))
    setCompletedTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  const handleRescheduleAll = async () => {
    if (overdueTasks.length === 0) return
    const ids = overdueTasks.map((t) => t.id)
    try {
      const updated = await rescheduleTasks(ids, today)
      const updatedIds = new Set(updated.map((t) => t.id))
      setOpenTasks((prev) => prev.map((t) => (updatedIds.has(t.id) ? { ...t, dueDate: today } : t)))
      addToast({ message: `Rescheduled ${updated.length} task${updated.length === 1 ? '' : 's'} to today.` })
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not reschedule those tasks — please try again.') })
    }
  }

  // FEAT-054: the composer parses a whole line ("pay rent tomorrow 9am
  // #household !high @tumpa") into a draft — create the task plain, then
  // fold every non-null parsed field into ONE follow-up PATCH (mirrors the
  // combined-update shape updateTaskDueDate/updateTaskDueTime already send,
  // per BUG-009's fix), rather than chaining several guard-free setters and
  // paying for a round trip each.
  const handleCreateTask = async (draft: TaskComposerDraft) => {
    let newTask: Task
    try {
      newTask = await addTask(draft.content, null)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not add that task — please try again.') })
      return
    }

    // BUG-009: a task added from Today always defaults to today's date so it
    // still lands in the Today group, even when the composer text has no
    // date word — the parser leaving dueDate null must not mean "no date".
    const dueDate = draft.dueDate ?? today

    const patch: Record<string, unknown> = { dueDate }
    if (draft.listId !== null) patch.listId = draft.listId
    if (draft.priority !== null) patch.priority = draft.priority
    if (draft.assigneeId !== null) patch.assigneeId = draft.assigneeId
    if (draft.dueTime !== null) patch.dueTime = draft.dueTime

    try {
      const row = await api.patch<Record<string, unknown>>(`/tasks/${newTask.id}`, patch)
      const merged: Task = {
        ...newTask,
        listId: (row.list_id as string | null | undefined) ?? draft.listId ?? newTask.listId,
        priority: (row.priority as Task['priority'] | undefined) ?? draft.priority ?? newTask.priority,
        assigneeId: (row.assignee_id as string | null | undefined) ?? draft.assigneeId ?? newTask.assigneeId,
        dueDate: (row.due_date as string | null | undefined) ?? dueDate,
        dueTime: (row.due_time as string | null | undefined) ?? draft.dueTime ?? newTask.dueTime,
      }
      setOpenTasks((prev) => [...prev, merged])
    } catch (err) {
      // The task itself was created — only the follow-up detail patch failed.
      // Surface that distinction rather than implying the whole add failed.
      addToast({ message: errorMessage(err, 'Task added, but its details could not be saved — please edit it to fix that.') })
      setOpenTasks((prev) => [...prev, newTask])
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

  // "Worth knowing" — only what's honestly derivable from data already on
  // the page (no fabricated "moved N times" stat — no such tracking exists).
  const noDueDateCount = visibleOpen.filter((t) => t.dueDate === null).length
  const eveningTodayCount = todayTasks.filter((t) => t.dueTime && Number(t.dueTime.slice(0, 2)) >= 17).length
  const loadImbalance = maxLoad - Math.min(...loadStrip.map((d) => d.count))
  const worthKnowing: { title: string; sub: string; href: string }[] = []
  if (loadImbalance >= 3) {
    worthKnowing.push({
      title: 'Your week is lopsided',
      sub: `Busiest day has ${maxLoad}, lightest has ${Math.min(...loadStrip.map((d) => d.count))} — worth spreading out.`,
      href: '/tasks/upcoming',
    })
  }
  if (noDueDateCount > 0) {
    worthKnowing.push({
      title: `${noDueDateCount} task${noDueDateCount === 1 ? '' : 's'} with no due date`,
      sub: 'Nothing is tracking when these should happen.',
      href: '/tasks/all',
    })
  }
  if (eveningTodayCount > 0) {
    worthKnowing.push({
      title: `${eveningTodayCount} evening task${eveningTodayCount === 1 ? '' : 's'} today`,
      sub: 'Your evening is loaded up — plan around it.',
      href: '/tasks/all',
    })
  }

  const rescheduleLabel =
    overdueTasks.length === 2
      ? 'Reschedule both to today'
      : overdueTasks.length === 1
        ? 'Reschedule to today'
        : `Reschedule all ${overdueTasks.length} to today`

  return (
    <div className="content">
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
              onClick={() => setAudience('mine')}
              data-testid="today-audience-mine"
            >
              Mine
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={audience === 'everyone'}
              onClick={() => setAudience('everyone')}
              data-testid="today-audience-everyone"
            >
              Everyone
            </button>
          </div>
          <button
            type="button"
            className="section-action"
            onClick={() => navigate('/tasks/upcoming')}
            data-testid="today-plan-week-btn"
          >
            Plan week
          </button>
        </div>
      </div>

      <TaskComposer
        ref={composerInputRef}
        lists={taskLists}
        coMembers={coMembers}
        onCreateTask={handleCreateTask}
        onOpenHabitModal={handleOpenHabitModal}
        onOpenTaskForm={handleOpenTaskForm}
        onOpenAssignForm={handleOpenAssignForm}
      />

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your tasks…</p>
      ) : (
        <div className="dash">
          {/* Band */}
          <section className="card card-pad c12" data-testid="today-band">
            <div className="card-head">
              <div>
                <span className="card-title">{todayLabel}</span>
                <div className="card-sub">
                  {todayTasks.length + overdueTasks.length === 0
                    ? "Nothing due today — you're all caught up."
                    : `${todayTasks.length + overdueTasks.length} due today · ${lateOfDueTodayCount} of them are already late`}
                </div>
              </div>
              {isHeaviestDay && (
                <span className="chip chip-warn ml-auto" data-testid="today-heaviest-chip">
                  Heaviest day this week
                </span>
              )}
            </div>

            <div className="band">
              <div className="band-main">
                <div className="band-fig">
                  <span className="v">
                    {doneCount} of {totalToday}
                  </span>
                  <span className="k">done today</span>
                </div>
                <div className="track mt-3">
                  <i className="bg-pos" style={{ width: `${donePct}%` }} />
                </div>
              </div>
              <div className="band-stats">
                <div className="band-stat">
                  <p className="k">Overdue</p>
                  <p className="v">{overdueTasks.length}</p>
                  {oldestOverdueDays !== null && <p className="s">oldest is {oldestOverdueDays} days</p>}
                </div>
                <div className="band-stat">
                  <p className="k">Assigned to me</p>
                  <p className="v">{assignedCount}</p>
                </div>
                <div className="band-stat">
                  <p className="k">Finished this week</p>
                  <p className="v">{finishedThisWeekCount}</p>
                </div>
              </div>
            </div>

            <div className="divider" />

            <div className="load mt-4">
              {loadStrip.map((d, i) => (
                <div key={d.date} className={cn('load-day', i === 0 && 'today')} data-testid="load-day">
                  <div className="load-d">{d.label}</div>
                  <div className="load-n">{d.count}</div>
                  <div className="load-bar">
                    <i style={{ width: `${(d.count / maxLoad) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="c8 stack">
            {overdueTasks.length > 0 && (
              <div>
                <div className="tgroup">
                  <AlertTriangle className="icon-sm text-neg-fg" aria-hidden="true" />
                  <span className="text-neg-fg">Overdue</span>
                  <span className="n">{overdueTasks.length}</span>
                  <span className="line" />
                  <button
                    type="button"
                    className="section-action"
                    onClick={handleRescheduleAll}
                    data-testid="reschedule-all-btn"
                  >
                    {rescheduleLabel}
                  </button>
                </div>
                {overdueTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    list={t.listId ? listById.get(t.listId) : undefined}
                    coMembers={coMembers}
                    onToggleComplete={handleToggleComplete}
                    onOpenDetail={openDetail}
                    onContentChange={handleContentChange}
                    onDueDateChange={handleDueDateChange}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}

            <div>
              <div className="tgroup">
                <Clock className="icon-sm text-accent" aria-hidden="true" />
                <span>Today</span>
                <span className="n">{todayTasks.length}</span>
                <span className="line" />
              </div>
              {todayTasks.length === 0 ? (
                <p className="py-3 text-sm text-fg-subtle">Nothing due today.</p>
              ) : (
                todayTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    list={t.listId ? listById.get(t.listId) : undefined}
                    coMembers={coMembers}
                    onToggleComplete={handleToggleComplete}
                    onOpenDetail={openDetail}
                    onContentChange={handleContentChange}
                    onDueDateChange={handleDueDateChange}
                    onDelete={handleDelete}
                  />
                ))
              )}
            </div>

            {doneTodayTasks.length > 0 && (
              <div>
                <div className="tgroup">
                  <CheckCircle2 className="icon-sm text-pos-fg" aria-hidden="true" />
                  <span>Done today</span>
                  <span className="n">{doneTodayTasks.length}</span>
                  <span className="line" />
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => setDoneCollapsed((v) => !v)}
                    aria-expanded={!doneCollapsed}
                    data-testid="done-today-toggle"
                  >
                    {doneCollapsed ? 'Show' : 'Hide'}
                  </button>
                </div>
                {!doneCollapsed &&
                  doneTodayTasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      list={t.listId ? listById.get(t.listId) : undefined}
                      coMembers={coMembers}
                      onToggleComplete={handleToggleComplete}
                      onOpenDetail={openDetail}
                      onContentChange={handleContentChange}
                      onDueDateChange={handleDueDateChange}
                      onDelete={handleDelete}
                    />
                  ))}
              </div>
            )}
          </section>

          <aside className="c4 stack">
            <div className="card card-pad">
              <div className="card-head">
                <span className="card-title">Up next</span>
                <button type="button" className="section-action" onClick={() => navigate('/tasks/upcoming')}>
                  Week →
                </button>
              </div>
              {upNext.length === 0 ? (
                <p className="text-sm text-fg-subtle">Nothing scheduled yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {upNext.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2" data-testid="upnext-row">
                      <span className="truncate text-sm">{t.content || 'Untitled task'}</span>
                      <span className="task-when text-xs">{format(parseISO(t.dueDate!), 'dd MMM')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {taskLists.length > 0 && (
              <div className="card card-pad" data-testid="today-lists-card">
                <div className="card-head">
                  <span className="card-title">Lists</span>
                  <button type="button" className="section-action" onClick={() => navigate('/tasks/all')}>
                    All →
                  </button>
                </div>
                <div className="stack">
                  {taskLists.map((l) => {
                    const done = completedTasks.filter((t) => t.listId === l.id).length
                    const open = openTasks.filter((t) => t.listId === l.id).length
                    const total = done + open
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0
                    return (
                      <div key={l.id} className="lrow-list" data-testid={`today-list-progress-${l.id}`}>
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ background: l.color }}
                          aria-hidden="true"
                        />
                        <span className="flex-1 truncate text-sm">{l.name}</span>
                        <span className="track">
                          <i className="bg-pos" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="text-xs text-fg-subtle">
                          {done}/{total}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {worthKnowing.length > 0 && (
              <div className="card card-pad" data-testid="today-worth-knowing-card">
                <div className="card-head">
                  <span className="card-title">Worth knowing</span>
                </div>
                <div>
                  {worthKnowing.map((w) => (
                    <div key={w.title} className="sug">
                      <div className="sug-main">
                        <p className="sug-title">{w.title}</p>
                        <p className="sug-sub">{w.sub}</p>
                      </div>
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => navigate(w.href)}>
                        View
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      <TaskDetailModal
        task={detailTask}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        availableLists={taskLists}
        coMembers={coMembers}
        onSaved={(updated) => {
          setOpenTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
          setCompletedTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
        }}
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
