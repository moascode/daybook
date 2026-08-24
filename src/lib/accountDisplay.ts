import { Wallet, CreditCard, Smartphone, Building2, PiggyBank, TrendingUp, Banknote, Coins } from 'lucide-react'
import type { Account } from '@/types/wallet.types'

export const ACCOUNT_TYPE_LABELS: Record<Account['type'], string> = {
  cash: 'Cash',
  card: 'Card',
  'e-wallet': 'E-Wallet',
  bank: 'Bank',
  investment: 'Investment',
  other: 'Other',
}

export const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  wallet: Wallet,
  'credit-card': CreditCard,
  smartphone: Smartphone,
  building: Building2,
  'piggy-bank': PiggyBank,
  'trending-up': TrendingUp,
  banknote: Banknote,
  coins: Coins,
}
