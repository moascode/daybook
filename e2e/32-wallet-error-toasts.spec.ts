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
import { newAppPage } from './helpers'

test.describe.configure({ mode: 'serial' })

const API = 'http://localhost:5173/api'

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

  await page.getByRole('button', { name: 'Add Transaction' }).click()
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
      nextDueDate: '2026-08-01',
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
