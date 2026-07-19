import { useState, useEffect, useCallback } from 'react'
import { Users } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api } from '@/lib/api'
import { formatMYR, splitEqually } from '@/lib/utils'
import { mapMember } from '@/lib/household.mappers'
import type { Transaction } from '@/types/wallet.types'
import type { GroupMember } from '@/types/household.types'

interface BulkShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedTransactionIds: string[]
  transactions: Transaction[]
  currentUserId: string
  onSave: () => void
}

type SplitMode = 'none' | 'equal' | 'custom'

interface CardState {
  transaction: Transaction
  recipientIds: string[]
  mode: SplitMode
  // Custom amounts keyed by userId; includes the payer under currentUserId.
  customAmounts: Record<string, string>
}

export function BulkShareDialog({
  open,
  onOpenChange,
  selectedTransactionIds,
  transactions,
  currentUserId,
  onSave,
}: BulkShareDialogProps) {
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [cards, setCards] = useState<CardState[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (selectedTransactionIds.length === 0) return
    setLoadingMembers(true)
    try {
      const memberRows = await api.get<Record<string, unknown>[]>('/groups/members').then((rows) =>
        rows.map(mapMember),
      )
      setGroupMembers(memberRows.filter((m) => m.userId !== currentUserId))
      setCards(
        selectedTransactionIds
          .map((txnId) => transactions.find((t) => t.id === txnId))
          .filter((t): t is Transaction => t !== undefined)
          .map((transaction) => ({ transaction, recipientIds: [], mode: 'none' as SplitMode, customAmounts: {} })),
      )
    } finally {
      setLoadingMembers(false)
    }
  }, [selectedTransactionIds, transactions, currentUserId])

  useEffect(() => {
    if (open) { setError(null); loadData() } // eslint-disable-line react-hooks/set-state-in-effect
  }, [open, loadData])

  const updateCard = (txnId: string, patch: (card: CardState) => CardState) => {
    setCards((prev) => prev.map((c) => (c.transaction.id === txnId ? patch(c) : c)))
  }

  const toggleRecipient = (txnId: string, userId: string) => {
    updateCard(txnId, (c) => {
      const selected = c.recipientIds.includes(userId)
      const recipientIds = selected ? c.recipientIds.filter((id) => id !== userId) : [...c.recipientIds, userId]
      // "Keep as-is" only fits a single recipient — fall back to equal split.
      const mode = c.mode === 'none' && recipientIds.length > 1 ? 'equal' : c.mode
      return { ...c, recipientIds, mode }
    })
  }

  // Validation mirrors ShareDialog; returns null when the card can be saved.
  const cardError = (c: CardState): string | null => {
    if (c.recipientIds.length === 0) return 'Please select a recipient'
    if (c.transaction.amount <= 0) return 'Cannot share a zero-amount transaction'
    if (c.mode === 'none' && c.recipientIds.length > 1) return 'Keep as-is shares the full amount with a single recipient'
    if (c.mode === 'custom') {
      const sum = [currentUserId, ...c.recipientIds].reduce(
        (acc, id) => acc + (parseFloat(c.customAmounts[id]) || 0),
        0,
      )
      if (Math.abs(sum - c.transaction.amount) > 0.015) {
        return `Amounts must sum to ${formatMYR(c.transaction.amount)} — got ${formatMYR(sum)}`
      }
    }
    return null
  }

  const handleSave = async () => {
    for (const c of cards) {
      const err = cardError(c)
      if (err) {
        setError(`${c.transaction.merchant || 'Transaction'}: ${err}`)
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      const payload = cards.map((c) => {
        let shares: Array<{ userId: string; shareAmount: number }>
        if (c.mode === 'none') {
          // Recipient owes 100% — no payer row (matches the quick-share route).
          shares = [{ userId: c.recipientIds[0], shareAmount: c.transaction.amount }]
        } else if (c.mode === 'equal') {
          const amounts = splitEqually(c.transaction.amount, c.recipientIds.length + 1)
          shares = [currentUserId, ...c.recipientIds].map((userId, i) => ({ userId, shareAmount: amounts[i] }))
        } else {
          shares = [currentUserId, ...c.recipientIds].map((userId) => ({
            userId,
            shareAmount: parseFloat(c.customAmounts[userId]) || 0,
          }))
        }
        return { transactionId: c.transaction.id, shares }
      })

      await api.post('/transactions/shares', { transactions: payload })
      onSave()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to share transactions')
    } finally {
      setSaving(false)
    }
  }

  const participantName = (userId: string): string =>
    userId === currentUserId ? 'You' : groupMembers.find((m) => m.userId === userId)?.username ?? 'Member'

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Share ${cards.length} Transaction${cards.length !== 1 ? 's' : ''}`}
    >
      <div className="space-y-4">
        {loadingMembers ? (
          <p className="text-sm text-gray-400 text-center py-2">Loading members…</p>
        ) : groupMembers.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-2">
            <Users className="h-4 w-4 inline mr-1" />
            No group members yet. Add people to a household group first.
          </p>
        ) : cards.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-2">No transactions to share</p>
        ) : (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {cards.map((c) => {
              const amount = c.transaction.amount
              const participants = [currentUserId, ...c.recipientIds]
              const equalAmounts = splitEqually(amount, participants.length)

              return (
                <div key={c.transaction.id} className="border rounded-lg p-4 space-y-3" data-testid="bulk-share-card">
                  <div className="rounded-lg bg-gray-50 px-4 py-3">
                    <p className="font-semibold text-gray-900">{c.transaction.merchant || 'Transaction'}</p>
                    <p className="text-xs text-gray-500">{format(parseISO(c.transaction.date), 'dd MMM yyyy')}</p>
                    <p className="text-lg font-bold text-gray-900">{formatMYR(amount)}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-gray-700 mb-2">Share with</p>
                    <div className="flex flex-wrap gap-2">
                      {groupMembers.map((m) => (
                        <label key={m.userId} className="flex items-center gap-1.5 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={c.recipientIds.includes(m.userId)}
                            onChange={() => toggleRecipient(c.transaction.id, m.userId)}
                            disabled={saving}
                          />
                          {m.username}
                        </label>
                      ))}
                    </div>
                  </div>

                  {c.recipientIds.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-2">How to split</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant={c.mode === 'none' ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => updateCard(c.transaction.id, (card) => ({ ...card, mode: 'none', customAmounts: {} }))}
                          disabled={saving || c.recipientIds.length > 1}
                          title={c.recipientIds.length > 1 ? 'Keep as-is shares the full amount with a single recipient' : undefined}
                        >
                          Keep as-is ({formatMYR(amount)})
                        </Button>
                        <Button
                          variant={c.mode === 'equal' ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => updateCard(c.transaction.id, (card) => ({ ...card, mode: 'equal', customAmounts: {} }))}
                          disabled={saving}
                        >
                          Split equally ({formatMYR(amount / participants.length)} each)
                        </Button>
                        <Button
                          variant={c.mode === 'custom' ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => updateCard(c.transaction.id, (card) => ({ ...card, mode: 'custom' }))}
                          disabled={saving}
                        >
                          Custom amounts
                        </Button>
                      </div>

                      {c.mode === 'equal' && (
                        <div className="mt-3 space-y-1">
                          {participants.map((userId, i) => (
                            <div key={userId} className="flex items-center justify-between text-sm text-gray-700" data-testid="equal-share-row">
                              <span>{participantName(userId)}</span>
                              <span>{formatMYR(equalAmounts[i])}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {c.mode === 'custom' && (
                        <div className="mt-3 space-y-2">
                          {participants.map((userId) => (
                            <div key={userId} className="flex items-center gap-3">
                              <span className="flex-1 text-sm text-gray-700">{participantName(userId)}</span>
                              <Input
                                type="number"
                                step="0.01"
                                className="w-32"
                                value={c.customAmounts[userId] ?? ''}
                                onChange={(e) =>
                                  updateCard(c.transaction.id, (card) => ({
                                    ...card,
                                    customAmounts: { ...card.customAmounts, [userId]: e.target.value },
                                  }))
                                }
                                placeholder={formatMYR(amount / participants.length)}
                              />
                            </div>
                          ))}
                          <div className="text-right text-xs text-gray-500">
                            Total: {formatMYR(participants.reduce((acc, id) => acc + (parseFloat(c.customAmounts[id]) || 0), 0))} / {formatMYR(amount)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-between pt-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || loadingMembers || cards.length === 0 || groupMembers.length === 0 || cards.some((c) => cardError(c) !== null)}
          >
            <Users className="h-3.5 w-3.5 mr-1" />
            {saving ? 'Sharing…' : `Share ${cards.length} Transaction${cards.length !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
