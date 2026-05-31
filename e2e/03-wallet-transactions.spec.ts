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

test('account is pre-selected and amount must be > 0', async () => {
  const dialog = page.getByRole('dialog')
  // The account now defaults to the first account, so it is never empty when
  // accounts exist — only the amount needs validating.
  await expect(dialog.locator('#account')).not.toHaveValue('')
  await dialog.getByRole('button', { name: /Add Transaction/ }).click()
  await expect(dialog.getByText(/Amount must be greater than 0/)).toBeVisible()
  await expect(dialog.getByText(/Select an account/)).toHaveCount(0)
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
    tags: ['coffee'],
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
  // Net summary; the total-balance banner can show the same figure, so .first().
  await expect(page.getByText('RM 4,874.50').first()).toBeVisible()
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
  await expect(page.getByText('RM 4,902.00').first()).toBeVisible()
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
    tags: ['coffee'],
  })
  // Wait for dialog to fully close before touching the filter bar
  await expect(page.getByRole('dialog')).not.toBeVisible()
  // TagInput filter bar: type to filter suggestions, arrow-down to highlight, Enter to select
  const tagFilterInput = page.getByPlaceholder('Filter by tags...')
  await tagFilterInput.click()
  await tagFilterInput.fill('coffee')
  await tagFilterInput.press('ArrowDown')
  await tagFilterInput.press('Enter')
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible()
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()
})

test('clear tag filter restores all transactions', async () => {
  await page.getByLabel('Remove coffee').click()
  await expect(transactionRowFor(page, 'Acme Corp')).toBeVisible()
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible()
})

test('tag filter works standalone without other filters (no category/account required)', async () => {
  // Ensure no category or account filter is active
  await page.getByLabel('Account').selectOption('')
  await page.getByLabel('Category').selectOption('')
  // Filter by coffee tag alone — should return only Kopitiam
  const filterTagInput = page.locator('#filter-tags')
  await filterTagInput.click()
  await filterTagInput.fill('coffee')
  await filterTagInput.press('ArrowDown')
  await filterTagInput.press('Enter')
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible()
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()
  await page.getByLabel('Remove coffee').click()
})

test('tag filter uses OR logic: selecting multiple tags shows transactions matching any', async () => {
  // Add a second transaction with a different tag
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '30',
    account: 'Test Bank',
    merchant: 'Bistro',
    tags: ['food'],
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // Use #filter-tags id to locate the filter bar TagInput reliably
  // (placeholder disappears after the first tag is selected)
  const filterTagInput = page.locator('#filter-tags')

  // Select 'coffee' tag
  await filterTagInput.click()
  await filterTagInput.fill('coffee')
  await filterTagInput.press('ArrowDown')
  await filterTagInput.press('Enter')
  // Wait for transactions to reload after first tag filter
  await page.waitForTimeout(500)
  // Select 'food' tag (OR condition) — click again to re-open dropdown
  await filterTagInput.click()
  await filterTagInput.fill('food')
  await filterTagInput.press('ArrowDown')
  await filterTagInput.press('Enter')

  // Both transactions should appear (OR logic)
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible()
  await expect(transactionRowFor(page, 'Bistro')).toBeVisible()
  // Transaction without either tag should not appear
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()

  // Clear both tags
  await page.getByLabel('Remove coffee').click()
  await page.getByLabel('Remove food').click()
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
  // Test Bank: income 5000 - transfer 500 - expense 12 (Kopitiam) - expense 30 (Bistro) = 4458
  const bankCard = accountCardFor(page, 'Test Bank')
  await expect(bankCard.getByText(/RM\s4,458\.00/)).toBeVisible()
  // Test Cash: received 500 from transfer
  const cashCard = accountCardFor(page, 'Test Cash')
  await expect(cashCard.getByText(/RM\s500\.00/)).toBeVisible()
})

// ── Quick date filters ───────────────────────────────────────────────────

test('quick filter "This Month" sets date range to current month', async () => {
  await page.getByRole('link', { name: 'Transactions' }).click()
  await page.getByTestId('filter-this-month').click()

  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  await expect(page.getByLabel('From')).toHaveValue(firstDay)
  await expect(page.getByLabel('To')).toHaveValue(lastDay)
})

