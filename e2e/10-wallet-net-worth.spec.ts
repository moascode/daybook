/**
 * Wallet net worth (Total balance) summary — e2e tests.
 * Verifies the total balance display on the Accounts page.
 *
 * The Accounts page's net-worth figure moved from the old `NetWorthBanner`
 * ("Total Net Worth" text, `net-worth-value` testid, a bare "N accounts"
 * caption) to `BalanceSummary` (`balance-summary` / `balance-summary-total`
 * testids, "Total balance" eyebrow). Fresh accounts created here have no
 * full prior month of history, so `BalanceSummary`'s change chip/percent
 * line never renders — it falls back to "across N accounts", which is what
 * these tests assert against.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, fillTransactionForm, navTo , openBlankTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── No accounts state ─────────────────────────────────────────────────

test('balance summary is NOT shown when there are no accounts', async () => {
  await expect(page.getByTestId('balance-summary')).not.toBeVisible()
})

// ── After creating an account ──────────────────────────────────────────

test('balance summary appears once an account exists', async () => {
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Cash Wallet', type: 'cash' })
  await page.waitForTimeout(500)

  await expect(page.getByTestId('balance-summary')).toBeVisible()
})

test('total balance shows a formatted MYR amount (zero for new empty account)', async () => {
  // New account has no transactions → balance = 0
  const totalEl = page.getByTestId('balance-summary-total')
  await expect(totalEl).toBeVisible()
  // The value should be formatted as MYR 0.00 (or similar locale format)
  await expect(totalEl).toContainText('0.00')
})

test('balance summary shows the account count', async () => {
  await expect(page.getByText('across 1 account')).toBeVisible()
})

// ── With transactions ──────────────────────────────────────────────────

test('total balance increases after adding an income transaction', async () => {
  // Navigate to transactions and add income
  await navTo(page, 'transactions')
  await openBlankTransactionForm(page)

  await fillTransactionForm(page, {
    type: 'Income',
    amount: '500',
    account: 'Cash Wallet',
    merchant: 'Salary',
    date: '2024-01-15',
  })
  await page.waitForTimeout(400)

  // Go back to accounts
  await navTo(page, 'accounts')
  await page.waitForTimeout(600) // wait for balances to load

  // Total balance should now be MYR 500.00
  await expect(page.getByTestId('balance-summary-total')).toContainText('500')
})

test('total balance decreases after adding an expense transaction', async () => {
  await navTo(page, 'transactions')
  await openBlankTransactionForm(page)

  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '200',
    account: 'Cash Wallet',
    merchant: 'Groceries',
    date: '2024-01-16',
  })
  await page.waitForTimeout(400)

  await navTo(page, 'accounts')
  await page.waitForTimeout(600)

  // 500 income - 200 expense = 300 total balance
  await expect(page.getByTestId('balance-summary-total')).toContainText('300')
})

test('second account adds to the total balance', async () => {
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Bank Account', type: 'bank' })
  await page.waitForTimeout(500)

  // Total balance should be 300 (same — new empty account adds 0)
  await expect(page.getByTestId('balance-summary-total')).toContainText('300')
  // Two accounts now
  await expect(page.getByText('across 2 accounts')).toBeVisible()
})
