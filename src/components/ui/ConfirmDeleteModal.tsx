import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

interface ConfirmDeleteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onConfirm: () => void
  confirmLabel?: string
  // Optional test hook for specs that need a stable selector distinct from
  // the trigger button that opened this modal (e.g. bulk-delete flows).
  confirmTestId?: string
}

export function ConfirmDeleteModal({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel = 'Confirm',
  confirmTestId,
}: ConfirmDeleteModalProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description} className="max-w-sm">
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm} data-testid={confirmTestId}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
