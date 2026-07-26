import { test, expect } from '@playwright/test'
import { newAppPage } from './helpers'

test.describe('Help & Guide', () => {
  test('the TopBar help button opens the guide page', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.getByRole('button', { name: 'Help & Guide' }).first().click()

    await expect(page).toHaveURL(/\/help$/)
    // Both the TopBar page title and the page header read "Help & Guide";
    // scope to the main content region to assert the page rendered.
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Help & Guide' }),
    ).toBeVisible()
  })

  test('renders the key guide sections', async ({ browser }) => {
    const page = await newAppPage(browser, '/help')

    for (const heading of [
      'Getting Started',
      'Tasks',
      'Accounts & Transactions',
      'CSV Import',
      'Credit Cards & Transfers',
      'Planning & Analysis',
      'Sharing (Households)',
      'Settings',
      'Keyboard Shortcuts',
    ]) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    }
  })

  test('a deep-link button navigates into the app', async ({ browser }) => {
    const page = await newAppPage(browser, '/help')

    await page.getByRole('button', { name: 'Open Transactions' }).click()
    await expect(page).toHaveURL(/\/wallet$/)
  })
})
