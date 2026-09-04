import { Landmark, Wifi, Clapperboard, Smartphone } from 'lucide-react'
import { cn, formatMYR } from '@/lib/utils'
import type { RecurringTransaction } from '@/types/wallet.types'
import { DashboardCard } from './DashboardCard'

export interface UpcomingBill extends RecurringTransaction {
  daysUntilDue: number
}

interface UpcomingBillsProps {
  bills: UpcomingBill[]
  className?: string
}

/** Cycles a small set of icon/colour pairs by merchant, purely for visual
 *  variety row to row — the mockup's bills each carry a distinct bubble
 *  colour (rent, internet, streaming, phone…) and there is no real category
 *  signal on a recurring rule to key off instead. */
const BUBBLES = [
  { icon: Landmark, bg: 'bg-warn-bg', fg: 'text-warn-fg' },
  { icon: Wifi, bg: 'bg-info-bg', fg: 'text-info-fg' },
  { icon: Clapperboard, bg: 'bg-alt-bg', fg: 'text-alt-fg' },
  { icon: Smartphone, bg: 'bg-calm-bg', fg: 'text-calm-fg' },
]

function dueLabel(days: number): string {
  if (days < 0) return `overdue by ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''}`
  if (days === 0) return 'due today'
  if (days === 1) return 'Tomorrow'
  return `due in ${days} days`
}

/**
 * "Coming up" — recurring bills due soon, literal `.prow` rows matching the
 * mockup (icon bubble, name + due-date subtext, amount). The markup contract
 * is load-bearing: spec 17 drives this by the `bill-reminder` test id, the
 * due-date wording and the amount.
 */
export function UpcomingBills({ bills, className }: UpcomingBillsProps) {
  if (bills.length === 0) return null

  const totalDue = bills.reduce((sum, bill) => sum + bill.amount, 0)

  return (
    <DashboardCard
      className={cn('flex flex-col', className)}
      title="Coming up"
      subtitle="Recurring bills due soon."
    >
      <div>
        {bills.map((bill, i) => {
          const { icon: Icon, bg, fg } = BUBBLES[i % BUBBLES.length]
          return (
            <div key={bill.id} data-testid="bill-reminder" className="prow">
              <div className={cn('tavatar', bg, fg)}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="pname">{bill.merchant || '(no merchant)'}</div>
                <div className="psub">{dueLabel(bill.daysUntilDue)}</div>
              </div>
              <div className="pamt">{formatMYR(bill.amount)}</div>
            </div>
          )
        })}
      </div>
      <div className="divider" style={{ marginTop: 'auto' }} />
      <div className="flex justify-between text-sm">
        <span className="text-fg-subtle">Total due</span>
        <span className="tabular-nums font-semibold" data-testid="upcoming-bills-total">
          {formatMYR(totalDue)}
        </span>
      </div>
    </DashboardCard>
  )
}
