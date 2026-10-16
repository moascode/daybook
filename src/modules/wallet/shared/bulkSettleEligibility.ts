import type { ClaimState } from '@/types/household.types'

export interface SettleEligibility {
  ok: boolean
  reason: string
}

/** The minimum a row needs to carry for the eligibility check below —
 * structurally satisfied by SharedActivity's own ActivityRow, without this
 * file importing that type back (it would be a circular import, since
 * SharedActivity imports this function). */
export interface SettleCandidateRow {
  role: 'debtor' | 'creditor'
  state: ClaimState
  outstanding: number
  counterpartyId: string
  counterpartyUsername: string
}

/**
 * Whether a selection of split-review rows can go straight to Settle Up:
 * every row has to be a debt the viewer owes (role debtor), still open with
 * something outstanding, and owed to the same person — and that person has
 * to share an actual group with the viewer, because `POST /settlements`
 * requires a real `groupId` (worker/routes/settlements.ts) and a selection
 * with no shared group has nothing to send.
 *
 * `groupIdFor` is the caller's own lookup (SharedPage builds it from the
 * per-group membership lists it already fetches) rather than something this
 * function derives from the rows themselves — a claim's own API shape does
 * not carry which group it belongs to.
 */
/** POST /settlements rejects a shareIds array over this length (400) —
 * matched here so an oversized selection is refused before the request. */
export const MAX_BULK_SETTLE_ROWS = 90

export function computeSettleEligibility(
  rows: SettleCandidateRow[],
  groupIdFor: (userId: string) => string | null,
): SettleEligibility {
  if (rows.length === 0) return { ok: false, reason: '' }
  if (rows.length > MAX_BULK_SETTLE_ROWS) {
    return { ok: false, reason: `Select at most ${MAX_BULK_SETTLE_ROWS} rows to settle at once` }
  }
  if (rows.some((r) => r.role !== 'debtor')) {
    return { ok: false, reason: 'Settle only works for debts you owe — your selection includes a claim owed to you.' }
  }
  if (rows.some((r) => !(r.state === 'pending' || r.state === 'approved') || r.outstanding <= 0.005)) {
    return { ok: false, reason: 'Settle only works for open claims with something still outstanding.' }
  }
  const counterparties = new Set(rows.map((r) => r.counterpartyId))
  if (counterparties.size > 1) {
    return { ok: false, reason: 'Select claims owed to the same person to settle them together.' }
  }
  const first = rows[0]
  if (!groupIdFor(first.counterpartyId)) {
    return { ok: false, reason: `You don't share a group with ${first.counterpartyUsername}.` }
  }
  return { ok: true, reason: '' }
}
