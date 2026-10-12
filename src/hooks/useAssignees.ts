import { useMemo } from 'react'
import { useAppStore } from '@/stores/app.store'

export interface Assignee {
  userId: string
  username: string
}

/**
 * Who a task can be assigned to: the viewer first (labelled "Me"), then their
 * household co-members.
 *
 * `GET /groups/members` returns co-members ONLY — the caller is excluded — so
 * every picker built straight from `coMembers` offered everyone except the
 * person using it, and a task could not be assigned to yourself. Pickers read
 * from here instead of `coMembers` so they cannot drift apart again.
 */
export function useAssignees(coMembers: Assignee[]): Assignee[] {
  const userId = useAppStore((s) => s.user?.id ?? '')
  return useMemo(() => {
    const others = coMembers.filter((m) => m.userId !== userId)
    return userId ? [{ userId, username: 'Me' }, ...others] : others
  }, [coMembers, userId])
}
