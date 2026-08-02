import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app.store'
import { useHouseholdStore } from '@/stores/household.store'

/**
 * Recomputes the Shared nav badge: everything waiting on the current user.
 *
 * One definition, deliberately. This used to be computed in two places that
 * disagreed — the sidebar counted unresolved claims *plus* payments awaiting the
 * user's confirmation, while the review queue counted claims alone and wrote the
 * result to the same store field. Whichever ran last won, so the badge changed
 * meaning depending on which page you were on.
 *
 * Callers are the sidebar's poll and any action that resolves a claim; the poll
 * is only every 60s, so an action that clears the last claim has to say so
 * itself or the badge sits there stale.
 */
export async function refreshClaimBadge(): Promise<void> {
  try {
    const [claims, settlements] = await Promise.all([
      api.get<unknown[]>('/transactions/splits/mine?status=pending'),
      api.get<{ status?: string; to_user?: string }[]>('/settlements'),
    ])
    const me = useAppStore.getState().user?.id
    const toConfirm = settlements.filter(
      (x) => x.status === 'awaiting_confirmation' && x.to_user === me,
    ).length
    useHouseholdStore.getState().setPendingClaimCount(claims.length + toConfirm)
  } catch {
    // A failed refresh leaves the previous count standing; the poll retries.
  }
}
