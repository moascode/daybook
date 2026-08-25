import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { TasksTodayPage } from '@/modules/tasks/TasksTodayPage'
import { TasksAllPage } from '@/modules/tasks/TasksAllPage'
import { TasksOutlinerPage } from '@/modules/tasks/TasksOutlinerPage'
import { WalletLayout } from '@/modules/wallet/WalletLayout'
import { WalletPage } from '@/modules/wallet/WalletPage'
import { AccountsPage } from '@/modules/wallet/AccountsPage'
import { Dashboard } from '@/modules/wallet/Dashboard'
import { CsvImport } from '@/modules/wallet/CsvImport'
import { CanonicalizeMerchantsPage } from '@/modules/wallet/CanonicalizeMerchantsPage'
import { BudgetsPage } from '@/modules/wallet/BudgetsPage'
import { RecurringPage } from '@/modules/wallet/RecurringPage'
import { GoalsPage } from '@/modules/wallet/GoalsPage'
import { ReportsPage } from '@/modules/wallet/ReportsPage'
import { SharedPage } from '@/modules/wallet/SharedPage'
import { SettingsLayout } from '@/modules/settings/SettingsLayout'
import { SettingsPage } from '@/modules/settings/SettingsPage'
import { SharingPage } from '@/modules/settings/SharingPage'
import { HelpPage } from '@/modules/help/HelpPage'
import { UATPage } from '@/modules/uat/UATPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/tasks" replace /> },
      { path: 'tasks', element: <TasksTodayPage /> },
      { path: 'tasks/all', element: <TasksAllPage /> },
      { path: 'tasks/lists/:listId', element: <TasksOutlinerPage /> },
      {
        path: 'wallet',
        element: <WalletLayout />,
        children: [
          { index: true, element: <WalletPage /> },
          { path: 'accounts', element: <AccountsPage /> },
          { path: 'shared', element: <SharedPage /> },
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'budgets', element: <BudgetsPage /> },
          { path: 'recurring', element: <RecurringPage /> },
          { path: 'goals', element: <GoalsPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'import', element: <CsvImport /> },
          { path: 'canonicalize-merchants', element: <CanonicalizeMerchantsPage /> },
        ],
      },
      // Sharing IA relocation (§3): keep the old URL working for one release
      { path: 'household', element: <Navigate to="/settings/sharing" replace /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <SettingsPage /> },
          { path: 'sharing', element: <SharingPage /> },
        ],
      },
      { path: 'help', element: <HelpPage /> },
      { path: 'uat', element: <UATPage /> },
    ],
  },
])
