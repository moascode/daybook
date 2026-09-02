import { Bell, X } from 'lucide-react'
import { cn, formatMYR } from '@/lib/utils'
import type { RecurringTransaction } from '@/types/wallet.types'

export interface UpcomingBill extends RecurringTransaction {
  daysUntilDue: number
}

interface UpcomingBillsProps {
  bills: UpcomingBill[]
  onDismiss: (id: string) => void
  className?: string
}

/**
 * Bill reminders, lifted out of Dashboard.tsx unchanged.
 *
 * The markup contract is load-bearing — spec 17 drives this by the
 * `bill-reminder` test id, the "due in N days" wording, the amount and the
 * Dismiss control — so the migration to theme tokens is the only edit here.
 */
export function UpcomingBills({ bills, onDismiss, className }: UpcomingBillsProps) {
  if (bills.length === 0) return null

  const totalDue = bills.reduce((sum, bill) => sum + bill.amount, 0)

  return (
    <div className={cn('card card-pad flex flex-col', className)}>
      <div className="mb-3 flex items-center gap-2">
        <Bell className="h-4 w-4 text-warn-fg" />
        <h3 className="text-sm font-semibold text-warn-fg">Upcoming Bills</h3>
      </div>
      <div className="flex flex-col gap-2">
        {bills.map((bill) => {
          const days = bill.daysUntilDue
          return (
            <div
              key={bill.id}
              data-testid="bill-reminder"
              className="flex items-center justify-between rounded-lg border border-warn-bd bg-surface px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-fg">{bill.merchant || '(no merchant)'}</p>
                <p className="text-xs text-warn-fg">
                  {days < 0
                    ? `overdue by ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''}`
                    : days === 0
                      ? 'due soon'
                      : `due in ${days} day${days !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-fg-muted">{formatMYR(bill.amount)}</span>
                <button
                  aria-label="Dismiss"
                  onClick={() => onDismiss(bill.id)}
                  className="rounded p-1 text-fg-faint hover:bg-surface-hover hover:text-fg-muted"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <p data-testid="upcoming-bills-total" className="mt-auto pt-3 text-right text-sm font-semibold text-fg">
        Total due: {formatMYR(totalDue)}
      </p>
    </div>
  )
}
