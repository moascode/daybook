import { format, parseISO } from 'date-fns'
import { CalendarClock, Scale, CalendarOff, Moon, Info } from 'lucide-react'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'
import type { WorthKnowingItem } from '@/modules/tasks/today/useTodayTasks'

const TAVATAR_TINTS = [
  { background: 'rgb(var(--accent-bg))', color: 'rgb(var(--accent-fg))' },
  { background: 'rgb(var(--alt-bg))', color: 'rgb(var(--alt-fg))' },
  { background: 'rgb(var(--calm-bg))', color: 'rgb(var(--calm-fg))' },
]

/** "Tue 13 · 10:30 · Work" (mockup: proposal-v2/tasks.html `.prow`'s `.psub`). */
function upNextSub(task: Task, list: TaskList | undefined): string {
  const parts = [format(parseISO(task.dueDate!), 'EEE d')]
  if (task.dueTime) parts.push(task.dueTime.slice(0, 5))
  if (list) parts.push(list.name)
  return parts.join(' · ')
}

function UpNextCard({
  upNext,
  listById,
  onPlanWeek,
}: {
  upNext: Task[]
  listById: Map<string, TaskList>
  onPlanWeek: () => void
}) {
  return (
    <div className="card card-pad">
      <div className="card-head">
        <span className="card-title">Up next</span>
        <button type="button" className="section-action" onClick={onPlanWeek}>
          Week →
        </button>
      </div>
      {upNext.length === 0 ? (
        <p className="text-sm text-fg-subtle">Nothing scheduled yet.</p>
      ) : (
        upNext.map((t, i) => (
          <div key={t.id} className="prow" data-testid="upnext-row">
            <div className="tavatar" style={TAVATAR_TINTS[i % TAVATAR_TINTS.length]}>
              <CalendarClock className="icon-sm" aria-hidden="true" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="pname truncate">{t.content || 'Untitled task'}</div>
              <div className="psub">{upNextSub(t, t.listId ? listById.get(t.listId) : undefined)}</div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function ListsCard({
  taskLists,
  openTasks,
  completedTasks,
  onViewAll,
}: {
  taskLists: TaskList[]
  openTasks: Task[]
  completedTasks: Task[]
  onViewAll: () => void
}) {
  if (taskLists.length === 0) return null
  return (
    <div className="card card-pad" data-testid="today-lists-card">
      <div className="card-head">
        <span className="card-title">Lists</span>
        <button type="button" className="section-action" onClick={onViewAll}>
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
              <span className="cat-dot" style={{ background: l.color }} aria-hidden="true" />
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
  )
}

/** Icon + tint per "Worth knowing" item, keyed off what the item is actually about. */
function worthKnowingVisual(title: string): { Icon: typeof Info; tint: { background: string; color: string } } {
  if (title.includes('lopsided')) {
    return { Icon: Scale, tint: { background: 'rgb(var(--warn-bg))', color: 'rgb(var(--warn-fg))' } }
  }
  if (title.includes('no due date')) {
    return { Icon: CalendarOff, tint: { background: 'rgb(var(--info-bg))', color: 'rgb(var(--info-fg))' } }
  }
  if (title.includes('evening')) {
    return { Icon: Moon, tint: { background: 'rgb(var(--alt-bg))', color: 'rgb(var(--alt-fg))' } }
  }
  return { Icon: Info, tint: { background: 'rgb(var(--accent-bg))', color: 'rgb(var(--accent-fg))' } }
}

function WorthKnowingCard({ items, onAction }: { items: WorthKnowingItem[]; onAction: (href: string) => void }) {
  if (items.length === 0) return null
  return (
    <div className="card card-pad" data-testid="today-worth-knowing-card">
      <div className="card-head">
        <span className="card-title">Worth knowing</span>
      </div>
      <div>
        {items.map((w) => {
          const { Icon, tint } = worthKnowingVisual(w.title)
          return (
            <div key={w.title} className="sug">
              <div className="tavatar" style={tint}>
                <Icon className="icon-sm" aria-hidden="true" />
              </div>
              <div className="sug-main">
                <p className="sug-title">{w.title}</p>
                <p className="sug-sub">{w.sub}</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAction(w.href)}>
                {w.actionLabel}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface TodayRailProps {
  upNext: Task[]
  taskLists: TaskList[]
  openTasks: Task[]
  completedTasks: Task[]
  listById: Map<string, TaskList>
  worthKnowing: WorthKnowingItem[]
  onNavigate: (href: string) => void
}

/** The Today page's right rail: Up next, Lists, Worth knowing. */
export function TodayRail({ upNext, taskLists, openTasks, completedTasks, listById, worthKnowing, onNavigate }: TodayRailProps) {
  return (
    <aside className="c4 stack">
      <UpNextCard upNext={upNext} listById={listById} onPlanWeek={() => onNavigate('/tasks/upcoming')} />
      <ListsCard
        taskLists={taskLists}
        openTasks={openTasks}
        completedTasks={completedTasks}
        onViewAll={() => onNavigate('/tasks/all')}
      />
      <WorthKnowingCard items={worthKnowing} onAction={onNavigate} />
    </aside>
  )
}
