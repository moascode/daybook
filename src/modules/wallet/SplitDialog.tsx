import { useState, useEffect, useCallback } from 'react'
import { Users } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { api } from '@/lib/api'
import { formatMYR, formatPercent, splitEqually, splitByPercents } from '@/lib/utils'
import { mapMember, mapTransactionShare } from '@/lib/household.mappers'
import type { Transaction } from '@/types/wallet.types'
import type { GroupMember, TransactionShare } from '@/types/household.types'

interface SplitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: Transaction | null
  currentUserId: string
  onSaved: () => void
}

type SplitMode = 'none' | 'equal' | 'custom' | 'percent'

export function SplitDialog({ open, onOpenChange, transaction, currentUserId, onSaved }: SplitDialogProps) {
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [existingShares, setExistingShares] = useState<TransactionShare[]>([])
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null)
  const [splitMode, setSplitMode] = useState<SplitMode>('none')
  const [customAmounts, setCustomAmounts] = useState<[string, string]>(['', ''])
  const [percents, setPercents] = useState<[string, string]>(['', ''])
  // Why the recipient is being asked for this. It reaches them in the review
  // queue, where until now they had a merchant, a date and an amount and no way
  // to tell an agreed cost from a mistake.
  const [note, setNote] = useState('')
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amount = transaction?.amount ?? 0

  // Percentage mode is judged in three places — the per-person preview, the
  // Save button, and handleSave — so derive it once and let them share it.
  const pctValues: [number, number] = [parseFloat(percents[0]) || 0, parseFloat(percents[1]) || 0]
  const pctSum = pctValues[0] + pctValues[1]
  const pctSumValid = Math.abs(pctSum - 100) <= 0.1
  const pctAmounts = splitByPercents(amount, pctValues)
  const pctSharesPositive = pctAmounts.every((a) => a > 0)

  const loadData = useCallback(async () => {
    if (!transaction) return
    setLoadingMembers(true)
    try {
      // §2.2: also load existing share rows so re-opening an already-shared
      // transaction shows who owes what instead of a blank form.
      const [memberRows, shareRows] = await Promise.all([
        api.get<Record<string, unknown>[]>('/groups/members').then((rows) => rows.map(mapMember)),
        api
          .get<Record<string, unknown>[]>(`/transactions/${transaction.id}/splits`)
          .then((rows) => rows.map(mapTransactionShare))
          .catch(() => [] as TransactionShare[]),
      ])
      setGroupMembers(memberRows.filter((m) => m.userId !== currentUserId))
      setExistingShares(shareRows)
     } finally {
      setLoadingMembers(false)
     }
   }, [transaction, currentUserId])

  useEffect(() => {
    // Clear the whole form on open. The note belongs to one claim, and carrying
    // the last one's explanation into the next would attach a wrong reason to a
    // real debt. The mode and its inputs are worse: WalletPage keeps this dialog
    // mounted, so without this a 70/30 set up on one transaction is still
    // selected, still valid and one click from saving on the *next* one —
    // percentages, unlike custom amounts, are amount-independent, so a stale
    // pair is never rejected by the sum check that would have caught it.
    /* eslint-disable react-hooks/set-state-in-effect -- resetting the form when
       the dialog opens is the whole point; `open` is the external event. */
    if (open) {
      setNote('')
      setSelectedRecipient(null)
      setSplitMode('none')
      setCustomAmounts(['', ''])
      setPercents(['', ''])
      loadData()
     }
    /* eslint-enable react-hooks/set-state-in-effect */
   }, [open, loadData])

  const handleSave = async () => {
    if (!transaction || !selectedRecipient) {
      setError('Please select a recipient')
      return
     }
    if (amount <= 0) {
      setError('Cannot split a zero-amount transaction')
      return
     }

    setSaving(true)
    setError(null)
    try {
      let shareAmounts: number[] | undefined

      if (splitMode === 'equal') {
        shareAmounts = splitEqually(amount, 2)
       } else if (splitMode === 'custom') {
        const [ownerAmt, recipientAmt] = customAmounts
        const sum = parseFloat(ownerAmt) + parseFloat(recipientAmt)
        if (Math.abs(sum - amount) > 0.015) {
          setError(`Amounts must sum to ${formatMYR(amount)} — got ${formatMYR(sum)}`)
          return
         }
        shareAmounts = [parseFloat(ownerAmt) || 0, parseFloat(recipientAmt) || 0]
       } else if (splitMode === 'percent') {
        if (!pctSumValid) {
          setError(`Percentages must sum to 100% — got ${formatPercent(pctSum)}%`)
          return
         }
        if (!pctSharesPositive) {
          setError('Each person needs a share above 0% — use Keep as-is to give them the full amount, or cancel to leave it unsplit')
          return
         }
        shareAmounts = pctAmounts
       }

      // The server only knows none/equal/custom — percent is a client-side
      // input method that resolves to the same custom-amounts payload.
      await api.post(`/transactions/${transaction.id}/split`, {
        recipientId: selectedRecipient,
        splitMode: splitMode === 'percent' ? 'custom' : splitMode,
        shareAmounts,
        note,
       })
      onSaved()
      onOpenChange(false)
     } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to split transaction')
     } finally {
      setSaving(false)
     }
   }

  if (!transaction) return null

  return (
     <Modal open={open} onOpenChange={onOpenChange} title="Split Transaction">
       <div className="space-y-4">
         <div className="rounded-lg bg-surface-sunken px-4 py-3">
           <p className="text-xs text-fg-subtle">Split</p>
           <p className="font-semibold text-fg">{transaction.merchant || 'Transaction'}</p>
           <p className="text-lg font-bold text-fg">{formatMYR(amount)}</p>
         </div>

         {/* §2.2: existing shares + overwrite warning */}
         {existingShares.length > 0 && (
           <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1" data-testid="existing-splits">
             <p className="text-xs font-medium text-amber-800">Currently split</p>
             {existingShares.map((s) => (
               <div key={s.id} className="flex items-center justify-between text-sm text-fg-muted">
                 <span>{s.userId === currentUserId ? 'You' : s.username}</span>
                 <span>
                   {formatMYR(s.shareAmount)}
                   {s.settledAt ? ' · settled' : ''}
                 </span>
               </div>
             ))}
             <p className="text-xs text-amber-700 pt-1">Saving will replace this split.</p>
           </div>
         )}

         {/* Recipient selector */}
         {loadingMembers ? (
           <p className="text-sm text-fg-faint text-center py-2">Loading members…</p>
         ) : groupMembers.length === 0 ? (
           <p className="text-sm text-fg-subtle text-center py-2">
             <Users className="h-4 w-4 inline mr-1" />
            No group members yet. Invite people in Settings → Sharing first.
           </p>
         ) : (
           <Select
             label="Split with"
             id="split-recipient"
             options={[
               { value: '', label: 'Select a recipient' },
               ...groupMembers.map((m) => ({ value: m.userId, label: m.username })),
             ]}
             value={selectedRecipient ?? ''}
             onChange={(e) => setSelectedRecipient(e.target.value || null)}
             disabled={saving}
           />
         )}

         {/* Split mode selector */}
         {selectedRecipient && (
           <div>
             <p className="text-xs font-medium text-fg-muted mb-2">How to split</p>
             <div className="flex gap-2">
               <Button
                variant={splitMode === 'none' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { setSplitMode('none'); setCustomAmounts(['', '']); setPercents(['', '']) }}
                disabled={saving}
               >
                Keep as-is ({formatMYR(amount)})
               </Button>
               <Button
                variant={splitMode === 'equal' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { setSplitMode('equal'); setCustomAmounts(['', '']); setPercents(['', '']) }}
                disabled={saving}
               >
                Split equally ({formatMYR(amount / 2)} each)
               </Button>
               <Button
                variant={splitMode === 'custom' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { setSplitMode('custom'); setPercents(['', '']) }}
                disabled={saving}
               >
                Custom amounts
               </Button>
               <Button
                variant={splitMode === 'percent' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { setSplitMode('percent'); setCustomAmounts(['', '']) }}
                disabled={saving}
               >
                By %
               </Button>
             </div>

             {/* Custom amounts inputs */}
             {splitMode === 'custom' && (
               <div className="mt-3 space-y-2">
                 <div className="flex items-center gap-3">
                   <span className="text-sm text-fg-muted">You</span>
                   <Input
                    type="number"
                    step="0.01"
                    className="w-32"
                    value={customAmounts[0]}
                    onChange={(e) => setCustomAmounts([e.target.value, customAmounts[1]])}
                    placeholder={formatMYR(amount / 2)}
                   />
                 </div>
                 <div className="flex items-center gap-3">
                   <span className="text-sm text-fg-muted">{groupMembers.find((m) => m.userId === selectedRecipient)?.username}</span>
                   <Input
                    type="number"
                    step="0.01"
                    className="w-32"
                    value={customAmounts[1]}
                    onChange={(e) => setCustomAmounts([customAmounts[0], e.target.value])}
                    placeholder={formatMYR(amount / 2)}
                   />
                 </div>
                 <div className="text-right text-xs text-fg-subtle">
                  Total: {formatMYR((parseFloat(customAmounts[0]) || 0) + (parseFloat(customAmounts[1]) || 0))} / {formatMYR(amount)}
                 </div>
               </div>
             )}

             {/* Percentage inputs — the two boxes auto-complement to 100%,
                 since a 2-party split always has exactly one degree of freedom.
                 The complement is rounded: 100 - 64.1 is 35.900000000000006 in
                 binary float, and that lands in the box the user reads. */}
             {splitMode === 'percent' && (
               <div className="mt-3 space-y-2">
                 <div className="flex items-center gap-3">
                   <span className="w-40 text-sm text-fg-muted">You</span>
                   <div className="flex items-center gap-1">
                     <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      className="w-24"
                      value={percents[0]}
                      onChange={(e) => {
                        const v = e.target.value
                        setPercents([v, v === '' ? '' : formatPercent(Math.min(100, Math.max(0, 100 - (parseFloat(v) || 0))))])
                       }}
                      placeholder="50"
                      data-testid="percent-you"
                     />
                     <span className="text-sm text-fg-subtle">%</span>
                   </div>
                   {/* Blank until the percentages add up: splitByPercents gives
                       the owner everything the other side hasn't claimed, so a
                       half-filled form would show an amount nobody typed. */}
                   <span className="text-xs text-fg-faint">
                    {pctSumValid ? formatMYR(pctAmounts[0]) : '—'}
                   </span>
                 </div>
                 <div className="flex items-center gap-3">
                   <span className="w-40 text-sm text-fg-muted">{groupMembers.find((m) => m.userId === selectedRecipient)?.username}</span>
                   <div className="flex items-center gap-1">
                     <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      className="w-24"
                      value={percents[1]}
                      onChange={(e) => {
                        const v = e.target.value
                        setPercents([v === '' ? '' : formatPercent(Math.min(100, Math.max(0, 100 - (parseFloat(v) || 0)))), v])
                       }}
                      placeholder="50"
                      data-testid="percent-recipient"
                     />
                     <span className="text-sm text-fg-subtle">%</span>
                   </div>
                   <span className="text-xs text-fg-faint">
                    {pctSumValid ? formatMYR(pctAmounts[1]) : '—'}
                   </span>
                 </div>
                 <div className="text-right text-xs text-fg-subtle">
                  Total: {formatPercent(pctSum)}% / 100%
                 </div>
                 {/* Save is disabled on this case, so it has to say why here —
                     a dead button that explains nothing is the worst outcome. */}
                 {pctSumValid && !pctSharesPositive && (
                   <p className="text-right text-xs text-red-600">
                    Each person needs a share above 0% — use Keep as-is to give them the full amount.
                   </p>
                 )}
               </div>
             )}
           </div>
         )}

         {selectedRecipient && (
           <div>
             <label htmlFor="split-note" className="mb-1 block text-xs font-medium text-fg-muted">
              Note for {groupMembers.find((m) => m.userId === selectedRecipient)?.username} (optional)
             </label>
             <Input
              id="split-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. half the weekly shop"
              data-testid="split-note"
             />
           </div>
         )}

         {error && <p className="text-sm text-red-600">{error}</p>}

         <div className="flex justify-between pt-2">
           <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
           </Button>
           <Button
            onClick={handleSave}
            disabled={
             saving ||
             !selectedRecipient ||
             (splitMode === 'custom' &&
              Math.abs((parseFloat(customAmounts[0]) || 0) + (parseFloat(customAmounts[1]) || 0) - amount) > 0.015) ||
             (splitMode === 'percent' && !(pctSumValid && pctSharesPositive))
            }
           >
             <Users className="h-3.5 w-3.5 mr-1" />
             {saving ? 'Splitting…' : 'Split'}
           </Button>
         </div>
       </div>
     </Modal>
   )
}
