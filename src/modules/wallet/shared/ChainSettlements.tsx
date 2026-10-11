import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api } from '@/lib/api'
import { cn, errorMessage, formatMYR } from '@/lib/utils'
import type { SettlementChain } from '@/types/household.types'

interface ChainAccount {
  id: string
  name: string
  isShared?: boolean
}

interface ChainSettlementsProps {
  groupName?: string
  chains: SettlementChain[]
  /** True when this group's chain fetch failed — shown inline, never swallowed (CLAUDE.md rule 10). */
  error: boolean
  currentUserId: string
  accounts: ChainAccount[]
  /** Refresh balances/plan/chains/activity after any action. */
  onChanged: () => void
}

/**
 * Within this many business days of confirming, a confirmed chain can still
 * be undone. Mirrors worker/routes/settlements.ts UNDO_WINDOW_DAYS, and the
 * same client-side approximation SharedPage.tsx's bilateral Undo uses — a
 * one-day grace rather than exact business-tz day arithmetic, since the
 * client has no access to the server's business-tz date helpers.
 */
const UNDO_WINDOW_DAYS = 7
function withinUndoWindow(confirmedAt: string | null): boolean {
  if (!confirmedAt) return false
  const parsed = new Date(`${confirmedAt.replace(' ', 'T')}${confirmedAt.includes('Z') ? '' : 'Z'}`)
  if (Number.isNaN(parsed.getTime())) return true
  return Date.now() - parsed.getTime() <= (UNDO_WINDOW_DAYS + 1) * 86_400_000
}

/**
 * FEAT-024 PR C — three-way settlements awaiting or within undo of
 * confirmation, for chains the viewer is a party to. Placed on the Shared
 * page the same way SettleGroupPlan is: once per group, only rendered when
 * there is something to show.
 */
