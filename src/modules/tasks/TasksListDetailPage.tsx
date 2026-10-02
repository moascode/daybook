import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import type { TaskList } from '@/hooks/useTaskLists'
import { useWalletRefChips } from '@/hooks/useWalletRefChips'
import { useToastStore } from '@/stores/toast.store'
import { errorMessage } from '@/lib/utils'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { TaskListRow } from '@/modules/tasks/TaskListRow'
import { TasksPage } from '@/modules/tasks/TasksPage'
import { TaskComposer, type TaskComposerDraft } from '@/modules/tasks/composer/TaskComposer'
import { TaskFormModal, type TaskFormDraft } from '@/modules/tasks/composer/TaskFormModal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type { Task } from '@/types/tasks.types'
import type { GroupMember } from '@/types/household.types'

const UNSORTED_ID = 'unsorted'

/** Display-only stand-in for the `unsorted` sentinel — list_id IS NULL has no
 *  real `task_lists` row, so there is nothing to fetch or rename. */
const UNSORTED_PSEUDO_LIST: Pick<TaskList, 'id' | 'name' | 'color'> = {
  id: UNSORTED_ID,
  name: 'Unsorted',
  color: '#6b7280',
}

/** `days` from today, using local date parts — never toISOString() (CLAUDE.md
 *  §16 trap 1). A local copy rather than importing another page's — see
 *  TasksAllPage.tsx for the same convention; sharing it isn't worth coupling
 *  two otherwise-unrelated pages together over one helper. */
function isoDatePlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const COLOR_PRESETS = [
  '#1D9E75', '#10b981', '#059669',
  '#3b82f6', '#6366f1', '#8b5cf6',
  '#ef4444', '#f97316', '#eab308',
  '#ec4899', '#14b8a6', '#6b7280',
]

type ViewMode = 'outline' | 'list'

/**
 * FEAT-062 review fix #9: after Delete, the clicked row (and its own "More"
 * trigger) unmounts, so focus would otherwise fall to `<body>` with no
 * indication of where the list went. Finds the next row's "More" trigger in
 * whichever group (`openRows` / `doneRows`) the deleted task belonged to —
 * computed BEFORE the task is actually removed from either array, since the
 * "neighbour" lookup needs the row still present to find its position.
 * Falls back to the composer input, then (in the caller) the list's own
 * heading, if the deleted row had no neighbour in its group.
 */
function findNextFocusSelector(deletedId: string, openRows: Task[], doneRows: Task[]): string {
  const neighborIn = (rows: Task[]): string | null => {
    const idx = rows.findIndex((t) => t.id === deletedId)
    if (idx === -1) return null
    const neighbor = rows[idx + 1] ?? rows[idx - 1]
    return neighbor ? `[data-testid="task-row-more-${neighbor.id}"]` : null
  }
  return neighborIn(openRows) ?? neighborIn(doneRows) ?? '[data-testid="today-composer-input"]'
}

/**
 * List detail — `/tasks/lists/:listId` (R5 PR-3,
 * docs/roadmap/design-adoption/.flow/R5-list-detail/flow-plan.md). Replaces the bare
 * `TasksOutlinerPage.tsx` wrapper with a band (list name/colour/progress), a
 * List/Outline view toggle, and a settings rail (rename/recolour).
 *
 * Deliberately scoped down from a literal reading of the design spec — see
 * the plan's context map. FEAT-062
 * (docs/backlog/EP-07-tasks-depth/FEAT-062-tasks-list-detail-design-adoption.md)
 * re-examined that original scope-out with the data model as it stands
 * today: Recurring-count and Wallet-linkage DO have real backing data now
 * (task.recurrence/task.walletRef, FEAT-028/FEAT-032) and are built below as
 * band stats plus a per-row wallet chip. An activity feed and a 90-day
 * per-person completion split still have no backing data model (or are a
 * materially bigger feature than this pass) and stay out — see FEAT-062's
 * "What this item does NOT build" section.
 *
 * DEFAULT VIEW IS OUTLINE, not List, even though this is nominally a "list
 * detail" page. `e2e/01-tasks.spec.ts` (plus 07/08/09/12/19/21/22/46/47)
 * navigate straight to `/tasks/lists/unsorted` and assert outliner content —
 * a "New task" button, contenteditable rows — with nothing else on screen
 * first. Defaulting to List mode would show this page's band + grouped rows
 * instead and break every one of those specs' very first assertions. Outline
 * mode renders the existing `TasksPage` completely unchanged (same as PR-1's
 * fallback), so keeping it the default preserves that behaviour exactly.
 */
