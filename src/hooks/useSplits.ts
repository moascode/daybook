import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { refreshClaimBadge } from '@/lib/claim-badge'
import { mapSplitClaim } from '@/lib/household.mappers'
import type { ClaimState, SplitClaim } from '@/types/household.types'

export interface SplitQuery {
  /**
   * 'debtor' = claims against me; 'creditor' = claims I have made on others;
   * 'both' = one of each, in parallel.
   *
   * 'both' exists because a pair of people is not one direction. The Shared page
   * used to pick a single role per person from whichever way the *netted*
   * balance pointed, which meant that when two people owed each other, the
   * smaller direction's claims were never fetched at all — no row, no agree, no
   * reject, and the money only visible as a total the page could not explain.
   */
  role: 'debtor' | 'creditor' | 'both'
  counterparty?: string
  groupId?: string
  dateFrom?: string
  dateTo?: string
  /**
   * Bumped by the page when something outside this hook changed the claims.
   * A prop rather than a remount: the section owns tab and date-range state, and
   * remounting to force a refetch threw both away — agreeing to one claim
   * bounced the user back to the "To review" tab mid-review.
   */
  revision?: number
}

/**
 * Every claim between the caller and one counterparty, both directions,
 * whatever state.
 *
 * Fetched unfiltered by state on purpose: the Shared page renders tabs over the
 * result, and the tab counts have to be right before a tab is opened. Narrowing
 * happens server-side on the axes that actually reduce the row count — the
 * person and the group — rather than in the browser, which is what the balance
 * breakdown used to do.
 *
 * Not date-filtered by default. A claim is outstanding until it is resolved,
 * whatever month it came from; that was the original bug.
 */
export function useSplits(query: SplitQuery) {
  const { role, counterparty, groupId, dateFrom, dateTo, revision } = query
  // `claims` stays the caller's own direction so existing call sites are
  // unchanged; `owedToMe`/`iOwe` are the two sides named, for callers that need
  // both at once.
  const [owedToMe, setOwedToMe] = useState<SplitClaim[]>([])
  const [iOwe, setIOwe] = useState<SplitClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    // `revision` is a refetch trigger, not a query input: reading it here is
    // what makes it a genuine dependency rather than one the linter is right to
    // call unnecessary. Bumping it re-runs this without remounting the caller.
    void revision
    setError(false)

    const fetchSide = async (asCreditor: boolean) => {
      const qs = new URLSearchParams()
      if (asCreditor) qs.set('role', 'creditor')
      // Every state including rejected — the tabs need them all. Without this
      // the endpoint defaults to hiding rejected claims and the Rejected tab
      // is permanently empty.
      qs.set('state', 'pending,approved,awaiting_confirmation,settled,rejected')
      if (counterparty) qs.set('counterparty', counterparty)
      if (groupId) qs.set('groupId', groupId)
      if (dateFrom) qs.set('dateFrom', dateFrom)
      if (dateTo) qs.set('dateTo', dateTo)
      const rows = await api.get<Record<string, unknown>[]>(`/transactions/splits/mine?${qs}`)
      // `splits/mine` matches on ts.user_id alone, so the debtor side of an
      // equal split hands back the payer's OWN share row — you, owing yourself.
      // It is not a claim and must not be counted as one.
      return rows.map(mapSplitClaim).filter((c) => c.ownerId !== c.debtorId)
    }

    try {
      // In parallel: two round trips, one render. Sequential would show one
      // direction populated and the other empty for a frame, which reads as the
      // very bug this replaced.
      const [credit, debit] = await Promise.all([
        role === 'debtor' ? Promise.resolve([]) : fetchSide(true),
        role === 'creditor' ? Promise.resolve([]) : fetchSide(false),
      ])
      setOwedToMe(credit)
      setIOwe(debit)
    } catch {
      setOwedToMe([])
      setIOwe([])
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [role, counterparty, groupId, dateFrom, dateTo, revision])

  useEffect(() => { load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  return {
    claims: role === 'creditor' ? owedToMe : iOwe,
    owedToMe,
    iOwe,
    loading,
    error,
    reload: load,
  }
}

/** Claims in one state, newest transaction first (the server already sorts). */
export function claimsInState(claims: SplitClaim[], state: ClaimState): SplitClaim[] {
  return claims.filter((c) => c.state === state)
}

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
