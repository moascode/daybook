import { api } from '@/lib/api'
import { refreshClaimBadge } from '@/lib/claim-badge'

/**
 * Agrees to a claim. Nothing about the money moves — the debt was already owed
 * — so this is safe to offer as a one-click action with an undo.
 */
export async function approveSplit(id: string): Promise<void> {
  await api.post(`/transactions/splits/${id}/approve`, {})
  await refreshClaimBadge()
}

/**
 * Agrees to several claims at once. Ids that are not the caller's are skipped
 * server-side rather than failing the batch, so a stale selection degrades to
 * "fewer approved" instead of an error.
 */
export async function approveSplits(ids: string[]): Promise<number> {
  const res = await api.post<{ approved: number }>('/transactions/splits/approve', { ids })
  await refreshClaimBadge()
  return res.approved
}

/** Takes the agreement back. Allowed until money moves against the claim. */
export async function unapproveSplit(id: string): Promise<void> {
  await api.post(`/transactions/splits/${id}/unapprove`, {})
  await refreshClaimBadge()
}

/**
 * Withdraws a claim the caller made on someone else — the payer's mirror of
 * reject. Allowed until money moves against it; past that the server refuses and
 * the settlement has to be undone first.
 */
export async function cancelSplit(id: string): Promise<void> {
  await api.delete(`/transactions/splits/${id}`)
  await refreshClaimBadge()
}

/**
 * Rejects a claim and refreshes the nav badge.
 *
 * The badge refresh is part of the action, not an afterthought: the sidebar
 * polls once a minute, so rejecting the last outstanding claim would otherwise
 * leave the badge lit for up to a minute after the queue is empty.
 */
export async function rejectSplit(id: string, reason: string): Promise<void> {
  await api.post(`/transactions/splits/${id}/reject`, { reason })
  await refreshClaimBadge()
}
