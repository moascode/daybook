import { test, expect } from '@playwright/test'
import { newAppPage, navTo, navItem } from './helpers'

/**
 * Phase A — wallet navigation moved from a squeezed horizontal tab strip to a
 * grouped, collapsible "Wallet" section in the left Sidebar.
 */
test.describe('wallet left-panel navigation', () => {
  test('wallet section auto-expands on /wallet and shows grouped sub-links', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')

    // Group headers are present when the section is expanded.
    await expect(page.getByText('Daily', { exact: true })).toBeVisible()
    await expect(page.getByText('Planning', { exact: true })).toBeVisible()

    // All nine destinations are reachable as sidebar nav items.
    for (const dest of [
      'transactions',
      'dashboard',
      'accounts',
      'shared',
      'budgets',
      'goals',
      'recurring',
      'reports',
      'import',
    ]) {
      await expect(navItem(page, dest)).toBeVisible()
    }
  })

  test('sub-links navigate and the top bar reflects the active page', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')

    await navTo(page, 'budgets')
    await expect(page).toHaveURL(/\/wallet\/budgets$/)
    await expect(page.getByRole('heading', { name: 'Budgets', level: 1 })).toBeVisible()

    await navTo(page, 'reports')
    await expect(page).toHaveURL(/\/wallet\/reports$/)
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible()
  })

  test('the Wallet section can be collapsed and re-expanded', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet')

    await expect(navItem(page, 'budgets')).toBeVisible()

    await navTo(page, 'wallet-toggle')
    await expect(navItem(page, 'budgets')).toBeHidden()

    await navTo(page, 'wallet-toggle')
    await expect(navItem(page, 'budgets')).toBeVisible()
  })

  test('leaving /wallet clears a manual collapse so returning auto-expands', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/wallet')
    await expect(navItem(page, 'budgets')).toBeVisible()

    await navTo(page, 'wallet-toggle')
    await expect(navItem(page, 'budgets')).toBeHidden()

    // Navigate away and back via the URL (not the Wallet link, which force-expands).
    await page.goto('/tasks')
    await page.goto('/wallet/dashboard')
    await expect(navItem(page, 'budgets')).toBeVisible()
  })
})
