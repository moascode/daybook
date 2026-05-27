import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wallet,
  CreditCard,
  Smartphone,
  Building2,
  PiggyBank,
  TrendingUp,
  Banknote,
  Coins,
  Pencil,
  Trash2,
} from 'lucide-react'
import { cn, formatMYR } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useWallet } from '@/hooks/useWallet'
import type { Account } from '@/types/wallet.types'

interface AccountCardProps {
  account: Account
  onEdit: (account: Account) => void
  onDelete: (account: Account) => void
}

const ACCOUNT_TYPE_LABELS: Record<Account['type'], string> = {
  cash: 'Cash',
  card: 'Card',
  'e-wallet': 'E-Wallet',
  bank: 'Bank',
  investment: 'Investment',
  other: 'Other',
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  wallet: Wallet,
  'credit-card': CreditCard,
  smartphone: Smartphone,
  building: Building2,
  'piggy-bank': PiggyBank,
  'trending-up': TrendingUp,
  banknote: Banknote,
  coins: Coins,
}

export function AccountCard({ account, onEdit, onDelete }: AccountCardProps) {
  const navigate = useNavigate()
  const { getAccountBalance } = useWallet()
  const [balance, setBalance] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    getAccountBalance(account.id).then((bal) => {
      if (!cancelled) setBalance(bal)
    })
    return () => { cancelled = true }
  }, [account.id, getAccountBalance])

  const IconComponent = ICON_MAP[account.icon] ?? Wallet

  function handleCardClick() {
    navigate(`/wallet?account=${account.id}`)
  }

  return (
    <div
      data-testid="account-card"
      className={cn(
        'group relative overflow-hidden rounded-xl border border-gray-200 bg-white',
        'transition-shadow hover:shadow-md cursor-pointer'
      )}
      onClick={handleCardClick}
    >
      {/* Color accent bar */}
      <div
        className="absolute left-0 top-0 h-full w-1.5"
        style={{ backgroundColor: account.color }}
      />

      <div className="p-5 pl-6">
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${account.color}18` }}
            >
              <IconComponent
                className="h-5 w-5"
                style={{ color: account.color }}
              />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{account.name}</h3>
              <div className="mt-0.5 flex items-center gap-2">
                <Badge color={account.color}>
                  {ACCOUNT_TYPE_LABELS[account.type]}
                </Badge>
                <span className="text-xs text-gray-400">{account.currency}</span>
              </div>
            </div>
          </div>

          {/* Actions — visible on hover */}
          <div
            className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(account)}
              aria-label="Edit account"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(account)}
              aria-label="Delete account"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </Button>
          </div>
        </div>

        {/* Description */}
        {account.description && (
          <p className="mt-2 text-sm text-gray-500 line-clamp-1">
            {account.description}
          </p>
        )}

        {/* Balance */}
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
            Balance
          </p>
          <p
            className={cn(
              'mt-0.5 text-xl font-bold',
              balance === null
                ? 'text-gray-300'
                : balance >= 0
                  ? 'text-gray-900'
                  : 'text-red-600'
            )}
          >
            {balance === null ? '...' : formatMYR(balance)}
          </p>
        </div>
      </div>
    </div>
  )
}
