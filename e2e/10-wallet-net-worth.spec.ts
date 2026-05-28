/**
 * Wallet net worth banner — e2e tests.
 * Verifies the total net worth display on the Accounts page.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── No accounts state ─────────────────────────────────────────────────

test('net worth banner is NOT shown when there are no accounts', async () => {
  await expect(page.getByText('Total Net Worth')).not.toBeVisible()
})

// ── After creating an account ──────────────────────────────────────────

test('net worth banner appears once an account exists', async () => {
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Cash Wallet', type: 'cash' })
  await page.waitForTimeout(500)

  await expect(page.getByText('Total Net Worth')).toBeVisible()
})

test('net worth shows a formatted MYR amount (zero for new empty account)', async () => {
  // New account has no transactions → balance = 0
  const netWorthEl = page.locator('p.text-2xl')
  await expect(netWorthEl).toBeVisible()
  // The value should be formatted as MYR 0.00 (or similar locale format)
  await expect(netWorthEl).toContainText('0.00')
})

test('net worth label shows the account count', async () => {
  await expect(page.getByText('1 account')).toBeVisible()
})

// ── With transactions ──────────────────────────────────────────────────

test('net worth increases after adding an income transaction', async () => {
  // Navigate to transactions and add income
  await page.getByRole('link', { name: 'Transactions' }).click()
  await page.getByRole('button', { name: 'Add Transaction' }).click()

  await fillTransactionForm(page, {
    type: 'Income',
    amount: '500',
    account: 'Cash Wallet',
    merchant: 'Salary',
    date: '2024-01-15',
  })
  await page.waitForTimeout(400)

  // Go back to accounts
  await page.getByRole('link', { name: 'Accounts' }).click()
  await page.waitForTimeout(600) // wait for balances to load

  // Net worth should now be MYR 500.00
  await expect(page.locator('p.text-2xl')).toContainText('500')
})

test('net worth decreases after adding an expense transaction', async () => {
  await page.getByRole('link', { name: 'Transactions' }).click()
  await page.getByRole('button', { name: 'Add Transaction' }).click()

  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '200',
    account: 'Cash Wallet',
    merchant: 'Groceries',
    date: '2024-01-16',
  })
  await page.waitForTimeout(400)

  await page.getByRole('link', { name: 'Accounts' }).click()
  await page.waitForTimeout(600)

  // 500 income - 200 expense = 300 net worth
  await expect(page.locator('p.text-2xl')).toContainText('300')
})

test('second account adds to the net worth total', async () => {
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Bank Account', type: 'bank' })
  await page.waitForTimeout(500)

  // Net worth should be 300 (same — new empty account adds 0)
  await expect(page.locator('p.text-2xl')).toContainText('300')
  // Two accounts now
  await expect(page.getByText('2 accounts')).toBeVisible()
})
