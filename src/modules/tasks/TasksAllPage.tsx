import { useEffect, useMemo, useState } from 'react'
import { format, parseISO, startOfWeek } from 'date-fns'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Filter, SlidersHorizontal, X } from 'lucide-react'
import { ListChecks, AlertTriangle, CalendarClock, Inbox } from 'lucide-react'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { useChartTheme } from '@/hooks/useChartTheme'
import { useDashboardChartColors } from '@/modules/wallet/dashboard/chartColors'
import { cn, errorMessage, todayISO } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { TaskListRow } from '@/modules/tasks/TaskListRow'
import type { Task, TaskPriority } from '@/types/tasks.types'

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
 * (R5 PR-2, docs/v2/tasks/02-design-adoption.md §All tasks). Stat cards,
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
  const { loadTasks, completeTask, rescheduleTasks } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const addToast = useToastStore((s) => s.addToast)
  const chart = useChartTheme()
  const colors = useDashboardChartColors()

  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState('')
  const [priority, setPriority] = useState<TaskPriority | ''>('')
  const [assignee, setAssignee] = useState<AssigneeFilter>('all')
  const [listId, setListId] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    Promise.all([loadTasks('all'), loadTasks('completed'), loadTaskLists()])
      .then(([open, done]) => {
        if (cancelled) return
        setOpenTasks(open)
        setCompletedTasks(done)
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

  // Only offer the assignee toggle once assignment data actually exists
  // (D-15) — a "me"/unassigned toggle over a field nobody has set is a
  // control that always does nothing.
  const hasAssignments = openTasks.some((t) => t.assigneeId !== null)

  const listById = useMemo(() => new Map(taskLists.map((l) => [l.id, l])), [taskLists])

  // ── Stat cards (criterion 2) — all from the one `openTasks` fetch ──────
  const overdueCount = openTasks.filter((t) => t.dueDate !== null && t.dueDate < today).length
  const dueTodayCount = openTasks.filter((t) => t.dueDate === today).length
  const noDueDateCount = openTasks.filter((t) => t.dueDate === null).length

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

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">All tasks</h1>
          <p className="page-sub">Every open task, filterable and grouped by when it's due.</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your tasks…</p>
      ) : (
        <>
          {/* Stat cards (criterion 2) */}
          <div className="grid g4 mb-4">
            <div className="card stat-card">
              <div className="stat-topline">
                <span className="stat-icon bg-accent-bg text-accent-fg">
                  <ListChecks className="h-3.5 w-3.5" />
                </span>
                <span className="stat-label">Open</span>
              </div>
              <p className="stat-value" data-testid="stat-open">{openTasks.length}</p>
            </div>
            <div className="card stat-card">
              <div className="stat-topline">
                <span className="stat-icon bg-neg-bg text-neg-fg">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
                <span className="stat-label">Overdue</span>
              </div>
              <p className={cn('stat-value', overdueCount > 0 && 'neg')} data-testid="stat-overdue">
                {overdueCount}
              </p>
            </div>
            <div className="card stat-card">
              <div className="stat-topline">
                <span className="stat-icon bg-warn-bg text-warn-fg">
                  <CalendarClock className="h-3.5 w-3.5" />
                </span>
                <span className="stat-label">Due today</span>
              </div>
              <p className="stat-value" data-testid="stat-due-today">{dueTodayCount}</p>
            </div>
            <div className="card stat-card">
              <div className="stat-topline">
                <span className="stat-icon bg-surface-hover text-fg-subtle">
                  <Inbox className="h-3.5 w-3.5" />
                </span>
                <span className="stat-label">No due date</span>
              </div>
              <p className="stat-value" data-testid="stat-no-due-date">{noDueDateCount}</p>
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
    </div>
  )
}
