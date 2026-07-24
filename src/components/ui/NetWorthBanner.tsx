import { Coins } from 'lucide-react'
import { cn, formatMYR } from '@/lib/utils'

interface NetWorthBannerProps {
  netWorth: number | null
  accountCount: number
  className?: string
}

// CD-15: shared net-worth hero card — previously duplicated (with two
// different captions) across WalletPage and AccountsPage.
export function NetWorthBanner({ netWorth, accountCount, className }: NetWorthBannerProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-5 py-4',
        className,
      )}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
          Total Net Worth
        </p>
        <p className="mt-1.5 text-2xl font-bold text-brand-900">
          {netWorth === null ? '…' : formatMYR(netWorth)}
        </p>
        <p className="mt-1 text-xs text-brand-700/60">
          across {accountCount} account{accountCount !== 1 ? 's' : ''}
        </p>
      </div>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100">
        <Coins className="h-6 w-6 text-brand-600" />
      </div>
    </div>
  )
}
