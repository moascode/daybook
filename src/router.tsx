import { lazy, Suspense, type ComponentType } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { WalletLayout } from '@/modules/wallet/WalletLayout'
import { SettingsLayout } from '@/modules/settings/SettingsLayout'
import { RouteFallback } from '@/components/layout/RouteFallback'

/**
 * Every page is code-split (v3 P3). Before this the whole app — all four
 * modules, Recharts, PapaParse — was one 1,251 kB chunk that had to arrive
 * before anything rendered, which on mobile data is most of the wait.
 *
 * The two layouts stay eager: they are a few lines each, they wrap the routes
 * below them, and splitting them would add a round trip to reach the split.
 *
 * `page()` keeps the named-export convention. React.lazy wants a default
 * export, and switching twenty files to default exports to satisfy a bundler
 * would be the tail wagging the dog.
 */
function page<T extends Record<string, unknown>>(
  load: () => Promise<T>,
  name: keyof T & string,
) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }))
}

const DayPage = page(() => import('@/modules/day/DayPage'), 'DayPage')
const TasksTodayPage = page(() => import('@/modules/tasks/TasksTodayPage'), 'TasksTodayPage')
const TasksAllPage = page(() => import('@/modules/tasks/TasksAllPage'), 'TasksAllPage')
const TasksListDetailPage = page(() => import('@/modules/tasks/TasksListDetailPage'), 'TasksListDetailPage')
const TasksCompletedPage = page(() => import('@/modules/tasks/TasksCompletedPage'), 'TasksCompletedPage')
const TripsPage = page(() => import('@/modules/trips/TripsPage'), 'TripsPage')
const WalletPage = page(() => import('@/modules/wallet/WalletPage'), 'WalletPage')
const AccountsPage = page(() => import('@/modules/wallet/AccountsPage'), 'AccountsPage')
const SharedPage = page(() => import('@/modules/wallet/SharedPage'), 'SharedPage')
const Dashboard = page(() => import('@/modules/wallet/Dashboard'), 'Dashboard')
const BudgetsPage = page(() => import('@/modules/wallet/BudgetsPage'), 'BudgetsPage')
const RecurringPage = page(() => import('@/modules/wallet/RecurringPage'), 'RecurringPage')
const GoalsPage = page(() => import('@/modules/wallet/GoalsPage'), 'GoalsPage')
const ReportsPage = page(() => import('@/modules/wallet/ReportsPage'), 'ReportsPage')
const CsvImport = page(() => import('@/modules/wallet/CsvImport'), 'CsvImport')
const CaptureInbox = page(() => import('@/modules/wallet/CaptureInbox'), 'CaptureInbox')
const CanonicalizeMerchantsPage = page(() => import('@/modules/wallet/CanonicalizeMerchantsPage'), 'CanonicalizeMerchantsPage')
const SettingsPage = page(() => import('@/modules/settings/SettingsPage'), 'SettingsPage')
const SharingPage = page(() => import('@/modules/settings/SharingPage'), 'SharingPage')
const HelpPage = page(() => import('@/modules/help/HelpPage'), 'HelpPage')
const UATPage = page(() => import('@/modules/uat/UATPage'), 'UATPage')

/** Suspense sits per route rather than once around the shell's Outlet, so the
 *  sidebar, app bar and offline banner never blank out mid-navigation. */
function lazyRoute(Component: ComponentType) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Component />
    </Suspense>
  )
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/day" replace /> },
      { path: 'day', element: lazyRoute(DayPage) },
      { path: 'tasks', element: lazyRoute(TasksTodayPage) },
      { path: 'tasks/all', element: lazyRoute(TasksAllPage) },
      { path: 'tasks/lists/:listId', element: lazyRoute(TasksListDetailPage) },
      { path: 'tasks/completed', element: lazyRoute(TasksCompletedPage) },
      { path: 'trips', element: lazyRoute(TripsPage) },
      {
        path: 'wallet',
        element: <WalletLayout />,
        children: [
          { index: true, element: lazyRoute(WalletPage) },
          { path: 'accounts', element: lazyRoute(AccountsPage) },
          { path: 'shared', element: lazyRoute(SharedPage) },
          { path: 'dashboard', element: lazyRoute(Dashboard) },
          { path: 'budgets', element: lazyRoute(BudgetsPage) },
          { path: 'recurring', element: lazyRoute(RecurringPage) },
          { path: 'goals', element: lazyRoute(GoalsPage) },
          { path: 'reports', element: lazyRoute(ReportsPage) },
          { path: 'import', element: lazyRoute(CsvImport) },
          { path: 'inbox', element: lazyRoute(CaptureInbox) },
          { path: 'canonicalize-merchants', element: lazyRoute(CanonicalizeMerchantsPage) },
        ],
      },
      // Sharing IA relocation (§3): keep the old URL working for one release
      { path: 'household', element: <Navigate to="/settings/sharing" replace /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: lazyRoute(SettingsPage) },
          { path: 'sharing', element: lazyRoute(SharingPage) },
        ],
      },
      { path: 'help', element: lazyRoute(HelpPage) },
      { path: 'uat', element: lazyRoute(UATPage) },
    ],
  },
])
