import { test, expect } from '@playwright/test'

const API = '/api'

test.describe.configure({ mode: 'serial' })

/**
 * FEAT-018 (EP-06) — GET /budgets/spending-history, the shared data source
 * for the suggestions engine (src/modules/wallet/budgets/insights.ts) and
 * the 6-month budget-vs-actual chart. No UI reads it yet (that's the next
 * PR) — API-only coverage, following the pattern in
 * e2e/68-tasks-api.spec.ts and e2e/40-transaction-permissions.spec.ts.
 */
test.describe('88 — Budgets spending history', () => {
  /** The current-month-relative 'YYYY-MM' key, `offset` months away (negative = past). Local Date, not toISOString — this only labels test fixture dates, not a production date comparison. */
  function monthKeyOffset(offset: number): string {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  async function setup(browser: import('@playwright/test').Browser, tag: string) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const ts = Date.now()
    await page.request.post(`${API}/auth/signup`, { data: { username: `${tag}_${ts}`, password: 'test-password' } })

    const account = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })).json()
    const category = await (await page.request.post(`${API}/categories`, {
      data: { name: 'Groceries', type: 'expense', icon: 'tag', color: '#378ADD' },
    })).json()

    return { ctx, page, account, category }
  }

  async function spendIn(page: import('@playwright/test').Page, accountId: string, categoryId: string, month: string, amount: number) {
    await page.request.post(`${API}/transactions`, {
      data: { accountId, categoryId, date: `${month}-05`, merchant: 'Store', amount, type: 'expense', tag: '[]' },
    })
  }

  test('groups effective spend by month and category, oldest requested month first', async ({ browser }) => {
    const s = await setup(browser, 'hist_basic')
    await spendIn(s.page, s.account.id, s.category.id, monthKeyOffset(-2), 100)
    await spendIn(s.page, s.account.id, s.category.id, monthKeyOffset(-1), 200)
    await spendIn(s.page, s.account.id, s.category.id, monthKeyOffset(0), 50)
    await spendIn(s.page, s.account.id, s.category.id, monthKeyOffset(0), 25) // same month, same category — sums

    const rows = await (await s.page.request.get(`${API}/budgets/spending-history?months=3`)).json()
    const byMonth = new Map(rows.map((r: { month: string; categoryId: string; spent: number }) => [r.month, r]))

    expect(byMonth.get(monthKeyOffset(-2))?.spent).toBe(100)
    expect(byMonth.get(monthKeyOffset(-1))?.spent).toBe(200)
    expect(byMonth.get(monthKeyOffset(0))?.spent).toBe(75)
    expect(rows.every((r: { categoryId: string }) => r.categoryId === s.category.id)).toBe(true)

    await s.ctx.close()
  })

  test('a month outside the requested window is excluded', async ({ browser }) => {
    const s = await setup(browser, 'hist_window')
    await spendIn(s.page, s.account.id, s.category.id, monthKeyOffset(-5), 999)
    await spendIn(s.page, s.account.id, s.category.id, monthKeyOffset(0), 40)

    const rows = await (await s.page.request.get(`${API}/budgets/spending-history?months=2`)).json()
    expect(rows.find((r: { month: string }) => r.month === monthKeyOffset(-5))).toBeUndefined()
    expect(rows.find((r: { month: string }) => r.month === monthKeyOffset(0))?.spent).toBe(40)

    await s.ctx.close()
  })

  test('defaults to 6 months when the months param is missing or out of range', async ({ browser }) => {
    const s = await setup(browser, 'hist_default')
    await spendIn(s.page, s.account.id, s.category.id, monthKeyOffset(-5), 10)

    const noParam = await (await s.page.request.get(`${API}/budgets/spending-history`)).json()
    expect(noParam.find((r: { month: string }) => r.month === monthKeyOffset(-5))?.spent).toBe(10)

    const outOfRange = await (await s.page.request.get(`${API}/budgets/spending-history?months=999`)).json()
    expect(outOfRange.find((r: { month: string }) => r.month === monthKeyOffset(-5))?.spent).toBe(10)

    await s.ctx.close()
  })

  test('income and balance-only transactions are excluded, only expenses count', async ({ browser }) => {
    const s = await setup(browser, 'hist_filter')
    const month = monthKeyOffset(0)
    await s.page.request.post(`${API}/transactions`, {
      data: { accountId: s.account.id, categoryId: s.category.id, date: `${month}-03`, merchant: 'Pay', amount: 5000, type: 'income', tag: '[]' },
    })
    await spendIn(s.page, s.account.id, s.category.id, month, 30)

    const rows = await (await s.page.request.get(`${API}/budgets/spending-history?months=1`)).json()
    expect(rows.find((r: { month: string }) => r.month === month)?.spent).toBe(30)

    await s.ctx.close()
  })
})
