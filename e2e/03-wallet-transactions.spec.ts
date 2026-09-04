/**
 * Wallet — Transactions end-to-end tests.
 * Covers: add/edit/delete expense, income, transfer; summary row; all filters.
 * Creates its own accounts in beforeAll so this file is fully self-contained.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, accountCardFor, transactionRowFor, openTransactionRowMenu, fillAccountForm, fillTransactionForm, openBlankTransactionForm, navTo, selectFilterOption, selectFilterOptionByLabel, clearFilterOption } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

/** Format a Date as YYYY-MM-DD in LOCAL time — toISOString() shifts the day
 *  back in UTC+ timezones, which is not how the app computes month bounds. */
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The occasional filters (Type/Account/Category/Tags) live in the collapsible
 *  Filters section of the §6.4 bar — open it if it isn't already. */
async function ensureFiltersOpen() {
  if (!(await page.getByTestId('filter-panel').isVisible())) {
    await page.getByTestId('filter-toggle').click()
  }
}

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
  await navTo(page, 'transactions')
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(page.locator('main').getByRole('heading', { name: 'Transactions' })).toBeVisible()
  // Clear the default current-month date filters so transactions with past dates are visible
  await page.getByTestId('filter-clear-dates').click()
})

test('shows "No transactions" placeholder when list is empty', async () => {
  // There are accounts but no transactions
  await expect(page.getByTestId('transactions-empty')).toBeVisible()
})

// ── Add expense ────────────────────────────────────────────────────────

test('open Add Transaction modal', async () => {
  await openBlankTransactionForm(page)
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
  await openBlankTransactionForm(page)
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
  await expect(row.getByTestId('transaction-row-amount')).toHaveText(/RM\s125\.50/)
  await expect(row.getByTestId('transaction-row-amount')).toHaveClass(/text-red-600/)
})

test('expense shows category badge', async () => {
  const row = transactionRowFor(page, 'Starbucks')
  await expect(row.getByTestId('transaction-row-category')).toHaveText('Food & Drink')
})

// ── Add income ─────────────────────────────────────────────────────────

test('add an income transaction', async () => {
  await openBlankTransactionForm(page)
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
  await expect(row.getByTestId('transaction-row-amount')).toHaveText(/RM\s5,000\.00/)
  await expect(row.getByTestId('transaction-row-amount')).toHaveClass(/text-positive-600/)
})

// ── Summary row ────────────────────────────────────────────────────────

test('summary row shows correct income, expense and net', async () => {
  // Income = 5000, Expense = 125.50, Net = 4874.50 — anchored to the summary
  // tiles so the total-balance banner sharing a figure can't satisfy them.
  await expect(page.getByTestId('summary-income')).toContainText('RM 5,000.00')
  await expect(page.getByTestId('summary-expense')).toContainText('RM 125.50')
  await expect(page.getByTestId('summary-net')).toContainText('RM 4,874.50')
})

// ── Add transfer ────────────────────────────────────────────────────────

test('add a transfer between accounts', async () => {
  await openBlankTransactionForm(page)
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
  await expect(row.getByTestId('transaction-row-amount')).toHaveText(/RM\s500\.00/)
  await expect(row.getByTestId('transaction-row-amount')).toHaveClass(/text-blue-600/)
})

test('transfer does NOT affect income/expense summary', async () => {
  // Income still 5000, expense still 125.50 — transfer is excluded from totals
  await expect(page.getByTestId('summary-income')).toContainText('RM 5,000.00')
  await expect(page.getByTestId('summary-expense')).toContainText('RM 125.50')
})

test('transfer shows source → destination account names', async () => {
  const row = transactionRowFor(page, 'ATM Withdrawal')
  await expect(row.getByTestId('transaction-row-account')).toHaveText('Test Bank')
  await expect(row.getByTestId('transaction-row-dest-account')).toHaveText('Test Cash')
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
  await expect(page.getByTestId('summary-expense')).toContainText('RM 98.00')
  await expect(page.getByTestId('summary-net')).toContainText('RM 4,902.00')
})

// ── Delete transaction ──────────────────────────────────────────────────

test('delete transaction — via the row\'s ⋯ menu, removes immediately with undo toast', async () => {
  await openTransactionRowMenu(page, 'Costa Coffee')
  await page.getByRole('menuitem', { name: 'Delete transaction' }).click()
  // No confirm dialog — the row disappears at once and an undo toast appears.
  await expect(transactionRowFor(page, 'Costa Coffee')).not.toBeVisible()
  await expect(page.getByText('Transaction deleted')).toBeVisible()
})

