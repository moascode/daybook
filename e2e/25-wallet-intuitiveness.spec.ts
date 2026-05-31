/**
 * Phase D — wallet intuitiveness wins:
 *  - a total-balance hero on the transactions screen
 *  - filter bar + summary hidden until there's an account
 *  - the transaction form pre-selects an account
 *  - a visible (not hover-only) edit affordance on rows
 *  - the dashboard empty state guides the user to Accounts
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import {
  newAppPage,
  fillAccountForm,
  fillTransactionForm,
  transactionRowFor,
} from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet')
})

test.afterAll(async () => {
  await page.context().close()
})

test('with no accounts the balance hero and filter bar are hidden', async () => {
  await expect(page.getByText('Total Balance')).toHaveCount(0)
  await expect(page.getByLabel('From')).toHaveCount(0)
  // The primary action and the guiding empty state are still present.
  await expect(page.getByRole('button', { name: 'Add Transaction' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Go to Accounts' })).toBeVisible()
})

test('the dashboard empty state links to Accounts', async () => {
  await page.goto('/wallet/dashboard')
  await expect(page.getByRole('button', { name: 'Go to Accounts' })).toBeVisible()
})

test('once an account exists the balance hero and filters appear', async () => {
  await page.goto('/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Main', type: 'bank' })

  await page.goto('/wallet')
  await expect(page.getByText('Total Balance')).toBeVisible()
  await expect(page.getByLabel('From')).toBeVisible()
})

test('the transaction form pre-selects the first account', async () => {
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('#account')).not.toHaveValue('')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
})

test('a transaction row exposes a visible Edit button that opens the editor', async () => {
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '10',
    account: 'Main',
    merchant: 'Cafe',
  })

  const row = transactionRowFor(page, 'Cafe')
  await row.getByRole('button', { name: 'Edit transaction' }).click()
  await expect(page.getByRole('heading', { name: 'Edit Transaction' })).toBeVisible()
})
