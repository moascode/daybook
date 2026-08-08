import { useState, useEffect, useCallback } from 'react'
import { Users } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api } from '@/lib/api'
import { formatMYR, formatPercent, equalPercents, redistributePercents, splitEqually, splitByPercents } from '@/lib/utils'
import { mapMember, mapTransactionShare } from '@/lib/household.mappers'
import type { Transaction } from '@/types/wallet.types'
import type { GroupMember, TransactionShare } from '@/types/household.types'

interface BulkSplitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedTransactionIds: string[]
  transactions: Transaction[]
  currentUserId: string
  onSave: () => void
}

type SplitMode = 'none' | 'equal' | 'custom' | 'percent'
type BulkMode = 'perTransaction' | 'uniform'

interface CardState {
  transaction: Transaction
  recipientIds: string[]
  mode: SplitMode
  // Custom amounts keyed by userId; includes the payer under currentUserId.
  customAmounts: Record<string, string>
  // Percentages keyed by userId, for mode 'percent'; includes the payer.
  customPercents: Record<string, string>
  // §2.2: shares already on this transaction — shown with an overwrite warning.
  existingShares: TransactionShare[]
}

// The "Same split for all" config, applied to every selected transaction.
// Fixed amounts are recipient-only: the payer's share is derived per
// transaction (t.amount − Σ recipient fixed) — the only reading of "recipient
// owes RM20" that means anything across transactions with different totals.
interface UniformState {
  recipientIds: string[]
  mode: SplitMode
  customAmounts: Record<string, string> // keyed by recipient userId only
  customPercents: Record<string, string> // keyed by userId, includes the payer
}

const emptyUniform: UniformState = { recipientIds: [], mode: 'none', customAmounts: {}, customPercents: {} }

// Resolves one transaction's shares under the uniform config, or null when
// this transaction can't fit it (fixed recipient amounts exceed the total,
// or cent rounding leaves someone at zero).
function computeUniformShares(
  t: Transaction,
  u: UniformState,
  currentUserId: string,
): Array<{ userId: string; shareAmount: number }> | null {
  if (t.amount <= 0 || u.recipientIds.length === 0) return null
  const participants = [currentUserId, ...u.recipientIds]
  if (u.mode === 'none') {
    return [{ userId: u.recipientIds[0], shareAmount: t.amount }]
  }
  let amounts: number[]
  if (u.mode === 'equal') {
    amounts = splitEqually(t.amount, participants.length)
  } else if (u.mode === 'percent') {
    amounts = splitByPercents(t.amount, participants.map((id) => parseFloat(u.customPercents[id]) || 0))
  } else {
    const recipientAmounts = u.recipientIds.map((id) => parseFloat(u.customAmounts[id]) || 0)
    const payerAmount = t.amount - recipientAmounts.reduce((a, b) => a + b, 0)
    amounts = [payerAmount, ...recipientAmounts]
  }
  if (amounts.some((a) => a <= 0)) return null
  return participants.map((userId, i) => ({ userId, shareAmount: amounts[i] }))
}