test('deleted transaction stays gone when the undo toast is not used', async () => {
  await expect(transactionRowFor(page, 'Costa Coffee')).not.toBeVisible()
})

// ── Filters ─────────────────────────────────────────────────────────────

test('filter by type: Income shows only income transactions', async () => {
  await ensureFiltersOpen()
  await selectFilterOption(page, 'filter-type', 'income')
  await expect(transactionRowFor(page, 'Acme Corp')).toBeVisible()
  await expect(transactionRowFor(page, 'ATM Withdrawal')).not.toBeVisible()
})

test('filter by type: Expense shows only expense transactions', async () => {
  await clearFilterOption(page, 'filter-type')
  await selectFilterOption(page, 'filter-type', 'expense')
  await expect(transactionRowFor(page, 'ATM Withdrawal')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()
  // No expense transactions remain (we deleted Costa Coffee)
  await expect(page.getByTestId('transactions-empty')).toBeVisible()
})

test('filter by type: Transfer shows only transfers', async () => {
  await clearFilterOption(page, 'filter-type')
  await selectFilterOption(page, 'filter-type', 'transfer')
  await expect(transactionRowFor(page, 'ATM Withdrawal')).toBeVisible()
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()
})

test('reset type filter to All Types', async () => {
  await clearFilterOption(page, 'filter-type')
  // Both Acme Corp (income) and ATM Withdrawal (transfer) visible
  await expect(transactionRowFor(page, 'Acme Corp')).toBeVisible()
  await expect(transactionRowFor(page, 'ATM Withdrawal')).toBeVisible()
})

test('filter by date range: future From date yields no results', async () => {
  // From/To live behind the Custom… segment of the date-range control
  await page.getByTestId('filter-custom-range').click()
  await page.getByTestId('filter-from').fill('2030-01-01')
  // The empty state names the active range and offers to widen it, rather than
  // the generic "no match" that left the date filter as an unstated cause.
  await expect(page.getByTestId('transactions-empty')).toContainText('2030-01-01')
  await expect(page.getByTestId('empty-show-all-time')).toBeVisible()
})

test('clear date filter restores transactions', async () => {
  await page.getByTestId('filter-from').fill('')
  await expect(transactionRowFor(page, 'Acme Corp')).toBeVisible()
})

test('filter by account: Test Cash shows only cash account transactions', async () => {
  // The Filters popup closes on any outside click (search, chips, the
  // date-range control above all reopen the panel-free, so it doesn't
  // silently stay up across unrelated actions) — reopen it here rather than
  // assuming it survived from an earlier test.
  await ensureFiltersOpen()
  await selectFilterOptionByLabel(page, 'filter-account', 'Test Cash')
  await expect(transactionRowFor(page, 'ATM Withdrawal')).toBeVisible()
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()
  await clearFilterOption(page, 'filter-account')
})

test('filter by tag: "coffee" shows tagged transaction', async () => {
  // Add a new expense with tag first
  await openBlankTransactionForm(page)
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
  await ensureFiltersOpen()
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
  await ensureFiltersOpen()
  await clearFilterOption(page, 'filter-account')
  await clearFilterOption(page, 'filter-category')
  // Filter by coffee tag alone — should return only Kopitiam
  const filterTagInput = page.getByTestId('filter-tags')
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
  await openBlankTransactionForm(page)
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '30',
    account: 'Test Bank',
    merchant: 'Bistro',
    tags: ['food'],
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // The placeholder disappears after the first tag is selected, so anchor on testid.
  await ensureFiltersOpen()
  const filterTagInput = page.getByTestId('filter-tags')

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
  // Transactions from different dates should have date header rows. Anchored to
  // the day-header seam so a weekday/date split in the reskin can't strand the
  // date text in a sibling element and fail a bare getByText.
  await expect(page.getByTestId('day-header').filter({ hasText: '14 Jan 2026' })).toBeVisible()
  await expect(page.getByTestId('day-header').filter({ hasText: '16 Jan 2026' })).toBeVisible()
})

// ── Account balance reflects transactions ────────────────────────────────

test('account balance updates to reflect transactions', async () => {
  await navTo(page, 'accounts')
  // Test Bank: income 5000 - transfer 500 - expense 12 (Kopitiam) - expense 30 (Bistro) = 4458
  const bankCard = accountCardFor(page, 'Test Bank')
  await expect(bankCard.getByTestId('account-card-balance')).toHaveText(/RM\s4,458\.00/)
  // Test Cash: received 500 from transfer
  const cashCard = accountCardFor(page, 'Test Cash')
  await expect(cashCard.getByTestId('account-card-balance')).toHaveText(/RM\s500\.00/)
})

// ── Quick date filters ───────────────────────────────────────────────────

test('date range "This month" is applied and shown as active', async () => {
  await navTo(page, 'transactions')
  await page.getByTestId('filter-this-month').click()
  await expect(page.getByTestId('filter-this-month')).toHaveClass(/bg-brand/)

  // Custom… reveals From/To without changing the range — values are the month bounds
  await page.getByTestId('filter-custom-range').click()
  const now = new Date()
  const firstDay = localISO(new Date(now.getFullYear(), now.getMonth(), 1))
  const lastDay = localISO(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  await expect(page.getByTestId('filter-from')).toHaveValue(firstDay)
  await expect(page.getByTestId('filter-to')).toHaveValue(lastDay)
})

test('date range "Last month" sets the previous month bounds', async () => {
  await page.getByTestId('filter-last-month').click()
  await expect(page.getByTestId('filter-last-month')).toHaveClass(/bg-brand/)

  await page.getByTestId('filter-custom-range').click()
  const now = new Date()
  const firstDay = localISO(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const lastDay = localISO(new Date(now.getFullYear(), now.getMonth(), 0))
  await expect(page.getByTestId('filter-from')).toHaveValue(firstDay)
  await expect(page.getByTestId('filter-to')).toHaveValue(lastDay)
})

test('date range "All time" clears the date range', async () => {
  // Date filters are currently set from last test; clear them
  await page.getByTestId('filter-clear-dates').click()
  await expect(page.getByTestId('filter-clear-dates')).toHaveClass(/bg-brand/)
  await page.getByTestId('filter-custom-range').click()
  await expect(page.getByTestId('filter-from')).toHaveValue('')
  await expect(page.getByTestId('filter-to')).toHaveValue('')
})

// ── Multi-select delete ──────────────────────────────────────────────────
// Every row's checkbox is always visible (no separate "select mode" to
// enter) — checking one is what surfaces the floating bulk-action-bar.

test('checking a transaction row selects it and shows the action bar', async () => {
  await page.getByRole('checkbox', { name: 'Select Acme Corp' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByTestId('bulk-action-bar')).toBeVisible()
  await expect(page.getByText('1 selected')).toBeVisible()
})

test('selecting another row updates the count', async () => {
  await page.getByRole('checkbox', { name: 'Select ATM Withdrawal' }).click()
  await expect(page.getByText('2 selected')).toBeVisible()
})

test('Delete button in action bar opens confirmation modal', async () => {
  await page.getByTestId('bulk-action-bar').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Delete 2 transactions?' })).toBeVisible()
})

test('confirming bulk delete removes the selected transactions', async () => {
  await page.getByTestId('confirm-bulk-delete').click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByTestId('bulk-action-bar')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Acme Corp')).not.toBeVisible()
  await expect(transactionRowFor(page, 'ATM Withdrawal')).not.toBeVisible()
  // Kopitiam expense added in the tag filter tests should still be here
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible()
})

test('Clear selection deselects without deleting', async () => {
  await page.getByRole('checkbox', { name: 'Select Kopitiam' }).click()
  await expect(page.getByTestId('bulk-action-bar')).toBeVisible()
  await expect(page.getByText('1 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Clear selection' }).click()
  await expect(page.getByTestId('bulk-action-bar')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Kopitiam')).toBeVisible()
})

// ── Tag filter combined with date range (regression) ─────────────────────

test('tag filter works when Last Month date range is active', async () => {
  // Compute last-month date string dynamically so the test never needs updating.
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15)
  const lastMonthDate = lastMonth.toISOString().slice(0, 10)

  // Add two transactions dated last month: one tagged, one untagged.
  await page.getByTestId('filter-clear-dates').click()

  await openBlankTransactionForm(page)
  await fillTransactionForm(page, {
    type: 'Expense',
    date: lastMonthDate,
    amount: '50',
    account: 'Test Bank',
    merchant: 'Brewers Coffee',
    tags: ['lastmonthtag'],
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await openBlankTransactionForm(page)
  await fillTransactionForm(page, {
    type: 'Expense',
    date: lastMonthDate,
    amount: '75',
    account: 'Test Bank',
    merchant: 'Monthly Grocery',
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // Both transactions should be visible with no date filter.
  await expect(transactionRowFor(page, 'Brewers Coffee')).toBeVisible()
  await expect(transactionRowFor(page, 'Monthly Grocery')).toBeVisible()

  // Apply Last Month date filter.
  await page.getByTestId('filter-last-month').click()
  await expect(transactionRowFor(page, 'Brewers Coffee')).toBeVisible()
  await expect(transactionRowFor(page, 'Monthly Grocery')).toBeVisible()

  // Now apply the tag filter — only the tagged transaction should remain.
  await ensureFiltersOpen()
  const filterTagInput = page.getByTestId('filter-tags')
  await filterTagInput.click()
  await filterTagInput.fill('lastmonthtag')
  await filterTagInput.press('ArrowDown')
  await filterTagInput.press('Enter')
  await page.waitForTimeout(500)

  await expect(transactionRowFor(page, 'Brewers Coffee')).toBeVisible()
  await expect(transactionRowFor(page, 'Monthly Grocery')).not.toBeVisible()

  // Clean up: remove tag filter and clear date range so later tests see all rows.
  await page.getByLabel('Remove lastmonthtag').click()
  await page.getByTestId('filter-clear-dates').click()
})

test('tag filter works when a legacy tag="" row exists in the same date range', async () => {
  // Inject a row with tag='' directly into the DB — simulates data created before
  // multi-tag support where SQLite stored the default empty string.
  // Before the fix, json_each('') throws and breaks the entire filter query.
  await page.request.post('/api/test/inject-legacy-tag-row')

  // Reload so the page fetches the freshly injected row. The store resets to
  // "This Month" on reload, so immediately switch to All Time to see all rows.
  await page.reload()
  await page.waitForSelector('main')
  await page.getByTestId('filter-clear-dates').click()

  // The injected row ("Legacy Row") should be visible in All Time view.
  await expect(transactionRowFor(page, 'Legacy Row')).toBeVisible()

  // Applying any tag filter must NOT crash (if it did, the list would stay unchanged).
  await ensureFiltersOpen()
  const filterTagInput = page.getByTestId('filter-tags')
  await filterTagInput.click()
  await filterTagInput.fill('lastmonthtag')
  await filterTagInput.press('ArrowDown')
  await filterTagInput.press('Enter')
  await page.waitForTimeout(500)

  // "Legacy Row" has no tag — it must be filtered out.
  // "Brewers Coffee" has the 'lastmonthtag' tag — it must be visible.
  await expect(transactionRowFor(page, 'Legacy Row')).not.toBeVisible()
  await expect(transactionRowFor(page, 'Brewers Coffee')).toBeVisible()

  // Clean up.
  await page.getByLabel('Remove lastmonthtag').click()
})

// ── Split transaction ────────────────────────────────────────────────────

// U-07: a user with no household group has nobody to split with, so the split
// (scissors) affordance is hidden rather than leading to a dead-end dialog. The
// full split flow (with a group) is covered in 35-splits.spec.ts.
test('the Split button is hidden for a user with no household group (U-07)', async () => {
  await openTransactionRowMenu(page, 'Kopitiam')
  await expect(page.getByTestId('split-transaction-btn')).toHaveCount(0)
  await page.keyboard.press('Escape')
})

// ── §1.1 regression: default date filters are TZ-safe ────────────────────

test('default From/To equal the current month bounds in a UTC+8 timezone', async ({ browser }) => {
  // With the old toISOString()-based default, a UTC+ browser rendered From as
  // the last day of the previous month and To as the day before month-end.
  const context = await browser.newContext({ timezoneId: 'Asia/Kuala_Lumpur' })
  const pg = await context.newPage()
  await pg.request.post('/api/auth/signup', {
    data: { username: `e2e_tz_${Date.now()}`, password: 'test-password' },
  })
  // The filter bar only renders once an account exists.
  await pg.request.post('/api/accounts', {
    data: { name: 'TZ Account', type: 'cash' },
  })
  await pg.goto('/wallet')
  await expect(pg.locator('main')).toBeVisible({ timeout: 20_000 })

  // Expected bounds computed in the page's own timezone with local arithmetic.
  const expected = await pg.evaluate(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    const pad = (n: number) => String(n).padStart(2, '0')
    const last = new Date(y, m + 1, 0).getDate()
    return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` }
  })
  // Custom… opens the From/To editors pre-filled with the active (default) range.
  await pg.getByTestId('filter-custom-range').click()
  await expect(pg.getByTestId('filter-from')).toHaveValue(expected.from)
  await expect(pg.getByTestId('filter-to')).toHaveValue(expected.to)
  await context.close()
})
