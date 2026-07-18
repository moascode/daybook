/**
 * Wave 3 server hardening — e2e tests.
 *
 * C2: API-level validation — malformed transaction/budget/goal writes are
 * rejected with 400 `{error}` JSON instead of being stored or crashing.
 * C1: batched balances — GET /api/accounts/balances agrees with the
 * per-account balance route, and the net-worth UI still matches the sum of
 * account balances after the client switched to the batched endpoint.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage } from './helpers'

test.describe.configure({ mode: 'serial' })

const API = 'http://localhost:5173/api'

let page: Page
let mainId: string
let savingsId: string

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet')

  // Two accounts with opening balances, seeded via the API.
  const mainRes = await page.request.post(`${API}/accounts`, {
    data: { name: 'Main', type: 'bank', openingBalance: 100 },
  })
  expect(mainRes.status()).toBe(201)
  mainId = (await mainRes.json()).id

  const savingsRes = await page.request.post(`${API}/accounts`, {
    data: { name: 'Savings', type: 'bank', openingBalance: 10 },
  })
  expect(savingsRes.status()).toBe(201)
  savingsId = (await savingsRes.json()).id
})

test.afterAll(async () => {
  await page.context().close()
})

// ── C2: transaction validation ─────────────────────────────────────────

test('rejects a transaction with an unknown type', async () => {
  const res = await page.request.post(`${API}/transactions`, {
    data: { accountId: mainId, date: '2026-07-01', amount: 10, type: 'bogus' },
  })
  expect(res.status()).toBe(400)
  const body = await res.json()
  expect(body.error).toContain('type')
})

test('rejects a negative amount', async () => {
  const res = await page.request.post(`${API}/transactions`, {
    data: { accountId: mainId, date: '2026-07-01', amount: -5, type: 'expense' },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toContain('amount')
})

test('rejects a zero amount', async () => {
  const res = await page.request.post(`${API}/transactions`, {
    data: { accountId: mainId, date: '2026-07-01', amount: 0, type: 'expense' },
  })
  expect(res.status()).toBe(400)
})

test('rejects a non-finite amount', async () => {
  const res = await page.request.post(`${API}/transactions`, {
    data: { accountId: mainId, date: '2026-07-01', amount: 'not-a-number', type: 'expense' },
  })
  expect(res.status()).toBe(400)
})

test('rejects a malformed date', async () => {
  const res = await page.request.post(`${API}/transactions`, {
    data: { accountId: mainId, date: '01/07/2026', amount: 10, type: 'expense' },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toContain('date')
})

test('rejects a transfer without a destination account', async () => {
  const res = await page.request.post(`${API}/transactions`, {
    data: { accountId: mainId, date: '2026-07-01', amount: 10, type: 'transfer' },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toContain('destination')
})

test('rejects a transfer to the same account', async () => {
  const res = await page.request.post(`${API}/transactions`, {
    data: {
      accountId: mainId,
      destinationAccountId: mainId,
      date: '2026-07-01',
      amount: 10,
      type: 'transfer',
    },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toContain('destination')
})

test('rejects a PATCH that sets an invalid type', async () => {
  const created = await page.request.post(`${API}/transactions`, {
    data: { accountId: mainId, date: '2026-07-01', amount: 50, type: 'income', merchant: 'Salary' },
  })
  expect(created.status()).toBe(201)
  const txnId = (await created.json()).id

  const res = await page.request.patch(`${API}/transactions/${txnId}`, {
    data: { type: 'bogus' },
  })
  expect(res.status()).toBe(400)

  // A PATCH turning it into a self-transfer is rejected too.
  const selfTransfer = await page.request.patch(`${API}/transactions/${txnId}`, {
    data: { type: 'transfer', destinationAccountId: mainId },
  })
  expect(selfTransfer.status()).toBe(400)
})

test('rejects budgets and goals with non-positive amounts', async () => {
  const cats = await (await page.request.get(`${API}/categories`)).json()
  const categoryId = cats[0].id

  const budget = await page.request.post(`${API}/budgets`, {
    data: { categoryId, limitAmount: -20 },
  })
  expect(budget.status()).toBe(400)
  expect((await budget.json()).error).toContain('limitAmount')

  const goal = await page.request.post(`${API}/goals`, {
    data: { name: 'Trip', targetAmount: 0, accountId: mainId },
  })
  expect(goal.status()).toBe(400)
  expect((await goal.json()).error).toContain('targetAmount')
})

// ── C1: batched balances parity ────────────────────────────────────────

test('batched balances endpoint matches the per-account route', async () => {
  // Seed real activity: income 50 and expense 20 on Main, transfer 30 → Savings.
  // The PATCH-validation test above already posted a valid 50 income on Main.
  // Expected: Main = 100 + 50 + 50 − 20 − 30 = 150; Savings = 10 + 30 = 40.
  for (const data of [
    { accountId: mainId, date: '2026-07-02', amount: 50, type: 'income', merchant: 'Salary' },
    { accountId: mainId, date: '2026-07-03', amount: 20, type: 'expense', merchant: 'Groceries' },
    { accountId: mainId, destinationAccountId: savingsId, date: '2026-07-04', amount: 30, type: 'transfer' },
  ]) {
    const res = await page.request.post(`${API}/transactions`, { data })
    expect(res.status()).toBe(201)
  }

  const batched = (await (await page.request.get(`${API}/accounts/balances`)).json()) as Array<{
    id: string
    balance: number
  }>
  const byId = new Map(batched.map((r) => [r.id, r.balance]))
  expect(byId.get(mainId)).toBe(150)
  expect(byId.get(savingsId)).toBe(40)

  for (const id of [mainId, savingsId]) {
    const single = await (await page.request.get(`${API}/accounts/${id}/balance`)).json()
    expect(single.balance).toBe(byId.get(id))
  }
})

test('hero net worth matches the sum of account balances', async () => {
  await page.goto('/wallet')
  // Main 150 + Savings 40 = 190
  await expect(page.locator('p.text-2xl')).toContainText('190.00')

  await page.goto('/wallet/accounts')
  await expect(page.getByText('Total Net Worth')).toBeVisible()
  await expect(page.locator('p.text-2xl')).toContainText('190.00')
})
