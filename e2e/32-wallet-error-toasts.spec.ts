/**
 * Wave 5 — C3 error toasts.
 *
 * Forces mutation requests to fail via page.route() (the only reliable way to
 * exercise the failure path) and asserts the wallet CRUD pages surface the
 * server's error message as a toast instead of failing silently, while the
 * relevant form/confirm modal stays open so the user can retry.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import {
  newAppPage,
  businessDatePlus,
  businessToday,
  openBlankTransactionForm,
  fillTransactionForm,
  fillAccountForm,
  accountCardFor,
  enableAccountManageMode,
  transactionRowFor,
  openTransactionRowMenu,
  selectAllVisibleTransactions,
} from './helpers'

test.describe.configure({ mode: 'serial' })

const API = '/api'

let page: Page
let accountId: string

/** Fulfil the next matching request with a 500 + {error} body, once. */
async function force500Once(page: Page, urlGlob: string, method: string, errorMessage: string) {
  await page.route(urlGlob, async (route) => {
    if (route.request().method() !== method) return route.continue()
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: errorMessage }),
    })
    await page.unroute(urlGlob)
  })
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet')
  const res = await page.request.post(`${API}/accounts`, {
    data: { name: 'Toast Bank', type: 'bank', openingBalance: 100 },
  })
  expect(res.status()).toBe(201)
  accountId = (await res.json()).id
})

test.afterAll(async () => {
  await page.context().close()
})

test('failed transaction save shows an error toast and keeps the form open', async () => {
  await page.goto('/wallet')
  await force500Once(page, `${API}/transactions`, 'POST', 'transaction save exploded')

  await openBlankTransactionForm(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('25')
  await dialog.locator('#account').selectOption('Toast Bank')
  await dialog.getByLabel('Merchant').fill('Failing Merchant')
  await dialog.getByRole('button', { name: 'Add Transaction' }).click()

  await expect(page.getByTestId('toast')).toContainText('transaction save exploded')
  await expect(dialog).toBeVisible()
})

test('failed budget delete shows an error toast and keeps the row', async () => {
  const cats = await (await page.request.get(`${API}/categories`)).json()
  const categoryId = cats[0].id
  const budgetRes = await page.request.post(`${API}/budgets`, {
    data: { categoryId, limitAmount: 200 },
  })
  expect(budgetRes.status()).toBe(201)

  await page.goto('/wallet/budgets')
  const row = page.getByTestId('budget-row').first()
  await expect(row).toBeVisible()

  await force500Once(page, `${API}/budgets/*`, 'DELETE', 'budget delete exploded')
  await row.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Confirm' }).click()

  await expect(page.getByTestId('toast')).toContainText('budget delete exploded')
  await expect(page.getByTestId('budget-row').first()).toBeVisible()
})

test('failed goal save shows an error toast and keeps the form open', async () => {
  await page.goto('/wallet/goals')
  await force500Once(page, `${API}/goals`, 'POST', 'goal save exploded')

  await page.getByRole('button', { name: 'Add Goal' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Goal name').fill('Failing Goal')
  await dialog.getByLabel('Target amount').fill('1000')
  await dialog.locator('#account').selectOption('Toast Bank')
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByTestId('toast')).toContainText('goal save exploded')
  await expect(dialog).toBeVisible()
})

test('failed recurring rule delete shows an error toast and keeps the row', async () => {
  const recRes = await page.request.post(`${API}/recurring-transactions`, {
    data: {
      accountId,
      amount: 50,
      merchant: 'Toast Subscription',
      type: 'expense',
      frequency: 'monthly',
      // Relative, not a literal. This was '2026-08-01', which worked until the
      // day arrived: a rule whose next due date is today is due, and a due rule
      // is processed on load, so the row under test changed out from under it.
      // A test that starts failing on a calendar date rather than on a change
      // is worse than no test.
      nextDueDate: businessDatePlus(30),
    },
  })
  expect(recRes.status()).toBe(201)

  await page.goto('/wallet/recurring')
  const row = page.getByTestId('recurring-row').filter({ hasText: 'Toast Subscription' })
  await expect(row).toBeVisible()

  await force500Once(page, `${API}/recurring-transactions/*`, 'DELETE', 'recurring delete exploded')
  await row.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Confirm' }).click()

  await expect(page.getByTestId('toast')).toContainText('recurring delete exploded')
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'Toast Subscription' })).toBeVisible()
})

// ── FEAT-009: the previously-silent gaps ─────────────────────────────────
// Every case below used to fail with no signal at all (a `.catch(() => {})`
// or a `.catch(() => [])`) — CLAUDE.md rule 10. Each now surfaces a toast.

