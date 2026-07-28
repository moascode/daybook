import { useCallback, useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { DateRangeControl } from '@/components/ui/DateRangeControl'
import { api } from '@/lib/api'
import { formatMYR } from '@/lib/utils'

interface SplitRow {
  id: string
  transaction_id: string
  share_amount: number
  settled_amount: number
  status: string
  date: string
  merchant: string
  transaction_amount: number
  owner_username: string
  owner_id: string
  debtor_username: string
  debtor_id: string
}

/**
 * The transactions behind one balance line.
 *
 * A balance is a single number standing in for a pile of individual splits, and
 * the original failure in this whole workstream was someone being shown that
 * number with no way to reach what it was made of. This is that way.
 *
 * Date filtering is opt-in and starts at All time: a claim is outstanding until
 * it is resolved, so defaulting to the current month here would recreate the
 * exact bug that started this — a debt on screen and an empty list under it.
 */
export function BalanceBreakdown({
  counterpartyId,
  iAmCreditor,
}: {
  counterpartyId: string
  iAmCreditor: boolean
}) {
  const [rows, setRows] = useState<SplitRow[]>([])
  const [range, setRange] = useState({ dateFrom: '', dateTo: '' })
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ status: 'pending' })
      if (iAmCreditor) qs.set('role', 'creditor')
      if (range.dateFrom) qs.set('dateFrom', range.dateFrom)
      if (range.dateTo) qs.set('dateTo', range.dateTo)
      const all = await api.get<SplitRow[]>(`/transactions/splits/mine?${qs}`)
      // Only the pair this balance is about — one group can hold several.
      setRows(all.filter((r) => (iAmCreditor ? r.debtor_id : r.owner_id) === counterpartyId))
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [counterpartyId, iAmCreditor, range.dateFrom, range.dateTo])

  useEffect(() => { if (open) load() }, [open, load]) // eslint-disable-line react-hooks/set-state-in-effect

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid="balance-breakdown-toggle"
        aria-expanded={open}
        className="text-xs font-medium text-brand-600 hover:underline"
      >
        {open ? 'Hide' : 'Show'} the {rows.length || ''} transactions behind this
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-3" data-testid="balance-breakdown">
          <DateRangeControl
            value={range}
            onChange={setRange}
            className="mb-2"
          />
          {loading ? (
            <p className="py-2 text-xs text-gray-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-2 text-xs text-gray-400" data-testid="breakdown-empty">
              Nothing outstanding in this range.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2" data-testid="breakdown-row">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-gray-800">
                      {r.merchant || '(no merchant)'}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {format(parseISO(r.date), 'dd MMM yyyy')}
                      {r.share_amount !== r.transaction_amount && (
                        <> · {formatMYR(r.transaction_amount)} total</>
                      )}
                      {r.settled_amount > 0.005 && (
                        <> · {formatMYR(r.settled_amount)} paid</>
                      )}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-gray-700">
                    {formatMYR(r.share_amount - r.settled_amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