export function BulkSplitDialog({
  open,
  onOpenChange,
  selectedTransactionIds,
  transactions,
  currentUserId,
  onSave,
}: BulkSplitDialogProps) {
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [cards, setCards] = useState<CardState[]>([])
  // Defaults to the existing per-transaction flow — "Same split for all" is an
  // explicit opt-in, not a behaviour change for anyone who doesn't reach for it.
  const [bulkMode, setBulkMode] = useState<BulkMode>('perTransaction')
  const [uniform, setUniform] = useState<UniformState>(emptyUniform)
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (selectedTransactionIds.length === 0) return
    setLoadingMembers(true)
    try {
      const txns = selectedTransactionIds
        .map((txnId) => transactions.find((t) => t.id === txnId))
        .filter((t): t is Transaction => t !== undefined)
      const [memberRows, shareLists] = await Promise.all([
        api.get<Record<string, unknown>[]>('/groups/members').then((rows) => rows.map(mapMember)),
        Promise.all(
          txns.map((t) =>
            api
              .get<Record<string, unknown>[]>(`/transactions/${t.id}/splits`)
              .then((rows) => rows.map(mapTransactionShare))
              .catch(() => [] as TransactionShare[]),
          ),
        ),
      ])
      setGroupMembers(memberRows.filter((m) => m.userId !== currentUserId))
      setCards(
        txns.map((transaction, i) => ({
          transaction,
          recipientIds: [],
          mode: 'none' as SplitMode,
          customAmounts: {},
          customPercents: {},
          existingShares: shareLists[i],
        })),
      )
    } finally {
      setLoadingMembers(false)
    }
  }, [selectedTransactionIds, transactions, currentUserId])

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- resetting the form when
       the dialog opens is the whole point; `open` is the external event. The
       mode and its config must reset too: WalletPage keeps this dialog mounted,
       so a uniform 70/30 set up on one selection would otherwise still be
       selected, still valid and one click from saving on the next one. */
    if (open) {
      setError(null)
      setBulkMode('perTransaction')
      setUniform(emptyUniform)
      loadData()
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, loadData])

  const updateCard = (txnId: string, patch: (card: CardState) => CardState) => {
    setCards((prev) => prev.map((c) => (c.transaction.id === txnId ? patch(c) : c)))
  }

  // Percentages are per-participant, so the seed has to be recomputed whenever
  // the participant list changes — otherwise adding a third person leaves two
  // boxes at 50/50 and the newcomer at an implicit 0.
  const seedPercents = (recipientIds: string[]): Record<string, string> => {
    const ids = [currentUserId, ...recipientIds]
    const pcts = equalPercents(ids.length)
    return Object.fromEntries(ids.map((id, i) => [id, pcts[i]]))
  }

  // Rebalances a percent map after one box is edited: the edited participant
  // keeps the raw typed value (so mid-typing digits aren't reformatted out
  // from under the cursor), everyone else splits the remainder equally.
  const editPercent = (participants: string[], editedId: string, rawValue: string): Record<string, string> => {
    const editedIndex = participants.indexOf(editedId)
    const redistributed = redistributePercents(participants.length, editedIndex, parseFloat(rawValue) || 0)
    return Object.fromEntries(participants.map((id, i) => [id, i === editedIndex ? rawValue : redistributed[i]]))
  }

  const toggleRecipient = (txnId: string, userId: string) => {
    updateCard(txnId, (c) => {
      const selected = c.recipientIds.includes(userId)
      const recipientIds = selected ? c.recipientIds.filter((id) => id !== userId) : [...c.recipientIds, userId]
      // "Keep as-is" only fits a single recipient — fall back to equal split.
      const mode = c.mode === 'none' && recipientIds.length > 1 ? 'equal' : c.mode
      return {
        ...c,
        recipientIds,
        mode,
        customPercents: mode === 'percent' ? seedPercents(recipientIds) : c.customPercents,
      }
    })
  }

  const toggleUniformRecipient = (userId: string) => {
    setUniform((u) => {
      const selected = u.recipientIds.includes(userId)
      const recipientIds = selected ? u.recipientIds.filter((id) => id !== userId) : [...u.recipientIds, userId]
      const mode = u.mode === 'none' && recipientIds.length > 1 ? 'equal' : u.mode
      return {
        ...u,
        recipientIds,
        mode,
        customPercents: mode === 'percent' ? seedPercents(recipientIds) : u.customPercents,
      }
    })
  }

  // Validation mirrors SplitDialog; returns null when the card can be saved.
  const cardError = (c: CardState): string | null => {
    if (c.recipientIds.length === 0) return 'Please select a recipient'
    if (c.transaction.amount <= 0) return 'Cannot split a zero-amount transaction'
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
    if (c.mode === 'percent') {
      const participants = [currentUserId, ...c.recipientIds]
      const pctSum = participants.reduce((acc, id) => acc + (parseFloat(c.customPercents[id]) || 0), 0)
      if (Math.abs(pctSum - 100) > 0.1) {
        return `Percentages must sum to 100% — got ${formatPercent(pctSum)}%`
      }
      const amounts = splitByPercents(
        c.transaction.amount,
        participants.map((id) => parseFloat(c.customPercents[id]) || 0),
      )
      // Also the negative guard: these boxes aren't clamped, so a pair like
      // 150/-50 sums to 100 and is only caught by the resulting share.
      if (amounts.some((a) => a <= 0)) {
        return 'Each person needs a share above 0% — use Keep as-is or remove them instead'
      }
    }
    return null
  }

  // Uniform-mode validation: shape of the config only (recipient count, mode
  // rules, sums). Per-transaction feasibility — whether a specific total can
  // actually absorb it — is computed separately per card, since a fixed
  // amount or a tiny total can fail on some transactions and not others.
  const uniformError = (): string | null => {
    if (uniform.recipientIds.length === 0) return 'Please select a recipient'
    if (uniform.mode === 'none' && uniform.recipientIds.length > 1) {
      return 'Keep as-is shares the full amount with a single recipient'
    }
    if (uniform.mode === 'custom') {
      for (const id of uniform.recipientIds) {
        const v = parseFloat(uniform.customAmounts[id])
        if (!Number.isFinite(v) || v <= 0) return 'Enter an amount above 0 for each recipient'
      }
    }
    if (uniform.mode === 'percent') {
      const participants = [currentUserId, ...uniform.recipientIds]
      const pctSum = participants.reduce((acc, id) => acc + (parseFloat(uniform.customPercents[id]) || 0), 0)
      if (Math.abs(pctSum - 100) > 0.1) {
        return `Percentages must sum to 100% — got ${formatPercent(pctSum)}%`
      }
      // A 0% (or negative) participant is a property of the config, not of any
      // one transaction, so it has to be reported as a config error. Left to
      // the per-transaction feasibility check it would surface as "every
      // transaction is too small", which is both wrong and unactionable.
      if (participants.some((id) => (parseFloat(uniform.customPercents[id]) || 0) <= 0)) {
        return 'Each person needs a share above 0% — use Keep as-is or remove them instead'
      }
    }
    return null
  }

  const uniformShapeOk = bulkMode === 'uniform' && !uniformError()
  const uniformFeasibleCount = uniformShapeOk
    ? cards.filter((c) => computeUniformShares(c.transaction, uniform, currentUserId) !== null).length
    : 0
  const uniformSkippedCount = uniformShapeOk ? cards.length - uniformFeasibleCount : 0

  const handleSave = async () => {
    if (bulkMode === 'perTransaction') {
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
          } else if (c.mode === 'percent') {
            const participants = [currentUserId, ...c.recipientIds]
            const amounts = splitByPercents(
              c.transaction.amount,
              participants.map((id) => parseFloat(c.customPercents[id]) || 0),
            )
            shares = participants.map((userId, i) => ({ userId, shareAmount: amounts[i] }))
          } else {
            shares = [currentUserId, ...c.recipientIds].map((userId) => ({
              userId,
              shareAmount: parseFloat(c.customAmounts[userId]) || 0,
            }))
          }
          return { transactionId: c.transaction.id, shares }
        })

        await api.post('/transactions/splits', { transactions: payload })
        onSave()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to share transactions')
      } finally {
        setSaving(false)
      }
      return
    }

    // Uniform mode: same config, resolved per transaction.
    const shapeErr = uniformError()
    if (shapeErr) {
      setError(shapeErr)
      return
    }
    const payload: Array<{ transactionId: string; shares: Array<{ userId: string; shareAmount: number }> }> = []
    for (const c of cards) {
      const shares = computeUniformShares(c.transaction, uniform, currentUserId)
      if (shares) payload.push({ transactionId: c.transaction.id, shares })
    }
    if (payload.length === 0) {
      setError('No selected transactions can be split with this configuration')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await api.post('/transactions/splits', { transactions: payload })
      onSave()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to share transactions')
    } finally {
      setSaving(false)
    }
  }

  const participantName = (userId: string): string =>
    userId === currentUserId ? 'You' : groupMembers.find((m) => m.userId === userId)?.username ?? 'Member'

  const existingShareCount = cards.filter((c) => c.existingShares.length > 0).length
  const uniformParticipants = [currentUserId, ...uniform.recipientIds]

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Split ${cards.length} Transaction${cards.length !== 1 ? 's' : ''}`}
    >
      <div className="space-y-4">
        {loadingMembers ? (
          <p className="text-sm text-fg-faint text-center py-2">Loading members…</p>
        ) : groupMembers.length === 0 ? (
          <p className="text-sm text-fg-subtle text-center py-2">
            <Users className="h-4 w-4 inline mr-1" />
            No group members yet. Invite people in Settings → Sharing first.
          </p>
        ) : cards.length === 0 ? (
          <p className="text-sm text-fg-subtle text-center py-2">No transactions to split</p>
        ) : (
          <>
            {cards.length > 1 && (
              <div className="flex gap-2 border-b border-line pb-3">
                <Button
                  variant={bulkMode === 'perTransaction' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setBulkMode('perTransaction')}
                  disabled={saving}
                >
                  Configure each
                </Button>
                <Button
                  variant={bulkMode === 'uniform' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setBulkMode('uniform')}
                  disabled={saving}
                >
                  Same split for all
                </Button>
              </div>
            )}

            {/* Uniform mode has no per-transaction cards to carry the usual
                per-card "Currently split" warning, so the same information is
                collapsed to one line here. Per-card mode already shows it in
                full detail on each card — showing both would double up. */}
            {bulkMode === 'uniform' && existingShareCount > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3" data-testid="existing-splits-summary">
                <p className="text-xs text-amber-800">
                  {existingShareCount} of {cards.length} selected transactions are already split — saving will
                  replace those splits.
                </p>
              </div>
            )}

            {bulkMode === 'uniform' ? (
              <div className="border rounded-lg p-4 space-y-3" data-testid="uniform-split-panel">
                <div>
                  <p className="text-xs font-medium text-fg-muted mb-2">Split with</p>
                  <div className="flex flex-wrap gap-2">
                    {groupMembers.map((m) => (
                      <label key={m.userId} className="flex items-center gap-1.5 text-sm text-fg-muted">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={uniform.recipientIds.includes(m.userId)}
                          onChange={() => toggleUniformRecipient(m.userId)}
                          disabled={saving}
                        />
                        {m.username}
                      </label>
                    ))}
                  </div>
                </div>

                {uniform.recipientIds.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-fg-muted mb-2">How to split</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant={uniform.mode === 'none' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setUniform((u) => ({ ...u, mode: 'none', customAmounts: {}, customPercents: {} }))}
                        disabled={saving || uniform.recipientIds.length > 1}
                        title={uniform.recipientIds.length > 1 ? 'Keep as-is shares the full amount with a single recipient' : undefined}
                      >
                        Keep as-is (full amount)
                      </Button>
                      <Button
                        variant={uniform.mode === 'equal' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setUniform((u) => ({ ...u, mode: 'equal', customAmounts: {}, customPercents: {} }))}
                        disabled={saving}
                      >
                        Split equally ({uniformParticipants.length} ways)
                      </Button>
                      <Button
                        variant={uniform.mode === 'custom' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setUniform((u) => ({ ...u, mode: 'custom', customPercents: {} }))}
                        disabled={saving}
                      >
                        Fixed amounts
                      </Button>
                      <Button
                        variant={uniform.mode === 'percent' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() =>
                          setUniform((u) => ({ ...u, mode: 'percent', customAmounts: {}, customPercents: seedPercents(u.recipientIds) }))
                        }
                        disabled={saving}
                      >
                        By %
                      </Button>
                    </div>

                    {uniform.mode === 'custom' && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-fg-subtle">
                          Each recipient owes this amount on every selected transaction. You cover the rest.
                        </p>
                        {uniform.recipientIds.map((userId) => (
                          <div key={userId} className="flex items-center gap-3">
                            <span className="flex-1 text-sm text-fg-muted">{participantName(userId)}</span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-32"
                              value={uniform.customAmounts[userId] ?? ''}
                              onChange={(e) =>
                                setUniform((u) => ({ ...u, customAmounts: { ...u.customAmounts, [userId]: e.target.value } }))
                              }
                              placeholder="0.00"
                              data-testid="uniform-fixed-amount"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {uniform.mode === 'percent' && (
                      <div className="mt-3 space-y-2">
                        {uniformParticipants.map((userId) => (
                          <div key={userId} className="flex items-center gap-3">
                            <span className="flex-1 text-sm text-fg-muted">{participantName(userId)}</span>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step="0.1"
                                min="0"
                                max="100"
                                className="w-24"
                                value={uniform.customPercents[userId] ?? ''}
                                onChange={(e) =>
                                  setUniform((u) => ({
                                    ...u,
                                    customPercents: editPercent(uniformParticipants, userId, e.target.value),
                                  }))
                                }
                                data-testid={userId === currentUserId ? 'uniform-percent-payer' : 'uniform-percent-recipient'}
                              />
                              <span className="text-sm text-fg-subtle">%</span>
                            </div>
                          </div>
                        ))}
                        <div className="text-right text-xs text-fg-subtle">
                          Total:{' '}
                          {formatPercent(
                            uniformParticipants.reduce((acc, id) => acc + (parseFloat(uniform.customPercents[id]) || 0), 0),
                          )}
                          % / 100%
                        </div>
                      </div>
                    )}

                    {(() => {
                      const err = uniformError()
                      if (err) {
                        return (
                          <p className="mt-2 text-xs text-red-600" data-testid="uniform-error">
                            {err}
                          </p>
                        )
                      }
                      if (uniformSkippedCount > 0) {
                        return (
                          <p className="mt-2 text-xs text-amber-700" data-testid="uniform-skip-warning">
                            {uniformSkippedCount} of {cards.length} selected transaction
                            {uniformSkippedCount !== 1 ? 's are' : ' is'} too small for this split and will be skipped.
                          </p>
                        )
                      }
                      return null
                    })()}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {cards.map((c) => {
                  const amount = c.transaction.amount
                  const participants = [currentUserId, ...c.recipientIds]
                  const equalAmounts = splitEqually(amount, participants.length)

                  return (
                    <div key={c.transaction.id} className="border rounded-lg p-4 space-y-3" data-testid="bulk-split-card">
                      <div className="rounded-lg bg-surface-sunken px-4 py-3">
                        <p className="font-semibold text-fg">{c.transaction.merchant || 'Transaction'}</p>
                        <p className="text-xs text-fg-subtle">{format(parseISO(c.transaction.date), 'dd MMM yyyy')}</p>
                        <p className="text-lg font-bold text-fg">{formatMYR(amount)}</p>
                      </div>

                      {/* §2.2: existing split lines + overwrite warning */}
                      {c.existingShares.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1" data-testid="existing-splits">
                          <p className="text-xs font-medium text-amber-800">Currently split</p>
                          {c.existingShares.map((s) => (
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

                      <div>
                        <p className="text-xs font-medium text-fg-muted mb-2">Split with</p>
                        <div className="flex flex-wrap gap-2">
                          {groupMembers.map((m) => (
                            <label key={m.userId} className="flex items-center gap-1.5 text-sm text-fg-muted">
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
                          <p className="text-xs font-medium text-fg-muted mb-2">How to split</p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant={c.mode === 'none' ? 'primary' : 'secondary'}
                              size="sm"
                              onClick={() => updateCard(c.transaction.id, (card) => ({ ...card, mode: 'none', customAmounts: {}, customPercents: {} }))}
                              disabled={saving || c.recipientIds.length > 1}
                              title={c.recipientIds.length > 1 ? 'Keep as-is shares the full amount with a single recipient' : undefined}
                            >
                              Keep as-is ({formatMYR(amount)})
                            </Button>
                            <Button
                              variant={c.mode === 'equal' ? 'primary' : 'secondary'}
                              size="sm"
                              onClick={() => updateCard(c.transaction.id, (card) => ({ ...card, mode: 'equal', customAmounts: {}, customPercents: {} }))}
                              disabled={saving}
                            >
                              Split equally ({formatMYR(amount / participants.length)} each)
                            </Button>
                            <Button
                              variant={c.mode === 'custom' ? 'primary' : 'secondary'}
                              size="sm"
                              onClick={() => updateCard(c.transaction.id, (card) => ({ ...card, mode: 'custom', customPercents: {} }))}
                              disabled={saving}
                            >
                              Custom amounts
                            </Button>
                            <Button
                              variant={c.mode === 'percent' ? 'primary' : 'secondary'}
                              size="sm"
                              onClick={() => updateCard(c.transaction.id, (card) => ({
                                ...card,
                                mode: 'percent',
                                customAmounts: {},
                                customPercents: seedPercents(card.recipientIds),
                              }))}
                              disabled={saving}
                            >
                              By %
                            </Button>
                          </div>

                          {c.mode === 'equal' && (
                            <div className="mt-3 space-y-1">
                              {participants.map((userId, i) => (
                                <div key={userId} className="flex items-center justify-between text-sm text-fg-muted" data-testid="equal-split-row">
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
                                  <span className="flex-1 text-sm text-fg-muted">{participantName(userId)}</span>
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
                              <div className="text-right text-xs text-fg-subtle">
                                Total: {formatMYR(participants.reduce((acc, id) => acc + (parseFloat(c.customAmounts[id]) || 0), 0))} / {formatMYR(amount)}
                              </div>
                            </div>
                          )}

                          {c.mode === 'percent' && (() => {
                            const pctValues = participants.map((id) => parseFloat(c.customPercents[id]) || 0)
                            const pctSum = pctValues.reduce((acc, p) => acc + p, 0)
                            const pctSumValid = Math.abs(pctSum - 100) <= 0.1
                            const pctAmounts = splitByPercents(amount, pctValues)
                            const pctSharesPositive = pctAmounts.every((a) => a > 0)
                            return (
                              <div className="mt-3 space-y-2">
                                {participants.map((userId, i) => (
                                  <div key={userId} className="flex items-center gap-3">
                                    <span className="flex-1 text-sm text-fg-muted">{participantName(userId)}</span>
                                    <div className="flex items-center gap-1">
                                      <Input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        max="100"
                                        className="w-24"
                                        value={c.customPercents[userId] ?? ''}
                                        onChange={(e) =>
                                          updateCard(c.transaction.id, (card) => ({
                                            ...card,
                                            customPercents: editPercent(participants, userId, e.target.value),
                                          }))
                                        }
                                        data-testid={userId === currentUserId ? 'percent-payer' : 'percent-recipient'}
                                      />
                                      <span className="text-sm text-fg-subtle">%</span>
                                    </div>
                                    {/* Blank until the percentages add up: the payer
                                        absorbs whatever the others leave unclaimed,
                                        so a half-filled form would show them an
                                        amount nobody typed. */}
                                    <span className="w-20 text-right text-xs text-fg-faint">
                                      {pctSumValid ? formatMYR(pctAmounts[i]) : '—'}
                                    </span>
                                  </div>
                                ))}
                                <div className="text-right text-xs text-fg-subtle">
                                  Total: {formatPercent(pctSum)}% / 100%
                                </div>
                                {/* Save is disabled on this case, so it has to say
                                    why here rather than only on click. */}
                                {pctSumValid && !pctSharesPositive && (
                                  <p className="text-right text-xs text-red-600">
                                    Each person needs a share above 0% — use Keep as-is or remove them instead.
                                  </p>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
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
              loadingMembers ||
              cards.length === 0 ||
              groupMembers.length === 0 ||
              (bulkMode === 'perTransaction'
                ? cards.some((c) => cardError(c) !== null)
                : uniformError() !== null || uniformFeasibleCount === 0)
            }
          >
            <Users className="h-3.5 w-3.5 mr-1" />
            {saving
              ? 'Splitting…'
              : bulkMode === 'uniform' && uniformSkippedCount > 0
                ? `Split ${uniformFeasibleCount} Transaction${uniformFeasibleCount !== 1 ? 's' : ''}`
                : `Split ${cards.length} Transaction${cards.length !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
