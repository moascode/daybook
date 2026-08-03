import { X } from 'lucide-react'
import { useToastStore } from '@/stores/toast.store'
import { cn } from '@/lib/utils'

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  return (
    <div
      className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          data-testid="toast"
          className={cn(
            'flex items-center gap-3 rounded-lg bg-surface-inverted px-4 py-2.5 text-sm text-fg-inverted shadow-xl',
            'animate-in fade-in-0 slide-in-from-bottom-2 duration-200',
          )}
        >
          <span className="text-fg-inverted">{toast.message}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.onClick()
                removeToast(toast.id)
              }}
              className="font-semibold text-brand-400 transition-colors hover:text-brand-300"
            >
              {toast.action.label}
            </button>
          )}
          <button
            onClick={() => removeToast(toast.id)}
            className="ml-1 text-fg-inverted-muted transition-colors hover:text-fg-inverted"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