export function TasksListDetailPage() {
  const { listId = UNSORTED_ID } = useParams<{ listId: string }>()
  const isUnsorted = listId === UNSORTED_ID
  const navigate = useNavigate()

  const { loadTasks, addTask, completeTask, deleteTaskById } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const { addToast, removeToast } = useToastStore()
  // FEAT-062: the same hook `BulletNode.tsx` already uses to resolve a
  // task's `walletRef` into real MYR chip text — not a second implementation.
  const { ensureLoaded: ensureWalletLoaded, resolveChip } = useWalletRefChips()

  // See the data-fetch effect below: refs so its dependency array can stay on
  // `[listId, isUnsorted]` instead of these hooks' unstable identities. Kept
  // current via their own effect (not a direct render-time assignment,
  // which react-hooks/refs disallows) — this runs after every render, same
  // as the identities it mirrors would have changed on anyway.
  const loadTasksRef = useRef(loadTasks)
  const loadTaskListsRef = useRef(loadTaskLists)
  const addToastRef = useRef(addToast)
  useEffect(() => {
    loadTasksRef.current = loadTasks
    loadTaskListsRef.current = loadTaskLists
    addToastRef.current = addToast
  })

  // FEAT-062 review fix #6: one undo-toast id PER deleted task id, not a
  // single shared slot — the earlier version (mirroring TasksPage.tsx's
  // single `undoToastIdRef`) let a second delete's toast silently replace
  // the first's, clobbering its undo. Keyed by task id so two deletes close
  // together each keep their own toast and their own undo data (closed over
  // directly in `handleDeleteTask` below, not read back out of this map).
  const undoToastIdsRef = useRef<Map<string, string>>(new Map())

  const [viewMode, setViewMode] = useState<ViewMode>('outline')
  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [completedInList, setCompletedInList] = useState<Task[]>([])
  // FEAT-062: the real household's co-members, for the composer's `@` picker
  // and each row's assignee avatar — same `GET /groups/members` resolution
  // `TasksAssignedPage.tsx` already does.
  const [members, setMembers] = useState<GroupMember[]>([])
  // FEAT-062 review fix #8: true only while the LAST `GET /groups/members`
  // attempt failed — gates hiding the assignee picker (degrade that one
  // control, not the whole page) rather than, as before, lumping this fetch
  // into the same `Promise.all` as the core list/tasks fetch so any members
  // failure fell through to the page's own "Could not load this list" catch
  // and blanked every task row along with it.
  const [membersError, setMembersError] = useState(false)
  // Derived, not stored: a fetch in flight for a `listId` other than the one
  // last completed for is "loading". Avoids calling setState synchronously at
  // the top of the effect below (react-hooks/set-state-in-effect) just to
  // flip a spinner back on when `listId` changes.
  const [loadedForListId, setLoadedForListId] = useState<string | null>(null)
  const loading = loadedForListId !== listId
  const [doneCollapsed, setDoneCollapsed] = useState(false)
  // FEAT-062: the composer's "Task"/"Assign" shortcuts open this shared modal
  // — same wiring as TasksTodayPage.tsx/TasksAssignedPage.tsx.
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskFormContent, setTaskFormContent] = useState<string | undefined>(undefined)
  const [taskFormFocusField, setTaskFormFocusField] = useState<'assignee' | undefined>(undefined)

  const realList = taskLists.find((l) => l.id === listId)
  const list: Pick<TaskList, 'id' | 'name' | 'color'> = isUnsorted
    ? UNSORTED_PSEUDO_LIST
    : (realList ?? { id: listId, name: 'List', color: '#6b7280' })

  // FEAT-051: every row here belongs to `list` above — until a picker moves
  // it elsewhere, at which point its dot needs to reflect the NEW list
  // rather than staying stuck on this page's.
  const listById = useMemo(() => new Map(taskLists.map((l) => [l.id, l])), [taskLists])

  // Rail form state — reset whenever the list being edited changes. Adjusted
  // during render (React's documented pattern for "reset state when a prop
  // changes") rather than in an effect, for the same set-state-in-effect
  // reason as `loadedForListId` above.
  const [nameDraft, setNameDraft] = useState(list.name)
  const [colorDraft, setColorDraft] = useState(list.color)
  // Keyed on id+name+color (not just id) so the drafts also pick up the real
  // name/colour once `taskLists` finishes loading — before that, `list` is a
  // same-id placeholder ('List' / grey) and only its name/colour change.
  const draftsKey = `${list.id}|${list.name}|${list.color}`
  const [syncedDraftsKey, setSyncedDraftsKey] = useState(draftsKey)
  const [savingSettings, setSavingSettings] = useState(false)
  if (syncedDraftsKey !== draftsKey) {
    setSyncedDraftsKey(draftsKey)
    setNameDraft(list.name)
    setColorDraft(list.color)
  }

  // FEAT-062 review fix #10b: a single in-flight-fetch guard shared by every
  // caller of `fetchListData` below (the initial/listId-change effect AND
  // the view-mode-transition effect further down) — calling it cancels
  // whatever fetch it last started, so two triggers close together can never
  // race each other's `setState` calls.
  const activeFetchCancelRef = useRef<() => void>(() => {})

  // FEAT-062 review fix #8: the core list/tasks fetch and the household
  // members fetch are now two independent requests, not two entries in the
  // same `Promise.all` — a `GET /groups/members` failure used to fall
  // through to this effect's own catch (the SAME one covering the actual
  // task data) and blank the whole page via "Could not load this list.",
  // even though the task rows themselves had loaded fine. Now a members
  // failure only sets `membersError` (hiding the assignee picker) and toasts
  // its own message; the task rows render regardless.
  const fetchListData = useCallback(() => {
    activeFetchCancelRef.current()
    let cancelled = false
    activeFetchCancelRef.current = () => {
      cancelled = true
    }

    // Called through refs, not the hooks' own return values, and depended on
    // by identity below (`listId`/`isUnsorted` only): `useTasks()` /
    // `useTaskLists()` re-derive `loadTasks`/`loadTaskLists`/`addToast` on
    // every render of ANY subscriber to the tasks store — including Outline
    // mode's `TasksPage`, mounted right alongside this effect by default.
    // Depending on those identities directly would re-fire this effect on
    // every one of those unrelated renders, so the fetch below would be
    // cancelled by the next run before it ever resolves and the band would
    // stay stuck at its initial zeroes. `TasksPage.tsx` itself is out of
    // scope for this PR, so the fix lives here rather than at the source.
    Promise.all([loadTasksRef.current('list', listId), loadTasksRef.current('completed'), loadTaskListsRef.current()])
      .then(([open, completed]) => {
        if (cancelled) return
        setOpenTasks(open)
        setCompletedInList(
          completed.filter((t) => (isUnsorted ? t.listId === null : t.listId === listId)),
        )
        setLoadedForListId(listId)
      })
      .catch((err) => {
        if (cancelled) return
        addToastRef.current({ message: errorMessage(err, 'Could not load this list.') })
        setLoadedForListId(listId)
      })

    api
      .get<Record<string, unknown>[]>('/groups/members')
      .then((rows) => {
        if (cancelled) return
        setMembers(rows.map(mapMember))
        setMembersError(false)
      })
      .catch((err) => {
        if (cancelled) return
        setMembersError(true)
        addToastRef.current({
          message: errorMessage(err, 'Could not load household members — assigning tasks is unavailable for now.'),
        })
      })
  }, [listId, isUnsorted])

  useEffect(() => {
    fetchListData()
    return () => activeFetchCancelRef.current()
  }, [fetchListData])

  // FEAT-062 review fix #10b: Outline mode edits this list's tasks through
  // the outliner's own store, completely bypassing this page's local
  // `openTasks`/`completedInList`/band-stats — so switching back to List view
  // showed stale data (a task completed in Outline mode still "open" here)
  // until a full page reload. Re-running the same fetch on every transition
  // INTO List view (not on every `viewMode` change — Outline mode needs no
  // refetch of its own, it reads the live store directly) picks that up.
  const prevViewModeRef = useRef(viewMode)
  useEffect(() => {
    if (prevViewModeRef.current !== 'list' && viewMode === 'list') {
      fetchListData()
    }
    prevViewModeRef.current = viewMode
  }, [viewMode, fetchListData])

  const coMembers = useMemo(() => members.map((m) => ({ userId: m.userId, username: m.username })), [members])
  // FEAT-062 review fix #8: `TaskListRow`'s `coMembers` prop is optional and
  // hide-when-absent by convention — passing `undefined` while the last
  // members fetch failed hides the (otherwise non-functional) assignee
  // picker entirely rather than showing one with no real options. The
  // composer/modal keep getting the plain array (possibly empty); their own
  // "Unassigned"-only state is an acceptable degrade for a required prop.
  const rowCoMembers = membersError ? undefined : coMembers

  // FEAT-062: a row with a walletRef needs the chip data even if the
  // "Link to Wallet…" dialog (outliner-only) is never opened on this page —
  // same story as BulletNode.tsx's identical effect. Gated on List view: no
  // chip renders in Outline mode (that's BulletNode's own concern), so there's
  // nothing to load for until the viewer actually switches to List.
  useEffect(() => {
    if (viewMode !== 'list') return
    ensureWalletLoaded().catch((err) => {
      addToastRef.current({ message: errorMessage(err, 'Could not load linked Wallet items.') })
    })
  }, [viewMode, ensureWalletLoaded])

  const totalInList = openTasks.length + completedInList.length
  const donePct = totalInList > 0 ? Math.round((completedInList.length / totalInList) * 100) : 0

  // FEAT-062 band stats — counts only, over `openTasks` (never completed —
  // the mockup's own "of the N still open" sub-line denominator).
  const recurringOpenCount = openTasks.filter((t) => t.recurrence !== null).length
  // Review fix #5: counting raw `walletRef !== null` included refs that
  // resolve to nothing (a deleted bill/goal, or another user's bill on a
  // shared-list task) — the stat disagreed with the zero actual chips shown
  // on the rows themselves. `resolveChip` is the same resolution each row
  // already uses, so the count and the chips can no longer disagree.
  const walletLinkedOpenCount = openTasks.filter((t) => resolveChip(t.walletRef) !== null).length

  const weekStart = isoDatePlus(-6)
  const today = isoDatePlus(0)
  const doneThisWeek = useMemo(
    () =>
      completedInList.filter(
        (t) => t.completedAt && t.completedAt.slice(0, 10) >= weekStart && t.completedAt.slice(0, 10) <= today,
      ),
    [completedInList, weekStart, today],
  )

  const handleToggleComplete = async (id: string) => {
    try {
      const updated = await completeTask(id)
      if (updated.isCompleted) {
        setOpenTasks((prev) => prev.filter((t) => t.id !== id))
        setCompletedInList((prev) => [updated, ...prev])
      } else {
        setCompletedInList((prev) => prev.filter((t) => t.id !== id))
        setOpenTasks((prev) => [...prev, updated])
      }
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not update that task — please try again.') })
    }
  }

  // FEAT-052 / BUG-006: TaskListRow persists the edit itself (guard-free
  // hook functions), but its display always renders `task.content`/
  // `task.dueDate` from THIS page's own arrays — without updating them here
  // too, a saved edit would revert to the stale prop the moment the row
  // leaves edit mode.
  const handleContentChange = (id: string, content: string) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === id ? { ...t, content } : t)))
    setCompletedInList((prev) => prev.map((t) => (t.id === id ? { ...t, content } : t)))
  }
  const handleDueDateChange = (id: string, dueDate: string | null) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === id ? { ...t, dueDate } : t)))
  }
  // FEAT-051: a task moved to a different list via the row's picker no
  // longer belongs on this page — filtered out on the next reload, but kept
  // visible (now showing its new list's dot) until then rather than
  // silently vanishing, matching how a due-date change doesn't re-fetch
  // either.
  const handleListChange = (id: string, newListId: string | null) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === id ? { ...t, listId: newListId } : t)))
    setCompletedInList((prev) => prev.map((t) => (t.id === id ? { ...t, listId: newListId } : t)))
  }

  /**
   * FEAT-062 review fix #1/#4 — shared creation path for both the composer
   * and the "New task" modal. `effectiveListId` is fully resolved by each
   * caller below before this runs:
   * - the composer is free text with no list-picker UI of its own, so an
   *   unmatched `#tag` (`draft.listId === null`) genuinely means "no
   *   opinion" and `handleCreateTask` below defaults it to the page's own
   *   list — there would be no honest way to explain a task added from
   *   "Groceries" landing in "Chores" instead.
   * - the modal's visible "List" dropdown (now prefilled to the page's own
   *   list by `initialListId` below) always expresses a real, explicit
   *   choice, including "Unsorted" — `handleTaskFormSubmit` honours it
   *   verbatim, never defaulting it.
   * Both previously discarded whatever the draft actually said in favour of
   * the current page's list unconditionally — review fix #4.
   *
   * The created task is appended to `openTasks` with its FULL resolved
   * fields (list/priority/assignee/due, once the follow-up PATCH below
   * succeeds) — not the bare just-created row — because `handleDeleteTask`'s
   * undo snapshot (further down) reads straight out of this page's own
   * `openTasks`/`completedInList` arrays, never the outliner's Zustand
   * store. Review fix #1's bug was exactly this: the old code appended the
   * bare row here but the store (which `deleteTask`'s snapshot actually
   * read from) only ever saw the pre-PATCH version, so Undo always restored
   * a bare Unsorted task regardless of what the composer/modal asked for.
   * Keeping those two in sync (append-the-merged-row here, snapshot-from-
   * local-state on delete) is what makes Undo correct now.
   */
  // Review fix #4 (completion): a task created with an explicit list other
  // than this page's own must not also show up in THIS page's "Open"
  // section — it doesn't belong here once the override is actually honoured.
  // Appends locally only when the resolved list matches the page; otherwise
  // confirms where it landed instead, so the honoured choice is also visible,
  // not just persisted.
  const appendIfBelongsHere = (task: Task) => {
    const belongsHere = task.listId === (isUnsorted ? null : listId)
    if (belongsHere) {
      setOpenTasks((prev) => [...prev, task])
      return
    }
    const landedList = task.listId ? listById.get(task.listId) : undefined
    addToast({ message: `Added to ${landedList?.name ?? 'another list'}.` })
  }

  const createTaskWithList = async (draft: TaskComposerDraft, effectiveListId: string | null) => {
    let newTask: Task
    try {
      newTask = await addTask(draft.content, null, null)
    } catch {
      // addTask already surfaced the error and reconciled the store.
      return
    }

    const patch: Record<string, unknown> = {}
    if (effectiveListId !== null) patch.listId = effectiveListId
    if (draft.priority !== null) patch.priority = draft.priority
    if (draft.assigneeId !== null) patch.assigneeId = draft.assigneeId
    if (draft.dueDate !== null) patch.dueDate = draft.dueDate
    if (draft.dueTime !== null) patch.dueTime = draft.dueTime

    if (Object.keys(patch).length === 0) {
      appendIfBelongsHere({ ...newTask, listId: effectiveListId })
      return
    }

    try {
      const row = await api.patch<Record<string, unknown>>(`/tasks/${newTask.id}`, patch)
      const merged: Task = {
        ...newTask,
        listId: (row.list_id as string | null | undefined) ?? effectiveListId,
        priority: (row.priority as Task['priority'] | undefined) ?? draft.priority ?? newTask.priority,
        assigneeId: (row.assignee_id as string | null | undefined) ?? draft.assigneeId ?? newTask.assigneeId,
        dueDate: (row.due_date as string | null | undefined) ?? draft.dueDate ?? newTask.dueDate,
        dueTime: (row.due_time as string | null | undefined) ?? draft.dueTime ?? newTask.dueTime,
      }
      appendIfBelongsHere(merged)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Task added, but its details could not be saved — please edit it to fix that.') })
      appendIfBelongsHere({ ...newTask, listId: effectiveListId })
    }
  }

  const handleCreateTask = async (draft: TaskComposerDraft) => {
    const effectiveListId = draft.listId !== null ? draft.listId : isUnsorted ? null : listId
    await createTaskWithList(draft, effectiveListId)
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

  // Review fix #4: the modal's dropdown always expresses an explicit choice
  // (it's prefilled to this page's own list below, not "Unsorted") — so
  // unlike the composer's `handleCreateTask`, this never defaults a null:
  // `null` here means the user explicitly picked "Unsorted", and that is
  // exactly what gets honoured.
  const handleTaskFormSubmit = async (draft: TaskFormDraft) => {
    await createTaskWithList(draft, draft.listId)
  }

  /**
   * FEAT-062 review fix #1/#2/#3/#6/#7 — recreates every task in `snapshot`
   * (the root plus any locally-known cascaded descendants, captured by
   * `handleDeleteTask` BEFORE the delete went out) via a direct POST, the
   * same restore shape `useTasks.ts`'s own `restoreDeleted` uses — but kept
   * local to this page rather than routed through that store-backed helper,
   * since this page's `openTasks`/`completedInList` are the only source of
   * truth it needs. Restores whatever succeeds even if a later item in the
   * snapshot fails, and always toasts a failure (CLAUDE.md §2 rule 10) —
   * the old version had no `.catch` at all, so a failed Undo silently did
   * nothing.
   */
  const undoDelete = async (snapshot: { task: Task; wasOpen: boolean }[]) => {
    const restored: { task: Task; wasOpen: boolean }[] = []
    try {
      for (const entry of snapshot) {
        const t = entry.task
        await api.post('/tasks', {
          id: t.id,
          parentId: t.parentId,
          content: t.content,
          note: t.note,
          isCompleted: t.isCompleted,
          isCollapsed: t.isCollapsed,
          sortOrder: t.sortOrder,
          dueDate: t.dueDate ?? null,
          listId: t.listId ?? null,
          priority: t.priority,
          dueTime: t.dueTime ?? null,
          assigneeId: t.assigneeId ?? null,
          assignedAt: t.assignedAt ?? null,
          recurrence: t.recurrence ?? null,
          recurrenceData: t.recurrenceData ?? null,
          recurrenceParentId: t.recurrenceParentId ?? null,
          walletRef: t.walletRef ?? null,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })
        restored.push(entry)
      }
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not undo that delete — please try again.') })
    }
    for (const { task, wasOpen } of restored) {
      if (wasOpen) setOpenTasks((prev) => [...prev, task])
      else setCompletedInList((prev) => [...prev, task])
    }
  }

  /**
   * FEAT-062 review fix #3 (root cause) — deletes via `deleteTaskById`
   * (`useTasks.ts`), the store-independent variant, NOT the outliner-store-
   * backed `deleteTask` the first version of this page used. `deleteTask`
   * silently no-oped for any task not already in the global Zustand store —
   * which is every task on THIS page whenever it was assigned to the viewer
   * by a co-member or lives in a group-shared list, since this page loads
   * everything via a store-bypassing `loadTasks('list'/'completed', …)` —
   * a CLAUDE.md §2 rule 10 violation (a click that removed nothing and said
   * nothing). The server side of that same gap is fixed in
   * worker/routes/tasks.ts's DELETE handler (review fix #3), which used to
   * scope deletion to `user_id = caller` only.
   *
   * Review fix #2 — the server CASCADEs descendants and now reports back
   * every id it actually removed; those are the ids this page filters out of
   * its own `openTasks`/`completedInList`, not just the one id the row
   * passed in, so a deleted parent's cascaded children (when they're flat
   * rows on this same page — same list_id) disappear too instead of lingering
   * with a now-wrong subtask count.
   *
   * Review fix #6 — the snapshot and undo-toast are keyed per task id (a
   * `Map`, not one shared ref), so two deletes close together never clobber
   * each other's undo data or toast.
   */
  const handleDeleteTask = async (id: string) => {
    const stillPresent = openTasks.some((t) => t.id === id) || completedInList.some((t) => t.id === id)
    if (!stillPresent) return

    // Computed from the CURRENT arrays, before anything is removed — the
    // deleted row still needs to be present to find its neighbour (review fix #9).
    const focusSelector = findNextFocusSelector(id, openTasks, doneThisWeek)

    let deletedIds: string[]
    try {
      deletedIds = await deleteTaskById(id)
    } catch {
      // deleteTaskById already surfaced the failure (reportAndReconcile) —
      // nothing removed locally, nothing more to do here.
      return
    }

    const snapshot: { task: Task; wasOpen: boolean }[] = []
    for (const t of openTasks) if (deletedIds.includes(t.id)) snapshot.push({ task: t, wasOpen: true })
    for (const t of completedInList) if (deletedIds.includes(t.id)) snapshot.push({ task: t, wasOpen: false })
    // The clicked task is always restored first — any locally-known
    // descendants in `snapshot` are its children, so recreating it first
    // satisfies their parent_id foreign key.
    snapshot.sort((a, b) => (a.task.id === id ? -1 : b.task.id === id ? 1 : 0))

    setOpenTasks((prev) => prev.filter((t) => !deletedIds.includes(t.id)))
    setCompletedInList((prev) => prev.filter((t) => !deletedIds.includes(t.id)))

    // Runs after this render commits the removal above, so the deleted
    // row(s) have actually left the DOM and the computed neighbour (or the
    // composer/heading fallback) can be found and focused (review fix #9).
    requestAnimationFrame(() => {
      const el =
        document.querySelector<HTMLElement>(focusSelector) ??
        document.querySelector<HTMLElement>('[data-testid="list-detail-title"]')
      el?.focus()
    })

    const existingToastId = undoToastIdsRef.current.get(id)
    if (existingToastId) removeToast(existingToastId)
    const toastId = addToast({
      message: 'Task deleted',
      action: {
        label: 'Undo',
        onClick: () => {
          void undoDelete(snapshot)
          undoToastIdsRef.current.delete(id)
        },
      },
      duration: 5000,
    })
    undoToastIdsRef.current.set(id, toastId)
  }

  const handleSaveSettings = async () => {
    if (isUnsorted) return
    const trimmed = nameDraft.trim()
    if (!trimmed) {
      addToast({ message: 'List name cannot be empty.' })
      return
    }
    setSavingSettings(true)
    try {
      await api.put(`/task-lists/${listId}`, { name: trimmed, color: colorDraft })
      await loadTaskLists()
      addToast({ message: 'List updated.' })
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not update this list — please try again.') })
    } finally {
      setSavingSettings(false)
    }
  }

  return (
    <div className="content">
      <div className="page-head">
        <div>
          {/* tabIndex=-1: not in the normal tab order, but a valid target for
              `handleDeleteTask`'s programmatic focus() when a deleted row had
              no sibling to hand focus to and the composer input isn't found
              either (review fix #9's last-resort fallback). */}
          <h1 className="page-title" tabIndex={-1} data-testid="list-detail-title">{list.name}</h1>
          {/* FEAT-062: dynamic and honest — the static description never
              reflected the list's actual state, and "shared with X and Y" is
              dropped. Not because no such data model exists — `task_list_shares`
              and `POST/GET /task-lists/:id/shares` are real, shipped routes
              (worker/routes/tasks.ts) — but because no client UI consumes them
              yet (review fix #10c: an earlier version of this comment claimed
              the data model itself didn't exist, which is wrong; the scope
              decision to leave it UI-less for now is unchanged). */}
          <p className="page-sub" data-testid="list-detail-sub">{openTasks.length} open</p>
        </div>
        <div className="segment" role="tablist" aria-label="View" data-testid="list-view-toggle">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'outline'}
            onClick={() => setViewMode('outline')}
            data-testid="list-view-outline"
          >
            Outline
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'list'}
            onClick={() => setViewMode('list')}
            data-testid="list-view-list"
          >
            List
          </button>
        </div>
      </div>

      {/* Band — list name/colour + progress (unchanged), plus the band-stats
          column FEAT-062 adds: Recurring and Linked to Wallet now have real
          backing data (task.recurrence/task.walletRef). No "Members" stat —
          no client UI exists yet for list sharing (see the page-sub comment
          above and the item's "does NOT build" note; review fix #10c). */}
      <div className="card card-pad mb-4" data-testid="list-detail-band">
        <div className="band">
          <div className="band-main">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 flex-shrink-0 rounded-full"
                style={{ background: list.color }}
                aria-hidden="true"
                data-testid="list-detail-swatch"
              />
              <span className="band-fig">
                <span className="v" data-testid="list-detail-progress">
                  {completedInList.length} of {totalInList}
                </span>
                <span className="k">done</span>
              </span>
            </div>
            <div className="track mt-3">
              <i className="bg-pos" style={{ width: `${donePct}%` }} />
            </div>
          </div>
          <div className="band-stats">
            <div className="band-stat" data-testid="list-detail-stat-recurring">
              <p className="k">Recurring</p>
              <p className="v">{recurringOpenCount}</p>
              {/* Review fix #10a: "0 of the 0 still open" for an empty list was
                  a redundant, honest-sounding non-statement — an empty list has
                  nothing to be "still open" relative to. */}
              <p className="s">{openTasks.length > 0 ? `of the ${openTasks.length} still open` : 'No tasks open'}</p>
            </div>
            <div className="band-stat" data-testid="list-detail-stat-wallet">
              <p className="k">Linked to Wallet</p>
              <p className="v">{walletLinkedOpenCount}</p>
              <p className="s">{openTasks.length > 0 ? `of the ${openTasks.length} still open` : 'No tasks open'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="dash">
        <section className="c8 stack">
          {viewMode === 'outline' ? (
            <TasksPage />
          ) : loading ? (
            <p className="text-sm text-fg-subtle">Loading this list…</p>
          ) : (
            <>
              {/* FEAT-062: List view's own composer — Outline mode keeps
                  getting its composer from `TasksPage` above, unchanged. */}
              <TaskComposer
                lists={taskLists}
                coMembers={coMembers}
                onCreateTask={handleCreateTask}
                onOpenHabitModal={handleOpenHabitModal}
                onOpenTaskForm={handleOpenTaskForm}
                onOpenAssignForm={handleOpenAssignForm}
              />

              <div>
                <div className="tgroup" data-testid="list-detail-open-header">
                  <span>Open</span>
                  <span className="n">{openTasks.length}</span>
                  <span className="line" />
                </div>
                {openTasks.length === 0 ? (
                  <p className="py-3 text-sm text-fg-subtle" data-testid="list-detail-open-empty">
                    Nothing open in this list.
                  </p>
                ) : (
                  openTasks.map((t) => (
                    <TaskListRow
                      key={t.id}
                      task={t}
                      list={t.listId ? listById.get(t.listId) : undefined}
                      onToggleComplete={handleToggleComplete}
                      onContentChange={handleContentChange}
                      onDueDateChange={handleDueDateChange}
                      availableLists={taskLists}
                      onListChange={handleListChange}
                      coMembers={rowCoMembers}
                      walletChip={resolveChip(t.walletRef)}
                      onDelete={handleDeleteTask}
                    />
                  ))
                )}
              </div>

              {doneThisWeek.length > 0 && (
                <div>
                  <button
                    type="button"
                    className="tgroup w-full text-left"
                    onClick={() => setDoneCollapsed((v) => !v)}
                    aria-expanded={!doneCollapsed}
                    data-testid="list-detail-done-toggle"
                  >
                    <span>Done this week</span>
                    <span className="n">{doneThisWeek.length}</span>
                    <span className="line" />
                  </button>
                  {!doneCollapsed &&
                    doneThisWeek.map((t) => (
                      <TaskListRow
                        key={t.id}
                        task={t}
                        list={t.listId ? listById.get(t.listId) : undefined}
                        onToggleComplete={handleToggleComplete}
                        onContentChange={handleContentChange}
                        onDueDateChange={handleDueDateChange}
                        availableLists={taskLists}
                        onListChange={handleListChange}
                        coMembers={rowCoMembers}
                        walletChip={resolveChip(t.walletRef)}
                        onDelete={handleDeleteTask}
                      />
                    ))}
                </div>
              )}
            </>
          )}
        </section>

        <aside className="c4 stack">
          {!isUnsorted && (
            <div className="card card-pad" data-testid="list-detail-rail">
              <div className="card-head">
                <span className="card-title">List settings</span>
              </div>
              <div className="stack">
                <Input
                  label="Name"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  data-testid="list-detail-name-input"
                />
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-fg-muted">Colour</label>
                  <div className="flex flex-wrap gap-2">
                    {COLOR_PRESETS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="group flex h-10 w-10 shrink-0 items-center justify-center rounded-full md:h-7 md:w-7"
                        onClick={() => setColorDraft(color)}
                        aria-label={`Select colour ${color}`}
                        data-testid="list-detail-color-swatch"
                      >
                        <span
                          className={`h-7 w-7 rounded-full border-2 transition-transform ${
                            colorDraft === color ? 'scale-110 border-fg' : 'border-transparent group-hover:scale-105'
                          }`}
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveSettings}
                  loading={savingSettings}
                  data-testid="list-detail-save-settings"
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <TaskFormModal
        open={taskFormOpen}
        onClose={() => setTaskFormOpen(false)}
        lists={taskLists}
        coMembers={coMembers}
        initialContent={taskFormContent}
        initialListId={isUnsorted ? null : listId}
        focusField={taskFormFocusField}
        onSubmit={handleTaskFormSubmit}
      />
    </div>
  )
}