test('quick filter "Last Month" sets date range to previous month', async () => {
  await page.getByTestId('filter-last-month').click()

  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10)
  const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10)
  await expect(page.getByLabel('From')).toHaveValue(firstDay)
  await expect(page.getByLabel('To')).toHaveValue(lastDay)
})

test('quick filter "All Time" clears date range', async () => {
  // Date filters are currently set from last test; clear them
  await page.getByTestId('filter-clear-dates').click()
  await expect(page.getByLabel('From')).toHaveValue('')
  await expect(page.getByLabel('To')).toHaveValue('')
})

// ── Multi-select delete ──────────────────────────────────────────────────

test('Select button enters select mode and shows action bar', async () => {
  await page.getByRole('button', { name: 'Select' }).click()
  await expect(page.getByTestId('select-mode-bar')).toBeVisible()
  await expect(page.getByText('Select transactions')).toBeVisible()
})

test('clicking a transaction row in select mode checks the checkbox', async () => {
  // Click a transaction row — should select it, not open edit form
  await transactionRowFor(page, 'Acme Corp').click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('1 selected')).toBeVisible()
})

test('selecting another row updates the count', async () => {
  await transactionRowFor(page, 'ATM Withdrawal').click()
  await expect(page.getByText('2 selected')).toBeVisible()
})

test('Delete button in action bar opens confirmation modal', async () => {
  await page.getByTestId('bulk-delete-btn').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText(/Delete 2 selected/)).toBeVisible()
})

test('confirming bulk delete removes the selected transactions', async () => {
  await page.getByTestId('confirm-bulk-delete').click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByTestId('select-mode-bar')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()
  await expect(transactionRowFor(page, 'ATM Withdrawal')).not.toBeVisible()
  // Kopitiam expense added in the tag filter tests should still be here
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible()
})

test('Cancel exits select mode without deleting', async () => {
  await page.getByRole('button', { name: 'Select' }).click()
  await expect(page.getByTestId('select-mode-bar')).toBeVisible()
  await transactionRowFor(page, 'Kopitiam').click()
  await expect(page.getByText('1 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('select-mode-bar')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible()
})

// ── Split transaction ────────────────────────────────────────────────────

test('hover on transaction row reveals the Split (scissors) button', async () => {
  await transactionRowFor(page, 'Kopitiam').hover()
  await expect(transactionRowFor(page, 'Kopitiam').getByTestId('split-transaction-btn')).toBeVisible()
})

test('clicking Split opens the Split Transaction modal', async () => {
  await transactionRowFor(page, 'Kopitiam').hover()
  await transactionRowFor(page, 'Kopitiam').getByTestId('split-transaction-btn').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Split Transaction' })).toBeVisible()
})

test('split modal shows two part inputs with amounts summing to original', async () => {
  const dialog = page.getByRole('dialog')
  // Default: each part is half of original (12 / 2 = 6)
  await expect(dialog.locator('#split-amount-0')).toBeVisible()
  await expect(dialog.locator('#split-amount-1')).toBeVisible()
  // Total indicator shows a checkmark because the halves sum to the original
  await expect(dialog.getByText('✓')).toBeVisible()
})

test('changing amount in part 0 auto-updates part 1 to keep total', async () => {
  const dialog = page.getByRole('dialog')
  const part0Amount = dialog.locator('#split-amount-0')
  await part0Amount.fill('8')
  await part0Amount.blur()
  // Part 1 should now show 4 (12 - 8)
  const part1Amount = dialog.locator('#split-amount-1')
  await expect(part1Amount).toHaveValue('4')
  // Checkmark shows totals match
  await expect(dialog.getByText('✓')).toBeVisible()
})

test('confirming split creates two transactions and removes the original', async () => {
  await page.getByTestId('confirm-split-btn').click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  // Original Kopitiam is replaced by two new Kopitiam rows
  const rows = page.locator('[data-testid="transaction-row"]').filter({ hasText: 'Kopitiam' })
  await expect(rows).toHaveCount(2)
})
