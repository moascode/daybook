import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  className?: string
  /** Extra control rendered in the header, between the title and the close (×) button. */
  headerAction?: ReactNode
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  headerAction,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            // -raised, not -surface: identical in light, but in dark a modal
            // must sit above the cards behind it rather than match them.
            'w-full max-w-lg rounded-xl bg-surface-raised p-6 shadow-xl',
            'max-h-[90vh] overflow-y-auto',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between">
            <div>
              <Dialog.Title className="text-lg font-semibold text-fg">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-fg-subtle">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-1">
              {headerAction}
              <Dialog.Close className="rounded-lg p-1.5 text-fg-faint hover:bg-surface-hover hover:text-fg-muted">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