export function ChainSettlements({ groupName, chains, error, currentUserId, accounts, onChanged }: ChainSettlementsProps) {
  const [accountByChain, setAccountByChain] = useState<Record<string, string>>({})
  const [rejectingChain, setRejectingChain] = useState<string | null>(null)
  const [busyChain, setBusyChain] = useState<string | null>(null)
  const [errorByChain, setErrorByChain] = useState<Record<string, string>>({})
  const [undoTarget, setUndoTarget] = useState<SettlementChain | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)

  const myAccounts = accounts.filter((a) => !a.isShared)

  const awaiting = chains.filter((c) => c.status === 'awaiting_confirmation')
  const undoable = chains.filter((c) => c.status === 'confirmed' && withinUndoWindow(c.confirmedAt))

  if (!error && awaiting.length === 0 && undoable.length === 0) return null

  const setChainError = (chainId: string, message: string) =>
    setErrorByChain((m) => ({ ...m, [chainId]: message }))

  const run = async (chainId: string, fn: () => Promise<unknown>) => {
    setBusyChain(chainId)
    setChainError(chainId, '')
    try {
      await fn()
      setRejectingChain(null)
      onChanged()
    } catch (err: unknown) {
      setChainError(chainId, errorMessage(err, 'Could not update this settlement.'))
    } finally {
      setBusyChain(null)
    }
  }

  const handleConfirm = (chain: SettlementChain) => {
    const accountId = accountByChain[chain.id]
    if (!accountId) return
    void run(chain.id, () => api.post(`/settlement-chains/${chain.id}/confirm`, { accountId }))
  }

  const handleReject = (chain: SettlementChain, reason: string) =>
    run(chain.id, () => api.post(`/settlement-chains/${chain.id}/reject`, { reason }))

  const handleCancel = (chain: SettlementChain) =>
    run(chain.id, () => api.delete(`/settlement-chains/${chain.id}`))

  const handleUndo = async (chain: SettlementChain) => {
    setUndoError(null)
    try {
      await api.delete(`/settlement-chains/${chain.id}`)
      setUndoTarget(null)
      onChanged()
    } catch (err: unknown) {
      setUndoError(errorMessage(err, 'Failed to undo settlement'))
    }
  }

  return (
    <>
      <section className="card card-pad c6" data-testid="chain-settlements">
        <div className="card-head">
          <div className="card-title">Three-way settlements{groupName ? ` · ${groupName}` : ''}</div>
        </div>

        {error ? (
          <p className="text-sm text-red-600" data-testid="chain-settlements-error">
            Couldn&rsquo;t load three-way settlements for this group — please try again.
          </p>
        ) : (
          <>
            {awaiting.map((chain) => {
              const myParty = chain.parties.find((p) => p.userId === currentUserId)
              const isPayer = chain.payerId === currentUserId
              const iAmUnconfirmed = !!myParty && !myParty.confirmed
              return (
                <div key={chain.id} className="prow flex-col items-stretch gap-2" data-testid="chain-settlement-row">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="pname truncate">
                        {chain.parties.find((p) => p.role === 'payer')?.username} pays{' '}
                        {chain.parties.find((p) => p.role === 'payee')?.username}
                      </div>
                      <div className="psub">{formatMYR(chain.amount)}</div>
                    </div>
                  </div>

                  <ul className="space-y-1" data-testid="chain-party-list">
                    {chain.parties.map((p) => (
                      <li key={p.userId} className="flex items-center justify-between text-xs" data-testid="chain-party-row">
                        <span className="text-fg-muted">
                          {p.username} <span className="text-fg-faint">({p.role})</span>
                        </span>
                        <span className="flex items-center gap-1 tabular-nums text-fg-muted">
                          {formatMYR(p.amount)}
                          {p.confirmed && <Check className="h-3 w-3 text-positive-700" aria-label={`${p.username} confirmed`} />}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {isPayer ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label="Cancel three-way settlement"
                        disabled={busyChain === chain.id}
                        onClick={() => handleCancel(chain)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : iAmUnconfirmed && rejectingChain !== chain.id ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <Select
                        label="Confirm into (your account)"
                        id={`chain-confirm-account-${chain.id}`}
                        options={[
                          { value: '', label: '— select account —' },
                          ...myAccounts.map((a) => ({ value: a.id, label: a.name })),
                        ]}
                        value={accountByChain[chain.id] ?? ''}
                        onChange={(e) => setAccountByChain((m) => ({ ...m, [chain.id]: e.target.value }))}
                      />
                      <div className="ml-auto flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label="Reject three-way settlement (open reason)"
                          data-testid="chain-reject-open"
                          disabled={busyChain === chain.id}
                          onClick={() => setRejectingChain(chain.id)}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          aria-label="Confirm three-way settlement"
                          disabled={busyChain === chain.id || !accountByChain[chain.id]}
                          onClick={() => handleConfirm(chain)}
                        >
                          Confirm
                        </Button>
                      </div>
                    </div>
                  ) : iAmUnconfirmed && rejectingChain === chain.id ? (
                    <RejectPanel
                      busy={busyChain === chain.id}
                      onBack={() => setRejectingChain(null)}
                      onReject={(reason) => handleReject(chain, reason)}
                    />
                  ) : (
                    <p className="text-xs text-fg-faint">Waiting on the other parties to confirm.</p>
                  )}

                  {errorByChain[chain.id] && (
                    <p className="text-xs text-red-600" data-testid="chain-settlement-row-error">{errorByChain[chain.id]}</p>
                  )}
                </div>
              )
            })}

            {undoable.map((chain) => (
              <div key={chain.id} className="prow" data-testid="chain-settlement-confirmed-row">
                <div className="tavatar" style={{ background: 'rgb(var(--pos-bg))', color: 'rgb(var(--pos-fg))' }}>
                  <Check className="icon-sm" />
                </div>
                <div className={cn('min-w-0 flex-1')}>
                  <div className="pname">
                    {chain.parties.find((p) => p.role === 'payer')?.username} paid{' '}
                    {chain.parties.find((p) => p.role === 'payee')?.username}
                  </div>
                  <div className="psub">{formatMYR(chain.amount)}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Undo three-way settlement"
                  onClick={() => { setUndoError(null); setUndoTarget(chain) }}
                >
                  Undo
                </Button>
              </div>
            ))}
          </>
        )}
      </section>

      <Modal open={!!undoTarget} onOpenChange={() => setUndoTarget(null)} title="Undo three-way settlement?">
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">Undo this three-way settlement? Balances will be restored for everyone involved.</p>
          {undoError && <p className="text-sm text-red-600">{undoError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUndoTarget(null)}>Cancel</Button>
            <Button
              aria-label="Confirm undo of three-way settlement"
              onClick={() => undoTarget && handleUndo(undoTarget)}
            >
              Confirm Undo
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function RejectPanel({ busy, onBack, onReject }: { busy: boolean; onBack: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  return (
    <div className="space-y-2">
      <label htmlFor="chain-reject-reason" className="block text-xs font-medium text-fg-muted">
        Reason (optional)
      </label>
      <textarea
        id="chain-reject-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="e.g. nothing has arrived yet"
        className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onBack}>Back</Button>
        <Button
          variant="danger"
          size="sm"
          aria-label="Reject three-way settlement"
          disabled={busy}
          onClick={() => onReject(reason)}
        >
          Reject
        </Button>
      </div>
    </div>
  )
}