test('failed sharing-groups load shows an error toast when editing an account', async () => {
  await page.goto('/wallet/accounts')
  await enableAccountManageMode(page)
  await force500Once(page, `${API}/groups`, 'GET', 'sharing groups exploded')
  await accountCardFor(page, 'Toast Bank').getByRole('button', { name: 'Edit account' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('sharing groups exploded')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('failed groups check on the transactions page shows an error toast', async () => {
  await force500Once(page, `${API}/groups`, 'GET', 'groups check exploded')
  await page.goto('/wallet')
  await expect(page.getByTestId('toast')).toContainText('groups check exploded')
})

test('bulk split: a failed per-transaction split fetch shows an error toast', async () => {
  const today = businessToday()
  // Deliberately a single transaction: BulkSplitDialog fires one splits-GET
  // per selected row concurrently, and force500Once only intercepts the
  // first matching in-flight request before unrouting — with 2+ rows, both
  // requests can land before the unroute takes effect, firing the toast
  // twice and failing this assertion on a strict-mode multi-match.
  await page.request.post(`${API}/transactions`, {
    data: { accountId, date: today, merchant: 'Bulk Split A', amount: 20, type: 'expense', tag: '[]' },
  })

  await page.goto('/wallet')
  await expect(transactionRowFor(page, 'Bulk Split A')).toBeVisible()
  await selectAllVisibleTransactions(page)

  await force500Once(page, `${API}/transactions/*/splits`, 'GET', 'split fetch exploded')
  await page.getByTestId('bulk-split-btn').click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('split fetch exploded')

  await page.keyboard.press('Escape')
})

test('bulk split: a failed group-members fetch shows an error toast (previously an unhandled rejection)', async () => {
  // Selection from the previous test is still active — WalletPage keeps
  // BulkSplitDialog mounted and re-runs loadData() whenever it reopens.
  // Deliberately no page.goto here (that's what the next test's re-fetch is
  // exercising) — so wait out the previous test's still-visible toast first,
  // rather than risk a strict-mode multi-match against this one's.
  await expect(page.getByTestId('toast')).toHaveCount(0)
  await force500Once(page, `${API}/groups/members`, 'GET', 'members fetch exploded')
  await page.getByTestId('bulk-split-btn').click()

  await expect(page.getByTestId('toast')).toContainText('members fetch exploded')

  await page.keyboard.press('Escape')
})

test('single split: a failed existing-split fetch shows an error toast', async () => {
  // The single-row "Split transaction" menu item only renders once
  // WalletPage's `hasGroups` is true (TransactionList.tsx: onSplit is
  // undefined with no group to split with) — bulk split has no such gate.
  await page.request.post(`${API}/groups`, { data: { name: 'Toast Household' } })
  await page.request.post(`${API}/transactions`, {
    data: { accountId, date: businessToday(), merchant: 'Solo Split Target', amount: 15, type: 'expense', tag: '[]' },
  })

  await page.goto('/wallet')
  await expect(transactionRowFor(page, 'Solo Split Target')).toBeVisible()

  await force500Once(page, `${API}/transactions/*/splits`, 'GET', 'solo split fetch exploded')
  await openTransactionRowMenu(page, 'Solo Split Target')
  await page.getByRole('menuitem', { name: 'Split transaction' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('solo split fetch exploded')

  await page.keyboard.press('Escape')
})

test('single split: a failed group-members fetch shows an error toast (previously an unhandled rejection)', async () => {
  await page.goto('/wallet')
  await expect(transactionRowFor(page, 'Solo Split Target')).toBeVisible()

  await force500Once(page, `${API}/groups/members`, 'GET', 'solo members fetch exploded')
  await openTransactionRowMenu(page, 'Solo Split Target')
  await page.getByRole('menuitem', { name: 'Split transaction' }).click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('solo members fetch exploded')

  await page.keyboard.press('Escape')
})

test('dashboard: a failed member-count fetch shows a low-key error toast', async () => {
  await page.request.post(`${API}/groups`, { data: { name: 'Toast Household' } })

  await force500Once(page, `${API}/groups/*/members`, 'GET', 'member count fetch exploded')
  await page.goto('/wallet/dashboard')

  await expect(page.getByTestId('toast')).toContainText('member count fetch exploded')
})

test('edit form: a failed transfer-link search shows an error toast', async () => {
  await page.request.post(`${API}/transactions`, {
    data: { accountId, date: businessToday(), merchant: 'Toast Hook Test', amount: 65, type: 'expense', tag: '[]' },
  })

  await page.goto('/wallet')
  await expect(transactionRowFor(page, 'Toast Hook Test')).toBeVisible()

  await force500Once(page, `${API}/transactions?dateFrom=*&type=*`, 'GET', 'transfer link search exploded')
  await openTransactionRowMenu(page, 'Toast Hook Test')
  await page.getByRole('menuitem', { name: 'Edit transaction' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('transfer link search exploded')

  await page.keyboard.press('Escape')
})

test('create form: a failed transfer-match search shows an error toast', async () => {
  await page.goto('/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Toast Bank B', type: 'bank' })

  await page.goto('/wallet')
  await openBlankTransactionForm(page)
  await force500Once(page, `${API}/transactions?dateFrom=*&type=*`, 'GET', 'transfer match search exploded')
  await fillTransactionForm(page, {
    type: 'Transfer', amount: '42', account: 'Toast Bank', toAccount: 'Toast Bank B', submit: false,
  })

  await expect(page.getByTestId('toast')).toContainText('transfer match search exploded')

  await page.keyboard.press('Escape')
})

test('manual "Link as transfer" picker: a failed candidate search shows an error toast', async () => {
  await page.request.post(`${API}/transactions`, {
    data: { accountId, date: businessToday(), merchant: 'Solo Charge Toast', amount: 91.23, type: 'expense', tag: '[]' },
  })

  await page.goto('/wallet')
  await expect(transactionRowFor(page, 'Solo Charge Toast')).toBeVisible()
  await openTransactionRowMenu(page, 'Solo Charge Toast')
  await page.getByRole('menuitem', { name: 'Edit transaction' }).click()

  // No auto-match for this amount, so the manual picker button shows instead
  // of the proactive TransferLinkHint banner (PR #161 behaviour, see spec 50).
  const openPicker = page.getByTestId('link-transfer-open')
  await expect(openPicker).toBeVisible()

  await force500Once(page, `${API}/transactions?dateFrom=*&type=*`, 'GET', 'link picker search exploded')
  await openPicker.click()

  await expect(page.getByText('Link as transfer')).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('link picker search exploded')
})
