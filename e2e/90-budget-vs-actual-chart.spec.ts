import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

test.describe.configure({ mode: 'serial' })

/**
 * FEAT-018 (EP-06), part 3/3 — the 6-month budget-vs-actual chart
 * (design.md: "beside them, six months of budget-vs-actual"). Budgeted is
 * the SAME total in every month (today's snapshot — there's no historical
 * limit to look up), so this fixture spends different amounts across
 * months against one fixed RM100 budget to exercise both the over and
 * under cases.
 */
test.describe('90 — Budget vs. actual chart', () => {
  // The "one clock" trap (CLAUDE.md §3): the Worker derives its 6-month
  // window from the business timezone (Asia/Kuala_Lumpur), not the CI
  // runner's UTC clock — `new Date()` here would drift by a month right at
  // a month boundary, inside the documented 8-hour divergence window.
  function monthKeyOffset(offset: number): string {
    const [y, m] = businessToday().split('-').map(Number)
    const d = new Date(y, m - 1 + offset, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await newAppPage(browser, '/wallet/budgets')

    const account = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })).json()
    const groceries = await (await page.request.post(`${API}/categories`, {
      data: { name: 'Groceries', type: 'expense', icon: 'tag', color: '#378ADD' },
    })).json()
    await page.request.post(`${API}/budgets`, { data: { categoryId: groceries.id, limitAmount: 100 } })

    // A category with real spend but no budget — must NOT count toward "actual".
    const other = await (await page.request.post(`${API}/categories`, {
      data: { name: 'Other', type: 'expense', icon: 'tag', color: '#999999' },
    })).json()
    await page.request.post(`${API}/transactions`, {
      data: { accountId: account.id, categoryId: other.id, date: `${monthKeyOffset(0)}-05`, merchant: 'X', amount: 500, type: 'expense', tag: '[]' },
    })

    // Groceries: under budget 4 months back, over budget this month.
    for (const offset of [-4, -3, -2, -1]) {
      await page.request.post(`${API}/transactions`, {
        data: { accountId: account.id, categoryId: groceries.id, date: `${monthKeyOffset(offset)}-05`, merchant: 'Store', amount: 60, type: 'expense', tag: '[]' },
      })
    }
    await page.request.post(`${API}/transactions`, {
      data: { accountId: account.id, categoryId: groceries.id, date: `${monthKeyOffset(0)}-05`, merchant: 'Store', amount: 150, type: 'expense', tag: '[]' },
    })

    await page.reload()
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  test('renders 6 month groups, each with a budgeted and an actual bar', async () => {
    const chart = page.getByTestId('budget-vs-actual')
    await expect(chart).toBeVisible()
    await expect(chart.getByTestId('budget-vs-actual-group')).toHaveCount(6)
    await expect(chart.getByTestId('budget-vs-actual-budgeted-bar')).toHaveCount(6)
    await expect(chart.getByTestId('budget-vs-actual-actual-bar')).toHaveCount(6)
  })

  test('current month shows the RM150 over-budget spend, excluding the unbudgeted category', async () => {
    const chart = page.getByTestId('budget-vs-actual')
    await chart.getByTestId('budget-vs-actual-group').last().hover()
    await expect(chart.getByText(/RM\s*150\.00 actual/)).toBeVisible()
    await expect(chart.getByText(/RM\s*50\.00 over/)).toBeVisible()
  })

  test('an earlier month shows the RM60 under-budget spend', async () => {
    // The 6-month window runs oldest→newest, offsets -5..0; -5 has no spend
    // (nothing was seeded there), so index 1 (offset -4) is the first RM60 month.
    const chart = page.getByTestId('budget-vs-actual')
    await chart.getByTestId('budget-vs-actual-group').nth(1).hover()
    await expect(chart.getByText(/RM\s*60\.00 actual/)).toBeVisible()
    await expect(chart.getByText(/RM\s*40\.00 under/)).toBeVisible()
  })
})
