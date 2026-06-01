import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  CheckSquare,
  Wallet,
  Settings,
  FlaskConical,
  X,
  ChevronDown,
  List,
  CreditCard,
  BarChart3,
  PieChart,
  RefreshCw,
  Target,
  BarChart2,
  Upload,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { InvitationsBadge } from '@/modules/household/InvitationsBadge'
import { useHouseholdStore } from '@/stores/household.store'
import { api } from '@/lib/api'
import { mapInvite } from '@/lib/household.mappers'

/**
 * Wallet sub-navigation, grouped by how often each destination is used.
 * Rendered as an expandable section under the "Wallet" top-level item so the
 * eight wallet pages live in a vertical left panel instead of a squeezed
 * horizontal tab strip.
 */
const walletGroups = [
  {
    label: 'Daily',
    items: [
      { to: '/wallet', label: 'Transactions', icon: List, end: true },
      { to: '/wallet/dashboard', label: 'Dashboard', icon: BarChart3, end: false },
      { to: '/wallet/accounts', label: 'Accounts', icon: CreditCard, end: false },
    ],
  },
  {
    label: 'Planning',
    items: [
      { to: '/wallet/budgets', label: 'Budgets', icon: PieChart, end: false },
      { to: '/wallet/goals', label: 'Goals', icon: Target, end: false },
      { to: '/wallet/recurring', label: 'Recurring', icon: RefreshCw, end: false },
    ],
  },
  {
    label: 'Analyse',
    items: [{ to: '/wallet/reports', label: 'Reports', icon: BarChart2, end: false }],
  },
  {
    label: 'Data',
    items: [{ to: '/wallet/import', label: 'Import CSV', icon: Upload, end: false }],
  },
] as const

interface SidebarProps {
  open?: boolean
  onClose?: () => void
}

const topLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-50 text-brand-700'
      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
  )

const subLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2.5 rounded-lg py-1.5 pl-9 pr-3 text-[13px] font-medium transition-colors',
    isActive
      ? 'bg-brand-50 text-brand-700'
      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
  )

export function Sidebar({ open = true, onClose }: SidebarProps) {
  const location = useLocation()
  const isWalletRoute = location.pathname.startsWith('/wallet')
  const setPendingInvites = useHouseholdStore((s) => s.setPendingInvites)

  // Poll for pending invites so the badge stays up-to-date
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const raw = await api.get<Record<string, unknown>[]>('/invites')
        if (!cancelled) setPendingInvites(raw.map(mapInvite))
      } catch { /* ignore */ }
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [setPendingInvites])
  // null = follow the route (auto-expand on /wallet/*); true/false = manual override.
  const [walletOverride, setWalletOverride] = useState<boolean | null>(null)
  // Clear a manual override once the user leaves /wallet so a later visit
  // auto-expands again, rather than staying stuck collapsed/expanded forever.
  const [prevIsWalletRoute, setPrevIsWalletRoute] = useState(isWalletRoute)
  if (isWalletRoute !== prevIsWalletRoute) {
    setPrevIsWalletRoute(isWalletRoute)
    if (!isWalletRoute) setWalletOverride(null)
  }
  const walletExpanded = walletOverride ?? isWalletRoute

  const navContent = (
    <>
      {/* Logo */}
      <div className="flex items-center justify-between gap-2.5 px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            D
          </div>
          <span className="text-lg font-bold tracking-tight text-gray-900">
            Daybook
          </span>
        </div>
        {/* Close button — mobile only */}
        {onClose && (
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 md:hidden"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Main navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pt-2">
        <NavLink to="/tasks" end onClick={onClose} className={topLinkClass}>
          <CheckSquare className="h-4 w-4 flex-shrink-0" />
          Tasks
        </NavLink>

        <NavLink to="/household" end onClick={onClose} className={({ isActive }) => cn(topLinkClass({ isActive }), 'justify-between')}>
          <span className="flex items-center gap-3">
            <Users className="h-4 w-4 flex-shrink-0" />
            Household
          </span>
          <InvitationsBadge />
        </NavLink>

        {/* Wallet — expandable section */}
        <div>
          <div className="flex items-center">
            <NavLink
              to="/wallet"
              end={false}
              onClick={() => {
                setWalletOverride(true)
                onClose?.()
              }}
              className={({ isActive }) =>
                cn(topLinkClass({ isActive }), 'flex-1')
              }
            >
              <Wallet className="h-4 w-4 flex-shrink-0" />
              Wallet
            </NavLink>
            <button
              type="button"
              onClick={() => setWalletOverride(!walletExpanded)}
              aria-label={walletExpanded ? 'Collapse Wallet' : 'Expand Wallet'}
              aria-expanded={walletExpanded}
              className="ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform',
                  walletExpanded ? '' : '-rotate-90',
                )}
              />
            </button>
          </div>

          {walletExpanded && (
            <div className="mt-0.5 space-y-2 pb-1">
              {walletGroups.map((group) => (
                <div key={group.label} className="space-y-0.5">
                  <p className="px-3 pb-0.5 pl-9 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {group.label}
                  </p>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={onClose}
                      className={subLinkClass}
                    >
                      <item.icon className="h-3.5 w-3.5 flex-shrink-0" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dev-only UAT link */}
        {import.meta.env.DEV && (
          <NavLink to="/uat" end onClick={onClose} className={topLinkClass}>
            <FlaskConical className="h-4 w-4 flex-shrink-0" />
            UAT Tests
          </NavLink>
        )}
      </nav>

      {/* Bottom: Settings */}
      <div className="border-t border-gray-200 px-3 py-3">
        <NavLink to="/settings" end onClick={onClose} className={topLinkClass}>
          <Settings className="h-4 w-4 flex-shrink-0" />
          Settings
        </NavLink>
        <p className="mt-2 px-3 text-xs text-gray-400">Daybook Alpha</p>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar — always visible on md+ */}
      <aside className="hidden md:flex h-full w-56 flex-col border-r border-gray-200 bg-white">
        {navContent}
      </aside>

      {/* Mobile sidebar — slide-in drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
            aria-hidden
          />
          {/* Drawer */}
          <aside className="relative flex h-full w-56 flex-col border-r border-gray-200 bg-white shadow-xl">
            {navContent}
          </aside>
        </div>
      )}
    </>
  )
}
