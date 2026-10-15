import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { format, parseISO, startOfWeek, subWeeks } from 'date-fns'
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarClock,
  Check,
  CheckCircle2,
  Filter,
  Inbox,
  ListFilter,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useWalletRefChips } from '@/hooks/useWalletRefChips'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { cn, errorMessage, todayISO } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { AllTasksRow } from '@/modules/tasks/AllTasksRow'
import { CompletionCard } from '@/modules/tasks/all/CompletionCard'
import { TaskAgeCard } from '@/modules/tasks/all/TaskAgeCard'
import {
  OLD_TASK_DAYS,
  SORT_LABELS,
  groupTasks,
  taskAgeDays,
  type TaskGrouping,
  type TaskSort,
  type TaskStatus,
} from '@/modules/tasks/all/groupTasks'
import { TaskDetailModal } from '@/modules/tasks/TaskDetailModal'
import { TaskComposer, type TaskComposerDraft } from '@/modules/tasks/composer/TaskComposer'
import { TaskFormModal, type TaskFormDraft } from '@/modules/tasks/composer/TaskFormModal'
import { upsertTasks } from '@/modules/tasks/composer/upsertTasks'
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

/** Rows per "Load more" step (tasks-all.html: "Showing 10 of 39"). */
const PAGE_SIZE = 25

const STATUS_TABS: { value: TaskStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
]

