import { useState, useEffect, useCallback } from 'react'
import { Scissors, Users } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api } from '@/lib/api'
import { formatMYR } from '@/lib/utils'
import { mapMember } from '@/lib/household.mappers'
import type { Transaction } from '@/types/wallet.types'
import type { TransactionShare, GroupMember } from '@/types/household.types'

interface SplitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: Transaction | null
  currentUserId: string
  onSaved: () => void
}

type SplitMode = 'equal' | 'custom'

interface ShareLine {
  userId: string
  username: string
  amount: string
}

export function SplitDialog({ open, onOpenChange, transaction, currentUserId, onSaved }: SplitDialogProps) {
  const [mode, setMode] = useState<SplitMode>('equal')
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set([currentUserId]))
  const [lines, setLines] = useState<ShareLine[]>([])
  const [existingShares, setExistingShares] = useState<TransactionShare[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amount = transaction?.amount ?? 0

  const loadData = useCallback(async () => {
    if (!transaction) return
    const [groups, shares] = await Promise.all([
      api.get<{ id: string; name: string }[]>('/groups').then(async (gs) => {
        // Flatten all unique members across all groups
        const members = new Map<string, GroupMember>()
        for (const g of gs) {
          const detail = await api.get<{ members: Record<string, unknown>[] }>(`/groups/${g.id}`)
          for (const raw of detail.members) {
            const m = mapMember(raw)
            if (!members.has(m.userId)) members.set(m.userId, m)
          }
        }
        return [...members.values()]
      }),
      api.get<TransactionShare[]>(`/transactions/${transaction.id}/shares`).catch(() => []),
    ])
    setGroupMembers(groups)
    setExistingShares(shares)

    if (shares.length > 0) {
      const ids = new Set(shares.map((s) => s.userId))
      setSelectedUserIds(ids)
      setLines(shares.map((s) => ({ userId: s.userId, username: s.username, amount: String(s.shareAmount) })))
    }
  }, [transaction])

  useEffect(() => {
    if (open) { loadData() } // eslint-disable-line react-hooks/set-state-in-effect
  }, [open, loadData])

  // Recalculate lines when mode or selection changes
  useEffect(() => {
    if (existingShares.length > 0) return // keep existing if editing
    const selected = groupMembers.filter((m) => selectedUserIds.has(m.userId))
    if (mode === 'equal' && selected.length > 0) {
      const base = Math.floor((amount / selected.length) * 100) / 100
      const remainder = Math.round((amount - base * selected.length) * 100) / 100
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLines(
        selected.map((m, i) => ({
          userId: m.userId,
          username: m.username,
          amount: i === selected.length - 1 ? String(Math.round((base + remainder) * 100) / 100) : String(base),
        }))
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedUserIds, groupMembers, amount])

  const toggleMember = (userId: string) => {
    if (userId === currentUserId) return // always include self
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
    setExistingShares([]) // entering edit mode
  }

  const updateLine = (userId: string, val: string) => {
    setLines((prev) => prev.map((l) => (l.userId === userId ? { ...l, amount: val } : l)))
  }

  const sumLines = lines.reduce((acc, l) => acc + (parseFloat(l.amount) || 0), 0)
  const sumDiff = Math.abs(sumLines - amount)

  const handleSave = async () => {
    if (!transaction) return
    if (sumDiff > 0.015) { setError(`Amounts must sum to ${formatMYR(amount)} — current sum: ${formatMYR(sumLines)}`); return }
    setSaving(true)
    setError(null)
    try {
      await api.post(`/transactions/${transaction.id}/shares`, {
        shares: lines.map((l) => ({ userId: l.userId, shareAmount: parseFloat(l.amount) || 0, note: '' })),
      })
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to save split')
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveSplit = async () => {
    if (!transaction) return
    await api.delete(`/transactions/${transaction.id}/shares`)
    onSaved()
    onOpenChange(false)
  }

  if (!transaction) return null

  const availableMembers = groupMembers.filter((m) => m.userId !== currentUserId)

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Split Transaction">
      <div className="space-y-4">
        <div className="rounded-lg bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">Splitting</p>
          <p className="font-semibold text-gray-900">{transaction.merchant || 'Transaction'}</p>
          <p className="text-lg font-bold text-gray-900">{formatMYR(amount)}</p>
        </div>

        {/* Mode selector */}
        <div className="flex gap-2">
          {(['equal', 'custom'] as SplitMode[]).map((m) => (
            <button
              key={m}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                mode === m ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => { setMode(m); setExistingShares([]) }}
            >
              {m === 'equal' ? 'Split equally' : 'Custom amounts'}
            </button>
          ))}
        </div>

        {/* Member selector */}
        {availableMembers.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-2">
            <Users className="h-4 w-4 inline mr-1" />
            No group members yet. Add people to a household group first.
          </p>
        ) : (
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Split with</p>
            <div className="flex flex-wrap gap-2">
              {availableMembers.map((m) => (
                <button
                  key={m.userId}
                  onClick={() => toggleMember(m.userId)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    selectedUserIds.has(m.userId)
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {m.username}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Share lines */}
        {lines.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-700">Amounts</p>
            {lines.map((l) => (
              <div key={l.userId} className="flex items-center gap-3">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                  {l.username[0].toUpperCase()}
                </div>
                <span className="flex-1 text-sm text-gray-700">{l.username}</span>
                <Input
                  type="number"
                  step="0.01"
                  className="w-28 text-right"
                  value={l.amount}
                  onChange={(e) => { setMode('custom'); updateLine(l.userId, e.target.value) }}
                  readOnly={mode === 'equal'}
                />
              </div>
            ))}
            <div className={`text-right text-xs font-medium ${sumDiff > 0.015 ? 'text-red-600' : 'text-green-600'}`}>
              Total: {formatMYR(sumLines)} / {formatMYR(amount)}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-between pt-2">
          {existingShares.length > 0 ? (
            <Button variant="secondary" onClick={handleRemoveSplit} className="text-red-600 border-red-200">
              Remove split
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || lines.length === 0 || sumDiff > 0.015}
            >
              <Scissors className="h-3.5 w-3.5 mr-1" />
              {saving ? 'Saving…' : 'Save Split'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
