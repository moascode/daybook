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
import { cn, TEST_HOOKS_ENABLED } from '@/lib/utils'
import { InvitationsBadge } from '@/modules/settings/InvitationsBadge'
import { PendingClaimsBadge } from '@/modules/wallet/PendingClaimsBadge'
import { useHouseholdStore } from '@/stores/household.store'
import { api } from '@/lib/api'
import { refreshClaimBadge } from '@/lib/claim-badge'
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
      { to: '/wallet/shared', label: 'Shared', icon: Users, end: false },
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
      : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
  )

const subLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2.5 rounded-lg py-1.5 pl-9 pr-3 text-[13px] font-medium transition-colors',
    isActive
      ? 'bg-brand-50 text-brand-700'
      : 'text-fg-subtle hover:bg-surface-sunken hover:text-fg',
  )

export function Sidebar({ open = true, onClose }: SidebarProps) {
  const location = useLocation()
  const isWalletRoute = location.pathname.startsWith('/wallet')
  const setPendingInvites = useHouseholdStore((s) => s.setPendingInvites)

  // Poll for pending invites and unresolved split claims so both badges stay
  // up-to-date. The claim badge is the fix for the failure that started this
  // work: a recipient had 15 splits against her and nothing told her.
  //
  // The claim count is computed by refreshClaimBadge so that this poll and the
  // actions that resolve a claim agree on what the badge means — they used to
  // write different numbers to the same field.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const raw = await api.get<Record<string, unknown>[]>('/invites')
        if (!cancelled) setPendingInvites(raw.map(mapInvite))
      } catch { /* ignore */ }
      if (!cancelled) await refreshClaimBadge()
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
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-fg-on-accent">
            D
          </div>
          <span className="text-lg font-bold tracking-tight text-fg">
            Daybook
          </span>
        </div>
        {/* Close button — mobile only */}
        {onClose && (
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md text-fg-faint hover:bg-surface-hover hover:text-fg-muted md:hidden"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Main navigation */}
      {/* min-h-0 lets this flex child actually shrink so the nav scrolls and
          Settings below stays pinned on short viewports (C11) */}
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pt-2">
        <NavLink to="/tasks" end onClick={onClose} className={topLinkClass}>
          <CheckSquare className="h-4 w-4 flex-shrink-0" />
          Tasks
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
              className="ml-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md text-fg-faint hover:bg-surface-hover hover:text-fg-muted md:h-7 md:w-7"
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
                  <p className="px-3 pb-0.5 pl-9 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
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
                      {item.to === '/wallet/shared' && <PendingClaimsBadge />}
                    </NavLink>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dev-only UAT link */}
        {TEST_HOOKS_ENABLED && (
          <NavLink to="/uat" end onClick={onClose} className={topLinkClass}>
            <FlaskConical className="h-4 w-4 flex-shrink-0" />
            UAT Tests
          </NavLink>
        )}
      </nav>

      {/* Bottom: Settings */}
      <div className="shrink-0 border-t border-line px-3 py-3">
        {/* end=false: stay highlighted on /settings/sharing; badge surfaces pending invites */}
        <NavLink to="/settings" end={false} onClick={onClose} className={({ isActive }) => cn(topLinkClass({ isActive }), 'justify-between')}>
          <span className="flex items-center gap-3">
            <Settings className="h-4 w-4 flex-shrink-0" />
            Settings
          </span>
          <InvitationsBadge />
        </NavLink>
        <p className="mt-2 px-3 text-xs text-fg-faint">Daybook</p>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar — always visible on md+ */}
      <aside className="hidden md:flex h-full w-56 flex-col border-r border-line bg-surface">
        {navContent}
      </aside>

      {/* Mobile sidebar — slide-in drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-overlay/40"
            onClick={onClose}
            aria-hidden
          />
          {/* Drawer */}
          <aside className="relative flex h-full w-56 flex-col border-r border-line bg-surface shadow-xl">
            {navContent}
          </aside>
        </div>
      )}
    </>
  )
}
