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
  CalendarClock,
  UserCheck,
  CheckCircle2,
  Repeat,
  MapPin,
  CalendarRange,
  ClipboardList,
  Ticket,
  Lightbulb,
  CalendarDays,
  StickyNote,
  ClipboardCheck,
  History,
} from 'lucide-react'

/**
 * The four Daybook modules and their navigation, in one place.
 *
 * AppBar (module tabs), ModuleSidebar (module-scoped nav), MobileTabBar (bottom
 * tab bar) and AccountMenu (MODULE SETTINGS rows) all read this list rather than
 * each owning a copy — see docs/v2/foundation/03-app-shell.md §7. Both Day and
 * Trips are live as of R6. Day's "Show on the timeline" toggles aren't listed
 * here — they're interactive checkboxes bound to `day.store.ts`, not links, so
 * ModuleSidebar injects them dynamically the same way it injects Tasks' Lists
 * group.
 */

export interface ModuleNavItem {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
  testid: string
  /** Renders as a real disabled `<button aria-disabled>` with a stated reason
   *  (ModuleSidebar), matching AppBar's disabled-module-tab pattern — never a
   *  bare 404 or a native `disabled` attribute (which would kill the tooltip). */
  disabled?: boolean
  /** Required alongside `disabled: true` — shown as `"{label} — {reason}"`. */
  disabledReason?: string
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
    headSub: 'Timeline',
    settingsBlurb: 'The daily timeline, notes and review.',
    navGroups: [
      {
        items: [
          { to: '/day', label: 'Today', icon: Calendar, end: true, testid: 'nav-day-today' },
          {
            to: '/day/week',
            label: 'This week',
            icon: CalendarDays,
            end: false,
            testid: 'nav-day-week',
            disabled: true,
            disabledReason: 'Coming in R16',
          },
          {
            to: '/day/calendar',
            label: 'Calendar',
            icon: CalendarRange,
            end: false,
            testid: 'nav-day-calendar',
            disabled: true,
            disabledReason: 'Coming in R16',
          },
          {
            to: '/day/notes',
            label: 'Notes',
            icon: StickyNote,
            end: false,
            testid: 'nav-day-notes',
            disabled: true,
            disabledReason: 'Coming in R15',
          },
        ],
      },
      // The dynamic "Show on the timeline" toggle group (Tasks & habits /
      // Money / Scheduled & bills, plus a disabled Notes row) is injected by
      // ModuleSidebar itself, not listed here — see the doc comment above.
      {
        label: 'Review',
        items: [
          {
            to: '/day/weekly-review',
            label: 'Weekly review',
            icon: ClipboardCheck,
            end: false,
            testid: 'nav-day-weekly-review',
            disabled: true,
            disabledReason: 'Coming in R16',
          },
          {
            to: '/day/on-this-day',
            label: 'On this day',
            icon: History,
            end: false,
            testid: 'nav-day-on-this-day',
            disabled: true,
            disabledReason: 'Coming in R16',
          },
        ],
      },
    ],
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
          { to: '/tasks', label: 'Today', icon: CheckSquare, end: true, testid: 'nav-tasks-today' },
          { to: '/tasks/all', label: 'All tasks', icon: List, end: false, testid: 'nav-tasks-all' },
          {
            to: '/tasks/upcoming',
            label: 'Upcoming',
            icon: CalendarClock,
            end: false,
            testid: 'nav-tasks-upcoming',
            disabled: true,
            disabledReason: 'Coming in R10',
          },
          {
            to: '/tasks/assigned',
            label: 'Assigned to me',
            icon: UserCheck,
            end: false,
            testid: 'nav-tasks-assigned',
            disabled: true,
            disabledReason: 'Coming in R10',
          },
        ],
      },
      // The dynamic per-user "Lists" group (task_lists rows + the fixed
      // "Unsorted" bucket) is injected by ModuleSidebar itself, not listed
      // here — this file stays static/pure, no per-user data (see the doc
      // comment above ModuleDescriptor).
      {
        label: 'Review',
        items: [
          { to: '/tasks/completed', label: 'Completed', icon: CheckCircle2, end: false, testid: 'nav-tasks-completed' },
          {
            to: '/tasks/habits',
            label: 'Habits',
            icon: Repeat,
            end: false,
            testid: 'nav-tasks-habits',
            disabled: true,
            disabledReason: 'Coming in R11',
          },
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
    headSub: 'Itinerary',
    settingsBlurb: 'Itineraries, bookings and prep lists — coming in R12.',
    navGroups: [
      {
        items: [
          {
            to: '/trips/active',
            label: 'Active trip',
            icon: Plane,
            end: false,
            testid: 'nav-trips-active',
            disabled: true,
            disabledReason: 'Coming in R12',
          },
          {
            to: '/trips/itinerary',
            label: 'Itinerary',
            icon: CalendarRange,
            end: false,
            testid: 'nav-trips-itinerary',
            disabled: true,
            disabledReason: 'Coming in R12',
          },
          {
            to: '/trips/prep',
            label: 'Prep',
            icon: ClipboardList,
            end: false,
            testid: 'nav-trips-prep',
            disabled: true,
            disabledReason: 'Coming in R12',
          },
          {
            to: '/trips/bookings',
            label: 'Bookings',
            icon: Ticket,
            end: false,
            testid: 'nav-trips-bookings',
            disabled: true,
            disabledReason: 'Coming in R12',
          },
        ],
      },
      {
        items: [
          {
            to: '/trips/all',
            label: 'All trips',
            icon: MapPin,
            end: false,
            testid: 'nav-trips-all',
            disabled: true,
            disabledReason: 'Coming in R12',
          },
          {
            to: '/trips/wishlist',
            label: 'Wishlist',
            icon: Lightbulb,
            end: false,
            testid: 'nav-trips-wishlist',
            disabled: true,
            disabledReason: 'Coming in R12',
          },
        ],
      },
    ],
  },
]
