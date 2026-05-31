/**
 * Opening balance — an account can start at a non-zero balance (e.g. a real
 * bank account), and that opening figure flows into the running balance and
 * net worth.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, accountCardFor, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
})

test.afterAll(async () => {
  await page.context().close()
})

test('create an account with an opening balance', async () => {
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Account Name').fill('Savings')
  await dialog.getByLabel('Type').selectOption('bank')
  await dialog.getByLabel('Opening Balance').fill('1000')
  await dialog.getByRole('button', { name: /Create Account/ }).click()
  await expect(dialog).toBeHidden()

  await expect(accountCardFor(page, 'Savings').getByText('RM 1,000.00')).toBeVisible()
})

test('net worth includes the opening balance', async () => {
  await expect(page.getByText('Total Net Worth')).toBeVisible()
  await expect(page.getByText('RM 1,000.00').first()).toBeVisible()
})

test('opening balance feeds the running balance after a transaction', async () => {
  await page.goto('/wallet')
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '100',
    account: 'Savings',
    merchant: 'Groceries',
  })

  await page.goto('/wallet/accounts')
  await expect(accountCardFor(page, 'Savings').getByText('RM 900.00')).toBeVisible()
})

test('editing the opening balance updates the running balance', async () => {
  const card = accountCardFor(page, 'Savings')
  await card.hover()
  await card.getByRole('button', { name: 'Edit account' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Opening Balance')).toHaveValue('1000')
  await dialog.getByLabel('Opening Balance').fill('2000')
  await dialog.getByRole('button', { name: /Save Changes/ }).click()
  await expect(dialog).toBeHidden()

  // 2000 opening − 100 expense = 1900
  await expect(accountCardFor(page, 'Savings').getByText('RM 1,900.00')).toBeVisible()
})
