import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { refreshClaimBadge } from '@/lib/claim-badge'
import { mapSplitClaim } from '@/lib/household.mappers'
import type { ClaimState, SplitClaim } from '@/types/household.types'

export interface SplitQuery {
  /** 'debtor' = claims against me; 'creditor' = claims I have made on others. */
  role: 'debtor' | 'creditor'
  counterparty?: string
  groupId?: string
  dateFrom?: string
  dateTo?: string
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
  const { role, counterparty, groupId, dateFrom, dateTo } = query
  const [claims, setClaims] = useState<SplitClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    try {
      const qs = new URLSearchParams()
      if (role === 'creditor') qs.set('role', 'creditor')
      // Every state including rejected — the tabs need them all. Without this
      // the endpoint defaults to hiding rejected claims and the Rejected tab
      // is permanently empty.
      qs.set('state', 'pending,approved,awaiting_confirmation,settled,rejected')
      if (counterparty) qs.set('counterparty', counterparty)
      if (groupId) qs.set('groupId', groupId)
      if (dateFrom) qs.set('dateFrom', dateFrom)
      if (dateTo) qs.set('dateTo', dateTo)
      const rows = await api.get<Record<string, unknown>[]>(`/transactions/splits/mine?${qs}`)
      setClaims(rows.map(mapSplitClaim))
    } catch {
      setClaims([])
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [role, counterparty, groupId, dateFrom, dateTo])

  useEffect(() => { load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  return { claims, loading, error, reload: load }
}

/** Claims in one state, newest transaction first (the server already sorts). */
export function claimsInState(claims: SplitClaim[], state: ClaimState): SplitClaim[] {
  return claims.filter((c) => c.state === state)
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
