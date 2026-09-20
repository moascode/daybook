import { useEffect, useMemo, useState } from 'react'
import { differenceInHours, parseISO } from 'date-fns'
import { useTasks } from '@/hooks/useTasks'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { errorMessage } from '@/lib/utils'
import { TaskListRow } from '@/modules/tasks/TaskListRow'
import type { Task } from '@/types/tasks.types'
import type { GroupMember } from '@/types/household.types'

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
  const { loadTasks } = useTasks()
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const addToast = useToastStore((s) => s.addToast)

  const [waitingOnYou, setWaitingOnYou] = useState<Task[]>([])
  const [allOpen, setAllOpen] = useState<Task[]>([])
  const [completed, setCompleted] = useState<Task[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadTasks('assigned'),
      loadTasks('all'),
      loadTasks('completed'),
      api.get<Record<string, unknown>[]>('/groups/members').then((rows) => rows.map(mapMember)),
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

  // ── Section 1 — Waiting on you, grouped by owner ──────────────────────
  const waitingByOwner = useMemo(() => {
    const grouped = new Map<string, Task[]>()
    for (const t of waitingOnYou) {
      const existing = grouped.get(t.ownerId)
      if (existing) existing.push(t)
      else grouped.set(t.ownerId, [t])
    }
    return Array.from(grouped.entries())
      .map(([ownerId, tasks]) => ({ ownerId, ownerName: resolveName(ownerId), tasks }))
      .sort((a, b) => a.ownerName.localeCompare(b.ownerName))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveName is derived from usernameById, already a dep.
  }, [waitingOnYou, usernameById])

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

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Assigned to me</h1>
          <p className="page-sub">A two-way ledger — what's waiting on you, and what you're waiting on others for.</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your assignments…</p>
      ) : (
        <>
          {/* Section 1 — Waiting on you */}
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
                      list={undefined}
                      onToggleComplete={handleToggleComplete}
                      onContentChange={handleContentChange}
                      onDueDateChange={handleDueDateChange}
                    />
                  ))}
                </div>
              ))
            )}
          </div>

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
                        list={undefined}
                        onToggleComplete={handleToggleComplete}
                        coMembers={coMembers}
                        onAssigneeChange={handleAssigneeChange}
                        onContentChange={handleContentChange}
                        onDueDateChange={handleDueDateChange}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 3 — Turnaround per person */}
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
    </div>
  )
}
