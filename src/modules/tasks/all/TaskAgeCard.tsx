import { OLD_TASK_DAYS, taskAgeDays } from '@/modules/tasks/all/groupTasks'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

interface TaskAgeCardProps {
  openTasks: Task[]
  listById: Map<string, TaskList>
  /** Narrows the task list above to the tasks older than three months. */
  onReview: () => void
}

const BUCKETS = [
  { key: 'week', label: 'Under a week', color: 'rgb(var(--pos))', test: (d: number) => d < 7 },
  { key: 'month', label: '1–4 weeks', color: 'rgb(var(--info))', test: (d: number) => d >= 7 && d < 28 },
  { key: 'quarter', label: '1–3 months', color: 'rgb(var(--warn))', test: (d: number) => d >= 28 && d < OLD_TASK_DAYS },
  { key: 'old', label: 'Over 3 months', color: 'rgb(var(--neg))', test: (d: number) => d >= OLD_TASK_DAYS },
]

/**
 * "Where tasks go to die" (tasks-all.html): open tasks bucketed by age, and a
 * Review action that filters the list down to the oldest bucket. The sub-line
 * names a list only when most of the old tasks really do sit in it.
 */
export function TaskAgeCard({ openTasks, listById, onReview }: TaskAgeCardProps) {
  const ages = openTasks.map((t) => ({ task: t, days: taskAgeDays(t) }))
  const rows = BUCKETS.map((b) => ({ ...b, count: ages.filter((a) => b.test(a.days)).length }))
  const peak = Math.max(1, ...rows.map((r) => r.count))

  const old = ages.filter((a) => a.days >= OLD_TASK_DAYS).map((a) => a.task)
  const oldSub = (() => {
    if (old.length === 0) return null
    const counts = new Map<string, number>()
    for (const t of old) counts.set(t.listId ?? '', (counts.get(t.listId ?? '') ?? 0) + 1)
    const [topKey, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    const name = topKey ? listById.get(topKey)?.name : 'Unsorted'
    if (!name || topCount <= old.length / 2) return `Spread across ${counts.size} lists`
    if (topCount === old.length) return `All in ${name}`
    const rest = old.length - topCount
    return `All but ${rest === 1 ? 'one' : rest === 2 ? 'two' : rest} in ${name}`
  })()

  return (
    <section className="card card-pad c5 flex flex-col" data-testid="all-tasks-age-card">
      <div className="card-head">
        <div>
          <div className="card-title">Where tasks go to die</div>
          <div className="card-sub">Open tasks by age</div>
        </div>
      </div>
      <div className="blist">
        {rows.map((r) => (
          <div className="brow" key={r.key} data-testid={`all-tasks-age-${r.key}`}>
            <span className="cat-dot" style={{ background: r.color }} />
            <div className="brow-main">
              <div className="brow-top">
                <span className="brow-name">{r.label}</span>
                <span className="brow-val">{r.count}</span>
              </div>
              <div className="track">
                <i style={{ width: `${(r.count / peak) * 100}%`, background: r.color }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="divider" style={{ marginTop: 'auto' }} />
      {old.length > 0 ? (
        <div className="sug" style={{ paddingBottom: 0 }}>
          <div className="sug-main">
            <div className="sug-title" data-testid="age-breakdown">
              {old.length} task{old.length === 1 ? '' : 's'} older than three months
            </div>
            {oldSub && <div className="sug-sub">{oldSub}</div>}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onReview} data-testid="all-tasks-age-review">
            Review
          </button>
        </div>
      ) : (
        <p className="text-sm text-fg-subtle">Nothing has been open longer than three months.</p>
      )}
    </section>
  )
}
