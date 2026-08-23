import { test, expect } from '@playwright/test'
import { newAppPage, navTo, navItem } from './helpers'

/**
 * R2 — wallet navigation moved from a squeezed horizontal tab strip (Phase A),
 * then from a collapsible "Wallet" section inside one shared sidebar, to a
 * module-scoped sidebar: visiting /wallet* shows only Wallet's own nav, with
 * no cross-module expand/collapse control (that mechanism no longer exists —
 * the app bar's module tabs answer "which module", the sidebar only answers
 * "where inside it"). See docs/v2/foundation/03-app-shell.md §4.
 */
test.describe('wallet module sidebar navigation', () => {
  test('the Wallet module sidebar shows the grouped nav with no group label on the first set', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')

    // First group (Overview/Transactions/Accounts/Shared) is unlabeled; only
    // "Plan" and "Analyse" carry group headers now (design spec §4 table).
    await expect(page.getByText('Plan', { exact: true })).toBeVisible()
    await expect(page.getByText('Analyse', { exact: true })).toBeVisible()

    // All eight sidebar destinations are reachable (Import CSV moved off the
    // sidebar into the account menu — see the separate test below).
    for (const dest of [
      'transactions',
      'dashboard',
      'accounts',
      'shared',
      'budgets',
      'goals',
      'recurring',
      'reports',
    ]) {
      await expect(navItem(page, dest)).toBeVisible()
    }
  })

  test('sub-links navigate and the page renders', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')

    // R2 retires the old TopBar's route-title <h1> (routeTitles.ts) along with
    // TopBar itself — the app bar has no page-title area, by design (it's
    // module tabs + search, not a title bar). Each page's own content heading
    // is an <h2> (e.g. BudgetsPage/ReportsPage), so this now matches by name
    // only rather than assuming a page-level <h1> that no longer exists.
    await navTo(page, 'budgets')
    await expect(page).toHaveURL(/\/wallet\/budgets$/)
    // exact: 'Budgets' is otherwise a substring match of the empty state's
    // "No budgets yet" <h3> — getByRole name matching is substring by default.
    await expect(page.getByRole('heading', { name: 'Budgets', exact: true })).toBeVisible()

    await navTo(page, 'reports')
    await expect(page).toHaveURL(/\/wallet\/reports$/)
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible()
  })

  test('the Tasks module sidebar replaces the Wallet one when navigating away', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')
    await expect(navItem(page, 'budgets')).toBeVisible()

    await page.goto('/tasks')
    // Wallet's own nav is gone — genuinely absent from the DOM (ModuleSidebar
    // swaps its whole subtree per active module), not just hidden, so assert
    // on the unfiltered locator rather than the :visible-filtered navItem()
    // (which would pass just as well if the element were merely display:none).
    await expect(page.getByTestId('nav-budgets')).toHaveCount(0)
  })

  test('Import CSV is reachable from the account menu, not the sidebar', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')

    // D-14 / design spec §4: Import CSV leaves the sidebar; it must still be
    // reachable from somewhere or the feature has no UI entry point at all.
    // It lives in the account menu's settings pane, alongside merchant names.
    await page.getByTestId('account-menu-button').click()
    await page.getByTestId('account-menu-settings').click()
    await page.getByTestId('account-menu-import-csv').click()
    await expect(page).toHaveURL(/\/wallet\/import$/)
  })
})
