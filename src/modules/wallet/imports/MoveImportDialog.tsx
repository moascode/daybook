import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { accountLabel, accountMatchingName } from './importBatch'
import { AccountDot } from './ImportsPage'
import type { Account, ImportBatch } from '@/types/wallet.types'

interface MoveImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  batch: ImportBatch
  /** Writable accounts, excluding the batch's current one. */
  accounts: Account[]
  moving: boolean
  onMove: (accountId: string) => void
}

export function MoveImportDialog({ open, onOpenChange, batch, accounts, moving, onMove }: MoveImportDialogProps) {
  const suggested = accountMatchingName(batch.sourceName, accounts)
  const [targetId, setTargetId] = useState(suggested?.id ?? accounts[0]?.id ?? '')
  const noun = `transaction${batch.rowCount !== 1 ? 's' : ''}`

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Move ${batch.rowCount} ${noun}`}
      description={`From ${accountLabel(batch.accountName, batch.accountLast4)}. Balances on both accounts update.`}
      className="max-w-md"
    >
      {accounts.length === 0 ? (
        <p className="text-sm text-fg-subtle">You have no other account you can write to.</p>
      ) : (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-2 text-sm font-medium text-fg-muted">Move to</legend>
          {accounts.map((a) => (
            <label
              key={a.id}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm text-fg',
                a.id === targetId ? 'border-brand-500 bg-brand-50' : 'border-line',
              )}
            >
              <input
                type="radio"
                name="move-import-target"
                className="sr-only"
                checked={a.id === targetId}
                onChange={() => setTargetId(a.id)}
              />
              <AccountDot color={a.color} />
              {accountLabel(a.name, a.last4)}
              {a.id === suggested?.id && (
                <span className="ml-auto rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">
                  Matches file name
                </span>
              )}
            </label>
          ))}
        </fieldset>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button
          size="sm"
          disabled={!targetId || moving}
          onClick={() => onMove(targetId)}
          data-testid="move-import-confirm"
        >
          {moving ? 'Moving…' : `Move ${batch.rowCount} ${noun}`}
        </Button>
      </div>
    </Modal>
  )
}
