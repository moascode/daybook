import { test, expect } from '@playwright/test'
import { businessDatePlus } from './helpers'

const API = '/api'

test.describe.configure({ mode: 'serial' })

/**
 * BUG-002 — `Date.parse` rolls an impossible calendar date over to the next
 * valid one (2026-02-30 -> 2 March, 2026-04-31 -> 1 May) instead of failing,
 * so `transactionInputError` and `isoDateError` both silently accepted them
 * and relocated the row. Fixed by worker/lib/iso-date.ts's round-trip check.
 *
 * '2026-02-30' / '2026-04-31' are fixed literals, not relative to today —
 * they are impossible dates by construction, so businessToday() doesn't
 * apply to them. The "valid" control cases below DO use businessDatePlus()
 * per CLAUDE.md §3 (never toISOString() in specs, never hardcode a future
 * date that will eventually read as "far in the past").
 */
test.describe('107 — ISO date validation rejects impossible calendar dates', () => {
  async function signup(browser: import('@playwright/test').Browser, tag: string) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.request.post(`${API}/auth/signup`, {
      data: { username: `u_isodate_${tag}_${Date.now()}`, password: 'test-password' },
    })
    return { ctx, page }
  }

  test('POST /transactions rejects 2026-02-30 (rolls to 2 Mar under Date.parse)', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'txn1')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Cash', type: 'cash', openingBalance: 0 },
    })).json()

    const res = await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: '2026-02-30', merchant: 'Store', amount: 10, type: 'expense', tag: '[]' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/ISO date/)
    await ctx.close()
  })

  test('POST /transactions rejects 2026-04-31 (rolls to 1 May under Date.parse)', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'txn2')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Cash', type: 'cash', openingBalance: 0 },
    })).json()

    const res = await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: '2026-04-31', merchant: 'Store', amount: 10, type: 'expense', tag: '[]' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/ISO date/)
    await ctx.close()
  })

  test('POST /transactions accepts a real leap-day date', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'txn3')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Cash', type: 'cash', openingBalance: 0 },
    })).json()

    const res = await page.request.post(`${API}/transactions`, {
      data: { accountId: acct.id, date: '2024-02-29', merchant: 'Store', amount: 10, type: 'expense', tag: '[]' },
    })
    expect(res.status()).toBe(201)
    await ctx.close()
  })

  test('POST /recurring-transactions rejects an impossible nextDueDate', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'rec1')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Cash', type: 'cash', openingBalance: 0 },
    })).json()

    const res = await page.request.post(`${API}/recurring-transactions`, {
      data: {
        accountId: acct.id,
        amount: 50,
        merchant: 'Rent',
        type: 'expense',
        frequency: 'monthly',
        nextDueDate: '2026-02-30',
      },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/ISO date/)
    await ctx.close()
  })

  test('POST /recurring-transactions accepts a normal, valid nextDueDate', async ({ browser }) => {
    const { ctx, page } = await signup(browser, 'rec2')
    const acct = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Cash', type: 'cash', openingBalance: 0 },
    })).json()

    const res = await page.request.post(`${API}/recurring-transactions`, {
      data: {
        accountId: acct.id,
        amount: 50,
        merchant: 'Rent',
        type: 'expense',
        frequency: 'monthly',
        nextDueDate: businessDatePlus(7),
      },
    })
    expect(res.status()).toBe(201)
    await ctx.close()
  })
})
