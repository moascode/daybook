import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import type { TaskList } from '@/hooks/useTaskLists'
import { useToastStore } from '@/stores/toast.store'
import { errorMessage } from '@/lib/utils'
import { api } from '@/lib/api'
import { TaskListRow } from '@/modules/tasks/TaskListRow'
import { TasksPage } from '@/modules/tasks/TasksPage'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type { Task } from '@/types/tasks.types'

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
 * List detail — `/tasks/lists/:listId` (R5 PR-3,
 * docs/v2/.flow/R5-list-detail/flow-plan.md). Replaces the bare
 * `TasksOutlinerPage.tsx` wrapper with a band (list name/colour/progress), a
 * List/Outline view toggle, and a settings rail (rename/recolour).
 *
 * Deliberately scoped down from a literal reading of the design spec — see
 * the plan's context map. Recurring-count, Wallet-linkage, an activity feed
 * and a 90-day per-person completion split are all omitted: none has a
 * backing data model in this codebase, and CLAUDE.md rule 13's spirit is to
 * omit a feature entirely rather than fake it with a zero or a dash.
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

  const { loadTasks, completeTask } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const addToast = useToastStore((s) => s.addToast)

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

  const [viewMode, setViewMode] = useState<ViewMode>('outline')
  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [completedInList, setCompletedInList] = useState<Task[]>([])
  // Derived, not stored: a fetch in flight for a `listId` other than the one
  // last completed for is "loading". Avoids calling setState synchronously at
  // the top of the effect below (react-hooks/set-state-in-effect) just to
  // flip a spinner back on when `listId` changes.
  const [loadedForListId, setLoadedForListId] = useState<string | null>(null)
  const loading = loadedForListId !== listId
  const [doneCollapsed, setDoneCollapsed] = useState(false)

  const realList = taskLists.find((l) => l.id === listId)
  const list: Pick<TaskList, 'id' | 'name' | 'color'> = isUnsorted
    ? UNSORTED_PSEUDO_LIST
    : (realList ?? { id: listId, name: 'List', color: '#6b7280' })

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

  useEffect(() => {
    let cancelled = false
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
    return () => {
      cancelled = true
    }
  }, [listId, isUnsorted])

  const totalInList = openTasks.length + completedInList.length
  const donePct = totalInList > 0 ? Math.round((completedInList.length / totalInList) * 100) : 0

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
          <h1 className="page-title" data-testid="list-detail-title">{list.name}</h1>
          <p className="page-sub">A single list, viewed either as a flat checklist or the full outliner.</p>
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

      {/* Band — list name/colour + progress only (criterion 2). Recurring-count
          and Wallet-linkage are out of scope: omitted entirely, not faked. */}
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
                    <TaskListRow key={t.id} task={t} list={undefined} onToggleComplete={handleToggleComplete} />
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
                      <TaskListRow key={t.id} task={t} list={undefined} onToggleComplete={handleToggleComplete} />
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
                        className={`h-7 w-7 rounded-full border-2 transition-transform ${
                          colorDraft === color ? 'scale-110 border-fg' : 'border-transparent hover:scale-105'
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setColorDraft(color)}
                        aria-label={`Select colour ${color}`}
                        data-testid="list-detail-color-swatch"
                      />
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
    </div>
  )
}
