import { useEffect, useState, type KeyboardEvent } from 'react'
import { format, parseISO } from 'date-fns'
import { Plus } from 'lucide-react'
import { useTasks } from '@/hooks/useTasks'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { cn, errorMessage, todayISO } from '@/lib/utils'
import { TaskRow } from '@/modules/tasks/TaskRow'
import type { Task } from '@/types/tasks.types'

/** `days` from today, using local date parts — never toISOString() (CLAUDE.md §16 trap 1). */
function isoDatePlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Today — the Tasks module's landing page (R5 PR-1,
 * docs/v2/tasks/02-design-adoption.md §Today). Band (done-today progress +
 * overdue/assigned/finished-this-week + a 7-day load strip), a minimal
 * interim composer, the Overdue/Today/Done-today grouped list, and an
 * "Up next" right rail.
 *
 * The full Wallet-syntax composer (hotkeys, shortcut row, `"pay rent
 * tomorrow 9am #household !high"` parsing) is R7's deliverable — this page
 * gets retrofitted once that ships. For now, Enter-to-add is the whole
 * composer, same as the outliner's own "New task" affordance.
 */
export function TasksTodayPage() {
  const { loadTasks, addTask, updateTask, completeTask, rescheduleTasks } = useTasks()
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const addToast = useToastStore((s) => s.addToast)

  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [doneCollapsed, setDoneCollapsed] = useState(false)
  const [composerText, setComposerText] = useState('')
  const [composerBusy, setComposerBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadTasks('all'), loadTasks('completed')])
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
  }, [loadTasks, addToast])

  const today = todayISO()

  const overdueTasks = openTasks.filter((t) => t.dueDate !== null && t.dueDate < today)
  const todayTasks = openTasks.filter((t) => t.dueDate === today)
  const doneTodayTasks = completedTasks.filter((t) => t.completedAt?.slice(0, 10) === today)
  const upNext = openTasks
    .filter((t) => t.dueDate !== null && t.dueDate > today)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
    .slice(0, 5)

  const assignedCount = openTasks.filter((t) => t.assigneeId === currentUserId).length
  const weekStart = isoDatePlus(-6)
  const finishedThisWeekCount = completedTasks.filter(
    (t) => t.completedAt && t.completedAt.slice(0, 10) >= weekStart && t.completedAt.slice(0, 10) <= today,
  ).length

  const totalToday = overdueTasks.length + todayTasks.length + doneTodayTasks.length
  const doneCount = doneTodayTasks.length
  const donePct = totalToday > 0 ? Math.round((doneCount / totalToday) * 100) : 0

  const loadStrip = Array.from({ length: 7 }, (_, i) => {
    const date = isoDatePlus(i)
    const count = openTasks.filter((t) => t.dueDate === date).length
    return { date, label: format(parseISO(date), 'EEE'), count }
  })
  const maxLoad = Math.max(1, ...loadStrip.map((d) => d.count))

  const handleComposerKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const content = composerText.trim()
    if (!content || composerBusy) return
    setComposerBusy(true)
    try {
      // A task added from the Today page is, by definition, a today task —
      // default its due date to today so it lands in the Today group instead
      // of vanishing into the undated pile this page doesn't show.
      const newTask = await addTask(content, null)
      await updateTask(newTask.id, { dueDate: today })
      setOpenTasks((prev) => [...prev, { ...newTask, dueDate: today }])
      setComposerText('')
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not add that task — please try again.') })
    } finally {
      setComposerBusy(false)
    }
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

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Today</h1>
          <p className="page-sub">What's due, what's overdue, and what you've already finished.</p>
        </div>
      </div>

      {/* Band */}
      <div className="card card-pad mb-4" data-testid="today-band">
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
      </div>

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your tasks…</p>
      ) : (
        <div className="dash">
          <section className="c8 stack">
            <div className="qadd">
              <Plus className="plus" size={18} aria-hidden="true" />
              <input
                type="text"
                placeholder='Add a task — press Enter to save'
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                disabled={composerBusy}
                aria-label="New task"
                data-testid="today-composer-input"
              />
              <span className="hint">Enter</span>
            </div>

            {overdueTasks.length > 0 && (
              <div>
                <div className="tgroup">
                  <span>Overdue</span>
                  <span className="n">{overdueTasks.length}</span>
                  <span className="line" />
                  <button
                    type="button"
                    className="section-action"
                    onClick={handleRescheduleAll}
                    data-testid="reschedule-all-btn"
                  >
                    Reschedule all
                  </button>
                </div>
                {overdueTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onToggleComplete={handleToggleComplete} />
                ))}
              </div>
            )}

            <div>
              <div className="tgroup">
                <span>Today</span>
                <span className="n">{todayTasks.length}</span>
                <span className="line" />
              </div>
              {todayTasks.length === 0 ? (
                <p className="py-3 text-sm text-fg-subtle">Nothing due today.</p>
              ) : (
                todayTasks.map((t) => <TaskRow key={t.id} task={t} onToggleComplete={handleToggleComplete} />)
              )}
            </div>

            {doneTodayTasks.length > 0 && (
              <div>
                <button
                  type="button"
                  className="tgroup w-full text-left"
                  onClick={() => setDoneCollapsed((v) => !v)}
                  aria-expanded={!doneCollapsed}
                  data-testid="done-today-toggle"
                >
                  <span>Done today</span>
                  <span className="n">{doneTodayTasks.length}</span>
                  <span className="line" />
                </button>
                {!doneCollapsed &&
                  doneTodayTasks.map((t) => (
                    <TaskRow key={t.id} task={t} onToggleComplete={handleToggleComplete} />
                  ))}
              </div>
            )}
          </section>

          <aside className="c4 stack">
            <div className="card card-pad">
              <div className="card-head">
                <span className="card-title">Up next</span>
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
          </aside>
        </div>
      )}
    </div>
  )
}
