import { format, parseISO, addDays, differenceInCalendarDays } from 'date-fns'
import { api } from '@/lib/api'

// Candidate window (plan §Open decisions: start at ±5 days, tune after use).
// Shared by LinkTransferDialog's manual picker and TransferLinkHint's proactive
// search — keep both in sync with this one constant.
export const CANDIDATE_WINDOW_DAYS = 5

// Raw row from GET /transactions — only the fields either search needs.
export interface TransferCandidateRow {
  id: string
  account_id: string
  date: string
  merchant: string | null
  description: string | null
  amount: number
  type: string
  has_splits: number
}

/**
 * The opposite-type, other-account rows that could be this transaction's twin
 * — same amount, within CANDIDATE_WINDOW_DAYS, not itself, not split. Best
 * match (closest date) first.
 */
export async function fetchTransferCandidates(transaction: {
  id: string
  accountId: string
  amount: number
  date: string
  wantType: 'income' | 'expense'
}): Promise<TransferCandidateRow[]> {
  const base = parseISO(transaction.date)
  const dateFrom = format(addDays(base, -CANDIDATE_WINDOW_DAYS), 'yyyy-MM-dd')
  const dateTo = format(addDays(base, CANDIDATE_WINDOW_DAYS), 'yyyy-MM-dd')
  const rows = await api.get<TransferCandidateRow[]>(
    `/transactions?dateFrom=${dateFrom}&dateTo=${dateTo}&type=${transaction.wantType}`,
  )
  return rows
    .filter(
      (r) =>
        r.id !== transaction.id &&
        r.account_id !== transaction.accountId &&
        Math.abs(r.amount - transaction.amount) <= 0.01 &&
        !r.has_splits,
    )
    .sort(
      (a, b) =>
        Math.abs(differenceInCalendarDays(parseISO(a.date), base)) -
        Math.abs(differenceInCalendarDays(parseISO(b.date), base)),
    )
}
