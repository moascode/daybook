import { useEffect, useState } from 'react'
import { format, parseISO, addDays, differenceInCalendarDays } from 'date-fns'
import { ArrowRightLeft } from 'lucide-react'
import { api } from '@/lib/api'
import { formatMYR } from '@/lib/utils'
import type { Account } from '@/types/wallet.types'

// Same window as LinkTransferDialog — keep the two searches consistent.
const CANDIDATE_WINDOW_DAYS = 5
const DEBOUNCE_MS = 400

// Raw row from GET /transactions — only the fields the hint needs.
export interface TransferMatchCandidate {
  id: string
  account_id: string
  date: string
  merchant: string | null
  description: string | null
  amount: number
  type: string
  has_splits: number
}

interface TransferMatchHintProps {
  sourceAccountId: string
  destinationAccountId: string
  amount: number
  date: string
  accounts: Account[]
  onLink: (candidate: TransferMatchCandidate) => Promise<void>
}

/**
 * Shown while creating a NEW transfer: if an unlinked expense already sits on
 * the source account or an unlinked income already sits on the destination
 * account — same amount, within a few days — creating this transfer would
 * duplicate a movement that's already recorded. Offer to link into that row
 * instead of also inserting a fresh transfer (the same merge "Link as
 * transfer" performs from the edit form, just reached from the create form).
 */
export function TransferMatchHint({
  sourceAccountId,
  destinationAccountId,
  amount,
  date,
  accounts,
  onLink,
}: TransferMatchHintProps) {
  const [candidates, setCandidates] = useState<TransferMatchCandidate[]>([])
  const [linkingId, setLinkingId] = useState<string | null>(null)

  // Search key — null while the form hasn't given us enough to search on yet.
  // Rebuilt every render; when it changes, reset any stale candidates from the
  // render (adjust-during-render pattern, same as LinkTransferDialog's
  // fetchKey/prevFetchKey — keeps the setState out of the effect body, which
  // react-hooks/set-state-in-effect otherwise flags).
  const searchKey =
    sourceAccountId && destinationAccountId && sourceAccountId !== destinationAccountId && amount > 0 && date
      ? `${sourceAccountId}|${destinationAccountId}|${amount}|${date}`
      : null
  const [prevSearchKey, setPrevSearchKey] = useState<string | null>(searchKey)
  if (searchKey !== prevSearchKey) {
    setPrevSearchKey(searchKey)
    setCandidates([])
  }

  useEffect(() => {
    if (!searchKey) return
    let cancelled = false
    const timer = setTimeout(() => {
      const base = parseISO(date)
      const dateFrom = format(addDays(base, -CANDIDATE_WINDOW_DAYS), 'yyyy-MM-dd')
      const dateTo = format(addDays(base, CANDIDATE_WINDOW_DAYS), 'yyyy-MM-dd')
      const params =
        `dateFrom=${dateFrom}&dateTo=${dateTo}` +
        `&accountId=${sourceAccountId}&accountId=${destinationAccountId}` +
        `&type=expense&type=income`
      api
        .get<TransferMatchCandidate[]>(`/transactions?${params}`)
        .then((rows) => {
          if (cancelled) return
          const matches = rows
            .filter(
              (r) =>
                Math.abs(r.amount - amount) <= 0.01 &&
                !r.has_splits &&
                ((r.type === 'expense' && r.account_id === sourceAccountId) ||
                  (r.type === 'income' && r.account_id === destinationAccountId)),
            )
            .sort(
              (a, b) =>
                Math.abs(differenceInCalendarDays(parseISO(a.date), base)) -
                Math.abs(differenceInCalendarDays(parseISO(b.date), base)),
            )
          setCandidates(matches)
        })
        .catch(() => { if (!cancelled) setCandidates([]) })
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchKey, sourceAccountId, destinationAccountId, amount, date])

  if (candidates.length === 0) return null

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Unknown account'

  async function handlePick(candidate: TransferMatchCandidate) {
    if (linkingId) return
    setLinkingId(candidate.id)
    try {
      await onLink(candidate)
    } finally {
      setLinkingId(null)
    }
  }

  return (
    <div
      className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/40 p-3"
      data-testid="transfer-match-hint"
    >
      <p className="text-xs font-medium text-fg-muted">
        Already recorded elsewhere? Link this transfer to the matching transaction instead
        of creating a new one:
      </p>
      <ul className="space-y-1.5" data-testid="transfer-match-candidates">
        {candidates.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => handlePick(c)}
              disabled={!!linkingId}
              className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">
                  {c.merchant || c.description || 'Untitled'}
                </span>
                <span className="block text-xs text-fg-faint">
                  {accountName(c.account_id)} · {format(parseISO(c.date), 'dd MMM yyyy')}
                </span>
              </span>
              <span className="text-sm font-semibold text-fg-muted">
                {formatMYR(c.amount)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
