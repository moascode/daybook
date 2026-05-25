import { NavLink } from 'react-router-dom'
import { List, CreditCard, BarChart3, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Tab {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  end?: boolean
}

const TABS: Tab[] = [
  { to: '/wallet', label: 'Transactions', icon: List, end: true },
  { to: '/wallet/accounts', label: 'Accounts', icon: CreditCard },
  { to: '/wallet/dashboard', label: 'Dashboard', icon: BarChart3 },
  { to: '/wallet/import', label: 'Import CSV', icon: Upload },
]

export function WalletTabNav() {
  return (
    <div className="flex border-b border-gray-200 -mx-6 px-6 mb-6">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              isActive
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            )
          }
        >
          <tab.icon className="h-4 w-4 flex-shrink-0" />
          {tab.label}
        </NavLink>
      ))}
    </div>
  )
}
