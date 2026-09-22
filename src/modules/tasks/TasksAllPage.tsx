import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO, startOfWeek } from 'date-fns'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CalendarClock, CheckCircle2, Filter, Inbox, SlidersHorizontal, X } from 'lucide-react'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { useChartTheme } from '@/hooks/useChartTheme'
import { useDashboardChartColors } from '@/modules/wallet/dashboard/chartColors'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { cn, errorMessage, todayISO } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { TaskListRow } from '@/modules/tasks/TaskListRow'
import { TaskDetailModal } from '@/modules/tasks/TaskDetailModal'
import { TaskComposer, type TaskComposerDraft } from '@/modules/tasks/composer/TaskComposer'
import { TaskFormModal, type TaskFormDraft } from '@/modules/tasks/composer/TaskFormModal'
import type { Task, TaskPriority } from '@/types/tasks.types'
import type { GroupMember } from '@/types/household.types'

/** `days` from today, using local date parts — never toISOString() (CLAUDE.md
 *  §16 trap 1). A local copy rather than importing TasksTodayPage's — that
 *  page is explicitly out of scope for this PR (locked file list). */
function isoDatePlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

type AssigneeFilter = 'all' | 'me' | 'unassigned'

const PRIORITY_OPTIONS = [
  { value: '', label: 'All priorities' },
  { value: 'high', label: 'High' },
  { value: 'med', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
]

/**
 * All tasks — the Tasks module's flat, filterable, everything-view page
 * (R5 PR-2, docs/archive/design-adoption/tasks-design-adoption.md §All tasks). Stat cards,
 * a filter bar with removable chips (mirrors WalletPage.tsx's pattern),
 * date-grouped rows including a "No due date" bucket, a twelve-week
 * completions chart, and an age-breakdown sentence.
 *
 * Two fetches total: `loadTasks('all')` (every open task) and
 * `loadTasks('completed')` (every completed task, for the chart) — every
 * stat, group and chip is derived client-side from those, no extra network
 * calls per the plan.
 */
export function TasksAllPage() {
  const { loadTasks, addTask, completeTask, rescheduleTasks } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const addToast = useToastStore((s) => s.addToast)
  const chart = useChartTheme()
  const colors = useDashboardChartColors()
  const navigate = useNavigate()

  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState('')
  const [priority, setPriority] = useState<TaskPriority | ''>('')
  const [assignee, setAssignee] = useState<AssigneeFilter>('all')
  const [listId, setListId] = useState<string>('')

  // FEAT-058: same shared "New task" modal FEAT-054/FEAT-057 wire up on
  // Today/Upcoming, opened from the composer's "Task"/"Assign" shortcuts.
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskFormContent, setTaskFormContent] = useState<string | undefined>(undefined)
  const [taskFormFocusField, setTaskFormFocusField] = useState<'assignee' | undefined>(undefined)

  // BUG-011: TaskDetailModal is the row's only route to priority/note edits —
  // this row has no inline editor for either.
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const openDetail = (task: Task) => {
    setDetailTask(task)
    setDetailOpen(true)
  }

  // `useTasks()`/`useTaskLists()` re-derive `loadTasks`/`loadTaskLists`/
  // `addToast` on every render of ANY subscriber to the tasks store,
  // including this page's own store mutations (e.g. `addTask` inside
  // `handleCreateTask`). Depending on those identities directly would
  // re-fire the mount effect below every time — once re-fetched, it can
  // overwrite this page's local optimistic state with a stale response.
  // Refs keep the effect's dependency array empty (TasksUpcomingPage.tsx
  // has the same pattern/comment).
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
        setOpenTasks(open)
        setCompletedTasks(done)
        setMembers(memberRows)
      })
      .catch((err) => {
        if (cancelled) return
        addToastRef.current({ message: errorMessage(err, 'Could not load your tasks.') })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const today = todayISO()

  // Only offer the assignee toggle once assignment data actually exists
  // (D-15) — a "me"/unassigned toggle over a field nobody has set is a
  // control that always does nothing.
  const hasAssignments = openTasks.some((t) => t.assigneeId !== null)

  const listById = useMemo(() => new Map(taskLists.map((l) => [l.id, l])), [taskLists])
  const coMembers = useMemo(() => members.map((m) => ({ userId: m.userId, username: m.username })), [members])

  // ── Stat cards (FEAT-058) — all from the two fetches already loaded, no
  // new network calls. ────────────────────────────────────────────────
  const overdueTasks = openTasks.filter((t) => t.dueDate !== null && t.dueDate < today)
  const overdueCount = overdueTasks.length
  // Same "oldest is N days" max-days-late computation TasksTodayPage.tsx's
  // `oldestOverdueDays` already has (mockup: Overdue band-stat sub-line) —
  // kept as a second local copy rather than extracted into a shared util:
  // TasksTodayPage.tsx is explicitly out of scope for this PR (locked file
  // list), so a shared helper would need a third file touched for no benefit
  // beyond these two ~6-line call sites.
  const oldestOverdueDays =
    overdueCount > 0
      ? Math.max(
          ...overdueTasks.map((t) => {
            const [y1, m1, d1] = t.dueDate!.split('-').map(Number)
            const [y2, m2, d2] = today.split('-').map(Number)
            return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
          }),
        )
      : null

  // "Due this week" (mockup: replaces the old "Due today" stat, which
  // undercounts vs the mockup's weekly framing) — dated open tasks within the
  // next 7 days inclusive of today. `dueTodayCount` stays as the sub-line's
  // "N of them today" subset.
  const weekEnd = isoDatePlus(6)
  const dueThisWeekTasks = openTasks.filter((t) => t.dueDate !== null && t.dueDate >= today && t.dueDate <= weekEnd)
  const dueThisWeekCount = dueThisWeekTasks.length
  const dueTodayCount = openTasks.filter((t) => t.dueDate === today).length

  const noDueDateTasks = openTasks.filter((t) => t.dueDate === null)
  const noDueDateCount = noDueDateTasks.length
  // "N sitting in {list name}" — whichever single list holds the most of the
  // no-due-date tasks, only named when it clearly dominates (a plurality of
  // at least half, so the sub-line never implies a concentration that isn't
  // real when the undated tasks are actually spread across many lists). Not
  // wrapped in useMemo: `noDueDateTasks` above is a fresh array every render
  // (it isn't itself memoized), so a memo keyed on it would never actually
  // hit — plain computation matches the other stats on this page.
  const noDueDateDominantList = (() => {
    if (noDueDateTasks.length === 0) return null
    const counts = new Map<string, number>()
    for (const t of noDueDateTasks) {
      const key = t.listId ?? ''
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let topKey = ''
    let topCount = 0
    for (const [key, count] of counts) {
      if (count > topCount) {
        topKey = key
        topCount = count
      }
    }
    // A tie (exactly half) shows no sub-line — "dominates" should mean more
    // than half, not an arbitrary pick by Map insertion order.
    if (topKey === '' || topCount <= noDueDateTasks.length / 2) return null
    const list = listById.get(topKey)
    if (!list) return null
    return { name: list.name, count: topCount }
  })()

  // "Done this week" — completions in the last 7 days, no "+N vs usual"
  // comparison (that needs a historical weekly average this page doesn't
  // load — same category FEAT-054/FEAT-057 both already declined to fabricate).
  const weekStartISO = isoDatePlus(-6)
  const doneThisWeekCount = completedTasks.filter(
    (t) => t.completedAt && t.completedAt.slice(0, 10) >= weekStartISO && t.completedAt.slice(0, 10) <= today,
  ).length

  // ── Filtering (criterion 3) ─────────────────────────────────────────
  const q = searchDraft.trim().toLowerCase()
  const filteredTasks = useMemo(() => {
    return openTasks.filter((t) => {
      if (priority && t.priority !== priority) return false
      if (assignee === 'me' && t.assigneeId !== currentUserId) return false
      if (assignee === 'unassigned' && t.assigneeId !== null) return false
      if (listId && t.listId !== listId) return false
      if (q && !t.content.toLowerCase().includes(q)) return false
      return true
    })
  }, [openTasks, priority, assignee, listId, q, currentUserId])

  const activeFilterCount = [priority !== '', assignee !== 'all', listId !== ''].filter(Boolean).length
  const anyFilterActive = activeFilterCount > 0 || q !== ''

  const clearAllFilters = () => {
    setSearchDraft('')
    setPriority('')
    setAssignee('all')
    setListId('')
  }

  // U-10 pattern (WalletPage.tsx): removable chips for the occasional
  // (collapsed) filters, same class names/structure so Wallet and Tasks
  // visually match.
  const filterChips = useMemo(() => {
    const chips: { key: string; label: string; onClear: () => void }[] = []
    if (priority) {
      const label = PRIORITY_OPTIONS.find((o) => o.value === priority)?.label ?? priority
      chips.push({ key: 'priority', label: `Priority: ${label}`, onClear: () => setPriority('') })
    }
    if (assignee !== 'all') {
      chips.push({
        key: 'assignee',
        label: `Assignee: ${assignee === 'me' ? 'Me' : 'Unassigned'}`,
        onClear: () => setAssignee('all'),
      })
    }
    if (listId) {
      const name = listById.get(listId)?.name ?? 'List'
      chips.push({ key: 'list', label: `List: ${name}`, onClear: () => setListId('') })
    }
    return chips
  }, [priority, assignee, listId, listById])

  // ── Date grouping (criterion 4) — matches TransactionList.tsx's
  // groupByDay convention: soonest/newest first, undated tasks in their own
  // trailing "No due date" group.
  const dateGroups = useMemo(() => {
    const grouped = new Map<string, Task[]>()
    const undated: Task[] = []
    for (const t of filteredTasks) {
      if (t.dueDate === null) {
        undated.push(t)
        continue
      }
      const existing = grouped.get(t.dueDate)
      if (existing) existing.push(t)
      else grouped.set(t.dueDate, [t])
    }
    const groups = Array.from(grouped.entries())
      .map(([date, tasks]) => ({ date, tasks }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return { groups, undated }
  }, [filteredTasks])

  // ── Age breakdown (criterion 7) ─────────────────────────────────────
  const ninetyDaysAgo = isoDatePlus(-90)
  const oldOpenCount = openTasks.filter((t) => t.createdAt.slice(0, 10) < ninetyDaysAgo).length

  // ── Twelve weeks of completions (criterion 6) ───────────────────────
  const completionWeeks = useMemo(() => {
    const weekStart = (dateStr: string) =>
      format(startOfWeek(parseISO(dateStr.slice(0, 10)), { weekStartsOn: 1 }), 'yyyy-MM-dd')

    const buckets: { weekStart: string; label: string; count: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const ws = weekStart(isoDatePlus(-7 * i))
      buckets.push({ weekStart: ws, label: format(parseISO(ws), 'd MMM'), count: 0 })
    }
    const byWeek = new Map(buckets.map((b) => [b.weekStart, b]))
    for (const t of completedTasks) {
      if (!t.completedAt) continue
      const ws = weekStart(t.completedAt)
      const bucket = byWeek.get(ws)
      if (bucket) bucket.count += 1
    }
    return buckets
  }, [completedTasks])

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

  // FEAT-052 / BUG-006: TaskListRow persists the edit itself (guard-free
  // hook functions — see its own doc comments); these only keep this page's
  // local `openTasks` array in sync so the row moves between due-date
  // groups (dateGroups is derived from openTasks) instead of showing a
  // stale bucket until the next reload.
  const handleContentChange = (id: string, content: string) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === id ? { ...t, content } : t)))
  }
  const handleDueDateChange = (id: string, dueDate: string | null) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === id ? { ...t, dueDate } : t)))
  }
  // FEAT-051: same staleness story — filteredTasks/dateGroups derive from
  // openTasks, and a `listId` filter is active on this page, so a task
  // moved out of the filtered list must actually disappear from view.
  const handleListChange = (id: string, listId: string | null) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === id ? { ...t, listId } : t)))
  }

  // BUG-011: TaskDetailModal saves the field itself; this only keeps this
  // page's local arrays in sync, same staleness story as the handlers above.
  // A task saved from the modal could be in either array (the modal doesn't
  // know which), so both are patched — the id that isn't present is a no-op.
  const handleDetailSaved = (updated: Task) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setCompletedTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setDetailTask(updated)
  }

  const handleScheduleUndated = async () => {
    const ids = dateGroups.undated.map((t) => t.id)
    if (ids.length === 0) return
    try {
      const updated = await rescheduleTasks(ids, today)
      const updatedIds = new Set(updated.map((t) => t.id))
      setOpenTasks((prev) => prev.map((t) => (updatedIds.has(t.id) ? { ...t, dueDate: today } : t)))
      addToast({ message: `Scheduled ${updated.length} task${updated.length === 1 ? '' : 's'} for today.` })
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not schedule those tasks — please try again.') })
    }
  }

  // Composer wiring (FEAT-058), mirroring TasksUpcomingPage.tsx's
  // handleCreateTask — same addTask-then-combined-PATCH shape, WITHOUT
  // Today's BUG-009 default-to-today: a task created here with no parsed
  // date stays undated and lands in the existing "No due date" group, which
  // is the correct outcome for an all-tasks flat view.
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
      setOpenTasks((prev) => [...prev, newTask])
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
      setOpenTasks((prev) => [...prev, merged])
    } catch (err) {
      // The task itself was created — only the follow-up detail patch failed.
      addToast({
        message: errorMessage(err, 'Task added, but its details could not be saved — please edit it to fix that.'),
      })
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

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">All tasks</h1>
          <p className="page-sub">Every open task, filterable and grouped by when it's due.</p>
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

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your tasks…</p>
      ) : (
        <>
          {/* Stat cards (FEAT-058) — four .stat-card tiles in a .grid.g4, the
              real mockup idiom (confirmed against the rendered
              tasks-all.html: each stat is `.card.stat-card` >
              `.stat-topline` (`.stat-icon` + `.stat-label`) > `.stat-value`
              > `.stat-foot`). NOT `.band-stats`/`.band-stat` — that idiom
              belongs to Today/Upcoming, whose mockups pair it with a
              `.band-main` sibling; without one here it renders with ~50%
              blank space. `.stat-foot` (src/styles/data.css) already exists
              for exactly the sub-line role below. */}
          <div className="grid g4 mb-4">
            <div className="card stat-card" data-testid="all-tasks-stat-overdue">
              <div className="stat-topline">
                <span className="stat-icon bg-neg-bg text-neg-fg">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
                <span className="stat-label">Overdue</span>
              </div>
              <p className={cn('stat-value', overdueCount > 0 && 'neg')}>{overdueCount}</p>
              {oldestOverdueDays !== null && (
                <p className="stat-foot">
                  Oldest is {oldestOverdueDays} day{oldestOverdueDays === 1 ? '' : 's'} old
                </p>
              )}
            </div>
            <div className="card stat-card" data-testid="all-tasks-stat-due-this-week">
              <div className="stat-topline">
                <span className="stat-icon bg-accent-bg text-accent-fg">
                  <CalendarClock className="h-3.5 w-3.5" />
                </span>
                <span className="stat-label">Due this week</span>
              </div>
              <p className="stat-value">{dueThisWeekCount}</p>
              {dueTodayCount > 0 && <p className="stat-foot">{dueTodayCount} of them today</p>}
            </div>
            <div className="card stat-card" data-testid="all-tasks-stat-no-due-date">
              <div className="stat-topline">
                <span className="stat-icon bg-info-bg text-info-fg">
                  <Inbox className="h-3.5 w-3.5" />
                </span>
                <span className="stat-label">No due date</span>
              </div>
              <p className="stat-value">{noDueDateCount}</p>
              {noDueDateDominantList && (
                <p className="stat-foot">
                  {noDueDateDominantList.count} sitting in {noDueDateDominantList.name}
                </p>
              )}
            </div>
            <div className="card stat-card" data-testid="all-tasks-stat-done-this-week">
              <div className="stat-topline">
                <span className="stat-icon bg-pos-bg text-pos-fg">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
                <span className="stat-label">Done this week</span>
              </div>
              <p className={cn('stat-value', doneThisWeekCount > 0 && 'pos')}>{doneThisWeekCount}</p>
            </div>
          </div>

          {/* Filter bar (criterion 3) — visibly distinct from the global AppBar
              search: labelled by what it filters, placed inside its own card,
              not a second copy of `.search`. */}
          <div className="card card-pad mb-4">
            <div className="filters">
              <div className="filter-field">
                <Filter className="h-3.5 w-3.5" />
                <input
                  id="all-tasks-filter"
                  type="search"
                  aria-label="Filter tasks"
                  data-testid="all-tasks-filter-input"
                  placeholder={`Filter these ${openTasks.length} tasks…`}
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen((o) => !o)}
                data-testid="all-tasks-filter-toggle"
                aria-expanded={filtersOpen}
                className={cn(
                  'filter-btn',
                  filtersOpen || activeFilterCount > 0
                    ? 'border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100'
                    : 'hover:bg-surface-hover hover:text-fg',
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="count" data-testid="all-tasks-filter-count">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {anyFilterActive && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  data-testid="all-tasks-filter-clear-all"
                  className="btn btn-quiet"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
            </div>

            {filterChips.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="all-tasks-filter-chips">
                {filterChips.map((chip) => (
                  <span key={chip.key} data-testid="all-tasks-filter-chip" className="chip chip-mute">
                    {chip.label}
                    <button
                      type="button"
                      onClick={chip.onClear}
                      aria-label="Remove filter"
                      title={`Remove ${chip.label}`}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-surface-hover"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {filtersOpen && (
              <div data-testid="all-tasks-filter-panel" className="mt-3 border-t border-line-subtle pt-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Select
                    label="Priority"
                    data-testid="all-tasks-filter-priority"
                    options={PRIORITY_OPTIONS.filter((o) => o.value !== '')}
                    placeholder="All priorities"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority | '')}
                  />
                  <Select
                    label="List"
                    data-testid="all-tasks-filter-list"
                    options={taskLists.map((l) => ({ value: l.id, label: l.name }))}
                    placeholder="All lists"
                    value={listId}
                    onChange={(e) => setListId(e.target.value)}
                  />
                  {hasAssignments && (
                    <Select
                      label="Assignee"
                      data-testid="all-tasks-filter-assignee"
                      options={[
                        { value: 'all', label: 'Everyone' },
                        { value: 'me', label: 'Me' },
                        { value: 'unassigned', label: 'Unassigned' },
                      ]}
                      value={assignee}
                      onChange={(e) => setAssignee(e.target.value as AssigneeFilter)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Age breakdown (criterion 7) */}
          {oldOpenCount > 0 && (
            <p className="mb-4 text-sm text-fg-subtle" data-testid="age-breakdown">
              {oldOpenCount} open task{oldOpenCount === 1 ? ' is' : 's are'} older than three months.
            </p>
          )}

          {/* Date-grouped list (criterion 4) */}
          {filteredTasks.length === 0 ? (
            <p className="py-3 text-sm text-fg-subtle" data-testid="all-tasks-empty">
              No tasks match these filters.
            </p>
          ) : (
            <div className="mb-6">
              {dateGroups.groups.map((group) => {
                const d = parseISO(group.date)
                return (
                  <div key={group.date}>
                    <div className="tgroup-head" data-testid="all-tasks-day-header">
                      <span className="tg-date">
                        <b>{format(d, 'EEE')}</b>, {format(d, 'dd MMM yyyy')}
                      </span>
                    </div>
                    {group.tasks.map((t) => (
                      <TaskListRow
                        key={t.id}
                        task={t}
                        list={t.listId ? listById.get(t.listId) : undefined}
                        onToggleComplete={handleToggleComplete}
                        onContentChange={handleContentChange}
                        onDueDateChange={handleDueDateChange}
                        availableLists={taskLists}
                        onListChange={handleListChange}
                        onOpenDetail={openDetail}
                      />
                    ))}
                  </div>
                )
              })}

              {dateGroups.undated.length > 0 && (
                <div>
                  <div className="tgroup" data-testid="all-tasks-no-due-date-group">
                    <span>No due date</span>
                    <span className="n">{dateGroups.undated.length}</span>
                    <span className="line" />
                    <button
                      type="button"
                      className="section-action"
                      onClick={handleScheduleUndated}
                      data-testid="schedule-undated-btn"
                    >
                      Schedule these
                    </button>
                  </div>
                  {dateGroups.undated.map((t) => (
                    <TaskListRow
                      key={t.id}
                      task={t}
                      list={t.listId ? listById.get(t.listId) : undefined}
                      onToggleComplete={handleToggleComplete}
                      onContentChange={handleContentChange}
                      onDueDateChange={handleDueDateChange}
                      availableLists={taskLists}
                      onListChange={handleListChange}
                      onOpenDetail={openDetail}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Twelve weeks of completions (criterion 6) */}
          <div className="card card-pad">
            <div className="card-head">
              <span className="card-title">Completed, last 12 weeks</span>
            </div>
            <div
              role="img"
              aria-label={`Tasks completed per week over the last twelve weeks, totalling ${completedTasks.length} tasks completed ever.`}
            >
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={completionWeeks} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke={chart.axis}
                    tick={{ fill: chart.axis }}
                    fontSize={11}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis
                    stroke={chart.axis}
                    tick={{ fill: chart.axis }}
                    fontSize={11}
                    tickLine={false}
                    width={28}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={chart.tooltip.contentStyle}
                    labelStyle={chart.tooltip.labelStyle}
                    itemStyle={chart.tooltip.itemStyle}
                    labelFormatter={(label: string) => `Week of ${label}`}
                    formatter={(value: number) => [`${value} completed`, '']}
                  />
                  <Bar dataKey="count" name="Completed" fill={colors.magnitude} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      <TaskDetailModal
        task={detailTask}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        availableLists={taskLists}
        coMembers={coMembers}
        onSaved={handleDetailSaved}
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
