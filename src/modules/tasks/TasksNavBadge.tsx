import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { todayISO } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'

interface TasksNavBadgeProps {
  /** `today`: your open tasks due today or earlier (red once any are late).
   *  `assigned`: open tasks someone else has handed you. */
  kind: 'today' | 'assigned'
}

interface TaskRowLite {
  user_id: string
  assignee_id: string | null
  due_date: string | null
}

/**
 * The count beside Today and Assigned to me in the Tasks sidebar
 * (proposal-v2/tasks.html: `nav-badge alert` on Today, plain on Assigned).
 *
 * Same shape as CaptureInboxBadge: recounts on navigation rather than
 * polling, so a task completed on any page is reflected by the next click.
 * Today counts only *your* work — owned by or assigned to you — matching the
 * Today page's default "Mine" view, so the badge and the page agree.
 */
export function TasksNavBadge({ kind }: TasksNavBadgeProps) {
  const [count, setCount] = useState(0)
  const [late, setLate] = useState(false)
  const userId = useAppStore((s) => s.user?.id ?? '')
  const location = useLocation()

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    api
      .get<TaskRowLite[]>(`/tasks?view=${kind}`)
      .then((rows) => {
        if (cancelled) return
        const today = todayISO()
        const mine =
          kind === 'today'
            ? rows.filter((r) => r.user_id === userId || r.assignee_id === userId)
            : rows.filter((r) => r.user_id !== userId)
        setCount(mine.length)
        setLate(kind === 'today' && mine.some((r) => r.due_date !== null && r.due_date < today))
      })
      // An ambient count is not the place to raise a toast — the page itself
      // reports a failed load. Log it so a broken badge is still debuggable.
      .catch((err: unknown) => console.error(`Tasks ${kind} badge count failed`, err))
    return () => {
      cancelled = true
    }
  }, [kind, userId, location.pathname])

  if (count === 0) return null
  return (
    <span className={late ? 'nav-badge alert' : 'nav-badge'} data-testid={`nav-tasks-${kind}-badge`}>
      {count}
    </span>
  )
}
