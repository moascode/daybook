import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { differenceInHours, parseISO } from 'date-fns'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { cn, errorMessage } from '@/lib/utils'
import { TaskListRow } from '@/modules/tasks/TaskListRow'
import { TaskDetailModal } from '@/modules/tasks/TaskDetailModal'
import { TaskComposer, type TaskComposerDraft } from '@/modules/tasks/composer/TaskComposer'
import { TaskFormModal, type TaskFormDraft } from '@/modules/tasks/composer/TaskFormModal'
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
  const { loadTasks, addTask } = useTasks()
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
  // FEAT-057's shared "New task" modal, wired the same way Upcoming/Today
  // open it from the composer's "Task"/"Assign" shortcuts.
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskFormContent, setTaskFormContent] = useState<string | undefined>(undefined)
  const [taskFormFocusField, setTaskFormFocusField] = useState<'assignee' | undefined>(undefined)
  const navigate = useNavigate()

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
    ])
      .then(([assigned, all, done, memberRows]) => {
        if (cancelled) return
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

  // Keeps `allOpen` (and so `handedOut`, derived from it) in step with a
  // successful assignee change made through this page's own picker — without
  // this, the card's "Assigned to X" caption and the picker's own value would
  // disagree until the next reload (the picker updates its own local draft
  // immediately, but nothing else on this page reads that draft).
  const handleAssigneeChange = (taskId: string, assigneeId: string | null) => {
    setAllOpen((prev) => prev.map((t) => (t.id === taskId ? { ...t, assigneeId } : t)))
  }

  // FEAT-052 / BUG-006: same staleness story as `handleAssigneeChange` above
  // — TaskListRow persists the edit itself, but its display renders straight
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

  // BUG-011: this page's rows don't cover priority/note — TaskDetailModal
  // does. Same staleness story as the handlers above — patch every section
  // that might hold this task by id, since the modal's own opener doesn't
  // know which section its `task` came from.
  const handleDetailSaved = (updated: Task) => {
    setWaitingOnYou((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setAllOpen((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setDetailTask(updated)
  }

  const handleToggleComplete = () => {
    // Both sections this page renders (Waiting on you / the handed-out rail)
    // are read-mostly ledgers, not an outliner — completion here would need
    // the same optimistic-move bookkeeping TasksAllPage.tsx already does, and
    // FEAT-027's own spec never asked for a complete affordance from this
    // page. Left as a documented no-op rather than silently wiring nothing to
    // a checkbox that would otherwise look actionable — TaskListRow's
    // checkbox does render on this page since it can't be hidden per-page,
    // so this exists to at least explain itself instead of throwing.
    addToast({ message: 'Complete this task from All tasks or the outliner.' })
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
  const turnaroundByAssignee = useMemo(() => {
    const eligible = completed.filter(
      (t) => t.ownerId === currentUserId && t.assigneeId !== null && t.assignedAt !== null,
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

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Assigned to me</h1>
          <p className="page-sub">A two-way ledger — what's waiting on you, and what you're waiting on others for.</p>
        </div>
        <div className="page-actions items-center">
          <div className="segment" role="tablist" aria-label="Show tasks for">
            <button
              type="button"
              role="tab"
              aria-selected={audience === 'to-me'}
              onClick={() => setAudience('to-me')}
              data-testid="assigned-audience-to-me"
            >
              To me
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={audience === 'from-me'}
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
            /* Section 1 — Waiting on you */
            <div className="mb-6" data-testid="assigned-waiting-section">
              <div className="tgroup-head">
                <span className="tg-date">Waiting on you</span>
              </div>
              {waitingByOwner.length === 0 ? (
                <p className="py-3 text-sm text-fg-subtle" data-testid="assigned-waiting-empty">
                  Nothing is waiting on you right now.
                </p>
              ) : (
                waitingByOwner.map((group) => (
                  <div key={group.ownerId}>
                    <div className="tgroup" data-testid="assigned-waiting-owner-header">
                      <span>Waiting on {group.ownerName}</span>
                      <span className="n">{group.tasks.length}</span>
                      <span className="line" />
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
                ))
              )}
            </div>
          )}

          {audience === 'from-me' && (
            <>
              {/* Section 2 — What you've handed out */}
              <div className="mb-6" data-testid="assigned-handed-out-section">
                <div className="tgroup-head">
                  <span className="tg-date">What you've handed out</span>
                </div>
                {handedOut.length === 0 ? (
                  <p className="py-3 text-sm text-fg-subtle" data-testid="assigned-handed-out-empty">
                    You haven't assigned anything to anyone else yet.
                  </p>
                ) : (
                  <div className="stack">
                    {handedOut.map(({ task, assigneeName, goneQuiet }) => (
                      <div key={task.id} className="card card-pad">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="task-title">{task.content || 'Untitled task'}</p>
                            <p className="text-xs text-fg-subtle">Assigned to {assigneeName}</p>
                          </div>
                          {goneQuiet && (
                            <span
                              className="chip chip-warn"
                              data-testid={`assigned-gone-quiet-${task.id}`}
                            >
                              Gone quiet — assigned without a date
                            </span>
                          )}
                        </div>
                        <div className="mt-2">
                          <TaskListRow
                            task={task}
                            list={task.listId ? listById.get(task.listId) : undefined}
                            onToggleComplete={handleToggleComplete}
                            coMembers={coMembers}
                            onAssigneeChange={handleAssigneeChange}
                            onContentChange={handleContentChange}
                            onDueDateChange={handleDueDateChange}
                            availableLists={taskLists}
                            onListChange={handleListChange}
                            onOpenDetail={openDetail}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
            </>
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
