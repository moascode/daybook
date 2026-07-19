import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { TasksPage } from '@/modules/tasks/TasksPage'
import { WalletLayout } from '@/modules/wallet/WalletLayout'
import { WalletPage } from '@/modules/wallet/WalletPage'
import { AccountsPage } from '@/modules/wallet/AccountsPage'
import { Dashboard } from '@/modules/wallet/Dashboard'
import { CsvImport } from '@/modules/wallet/CsvImport'
import { BudgetsPage } from '@/modules/wallet/BudgetsPage'
import { RecurringPage } from '@/modules/wallet/RecurringPage'
import { GoalsPage } from '@/modules/wallet/GoalsPage'
import { ReportsPage } from '@/modules/wallet/ReportsPage'
import { SettingsLayout } from '@/modules/settings/SettingsLayout'
import { SettingsPage } from '@/modules/settings/SettingsPage'
import { SharingPage } from '@/modules/settings/SharingPage'
import { UATPage } from '@/modules/uat/UATPage'
import { HouseholdPageWrapper } from '@/modules/household/HouseholdPageWrapper'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/tasks" replace /> },
      { path: 'tasks', element: <TasksPage /> },
      {
        path: 'wallet',
        element: <WalletLayout />,
        children: [
          { index: true, element: <WalletPage /> },
          { path: 'accounts', element: <AccountsPage /> },
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'budgets', element: <BudgetsPage /> },
          { path: 'recurring', element: <RecurringPage /> },
          { path: 'goals', element: <GoalsPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'import', element: <CsvImport /> },
        ],
      },
      { path: 'household', element: <HouseholdPageWrapper /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <SettingsPage /> },
          { path: 'sharing', element: <SharingPage /> },
        ],
      },
      { path: 'uat', element: <UATPage /> },
    ],
  },
])
