import type { Task } from '@/types/tasks.types'

/**
 * Merge freshly created tasks into a page's local list by id. The composer's
 * `onTasksCreated` can report the SAME parent twice (a checklist whose failed
 * items were retried), so a plain append would duplicate its row.
 */
export function upsertTasks(prev: Task[], incoming: Task[]): Task[] {
  const next = [...prev]
  for (const t of incoming) {
    const i = next.findIndex((x) => x.id === t.id)
    if (i === -1) next.push(t)
    else next[i] = t
  }
  return next
}
