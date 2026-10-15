import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { differenceInHours, parseISO } from 'date-fns'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { cn, errorMessage, todayISO } from '@/lib/utils'
import { avatarClass } from '@/lib/avatar'
import { dayDiff, recurrenceLabel } from '@/modules/tasks/taskRowFormat'
import { TaskListRow } from '@/modules/tasks/TaskListRow'
import { useNudges } from '@/modules/tasks/useNudges'
import { TaskDetailModal } from '@/modules/tasks/TaskDetailModal'
import { TaskComposer, type TaskComposerDraft } from '@/modules/tasks/composer/TaskComposer'
import { TaskFormModal, type TaskFormDraft } from '@/modules/tasks/composer/TaskFormModal'
import { upsertTasks } from '@/modules/tasks/composer/upsertTasks'
import type { Task } from '@/types/tasks.types'
import type { GroupMember } from '@/types/household.types'

/** "Never picked up" staleness — handed-out AND no due date AND assigned this
 *  long ago. `goneQuiet` (below) already treats "no due date" as the sole
 *  gone-quiet signal with no day threshold at all, so this is the one new
 *  staleness number this page introduces; the clock starts at `assignedAt`
 *  (falling back to `createdAt` only for pre-migration rows with no recorded
 *  assignment time), not `createdAt` — a task created months ago but handed
 *  out yesterday has been sitting for one day, not months. It reuses the same
 *  space-separated-timestamp fixup `turnaroundByAssignee` already established
 *  rather than inventing a second date-math idiom. */
const NEVER_PICKED_UP_DAYS = 30

type AssignedAudience = 'to-me' | 'from-me'

/** Days since a reference timestamp (assignedAt, falling back to
 *  createdAt), using real `Date` math — not a date-string diff, since this
 *  is "how long ago", not "which calendar day" (same convention
 *  `neverPickedUp`, further down, already uses). */
function daysSince(referenceAt: string): number {
  return Math.floor(differenceInHours(new Date(), parseISO(referenceAt.replace(' ', 'T'))) / 24)
}

/** "Waiting on you" row chip (FEAT-027/tasks-lists-parity): how long ago the
 *  owner asked, since the row's own due-date columns are relative to the
 *  due date, not the ask. */
function askedAgoLabel(task: Task): string {
  const days = daysSince(task.assignedAt ?? task.createdAt)
  if (days <= 0) return 'Asked today'
  if (days === 1) return 'Asked yesterday'
  return `Asked ${days} days ago`
}

/** "You assigned out" compact row status line — the mockup's `.psub`. */
function handedOutStatusLine(task: Task): string {
  const recurrence = recurrenceLabel(task)
  if (recurrence) return recurrence
  if (!task.dueDate) {
    const weeks = Math.floor(daysSince(task.assignedAt ?? task.createdAt) / 7)
    return weeks <= 0 ? 'No date · asked recently' : `No date · asked ${weeks} week${weeks === 1 ? '' : 's'} ago`
  }
  const diff = dayDiff(todayISO(), task.dueDate)
  if (diff < 0) return `Overdue by ${-diff} day${-diff === 1 ? '' : 's'}`
  if (diff === 0) return 'Due today · on time so far'
  if (diff === 1) return 'Due tomorrow'
  return `Due in ${diff} days`
}

/** "You assigned out" compact row chip — Today for a task due today, Stale
 *  (neg) for one handed out undated more than a week ago. Everything else
 *  gets no chip, matching the mockup (most rows have none). */
function handedOutChip(task: Task): { label: string; neg?: boolean } | null {
  if (task.dueDate && dayDiff(todayISO(), task.dueDate) === 0) return { label: 'Today' }
  if (!task.dueDate && daysSince(task.assignedAt ?? task.createdAt) > 7) return { label: 'Stale', neg: true }
  return null
}

