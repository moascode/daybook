import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api } from '@/lib/api'
import { formatMYR } from '@/lib/utils'
import type { GroupBalance } from '@/types/household.types'

interface Pairing {
  groupId: string
  counterpartyId: string
  counterpartyUsername: string
  balance: GroupBalance
}

interface Account {
  id: string
  name: string
  isShared?: boolean
}

/**
 * "Mark all as settled": records one real settlement per outstanding pairing,
 * sequentially, against a single account the user picks once. There is no
 * bulk-settle endpoint — this is client-side orchestration over the same
 * `POST /settlements` SettleUpDialog uses for one pairing at a time.
 */
export function MarkAllSettledDialog({
  open,
  pairings,
  currentUserId,
  accounts,
  onClose,
  onDone,
}: {
  open: boolean
  pairings: Pairing[]
  currentUserId: string
  accounts: Account[]
  onClose: () => void
  onDone: () => void
}) {
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const myAccounts = accounts.filter((a) => !a.isShared)

  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    let failed = 0
    for (const p of pairings) {
      const iAmCreditor = p.balance.toUserId === currentUserId
      try {
        await api.post('/settlements', {
          groupId: p.groupId,
          ...(iAmCreditor ? { fromUserId: p.balance.fromUserId } : { toUserId: p.balance.toUserId }),
          amount: p.balance.amount,
          ...(iAmCreditor ? { toAccountId: accountId } : { fromAccountId: accountId }),
        })
      } catch {
        failed += 1
      }
    }
    setBusy(false)
    if (failed > 0) {
      setError(`${failed} of ${pairings.length} payment${pairings.length === 1 ? '' : 's'} couldn't be recorded. The rest were.`)
      return
    }
    onDone()
  }

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose() }} title="Mark all as settled">
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          Records {pairings.length} payment{pairings.length === 1 ? '' : 's'} — nothing leaves your bank; this
          only books the ledger entries.
        </p>
        <ul className="space-y-1 rounded-lg border border-line-subtle bg-surface-sunken p-3 text-xs">
          {pairings.map((p) => {
            const iAmCreditor = p.balance.toUserId === currentUserId
            return (
              <li key={`${p.groupId}:${p.counterpartyId}`} className="flex justify-between">
                <span className="text-fg-muted">
                  {iAmCreditor ? `${p.counterpartyUsername} pays you` : `You pay ${p.counterpartyUsername}`}
                </span>
                <span className="tabular-nums font-medium text-fg">{formatMYR(p.balance.amount)}</span>
              </li>
            )
          })}
        </ul>
        <Select
          label="Account to apply"
          id="mark-all-account"
          options={[
            { value: '', label: '— select account —' },
            ...myAccounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        />
        <p className="text-xs text-fg-faint">
          Used for whichever side is yours in each payment above — deposits when you're owed, withdrawals when you owe.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={busy || !accountId}>
            {busy ? 'Recording…' : `Record ${pairings.length} payment${pairings.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
