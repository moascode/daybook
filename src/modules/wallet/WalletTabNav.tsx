import { NavLink } from 'react-router-dom'
import { List, CreditCard, BarChart3, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/wallet',            label: 'Transactions', icon: List,      end: true  },
  { to: '/wallet/accounts',   label: 'Accounts',     icon: CreditCard, end: false },
  { to: '/wallet/dashboard',  label: 'Dashboard',    icon: BarChart3,  end: false },
  { to: '/wallet/import',     label: 'Import CSV',   icon: Upload,     end: false },
] as const

export function WalletTabNav() {
  return (
    <nav className="flex items-center gap-1 px-4" aria-label="Wallet sections">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 px-3 py-3 text-sm font-medium',
              'border-b-2 -mb-px transition-colors whitespace-nowrap',
              isActive
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300',
            )
          }
        >
          <tab.icon className="h-3.5 w-3.5 flex-shrink-0" />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