/**
 * Assigned to me — `/tasks/assigned` (FEAT-027,
 * docs/backlog/EP-07-tasks-depth/FEAT-027-tasks-assigned-to-me.md). A two-way
 * delegation ledger, not just an inbox: what other people are waiting on you
 * for, what you've handed out and whether it's stalled, and — the thing only
 * a shared task app can know, per design.md — how long each person actually
 * takes to close something you've assigned them.
 *
 * Three independent fetches (`loadTasks('assigned')`, `loadTasks('all')`,
 * `loadTasks('completed')`) plus `/groups/members`, all in one `Promise.all`
 * on mount — same shape as TasksAllPage.tsx/TasksUpcomingPage.tsx. All three
 * `loadTasks` views deliberately bypass the outliner's Zustand store (see
 * useTasks.ts's doc comment), so this page keeps its own local state per
 * section rather than reading from the store.
 */
export function TasksAssignedPage() {
  const { loadTasks, addTask, completeTask } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const addToast = useToastStore((s) => s.addToast)

  const [waitingOnYou, setWaitingOnYou] = useState<Task[]>([])
  const [allOpen, setAllOpen] = useState<Task[]>([])
  const [completed, setCompleted] = useState<Task[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [audience, setAudience] = useState<AssignedAudience>('to-me')
  const [showAddDates, setShowAddDates] = useState(false)
  const [addDatesValue, setAddDatesValue] = useState('')
  const [addingDates, setAddingDates] = useState(false)
  // FEAT-057's shared "New task" modal, wired the same way Upcoming/Today
  // open it from the composer's "Task"/"Assign" shortcuts.
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskFormContent, setTaskFormContent] = useState<string | undefined>(undefined)
  const [taskFormFocusField, setTaskFormFocusField] = useState<'assignee' | undefined>(undefined)
  const navigate = useNavigate()
  const { nudgedIds, pendingIds, nudgingAll, seedNudged, nudgeOne, nudgeAll } = useNudges()

  const openDetail = (task: Task) => {
    setDetailTask(task)
    setDetailOpen(true)
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadTasks('assigned'),
      loadTasks('all'),
      loadTasks('completed'),
      api.get<Record<string, unknown>[]>('/groups/members').then((rows) => rows.map(mapMember)),
      loadTaskLists(),
      api.get<{ taskIds: string[] }>('/tasks/nudged-today'),
    ])
      .then(([assigned, all, done, memberRows, , nudged]) => {
        if (cancelled) return
        seedNudged(nudged.taskIds)
        setWaitingOnYou(assigned)
        setAllOpen(all)
        setCompleted(done)
        setMembers(memberRows)
      })
      .catch((err) => {
        if (cancelled) return
        addToast({ message: errorMessage(err, 'Could not load your assigned tasks.') })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch, matching TasksAllPage.tsx/TasksUpcomingPage.tsx.
  }, [])

  const usernameById = useMemo(() => new Map(members.map((m) => [m.userId, m.username])), [members])
  const coMembers = useMemo(() => members.map((m) => ({ userId: m.userId, username: m.username })), [members])
  const listById = useMemo(() => new Map(taskLists.map((l) => [l.id, l])), [taskLists])

  const resolveName = (userId: string): string => usernameById.get(userId) ?? 'Someone'

  // FEAT-052 / BUG-006: TaskListRow persists the edit itself, but its display renders straight
  // from THIS page's own arrays, and a task can appear in either
  // `waitingOnYou` (Section 1) or `allOpen` (Section 2's `handedOut`).
  const handleContentChange = (taskId: string, content: string) => {
    setWaitingOnYou((prev) => prev.map((t) => (t.id === taskId ? { ...t, content } : t)))
    setAllOpen((prev) => prev.map((t) => (t.id === taskId ? { ...t, content } : t)))
  }
  const handleDueDateChange = (taskId: string, dueDate: string | null) => {
    setWaitingOnYou((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate } : t)))
    setAllOpen((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate } : t)))
  }
  const handleListChange = (taskId: string, listId: string | null) => {
    setWaitingOnYou((prev) => prev.map((t) => (t.id === taskId ? { ...t, listId } : t)))
    setAllOpen((prev) => prev.map((t) => (t.id === taskId ? { ...t, listId } : t)))
  }

  // Section 1's kebab offers "Assign to" too (useAssignees, "Me" included)
  // — a row waiting on the viewer can be handed off further. A task
  // reassigned away from the viewer no longer belongs in `waitingOnYou`, so
  // it's dropped from there the same way completing it already is;
  // `allOpen` just keeps its new `assigneeId`.
  const handleAssigneeChange = (taskId: string, assigneeId: string | null) => {
    setAllOpen((prev) => prev.map((t) => (t.id === taskId ? { ...t, assigneeId } : t)))
    if (assigneeId !== currentUserId) {
      setWaitingOnYou((prev) => prev.filter((t) => t.id !== taskId))
    } else {
      setWaitingOnYou((prev) => prev.map((t) => (t.id === taskId ? { ...t, assigneeId } : t)))
    }
  }

  // BUG-011: this page's rows don't cover priority/note — TaskDetailModal
  // does. Same staleness story as the handlers above — patch every section
  // that might hold this task by id, since the modal's own opener doesn't
  // know which section its `task` came from.
  const handleDetailSaved = (updated: Task) => {
    setWaitingOnYou((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setAllOpen((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setDetailTask(updated)
  }

  // Tasks-lists-parity: the checkbox is now a real completion, not a
  // documented no-op — TaskListRow's checkbox otherwise looks actionable
  // but did nothing (CLAUDE.md §2 rule 10). A task can appear in either
  // `waitingOnYou` (Section 1) or `allOpen` (Section 2's `handedOut`), so
  // both get patched the same way TasksAllPage.tsx's own
  // `handleToggleComplete` does.
  const handleToggleComplete = async (id: string) => {
    try {
      const updated = await completeTask(id)
      if (updated.isCompleted) {
        setWaitingOnYou((prev) => prev.filter((t) => t.id !== id))
        setAllOpen((prev) => prev.filter((t) => t.id !== id))
        setCompleted((prev) => [updated, ...prev])
      } else {
        // Un-completing from here is rare, but the row can still do it —
        // append the server's fresh row back rather than let it vanish.
        setAllOpen((prev) => [...prev, updated])
        if (updated.assigneeId === currentUserId) setWaitingOnYou((prev) => [...prev, updated])
        setCompleted((prev) => prev.filter((t) => t.id !== id))
      }
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not update that task — please try again.') })
    }
  }

  // Composer wiring (FEAT-059), mirroring TasksUpcomingPage.tsx's
  // handleCreateTask exactly: undated stays undated (no Today-style
  // default-to-today), and a follow-up combined PATCH folds in whatever the
  // composer parsed (including `@username` → assigneeId, the one thing this
  // page's composer actually exercises differently from the others).
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
      setAllOpen((prev) => [...prev, newTask])
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
      // `allOpen` backs "What you've handed out"; a task self-assigned via
      // `@me` (or left assigned to the viewer) also belongs in "Waiting on
      // you" — mirrors the assignee-change staleness handling above.
      setAllOpen((prev) => [...prev, merged])
      if (merged.assigneeId === currentUserId) setWaitingOnYou((prev) => [...prev, merged])
    } catch (err) {
      addToast({ message: errorMessage(err, 'Task added, but its details could not be saved — please edit it to fix that.') })
      setAllOpen((prev) => [...prev, newTask])
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

  const handleTaskFormSubmit = async (draft: TaskFormDraft) => {
    await handleCreateTask(draft)
  }

  // ── Section 1 — Waiting on you, grouped by owner ──────────────────────
  // `GET /tasks?view=assigned` includes tasks the viewer assigned to
  // themselves (`@me`) — those have `ownerId === currentUserId` and would
  // otherwise render under a group literally labeled "Waiting on Someone"
  // (resolveName can't find the viewer in `members`, which excludes the
  // caller by design). A task only counts as "waiting on you" if someone
  // ELSE assigned it to you.
  const waitingOnOthers = useMemo(
    () => waitingOnYou.filter((t) => t.ownerId !== currentUserId),
    [waitingOnYou, currentUserId],
  )

  const waitingByOwner = useMemo(() => {
    const grouped = new Map<string, Task[]>()
    for (const t of waitingOnOthers) {
      const existing = grouped.get(t.ownerId)
      if (existing) existing.push(t)
      else grouped.set(t.ownerId, [t])
    }
    return Array.from(grouped.entries())
      .map(([ownerId, tasks]) => ({ ownerId, ownerName: resolveName(ownerId), tasks }))
      .sort((a, b) => a.ownerName.localeCompare(b.ownerName))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveName is derived from usernameById, already a dep.
  }, [waitingOnOthers, usernameById])

  // ── Section 2 — What you've handed out ────────────────────────────────
  const handedOut = useMemo(
    () =>
      allOpen
        .filter((t) => t.ownerId === currentUserId && t.assigneeId !== null && t.assigneeId !== currentUserId)
        .map((t) => ({ task: t, assigneeName: resolveName(t.assigneeId!), goneQuiet: t.dueDate === null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveName is derived from usernameById, already a dep.
    [allOpen, currentUserId, usernameById],
  )

  // ── Section 3 — Turnaround per person ─────────────────────────────────
  // Tasks assigned before `assigned_at` existed have assignedAt === null and
  // are EXCLUDED, not treated as an instant (zero-day) turnaround — an
  // explicit design decision (see the PR brief); every assignment made before
  // this column shipped would otherwise silently understate every average.
  // Also excludes a task the viewer assigned to THEMSELVES (`assigneeId ===
  // currentUserId`) — turnaround is about how long OTHER people take to
  // close something handed to them; a self-assignment has no delegation to
  // measure and would otherwise drag every person's average toward however
  // fast the viewer closes their own tasks.
  const turnaroundByAssignee = useMemo(() => {
    const eligible = completed.filter(
      (t) =>
        t.ownerId === currentUserId &&
        t.assigneeId !== null &&
        t.assignedAt !== null &&
        t.assigneeId !== currentUserId,
    )
    const byAssignee = new Map<string, number[]>()
    for (const t of eligible) {
      if (!t.completedAt) continue
      // Both timestamps come from the server's nowStr() ('YYYY-MM-DD HH:MM:SS',
      // worker/lib.ts) — space-separated, not ISO — so both need the same
      // ' ' → 'T' fixup before parseISO will accept them.
      const completedAt = parseISO(t.completedAt.replace(' ', 'T'))
      const assignedAt = parseISO(t.assignedAt!.replace(' ', 'T'))
      const days = differenceInHours(completedAt, assignedAt) / 24
      // A negative gap (assignedAt after completedAt) isn't a real turnaround
      // — it can only come from a row whose timestamps were set out of order
      // (e.g. a restored/seeded row) — so it's excluded the same way a null
      // assignedAt is, rather than dragging the average down silently.
      if (days < 0) continue
      const existing = byAssignee.get(t.assigneeId!)
      if (existing) existing.push(days)
      else byAssignee.set(t.assigneeId!, [days])
    }
    return Array.from(byAssignee.entries())
      .map(([assigneeId, samples]) => ({
        assigneeId,
        assigneeName: resolveName(assigneeId),
        avgDays: samples.reduce((sum, d) => sum + d, 0) / samples.length,
      }))
      .sort((a, b) => a.assigneeName.localeCompare(b.assigneeName))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveName is derived from usernameById, already a dep.
  }, [completed, currentUserId, usernameById])

  // ── Band card (FEAT-059) ───────────────────────────────────────────────
  // Household size: `/groups/members` (already fetched into `members`)
  // returns co-members ONLY, caller excluded (confirmed by
  // SharedSummary.tsx's own doc comment on the same route) — so the viewer
  // themself is the "+1" the mockup's "Household · 3 members" chip implies.
  // Deduped on userId: the route unions every group the caller is in, and a
  // `SELECT DISTINCT` on (user_id, username, role, joined_at) won't catch
  // the same user appearing twice with a different role/joined_at across
  // two shared groups.
  const householdMemberCount = new Set(members.map((m) => m.userId)).size + 1

  // Band title — the mockup's "Between the three of you" was copied
  // verbatim, but a real household can have 2, 3 or N members. "two" is
  // spelled out to read naturally; 3+ falls back to the numeral, which still
  // reads fine ("Between the 4 of you").
  const bandTitle =
    householdMemberCount <= 1
      ? 'Just you, for now'
      : householdMemberCount === 2
        ? 'Between the two of you'
        : `Between the ${householdMemberCount} of you`

  // Progress bar denominator: the two figures this band card is actually
  // about — what's waiting on you vs. what you've handed out — not `allOpen`
  // (every open task visible to the viewer via GET /tasks?view=all, which
  // for a real user can run into the hundreds and makes the bar render as a
  // near-invisible 1-3% sliver regardless of actual workload).
  const waitingOnYouCount = waitingOnOthers.length
  const waitingVsHandedOutTotal = waitingOnYouCount + handedOut.length
  const waitingTrackPct =
    waitingVsHandedOutTotal > 0 ? Math.min(100, Math.round((waitingOnYouCount / waitingVsHandedOutTotal) * 100)) : 0

  // "You assigned out" sub-line — real per-assignee breakdown, sorted the
  // same way `waitingByOwner`/`turnaroundByAssignee` are (alphabetically).
  const handedOutByAssignee = useMemo(() => {
    const counts = new Map<string, number>()
    for (const { assigneeName } of handedOut) counts.set(assigneeName, (counts.get(assigneeName) ?? 0) + 1)
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [handedOut])
  const handedOutSubline = handedOutByAssignee.map(([name, count]) => `${count} to ${name}`).join(', ')

  // "Average turnaround" — an unweighted mean of `turnaroundByAssignee`'s
  // own per-person averages (not a mean over every raw sample), so one
  // person with many more completed hand-offs doesn't drown out the other's
  // average — matches how the sub-line reads (one number per person, equal
  // weight).
  const avgTurnaroundDays =
    turnaroundByAssignee.length > 0
      ? turnaroundByAssignee.reduce((sum, r) => sum + r.avgDays, 0) / turnaroundByAssignee.length
      : null
  const turnaroundSubline = turnaroundByAssignee.map((r) => `${r.assigneeName} ${r.avgDays.toFixed(1)}`).join(', ')

  // "Never picked up" — handed-out tasks that are BOTH already flagged
  // `goneQuiet` (no due date — the only staleness signal this page's
  // existing "gone quiet" chip uses, see `handedOut` above) AND ASSIGNED at
  // least NEVER_PICKED_UP_DAYS ago, so a task assigned five minutes ago
  // without a date yet doesn't count as "never picked up". The clock starts
  // at `assignedAt`, not `createdAt` — a task created two months ago and
  // only assigned out yesterday has been sitting for one day, not two
  // months. Falls back to `createdAt` only for pre-migration rows with no
  // recorded assignment time.
  const neverPickedUp = useMemo(() => {
    const now = new Date()
    return handedOut.filter(({ task, goneQuiet }) => {
      if (!goneQuiet) return false
      const referenceAt = parseISO((task.assignedAt ?? task.createdAt).replace(' ', 'T'))
      return differenceInHours(now, referenceAt) / 24 >= NEVER_PICKED_UP_DAYS
    })
  }, [handedOut])
  const neverPickedUpSubline =
    neverPickedUp.length === 0
      ? ''
      : neverPickedUp.length === 2
        ? 'both older than a month'
        : neverPickedUp.length === 1
          ? 'older than a month'
          : `all ${neverPickedUp.length} older than a month`

  // "Add dates" — the mockup's `.sug` suggestion row under "You assigned
  // out": a one-click bulk reschedule for every never-picked-up task, via
  // the existing (already-shipped, never-called-from-the-client)
  // `POST /tasks/reschedule`. Scoped server-side to the caller's OWN tasks
  // (worker/routes/tasks.ts) — every id here already is one (handedOut
  // only contains tasks `t.ownerId === currentUserId`) — but the result is
  // still checked against the request, not assumed, and any gap is
  // reported as "skipped" rather than silently treated as success
  // (CLAUDE.md §2 rule 10).
  const handleAddDates = async () => {
    if (!addDatesValue || neverPickedUp.length === 0) return
    const ids = neverPickedUp.map(({ task }) => task.id)
    setAddingDates(true)
    try {
      const rows = await api.post<Record<string, unknown>[]>('/tasks/reschedule', { ids, dueDate: addDatesValue })
      const updatedIds = new Set(rows.map((r) => r.id as string))
      setAllOpen((prev) => prev.map((t) => (updatedIds.has(t.id) ? { ...t, dueDate: addDatesValue } : t)))
      const skipped = ids.length - rows.length
      addToast({
        message: `${rows.length} task${rows.length === 1 ? '' : 's'} rescheduled${
          skipped > 0 ? `, ${skipped} skipped` : ''
        }.`,
      })
      setShowAddDates(false)
      setAddDatesValue('')
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not reschedule those tasks — please try again.') })
    } finally {
      setAddingDates(false)
    }
  }

  // The handed-out list, rendered in both views: as the compact rail beside
  // "Waiting on you" (the mockup's c4 card) and as "From me"'s main list.
  const renderHandedOut = (framed: boolean) => (
    <>
      {handedOut.length === 0 ? (
        <p className="py-3 text-sm text-fg-subtle" data-testid="assigned-handed-out-empty">
          You haven't assigned anything to anyone else yet.
        </p>
      ) : (
        <div className={framed ? 'card card-pad' : undefined}>
          {handedOut.map(({ task, assigneeName }) => {
            const chip = handedOutChip(task)
            return (
              <div key={task.id} className="prow" data-testid={`assigned-handed-out-row-${task.id}`}>
                <button
                  type="button"
                  className={cn('tcheck', task.priority === 'high' && 'pri-high', task.priority === 'med' && 'pri-med')}
                  aria-label="Mark complete"
                  onClick={() => handleToggleComplete(task.id)}
                >
                  <Check />
                </button>
                <span
                  className={cn('avatar', task.assigneeId ? avatarClass(task.assigneeId) : undefined)}
                  title={assigneeName}
                >
                  {assigneeName.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="pname">{task.content || 'Untitled task'}</div>
                  <div className="psub">{handedOutStatusLine(task)}</div>
                </div>
                {chip && (
                  <span
                    className={cn('chip', chip.neg ? 'chip-neg' : 'chip-mute')}
                    data-testid={`assigned-gone-quiet-${task.id}`}
                  >
                    {chip.label}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  aria-label={`Nudge ${assigneeName} about ${task.content || 'Untitled task'}`}
                  disabled={nudgedIds.has(task.id) || pendingIds.has(task.id) || nudgingAll}
                  onClick={() => nudgeOne({ taskId: task.id, assigneeName })}
                  data-testid={`assigned-nudge-${task.id}`}
                >
                  {nudgedIds.has(task.id) ? 'Nudged' : 'Nudge'}
                </button>
              </div>
            )
          })}
          {neverPickedUp.length > 0 && (
            <>
              <div className="divider" style={{ marginTop: 'var(--s2)' }} />
              <div className="sug" style={{ paddingBottom: 0 }}>
                <div className="sug-main">
                  <div className="sug-title">
                    {neverPickedUp.length} gone quiet
                  </div>
                  <div className="sug-sub">Assigned without a date</div>
                </div>
                {showAddDates ? (
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="date"
                      autoFocus
                      aria-label="New due date for the never-picked-up tasks"
                      value={addDatesValue}
                      onChange={(e) => setAddDatesValue(e.target.value)}
                      data-testid="assigned-add-dates-input"
                      className="rounded border border-brand-500 bg-surface px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleAddDates}
                      disabled={!addDatesValue || addingDates}
                      data-testid="assigned-add-dates-confirm"
                    >
                      Set
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowAddDates(true)}
                    data-testid="assigned-add-dates-btn"
                  >
                    Add dates
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Assigned to me</h1>
          <p className="page-sub" data-testid="assigned-page-sub">
            {waitingOnYouCount} from others · {handedOut.length} you gave away
          </p>
        </div>
        <div className="page-actions items-center">
          <div className="segment" role="tablist" aria-label="Show tasks for">
            <button
              type="button"
              role="tab"
              id="assigned-tab-to-me"
              aria-selected={audience === 'to-me'}
              aria-controls="assigned-panel-to-me"
              onClick={() => setAudience('to-me')}
              data-testid="assigned-audience-to-me"
            >
              To me
            </button>
            <button
              type="button"
              role="tab"
              id="assigned-tab-from-me"
              aria-selected={audience === 'from-me'}
              aria-controls="assigned-panel-from-me"
              onClick={() => setAudience('from-me')}
              data-testid="assigned-audience-from-me"
            >
              From me
            </button>
          </div>
        </div>
      </div>

      <TaskComposer
        lists={taskLists}
        coMembers={coMembers}
        onCreateTask={handleCreateTask}
        onTasksCreated={(created) => setAllOpen((prev) => upsertTasks(prev, created))}
        onOpenHabitModal={handleOpenHabitModal}
        onOpenTaskForm={handleOpenTaskForm}
        onOpenAssignForm={handleOpenAssignForm}
      />

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your assignments…</p>
      ) : (
        <>
          {/* Band card (FEAT-059) */}
          <section className="card card-pad c12 mb-6" data-testid="assigned-band">
            <div className="card-head">
              <div>
                <span className="card-title">{bandTitle}</span>
                <div className="card-sub">Who is carrying what</div>
              </div>
              <span className="chip chip-mute" style={{ marginLeft: 'auto' }} data-testid="assigned-household-chip">
                Household · {householdMemberCount} member{householdMemberCount === 1 ? '' : 's'}
              </span>
            </div>
            <div className="band">
              <div className="band-main">
                <div className="band-fig">
                  <span className="v">{waitingOnYouCount}</span>
                  <span className="k">tasks waiting on you</span>
                </div>
                {waitingVsHandedOutTotal > 0 && (
                  <div className="track mt-3">
                    <i className="bg-pos" style={{ width: `${waitingTrackPct}%` }} />
                  </div>
                )}
              </div>
              <div className="band-stats">
                <div className="band-stat" data-testid="assigned-stat-handed-out">
                  <p className="k">You assigned out</p>
                  <p className="v">{handedOut.length}</p>
                  {handedOutSubline && <p className="s">{handedOutSubline}</p>}
                </div>
                <div className="band-stat" data-testid="assigned-stat-turnaround">
                  <p className="k">Average turnaround</p>
                  <p className="v">{avgTurnaroundDays !== null ? `${avgTurnaroundDays.toFixed(1)} days` : '—'}</p>
                  {turnaroundSubline && <p className="s">{turnaroundSubline}</p>}
                </div>
                <div className="band-stat" data-testid="assigned-stat-never-picked-up">
                  <p className="k">Never picked up</p>
                  <p className={cn('v', neverPickedUp.length > 0 && 'text-neg-fg')}>{neverPickedUp.length}</p>
                  {neverPickedUpSubline && <p className="s">{neverPickedUpSubline}</p>}
                </div>
              </div>
            </div>
          </section>

          {audience === 'to-me' && (
            /* Section 1 — Waiting on you, grouped by who asked (the
               mockup's c8 "Waiting on you" card). Avatar shows the ASKER
               (the owner), not the assignee — every row here is already
               assigned to the viewer, so the assignee avatar would just be
               the viewer's own on every row. */
            <div className="dash mb-6" id="assigned-panel-to-me" role="tabpanel" aria-labelledby="assigned-tab-to-me">
              <section className="card card-pad c8" data-testid="assigned-waiting-section">
              <div className="card-head">
                <div>
                  <div className="card-title">Waiting on you</div>
                  <div className="card-sub">Grouped by who asked</div>
                </div>
              </div>
              {waitingByOwner.length === 0 ? (
                <p className="py-3 text-sm text-fg-subtle" data-testid="assigned-waiting-empty">
                  Nothing is waiting on you right now.
                </p>
              ) : (
                waitingByOwner.map((group) => (
                  <div key={group.ownerId}>
                    <div className="tgroup" data-testid="assigned-waiting-owner-header">
                      <span>From {group.ownerName}</span>
                      <span className="n">{group.tasks.length}</span>
                      <span className="line" />
                    </div>
                    {group.tasks.map((t) => (
                      <TaskListRow
                        key={t.id}
                        task={t}
                        list={t.listId ? listById.get(t.listId) : undefined}
                        onToggleComplete={handleToggleComplete}
                        coMembers={coMembers}
                        onAssigneeChange={handleAssigneeChange}
                        onContentChange={handleContentChange}
                        onDueDateChange={handleDueDateChange}
                        availableLists={taskLists}
                        onListChange={handleListChange}
                        onOpenDetail={openDetail}
                        avatarUserId={group.ownerId}
                        extraChip={askedAgoLabel(t)}
                      />
                    ))}
                  </div>
                ))
              )}
              </section>
              <aside className="card card-pad c4" data-testid="assigned-out-rail">
                <div className="card-head">
                  <div className="card-title">You assigned out</div>
                  {handedOut.length > 0 && (
                    <button
                      type="button"
                      className="section-action"
                      disabled={nudgingAll}
                      onClick={() =>
                        nudgeAll(handedOut.map(({ task, assigneeName }) => ({ taskId: task.id, assigneeName })))
                      }
                      data-testid="assigned-nudge-all"
                    >
                      {nudgingAll ? 'Nudging…' : 'Nudge all ›'}
                    </button>
                  )}
                </div>
                {renderHandedOut(false)}
              </aside>
            </div>
          )}

          {audience === 'from-me' && (
            <div id="assigned-panel-from-me" role="tabpanel" aria-labelledby="assigned-tab-from-me">
              {/* Section 2 — What you've handed out (the mockup's c4 "You
                  assigned out" rail): compact rows, not full TaskListRows —
                  this is a status-at-a-glance rail, not an editing surface
                  (edit from Assigned's own kebab isn't offered here; use All
                  tasks or the outliner for that, same as before FEAT-027). */}
              <div className="mb-6" data-testid="assigned-handed-out-section">
                <div className="tgroup-head">
                  <span className="tg-date">What you've handed out</span>
                </div>
                {renderHandedOut(true)}
              </div>


              {/* Section 3 — Turnaround per person. Kept as its own card
                  (rather than folded away now that the band card carries the
                  aggregate) because it's the one place this page shows the
                  actual PER-PERSON averages behind that aggregate — the band
                  card's sub-line already names them inline, but this table is
                  more legible for a household bigger than two. The mockup
                  itself has no "From me" state and no separate turnaround
                  card at all — its only turnaround detail is the band's
                  sub-line plus one prose sentence under "Waiting on you" —
                  so this placement isn't matching the mockup, it's a judgment
                  call: turnaround is entirely about tasks the viewer handed
                  OUT, so it belongs under "From me", not "To me". Moved from
                  unconditional to from-me-only so it no longer duplicates the
                  aggregate Average-turnaround stat when the viewer is looking
                  at "Waiting on you", where turnaround isn't relevant at
                  all. */}
              <div className="card card-pad" data-testid="assigned-turnaround-section">
                <div className="card-head">
                  <span className="card-title">Turnaround per person</span>
                </div>
                {turnaroundByAssignee.length === 0 ? (
                  <p className="text-sm text-fg-subtle" data-testid="assigned-turnaround-empty">
                    No completed assignments with a recorded assignment time yet.
                  </p>
                ) : (
                  <ul className="stack">
                    {turnaroundByAssignee.map((row) => (
                      <li
                        key={row.assigneeId}
                        className="flex items-center justify-between text-sm"
                        data-testid={`assigned-turnaround-${row.assigneeId}`}
                      >
                        <span>{row.assigneeName}</span>
                        <span className="font-medium">{row.avgDays.toFixed(1)} days</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
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
