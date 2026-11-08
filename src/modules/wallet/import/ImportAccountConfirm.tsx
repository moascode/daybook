import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { Account } from '@/types/wallet.types'

interface ImportAccountConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: Account[]
  accountId: string
  onAccountChange: (id: string) => void
  count: number
  onConfirm: () => void
}

/**
 * Last stop before an import commits. The review page's account badge
 * defaults to the first account and is easy to miss, and importing into the
 * wrong one is expensive to undo — so the account is restated, and
 * changeable, right where the click lands.
 */
export function ImportAccountConfirm({
  open,
  onOpenChange,
  accounts,
  accountId,
  onAccountChange,
  count,
  onConfirm,
}: ImportAccountConfirmProps) {
  const noun = `transaction${count !== 1 ? 's' : ''}`
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Import into this account?"
      description={`${count} ${noun} will be added to the account below. Check it's the right one.`}
      className="max-w-md"
    >
      <Select
        id="import-confirm-account"
        label="Import to account"
        data-testid="import-confirm-account"
        value={accountId}
        onChange={(e) => onAccountChange(e.target.value)}
        options={accounts.map((a) => ({ value: a.id, label: a.last4 ? `${a.name} ··${a.last4}` : a.name }))}
      />
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button size="sm" onClick={onConfirm} data-testid="import-final-confirm-btn">
          Import {count} {noun}
        </Button>
      </div>
    </Modal>
  )
}
