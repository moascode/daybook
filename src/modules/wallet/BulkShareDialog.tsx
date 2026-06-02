import { useState, useEffect, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { formatMYR } from '@/lib/utils'
import { mapMember } from '@/lib/household.mappers'
import type { Transaction } from '@/types/wallet.types'

interface BulkShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedTransactionIds: string[]
  transactions: Transaction[]
  currentUserId: string
  onSave: () => void
}

type ShareMode = 'equal' | 'custom'

interface ShareRecipient {
  userId: string
  username: string
  selected: boolean
  amount?: string
}

interface TransactionShares {
  transaction: Transaction
  recipients: ShareRecipient[]
}

export function BulkShareDialog({
  open,
  onOpenChange,
  selectedTransactionIds,
  transactions,
  currentUserId,
  onSave,
}: BulkShareDialogProps) {
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [shareMode, setShareMode] = useState<ShareMode>('equal')
  const [transactionShares, setTransactionShares] = useState<TransactionShares[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadData = useCallback(async () => {
    if (!open || selectedTransactionIds.length === 0) return
    setLoadingMembers(true)
    try {
      const memberRows = await api.get<Record<string, unknown>[]>('/groups/members').then((rows) =>
        rows.map(mapMember)
       )
      // members loaded

      const initial: TransactionShares[] = selectedTransactionIds.map((txnId) => {
        const txn = transactions.find((t) => t.id === txnId)
        if (!txn) return null as any
        return {
          transaction: txn,
          recipients: memberRows.map((m) => ({
            userId: m.userId,
            username: m.username,
            selected: m.userId === currentUserId,
          })),
         }
       }).filter(Boolean) as TransactionShares[]

      setTransactionShares(initial)
    } finally {
      setLoadingMembers(false)
    }
   }, [open, selectedTransactionIds, transactions, currentUserId])

  useEffect(() => {
    if (open) { loadData() } // eslint-disable-line react-hooks/set-state-in-effect
  }, [open, loadData])

  useEffect(() => {
    if (open && selectedTransactionIds.length > 0) {
      setShareMode('equal')
      setTransactionShares((prev) =>
        prev.map((ts) => ({ ...ts, recipients: ts.recipients.map((r) => ({ ...r, selected: r.selected })) }))
       )
    }
   }, [selectedTransactionIds, open])

  useEffect(() => () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current) }, [])

  const showTempError = (msg: string) => {
    setError(msg)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => setError(null), 3000)
  }

  const toggleRecipient = (txnId: string, userId: string) => {
    if (userId === currentUserId) return

    setTransactionShares((prev) =>
      prev.map((ts) => {
        if (ts.transaction.id !== txnId) return ts
        const currentRecipient = ts.recipients.find((r) => r.userId === userId)
        if (!currentRecipient) return ts
        const isSelected = currentRecipient.selected
        if (isSelected) {
          if (shareMode === 'custom') {
            const hasAmounts = ts.recipients.some((r) => r.selected && r.amount !== undefined && r.amount !== '')
            if (hasAmounts) {
              showTempError('Custom amounts will be discarded for this recipient')
              return ts
            }
          }
          return {
            ...ts,
            recipients: ts.recipients.map((r) => (r.userId === userId ? { ...r, selected: false } : r)),
          }
        }
        return {
          ...ts,
          recipients: ts.recipients.map((r) => (r.userId === userId ? { ...r, selected: true } : r)),
        }
       })
     )
   }

  const updateRecipientAmount = (txnId: string, userId: string, amount: string) => {
    setTransactionShares((prev) =>
      prev.map((ts) =>
        ts.transaction.id === txnId
           ? { ...ts, recipients: ts.recipients.map((r) => (r.userId === userId ? { ...r, amount } : r)) }
          : ts
       )
     )
   }

  const calculateEqualShares = (txn: Transaction, selectedRecipients: ShareRecipient[]) => {
    const count = selectedRecipients.filter((r) => r.selected).length
    if (count === 0) return 0
    const base = Math.floor((txn.amount / count) * 100) / 100
    const remainder = Math.round((txn.amount - base * count) * 100) / 100
    return { base, remainder, count }
   }

  const validateTransaction = (txnShares: TransactionShares): string | null => {
    const selected = txnShares.recipients.filter((r) => r.selected)
    if (selected.length < 2) return 'Select at least 2 recipients (including yourself)'

    if (shareMode === 'equal') {
      return null
    }

    const sum = selected.reduce((acc, r) => acc + (Number(r.amount) || 0), 0)
    if (Math.abs(sum - txnShares.transaction.amount) > 0.015) {
      return `Amounts must sum to ${formatMYR(txnShares.transaction.amount)}; got ${formatMYR(sum)}`
     }
    return null
   }

  const validateAll = (): string | null => {
    for (const ts of transactionShares) {
      const error = validateTransaction(ts)
      if (error) return error
     }
    return null
   }

  const handleSave = async () => {
    const validationError = validateAll()
    if (validationError) {
      showTempError(validationError)
      return
     }

    setSaving(true)
    try {
      const payload = transactionShares.map((ts) => {
        const selected = ts.recipients.filter((r) => r.selected)
        let shares: Array<{ userId: string; shareAmount: number; note?: string }>
        if (shareMode === 'equal') {
          const count = selected.length
          const base = Math.floor((ts.transaction.amount / count) * 100) / 100
          const remainder = Math.round((ts.transaction.amount - base * count) * 100) / 100
          shares = selected.map((r, i) => ({
            userId: r.userId,
            shareAmount: i === selected.length - 1 ? Math.round((base + remainder) * 100) / 100 : base,
          }))
        } else {
          shares = selected.map((r) => ({
            userId: r.userId,
            shareAmount: Number(r.amount) || 0,
          }))
        }
        return { transactionId: ts.transaction.id, shares }
      })

      await api.post('/transactions/shares', { transactions: payload })
      onSave()
     } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to share transactions'
      showTempError(message)
     } finally {
      setSaving(false)
    }
   }

  const hasErrors = transactionShares.some((ts) => validateTransaction(ts) !== null)
  const selectedCount = transactionShares.reduce((acc, ts) => acc + ts.recipients.filter((r) => r.selected).length, 0)

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Share Transactions">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Share {transactionShares.length} Transaction{transactionShares.length > 1 ? 's' : ''}</h2>
           <p className="text-sm text-gray-500">Split amounts among group members</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
           <X className="h-4 w-4" />
        </Button>
       </div>

       {loadingMembers ? (
         <div className="text-center py-8">Loading group members...</div>
       ) : transactionShares.length === 0 ? (
         <div className="text-center py-8">No transactions to share</div>
       ) : (
         <>
           {error && (
             <div className={`mb-4 p-3 rounded ${error.includes('will be discarded') ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
               {error}
             </div>
           )}

           <div className="space-y-6 max-h-96 overflow-y-auto">
             {transactionShares.map((ts) => {
               const equalInfo = calculateEqualShares(ts.transaction, ts.recipients) || { base: 0, remainder: 0, count: 0 }
               const selected = ts.recipients.filter((r) => r.selected)

               return (
                 <div key={ts.transaction.id} className="border rounded-lg p-4">
                   <div className="flex items-start justify-between mb-3">
                     <div>
                       <div className="font-medium">{ts.transaction.merchant || ts.transaction.description || 'Transaction'}</div>
                       <div className="text-sm text-gray-500">
                         {new Date(ts.transaction.date).toLocaleDateString()} - {formatMYR(ts.transaction.amount)}
                       </div>
                     </div>
                     <Button
                      variant={shareMode === 'equal' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setShareMode('equal')}
                     >
                      Split equally
                     </Button>
                     <Button
                      variant={shareMode === 'custom' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setShareMode('custom')}
                     >
                      Custom amounts
                     </Button>
                   </div>

                   <div className="space-y-2">
                     <div className="flex items-center justify-between text-sm">
                       <span className="text-gray-500">Recipients</span>
                       <span className="text-gray-500">{selected.length} selected</span>
                     </div>

                     {ts.recipients.map((recipient) => (
                       <div key={recipient.userId} className="flex items-center gap-3">
                         <input
                          type="checkbox"
                          checked={recipient.selected}
                          onChange={() => toggleRecipient(ts.transaction.id, recipient.userId)}
                          disabled={recipient.userId === currentUserId}
                          className="rounded"
                         />
                         <span className={`flex-1 ${recipient.userId === currentUserId ? 'font-medium' : ''}`}>
                           {recipient.username}{recipient.userId === currentUserId ? ' (you)' : ''}
                         </span>
                         {recipient.selected && shareMode === 'custom' && (
                           <input
                            type="number"
                            step="0.01"
                            value={recipient.amount || ''}
                            onChange={(e) => updateRecipientAmount(ts.transaction.id, recipient.userId, e.target.value)}
                            className="w-24 border rounded px-2 py-1 text-sm"
                            placeholder={formatMYR(ts.transaction.amount / Math.max(selected.length, 1))}
                           />
                         )}
                         {recipient.selected && shareMode === 'equal' && equalInfo.count > 0 && (
                           <span className="text-sm text-gray-500 w-20 text-right">
                             {formatMYR(equalInfo.base)}
                           </span>
                         )}
                       </div>
                     ))}
                   </div>
                 </div>
               )
             })}
           </div>

           <div className="flex items-center justify-between mt-6 pt-4 border-t">
             <div className="text-sm text-gray-500">
               {selectedCount > 0 ? `${selectedCount} recipient${selectedCount > 1 ? 's' : ''} selected` : 'Select recipients'}
             </div>
             <div className="flex gap-3">
               <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
               </Button>
               <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || hasErrors}>
                 {saving ? 'Sharing...' : `Share ${transactionShares.length} Transaction${transactionShares.length > 1 ? 's' : ''}`}
               </Button>
             </div>
           </div>
         </>
       )}
     </Modal>
   )
}
