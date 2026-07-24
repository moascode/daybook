import { useState, useEffect, useCallback } from 'react'
import { Users } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api } from '@/lib/api'
import { formatMYR, splitEqually } from '@/lib/utils'
import { mapMember, mapTransactionShare } from '@/lib/household.mappers'
import type { Transaction } from '@/types/wallet.types'
import type { GroupMember, TransactionShare } from '@/types/household.types'

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: Transaction | null
  currentUserId: string
  onSaved: () => void
}

type SplitMode = 'none' | 'equal' | 'custom'

export function ShareDialog({ open, onOpenChange, transaction, currentUserId, onSaved }: ShareDialogProps) {
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [existingShares, setExistingShares] = useState<TransactionShare[]>([])
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null)
  const [splitMode, setSplitMode] = useState<SplitMode>('none')
  const [customAmounts, setCustomAmounts] = useState<[string, string]>(['', ''])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amount = transaction?.amount ?? 0

  const loadData = useCallback(async () => {
    if (!transaction) return
    setLoadingMembers(true)
    try {
      // §2.2: also load existing share rows so re-opening an already-shared
      // transaction shows who owes what instead of a blank form.
      const [memberRows, shareRows] = await Promise.all([
        api.get<Record<string, unknown>[]>('/groups/members').then((rows) => rows.map(mapMember)),
        api
          .get<Record<string, unknown>[]>(`/transactions/${transaction.id}/shares`)
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
    if (open) { loadData() } // eslint-disable-line react-hooks/set-state-in-effect
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
       }

      await api.post(`/transactions/${transaction.id}/share`, {
        recipientId: selectedRecipient,
        splitMode,
        shareAmounts,
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
         <div className="rounded-lg bg-gray-50 px-4 py-3">
           <p className="text-xs text-gray-500">Split</p>
           <p className="font-semibold text-gray-900">{transaction.merchant || 'Transaction'}</p>
           <p className="text-lg font-bold text-gray-900">{formatMYR(amount)}</p>
         </div>

         {/* §2.2: existing shares + overwrite warning */}
         {existingShares.length > 0 && (
           <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1" data-testid="existing-shares">
             <p className="text-xs font-medium text-amber-800">Currently split</p>
             {existingShares.map((s) => (
               <div key={s.id} className="flex items-center justify-between text-sm text-gray-700">
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
           <p className="text-sm text-gray-400 text-center py-2">Loading members…</p>
         ) : groupMembers.length === 0 ? (
           <p className="text-sm text-gray-500 text-center py-2">
             <Users className="h-4 w-4 inline mr-1" />
            No group members yet. Invite people in Settings → Sharing first.
           </p>
         ) : (
           <div>
             <p className="text-xs font-medium text-gray-700 mb-2">Split with</p>
             <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={selectedRecipient ?? ''}
              onChange={(e) => setSelectedRecipient(e.target.value || null)}
              disabled={saving}
             >
               <option value="">Select a recipient</option>
               {groupMembers.map((m) => (
                 <option key={m.userId} value={m.userId}>
                   {m.username}
                 </option>
               ))}
             </select>
           </div>
         )}

         {/* Split mode selector */}
         {selectedRecipient && (
           <div>
             <p className="text-xs font-medium text-gray-700 mb-2">How to split</p>
             <div className="flex gap-2">
               <Button
                variant={splitMode === 'none' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { setSplitMode('none'); setCustomAmounts(['', '']) }}
                disabled={saving}
               >
                Keep as-is ({formatMYR(amount)})
               </Button>
               <Button
                variant={splitMode === 'equal' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { setSplitMode('equal'); setCustomAmounts(['', '']) }}
                disabled={saving}
               >
                Split equally ({formatMYR(amount / 2)} each)
               </Button>
               <Button
                variant={splitMode === 'custom' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setSplitMode('custom')}
                disabled={saving}
               >
                Custom amounts
               </Button>
             </div>

             {/* Custom amounts inputs */}
             {splitMode === 'custom' && (
               <div className="mt-3 space-y-2">
                 <div className="flex items-center gap-3">
                   <span className="text-sm text-gray-700">You</span>
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
                   <span className="text-sm text-gray-700">{groupMembers.find((m) => m.userId === selectedRecipient)?.username}</span>
                   <Input
                    type="number"
                    step="0.01"
                    className="w-32"
                    value={customAmounts[1]}
                    onChange={(e) => setCustomAmounts([customAmounts[0], e.target.value])}
                    placeholder={formatMYR(amount / 2)}
                   />
                 </div>
                 <div className="text-right text-xs text-gray-500">
                  Total: {formatMYR((parseFloat(customAmounts[0]) || 0) + (parseFloat(customAmounts[1]) || 0))} / {formatMYR(amount)}
                 </div>
               </div>
             )}
           </div>
         )}

         {error && <p className="text-sm text-red-600">{error}</p>}

         <div className="flex justify-between pt-2">
           <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
           </Button>
           <Button
            onClick={handleSave}
            disabled={saving || !selectedRecipient || (splitMode === 'custom' && Math.abs((parseFloat(customAmounts[0]) || 0) + (parseFloat(customAmounts[1]) || 0) - amount) > 0.015)}
           >
             <Users className="h-3.5 w-3.5 mr-1" />
             {saving ? 'Splitting…' : 'Split'}
           </Button>
         </div>
       </div>
     </Modal>
   )
}
