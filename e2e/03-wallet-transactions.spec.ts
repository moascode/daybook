/**
 * Wallet — Transactions end-to-end tests.
 * Covers: add/edit/delete expense, income, transfer; summary row; all filters.
 * Creates its own accounts in beforeAll so this file is fully self-contained.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, accountCardFor, transactionRowFor, fillAccountForm, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  // Create two accounts needed throughout the spec
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Test Bank', type: 'bank' })
  await expect(accountCardFor(page, 'Test Bank')).toBeVisible()

  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Test Cash', type: 'cash' })
  await expect(accountCardFor(page, 'Test Cash')).toBeVisible()
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigation ─────────────────────────────────────────────────────────

test('navigate to Transactions tab', async () => {
  await page.getByRole('link', { name: 'Transactions' }).click()
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(page.locator('main').getByRole('heading', { name: 'Transactions' })).toBeVisible()
  // Clear the default current-month date filters so transactions with past dates are visible
  await page.getByLabel('From').fill('')
  await page.getByLabel('To').fill('')
})

test('shows "No transactions" placeholder when list is empty', async () => {
  // There are accounts but no transactions
  await expect(page.getByText(/No transactions match/)).toBeVisible()
})

// ── Add expense ────────────────────────────────────────────────────────

test('open Add Transaction modal', async () => {
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible()
})

test('form defaults to Expense type', async () => {
  const dialog = page.getByRole('dialog')
  // The Expense button should have the active style (red bg)
  await expect(dialog.getByRole('button', { name: 'Expense' })).toHaveClass(/text-red-600/)
})

test('form requires account and amount > 0', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Add Transaction/ }).click()
  await expect(dialog.getByText(/Select an account/)).toBeVisible()
  await expect(dialog.getByText(/Amount must be greater than 0/)).toBeVisible()
})

test('add an expense transaction', async () => {
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    date: '2026-01-15',
    amount: '125.50',
    account: 'Test Bank',
    merchant: 'Starbucks',
    category: 'Food & Drink',
    tag: 'coffee',
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Starbucks')).toBeVisible()
})

test('expense shows negative amount in red', async () => {
  const row = transactionRowFor(page, 'Starbucks')
  await expect(row.getByText(/RM\s125\.50/)).toHaveClass(/text-red-600/)
})

test('expense shows category badge', async () => {
  const row = transactionRowFor(page, 'Starbucks')
  await expect(row.getByText('Food & Drink')).toBeVisible()
})

// ── Add income ─────────────────────────────────────────────────────────

test('add an income transaction', async () => {
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Income',
    date: '2026-01-14',
    amount: '5000',
    account: 'Test Bank',
    merchant: 'Acme Corp',
    category: 'Salary',
  })
  await expect(transactionRowFor(page, 'Acme Corp')).toBeVisible()
})

test('income shows positive amount in green', async () => {
  const row = transactionRowFor(page, 'Acme Corp')
  await expect(row.getByText(/RM\s5,000\.00/)).toHaveClass(/text-green-600/)
})

// ── Summary row ────────────────────────────────────────────────────────

test('summary row shows correct income, expense and net', async () => {
  // Income = 5000, Expense = 125.50, Net = 4874.50
  await expect(page.getByText('RM 5,000.00').first()).toBeVisible()
  await expect(page.getByText('RM 125.50').first()).toBeVisible()
  await expect(page.getByText('RM 4,874.50')).toBeVisible()
})

// ── Add transfer ────────────────────────────────────────────────────────

test('add a transfer between accounts', async () => {
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Transfer',
    date: '2026-01-16',
    amount: '500',
    account: 'Test Bank',
    toAccount: 'Test Cash',
    merchant: 'ATM Withdrawal',
  })
  await expect(transactionRowFor(page, 'ATM Withdrawal')).toBeVisible()
})

test('transfer shows blue arrow icon (not red/green)', async () => {
  const row = transactionRowFor(page, 'ATM Withdrawal')
  await expect(row.getByText(/RM\s500\.00/)).toHaveClass(/text-blue-600/)
})

test('transfer does NOT affect income/expense summary', async () => {
  // Income still 5000, expense still 125.50 — transfer is excluded from totals
  await expect(page.getByText('RM 5,000.00').first()).toBeVisible()
  await expect(page.getByText('RM 125.50').first()).toBeVisible()
})

test('transfer shows source → destination account names', async () => {
  const row = transactionRowFor(page, 'ATM Withdrawal')
  await expect(row.getByText('Test Bank')).toBeVisible()
  await expect(row.getByText('Test Cash')).toBeVisible()
})

// ── Edit transaction ────────────────────────────────────────────────────

test('click transaction row opens edit modal', async () => {
  await transactionRowFor(page, 'Starbucks').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Edit Transaction' })).toBeVisible()
})

test('edit modal is pre-filled with existing values', async () => {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Merchant')).toHaveValue('Starbucks')
  await expect(dialog.getByLabel('Amount')).toHaveValue('125.5')
})

test('update merchant and amount, save', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Merchant').fill('Costa Coffee')
  await dialog.getByLabel('Amount').fill('98.00')
  await dialog.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Costa Coffee')).toBeVisible()
  await expect(transactionRowFor(page, 'Starbucks')).not.toBeVisible()
})

test('updated amount is reflected in the summary', async () => {
  // Expense is now 98.00, net = 5000 - 98 = 4902
  await expect(page.getByText('RM 98.00').first()).toBeVisible()
  await expect(page.getByText('RM 4,902.00')).toBeVisible()
})

// ── Delete transaction ──────────────────────────────────────────────────

test('delete transaction — hover reveals delete button, modal confirms', async () => {
  const row = transactionRowFor(page, 'Costa Coffee')
  await row.hover()
  await row.getByRole('button', { name: 'Delete transaction' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText(/Delete Transaction|Are you sure/)).toBeVisible()
})

test('confirm delete removes the transaction', async () => {
  await page.getByRole('button', { name: /Delete/ }).last().click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Costa Coffee')).not.toBeVisible()
})

// ── Filters ─────────────────────────────────────────────────────────────

test('filter by type: Income shows only income transactions', async () => {
  await page.getByLabel('Type').selectOption('income')
  await expect(transactionRowFor(page, 'Acme Corp')).toBeVisible()
  await expect(transactionRowFor(page, 'ATM Withdrawal')).not.toBeVisible()
})

test('filter by type: Expense shows only expense transactions', async () => {
  await page.getByLabel('Type').selectOption('expense')
  await expect(transactionRowFor(page, 'ATM Withdrawal')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()
  // No expense transactions remain (we deleted Costa Coffee)
  await expect(page.getByText(/No transactions match/)).toBeVisible()
})

test('filter by type: Transfer shows only transfers', async () => {
  await page.getByLabel('Type').selectOption('transfer')
  await expect(transactionRowFor(page, 'ATM Withdrawal')).toBeVisible()
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()
})

test('reset type filter to All Types', async () => {
  await page.getByLabel('Type').selectOption('all')
  // Both Acme Corp (income) and ATM Withdrawal (transfer) visible
  await expect(transactionRowFor(page, 'Acme Corp')).toBeVisible()
  await expect(transactionRowFor(page, 'ATM Withdrawal')).toBeVisible()
})

test('filter by date range: future From date yields no results', async () => {
  await page.getByLabel('From').fill('2030-01-01')
  await expect(page.getByText(/No transactions match/)).toBeVisible()
})

test('clear date filter restores transactions', async () => {
  await page.getByLabel('From').fill('')
  await expect(transactionRowFor(page, 'Acme Corp')).toBeVisible()
})

test('filter by account: Test Cash shows only cash account transactions', async () => {
  await page.getByLabel('Account').selectOption('Test Cash')
  await expect(transactionRowFor(page, 'ATM Withdrawal')).toBeVisible()
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()
  await page.getByLabel('Account').selectOption('')
})

test('filter by tag: "coffee" shows tagged transaction', async () => {
  // Add a new expense with tag first
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '12',
    account: 'Test Bank',
    merchant: 'Kopitiam',
    tag: 'coffee',
  })
  // Wait for dialog to fully close before touching the filter bar
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByLabel('Tag').fill('coffee')
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible()
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()
})

test('clear tag filter restores all transactions', async () => {
  await page.getByLabel('Tag').fill('')
  await expect(transactionRowFor(page, 'Acme Corp')).toBeVisible()
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible()
})

// ── Date grouping headers ────────────────────────────────────────────────

test('transactions are grouped by date with day headers', async () => {
  // Transactions from different dates should have date header rows
  await expect(page.getByText('14 Jan 2026')).toBeVisible()
  await expect(page.getByText('16 Jan 2026')).toBeVisible()
})

// ── Account balance reflects transactions ────────────────────────────────

test('account balance updates to reflect transactions', async () => {
  await page.getByRole('link', { name: 'Accounts' }).click()
  // Test Bank: income 5000 - transfer 500 - expense 12 = 4488
  const bankCard = accountCardFor(page, 'Test Bank')
  await expect(bankCard.getByText(/RM\s4,488\.00/)).toBeVisible()
  // Test Cash: received 500 from transfer
  const cashCard = accountCardFor(page, 'Test Cash')
  await expect(cashCard.getByText(/RM\s500\.00/)).toBeVisible()
})