const PRIORITY_OPTIONS = [
  { value: '', label: 'All priorities' },
  { value: 'high', label: 'High' },
  { value: 'med', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
]

/**
 * All tasks — the Tasks module's flat, filterable, everything-view page
 * (R5 PR-2, adopted to proposal-v2/tasks-all.html). Stat cards, a filter bar
 * with a sort menu and an Open/Done/All switch, removable chips (mirrors
 * WalletPage.tsx's pattern), rows grouped by when they're due or by list,
 * paged with Load more, then the Completion chart and the open-task age card.
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
  const removeToast = useToastStore((s) => s.removeToast)
  const { ensureLoaded: ensureWalletChips, resolveChip } = useWalletRefChips()
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
  const [oldOnly, setOldOnly] = useState(false)
  const [status, setStatus] = useState<TaskStatus>('open')
  const [grouping, setGrouping] = useState<TaskGrouping>('date')
  const [sort, setSort] = useState<TaskSort>('due')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const listRef = useRef<HTMLElement>(null)
  // Keyed per deleted task id (TasksListDetailPage.tsx's pattern, FEAT-062
  // review fix #6) — two deletes close together each keep their own toast
  // and their own undo data instead of clobbering each other's.
  const undoToastIdsRef = useRef<Map<string, string>>(new Map())

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

  // Wallet-linked chips: resolved once for the page, and only fetched when a
  // loaded task actually links to Wallet.
  const anyWalletRef = openTasks.some((t) => t.walletRef) || completedTasks.some((t) => t.walletRef)
  useEffect(() => {
    if (!anyWalletRef) return
    ensureWalletChips().catch((err: unknown) => {
      addToastRef.current({ message: errorMessage(err, 'Could not load the Wallet links on these tasks.') })
    })
  }, [anyWalletRef, ensureWalletChips])

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

  // "Done this week" — the SAME ISO week (Monday start) the Completion
  // chart's current-week bar counts, not a rolling 7 days: the two
  // disagreed whenever today isn't a Monday (a rolling window and the
  // chart's calendar week cover different sets of days). "+N vs usual"
  // (mockup) compares it against the mean completions per ISO week over
  // the previous 8 weeks, mirrored from completedTasks the same way as
  // CompletionCard.tsx's own weekKey — hidden until there are at least two
  // prior weeks with any completions, so "usual" is never a single data
  // point dressed up as an average, and hidden again when the two numbers
  // are equal (nothing to report).
  const isoWeekKey = (dateIso: string): string =>
    format(startOfWeek(parseISO(dateIso.slice(0, 10)), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const thisWeekStart = startOfWeek(parseISO(today), { weekStartsOn: 1 })
  const thisWeekKey = format(thisWeekStart, 'yyyy-MM-dd')
  const doneThisWeekCount = completedTasks.filter((t) => t.completedAt && isoWeekKey(t.completedAt) === thisWeekKey).length

  const priorWeekCounts = Array.from({ length: 8 }, (_, i) => {
    const key = format(subWeeks(thisWeekStart, i + 1), 'yyyy-MM-dd')
    return completedTasks.filter((t) => t.completedAt && isoWeekKey(t.completedAt) === key).length
  })
  const priorWeeksWithData = priorWeekCounts.filter((c) => c > 0).length
  const usualPerWeek = priorWeekCounts.reduce((s, c) => s + c, 0) / priorWeekCounts.length
  const vsUsualDelta = priorWeeksWithData >= 2 ? Math.round(doneThisWeekCount - usualPerWeek) : 0
  const vsUsualChip =
    priorWeeksWithData >= 2 && vsUsualDelta !== 0
      ? { label: `${vsUsualDelta > 0 ? '+' : ''}${vsUsualDelta} vs usual`, positive: vsUsualDelta > 0 }
      : null

  // ── Filtering (criterion 3) ─────────────────────────────────────────
  const q = searchDraft.trim().toLowerCase()
  const statusTasks = useMemo(
    () => (status === 'open' ? openTasks : status === 'done' ? completedTasks : [...openTasks, ...completedTasks]),
    [status, openTasks, completedTasks],
  )
  const filteredTasks = useMemo(() => {
    return statusTasks.filter((t) => {
      if (priority && t.priority !== priority) return false
      if (assignee === 'me' && t.assigneeId !== currentUserId) return false
      if (assignee === 'unassigned' && t.assigneeId !== null) return false
      if (listId && t.listId !== listId) return false
      if (oldOnly && taskAgeDays(t) < OLD_TASK_DAYS) return false
      if (q && !t.content.toLowerCase().includes(q)) return false
      return true
    })
  }, [statusTasks, priority, assignee, listId, oldOnly, q, currentUserId])

  const activeFilterCount = [priority !== '', assignee !== 'all', listId !== '', oldOnly].filter(Boolean).length
  const anyFilterActive = activeFilterCount > 0 || q !== ''

  const clearAllFilters = () => {
    setSearchDraft('')
    setPriority('')
    setAssignee('all')
    setListId('')
    setOldOnly(false)
  }

  // Any change to what the list shows starts paging over from the top — same
  // render-time reset pattern as the row drafts, so no effect round-trip.
  const viewKey = [status, grouping, sort, priority, assignee, listId, oldOnly, q].join('|')
  const [pagedViewKey, setPagedViewKey] = useState(viewKey)
  if (viewKey !== pagedViewKey) {
    setPagedViewKey(viewKey)
    setLimit(PAGE_SIZE)
  }

  const groups = useMemo(
    () => groupTasks(filteredTasks, { status, grouping, sort, limit, today, lists: taskLists }),
    [filteredTasks, status, grouping, sort, limit, today, taskLists],
  )
  const shownCount = groups.reduce((n, g) => n + g.visible.length, 0)
  const undatedOpen = filteredTasks.filter((t) => !t.isCompleted && t.dueDate === null)

  const reviewOldTasks = () => {
    setStatus('open')
    setOldOnly(true)
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
    if (oldOnly) {
      chips.push({ key: 'age', label: 'Older than three months', onClear: () => setOldOnly(false) })
    }
    return chips
  }, [priority, assignee, listId, oldOnly, listById])

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

  // FEAT-052 / BUG-006 / FEAT-051: AllTasksRow persists each edit itself;
  // these only keep this page's local arrays in step, so a row moves to its
  // new group (or out of a filtered view) without waiting for a reload. The
  // Done and All tabs show completed tasks too, so both arrays are patched —
  // the id that isn't present is a no-op.
  const patchTask = (id: string, patch: Partial<Task>) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    setCompletedTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }
  const handleContentChange = (id: string, content: string) => patchTask(id, { content })
  const handleDueDateChange = (id: string, dueDate: string | null) => patchTask(id, { dueDate })
  const handleListChange = (id: string, listId: string | null) => patchTask(id, { listId })

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
    // Open + undated only, even on the All tab where `filteredTasks` can
    // also hold completed rows (status === 'all') — a completed or dated
    // task has no business being swept into "today".
    const ids = undatedOpen.map((t) => t.id)
    if (ids.length === 0) return
    try {
      const updated = await rescheduleTasks(ids, today)
      const updatedIds = new Set(updated.map((t) => t.id))
      setOpenTasks((prev) => prev.map((t) => (updatedIds.has(t.id) ? { ...t, dueDate: today } : t)))
      // POST /tasks/reschedule moves what the caller may act on (owner,
      // assignee or writable shared list) and returns only those — a task in
      // a read-only shared list comes back unmoved. Never claim success for
      // those (CLAUDE.md §2 rule 10): say exactly how many moved and why the
      // rest didn't.
      const skipped = ids.length - updated.length
      const scheduledMsg = `Scheduled ${updated.length} task${updated.length === 1 ? '' : 's'} for today`
      addToast({
        message:
          skipped > 0
            ? `${scheduledMsg} — ${skipped} couldn't move because you can't edit ${skipped === 1 ? 'it' : 'them'}.`
            : `${scheduledMsg}.`,
      })
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not schedule those tasks — please try again.') })
    }
  }

  /**
   * CD-20: delete via `deleteTaskById` already happened in the row — this
   * only keeps the page's local arrays in step and offers the undo-toast,
   * same split as `handleContentChange`/`handleDueDateChange` above. Both
   * arrays are filtered against every id the server actually removed
   * (cascaded descendants included), not just the row's own id, so an
   * orphaned child never lingers with a stale subtask count. Undo recreates
   * only the row itself (not cascaded descendants) — this page, unlike
   * TasksListDetailPage.tsx, doesn't track a deleted row's children, and no
   * flat All-tasks row surfaces a subtask as its own entry to restore.
   */
  const handleRowDeleted = (task: Task, deletedIds: string[]) => {
    setOpenTasks((prev) => prev.filter((t) => !deletedIds.includes(t.id)))
    setCompletedTasks((prev) => prev.filter((t) => !deletedIds.includes(t.id)))

    const undoDelete = async () => {
      try {
        await api.post('/tasks', {
          id: task.id,
          parentId: task.parentId,
          content: task.content,
          note: task.note,
          isCompleted: task.isCompleted,
          isCollapsed: task.isCollapsed,
          sortOrder: task.sortOrder,
          dueDate: task.dueDate ?? null,
          listId: task.listId ?? null,
          priority: task.priority,
          dueTime: task.dueTime ?? null,
          assigneeId: task.assigneeId ?? null,
          assignedAt: task.assignedAt ?? null,
          recurrence: task.recurrence ?? null,
          recurrenceData: task.recurrenceData ?? null,
          recurrenceParentId: task.recurrenceParentId ?? null,
          walletRef: task.walletRef ?? null,
          remindAt: task.remindAt ?? null,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        })
      } catch (err) {
        addToast({ message: errorMessage(err, 'Could not undo that delete — please try again.') })
        return
      }
      if (task.isCompleted) setCompletedTasks((prev) => [task, ...prev])
      else setOpenTasks((prev) => [...prev, task])
    }

    const existingToastId = undoToastIdsRef.current.get(task.id)
    if (existingToastId) removeToast(existingToastId)
    const toastId = addToast({
      message: 'Task deleted',
      action: {
        label: 'Undo',
        onClick: () => {
          void undoDelete()
          undoToastIdsRef.current.delete(task.id)
        },
      },
      duration: 5000,
    })
    undoToastIdsRef.current.set(task.id, toastId)
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
        <h1 className="page-title">All tasks</h1>
        {!loading && (
          <span className="page-sub hide-mobile" data-testid="all-tasks-counts">
            {openTasks.length} open · {completedTasks.length} completed
          </span>
        )}
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            aria-pressed={grouping === 'list'}
            onClick={() => setGrouping((g) => (g === 'list' ? 'date' : 'list'))}
            data-testid="all-tasks-group-toggle"
          >
            <ListFilter className="icon-sm h-4 w-4" aria-hidden="true" />
            {grouping === 'list' ? 'Group by date' : 'Group by list'}
          </button>
        </div>
      </div>

      <TaskComposer
        lists={taskLists}
        coMembers={coMembers}
        onCreateTask={handleCreateTask}
        onTasksCreated={(created) => setOpenTasks((prev) => upsertTasks(prev, created))}
        onOpenHabitModal={handleOpenHabitModal}
        onOpenTaskForm={handleOpenTaskForm}
        onOpenAssignForm={handleOpenAssignForm}
      />

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your tasks…</p>
      ) : (
        <>
          {/* Stat cards (FEAT-058) — four `.card.stat-card.c3` tiles on the
              `.dash` 12-col grid, the real mockup idiom (confirmed against
              the rendered tasks-all.html: `.dash` > `.card.stat-card.c3` >
              `.stat-topline` (`.stat-icon` + `.stat-label`) > `.stat-value`
              > `.stat-foot`) — not the old `.grid.g4`, which isn't part of
              the mockup's layout system and doesn't share `.dash`'s
              responsive `.c3` collapse (layout.css: 2-up at <=1080px/680px).
              NOT `.band-stats`/`.band-stat` — that idiom belongs to
              Today/Upcoming, whose mockups pair it with a `.band-main`
              sibling; without one here it renders with ~50% blank space.
              `.stat-foot` (src/styles/data.css) already exists for exactly
              the sub-line role below. */}
          <div className="dash mb-4">
            <div className="card stat-card c3" data-testid="all-tasks-stat-overdue">
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
            <div className="card stat-card c3" data-testid="all-tasks-stat-due-this-week">
              <div className="stat-topline">
                <span className="stat-icon bg-accent-bg text-accent-fg">
                  <CalendarClock className="h-3.5 w-3.5" />
                </span>
                <span className="stat-label">Due this week</span>
              </div>
              <p className="stat-value">{dueThisWeekCount}</p>
              {dueTodayCount > 0 && <p className="stat-foot">{dueTodayCount} of them today</p>}
            </div>
            <div className="card stat-card c3" data-testid="all-tasks-stat-no-due-date">
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
            <div className="card stat-card c3" data-testid="all-tasks-stat-done-this-week">
              <div className="stat-topline">
                <span className="stat-icon bg-pos-bg text-pos-fg">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
                <span className="stat-label">Done this week</span>
              </div>
              <p className={cn('stat-value', doneThisWeekCount > 0 && 'pos')}>{doneThisWeekCount}</p>
              {vsUsualChip && (
                <p className="stat-foot">
                  <span
                    className={cn('chip', vsUsualChip.positive ? 'chip-pos' : 'chip-neg')}
                    data-testid="all-tasks-done-vs-usual"
                  >
                    {vsUsualChip.label}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* Filter bar — bare, as in the mockup: search, the Filters panel
              toggle, the sort menu, and the Open/Done/All switch. */}
          <div className="filters mb-3">
            <div className="filter-field">
              <Filter className="h-3.5 w-3.5" />
              <input
                id="all-tasks-filter"
                type="search"
                aria-label="Filter tasks"
                data-testid="all-tasks-filter-input"
                placeholder={`Filter these ${statusTasks.length} tasks…`}
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
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="filter-btn hide-mobile hover:bg-surface-hover hover:text-fg"
                  aria-label={`Sort by ${SORT_LABELS[sort]}`}
                  aria-haspopup="menu"
                  data-testid="all-tasks-sort"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  {SORT_LABELS[sort]}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-50 min-w-[180px] overflow-hidden rounded-xl border border-line bg-surface-raised p-1 shadow-xl shadow-line/60"
                  sideOffset={4}
                  align="start"
                >
                  <DropdownMenu.RadioGroup value={sort} onValueChange={(v) => setSort(v as TaskSort)}>
                    {(Object.keys(SORT_LABELS) as TaskSort[]).map((key) => (
                      <DropdownMenu.RadioItem
                        key={key}
                        value={key}
                        data-testid={`all-tasks-sort-${key}`}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
                      >
                        <span className="w-3.5">
                          <DropdownMenu.ItemIndicator>
                            <Check className="h-3.5 w-3.5" />
                          </DropdownMenu.ItemIndicator>
                        </span>
                        {SORT_LABELS[key]}
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <div className="segment ml-auto" role="tablist" aria-label="Task status" data-testid="all-tasks-status">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={status === tab.value}
                  onClick={() => setStatus(tab.value)}
                  data-testid={`all-tasks-status-${tab.value}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {(filterChips.length > 0 || anyFilterActive) && (
            <div className="filters mb-4" data-testid="all-tasks-filter-chips">
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
              <button
                type="button"
                onClick={clearAllFilters}
                data-testid="all-tasks-filter-clear-all"
                className="btn btn-quiet"
                style={{ height: 26, fontSize: 'var(--t-xs)' }}
              >
                Clear
              </button>
            </div>
          )}

          {filtersOpen && (
            <div data-testid="all-tasks-filter-panel" className="card card-pad mb-4">
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

          {/* The task list — one card, grouped by when it's due (or by list),
              paged with Load more. */}
          <section ref={listRef} className="card card-pad mb-4 scroll-mt-4" data-testid="all-tasks-list">
            {filteredTasks.length === 0 ? (
              <p className="py-3 text-sm text-fg-subtle" data-testid="all-tasks-empty">
                {anyFilterActive
                  ? 'No tasks match these filters.'
                  : status === 'done'
                    ? 'Nothing completed yet.'
                    : 'Nothing open — add a task above.'}
              </p>
            ) : (
              <>
                {groups.map((group) => (
                  <div key={group.key}>
                    <div
                      className="tgroup"
                      data-testid={
                        group.key === 'none'
                          ? 'all-tasks-no-due-date-group'
                          : ['overdue', 'today', 'tomorrow', 'week', 'later'].includes(group.key)
                            ? 'all-tasks-day-header'
                            : 'all-tasks-group-header'
                      }
                    >
                      {group.color && (
                        <i
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: group.color }}
                          aria-hidden="true"
                        />
                      )}
                      <span className={cn(group.tone === 'neg' && 'text-neg-fg')}>{group.label}</span>
                      <span className="n">{group.tasks.length}</span>
                      <span className="line" />
                      {group.key === 'none' && (
                        <button
                          type="button"
                          className="btn btn-quiet btn-sm"
                          onClick={handleScheduleUndated}
                          data-testid="schedule-undated-btn"
                        >
                          Schedule these
                        </button>
                      )}
                    </div>
                    {group.visible.map((t) => (
                      <AllTasksRow
                        key={t.id}
                        task={t}
                        list={t.listId ? listById.get(t.listId) : undefined}
                        availableLists={taskLists}
                        coMembers={coMembers}
                        walletChip={resolveChip(t.walletRef)}
                        onToggleComplete={handleToggleComplete}
                        onOpenDetail={openDetail}
                        onContentChange={handleContentChange}
                        onDueDateChange={handleDueDateChange}
                        onListChange={handleListChange}
                        onDelete={handleRowDeleted}
                      />
                    ))}
                  </div>
                ))}

                <div className="divider" />
                <div className="flex items-center gap-3">
                  <span className="text-sm text-fg-subtle" data-testid="all-tasks-showing">
                    Showing {shownCount} of {filteredTasks.length}
                  </span>
                  {shownCount < filteredTasks.length && (
                    <button
                      type="button"
                      className="btn btn-secondary ml-auto"
                      onClick={() => setLimit((n) => n + PAGE_SIZE)}
                      data-testid="all-tasks-load-more"
                    >
                      Load more
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          <div className="dash">
            <CompletionCard completedTasks={completedTasks} />
            <TaskAgeCard openTasks={openTasks} listById={listById} onReview={reviewOldTasks} />
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
