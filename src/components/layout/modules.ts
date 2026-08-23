import type { LucideIcon } from 'lucide-react'
import {
  Calendar,
  CheckSquare,
  Wallet,
  Plane,
  List,
  BarChart3,
  CreditCard,
  Users,
  PieChart,
  Target,
  RefreshCw,
  BarChart2,
} from 'lucide-react'

/**
 * The four Daybook modules and their navigation, in one place.
 *
 * AppBar (module tabs), ModuleSidebar (module-scoped nav), MobileTabBar (bottom
 * tab bar) and AccountMenu (MODULE SETTINGS rows) all read this list rather than
 * each owning a copy — see docs/v2/foundation/03-app-shell.md §7. Day and Trips
 * are `disabled: true` in R2 (R6 turns them on); their `navGroups` stay empty
 * since there is nothing to route to yet.
 */

export interface ModuleNavItem {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
  testid: string
}

export interface ModuleNavGroup {
  /** Omitted for the module's first, ungrouped set of destinations. */
  label?: string
  items: ModuleNavItem[]
}

export interface ModuleDescriptor {
  id: 'day' | 'tasks' | 'wallet' | 'trips'
  label: string
  icon: LucideIcon
  /** Route prefix used to decide which module is "active" for a given path. */
  path: string
  disabled?: boolean
  /** Short subtitle shown under the module name in ModuleSidebar's header. */
  headSub: string
  /** One-line description shown on this module's row in AccountMenu's
   *  MODULE SETTINGS group. No per-module settings page exists yet — every row
   *  in R2 is a description, not a link to a page. */
  settingsBlurb: string
  navGroups: ModuleNavGroup[]
}

export const modules: ModuleDescriptor[] = [
  {
    id: 'day',
    label: 'Day',
    icon: Calendar,
    path: '/day',
    disabled: true,
    headSub: 'Timeline',
    settingsBlurb: 'Timeline, notes and daily review — coming in R6.',
    navGroups: [],
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: CheckSquare,
    path: '/tasks',
    headSub: 'Outliner',
    settingsBlurb: 'Lists, due dates and the outliner.',
    navGroups: [
      {
        items: [
          { to: '/tasks', label: 'All tasks', icon: CheckSquare, end: true, testid: 'nav-tasks-all' },
        ],
      },
    ],
  },
  {
    id: 'wallet',
    label: 'Wallet',
    icon: Wallet,
    path: '/wallet',
    headSub: 'Household ledger',
    settingsBlurb: 'Accounts, categories, budgets and recurring rules.',
    navGroups: [
      {
        items: [
          { to: '/wallet/dashboard', label: 'Overview', icon: BarChart3, end: false, testid: 'nav-dashboard' },
          { to: '/wallet', label: 'Transactions', icon: List, end: true, testid: 'nav-transactions' },
          { to: '/wallet/accounts', label: 'Accounts', icon: CreditCard, end: false, testid: 'nav-accounts' },
          { to: '/wallet/shared', label: 'Shared', icon: Users, end: false, testid: 'nav-shared' },
        ],
      },
      {
        label: 'Plan',
        items: [
          { to: '/wallet/budgets', label: 'Budgets', icon: PieChart, end: false, testid: 'nav-budgets' },
          { to: '/wallet/goals', label: 'Goals', icon: Target, end: false, testid: 'nav-goals' },
          { to: '/wallet/recurring', label: 'Recurring', icon: RefreshCw, end: false, testid: 'nav-recurring' },
        ],
      },
      {
        label: 'Analyse',
        items: [
          { to: '/wallet/reports', label: 'Reports', icon: BarChart2, end: false, testid: 'nav-reports' },
        ],
      },
    ],
  },
  {
    id: 'trips',
    label: 'Trips',
    icon: Plane,
    path: '/trips',
    disabled: true,
    headSub: 'Itinerary',
    settingsBlurb: 'Itineraries, bookings and prep lists — coming in R6.',
    navGroups: [],
  },
]
