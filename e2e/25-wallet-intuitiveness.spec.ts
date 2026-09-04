/**
 * Phase D — wallet intuitiveness wins:
 *  - a Money in / Money out / Net summary on the transactions screen (the
 *    Transactions page's own total-balance hero was later dropped in favour
 *    of this — see the mockup-parity rebuild — since it summed the whole
 *    account book, not the filtered range this page is actually about)
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
  openBlankTransactionForm,
} from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet')
})

test.afterAll(async () => {
  await page.context().close()
})

test('with no accounts the summary and filter bar are hidden', async () => {
  await expect(page.getByTestId('summary-income')).toHaveCount(0)
  await expect(page.getByTestId('transaction-search')).toHaveCount(0)
  // R7: the composer replaced "Add Transaction" as the primary action, and
  // needs an account to attach a transaction to — it stays hidden until one
  // exists (owner-confirmed 2026-09-02, docs/v2/.flow/R7-composer). The
  // guiding empty state is what leads a new user to create one.
  await expect(page.getByLabel('Add a transaction')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Go to Accounts' })).toBeVisible()
})

test('the dashboard empty state links to Accounts', async () => {
  await page.goto('/wallet/dashboard')
  await expect(page.getByRole('button', { name: 'Go to Accounts' })).toBeVisible()
})

test('once an account exists the summary and filters appear', async () => {
  await page.goto('/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Main', type: 'bank' })

  await page.goto('/wallet')
  await expect(page.getByTestId('summary-income')).toBeVisible()
  // §6.4 single-row bar: search first, then the date-range control and Filters toggle
  await expect(page.getByTestId('transaction-search')).toBeVisible()
  await expect(page.getByTestId('filter-this-month')).toBeVisible()
  await expect(page.getByTestId('filter-toggle')).toBeVisible()
})

test('the transaction form pre-selects the first account', async () => {
  await openBlankTransactionForm(page)
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('#account')).not.toHaveValue('')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
})

test('a transaction row exposes a visible Edit button that opens the editor', async () => {
  await openBlankTransactionForm(page)
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
