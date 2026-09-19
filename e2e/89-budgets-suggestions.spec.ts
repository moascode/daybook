import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { newAppPage } from './helpers'

const API = '/api'

test.describe.configure({ mode: 'serial' })

/**
 * FEAT-018 (EP-06), part 2/3 — the suggestion rows and their one-click
 * actions on the Budgets page. Part 1 (e2e/88) covered the data endpoint and
 * the pure engine's rules directly; this covers what a person actually sees
 * and clicks.
 *
 * Fixture design (all amounts chosen well clear of the engine's thresholds
 * in src/modules/wallet/budgets/insights.ts, so this isn't sensitive to
 * exact boundary values):
 *   Transport — limit 100, spends RM20 in each of the last 3 months →
 *     averages 20% usage → donor, RM80 slack.
 *   Dining — limit 50, spends RM90 in the CURRENT month only → RM40 over
 *     this month → receiver. Reallocate moves min(80, 40) = RM40.
 *   Groceries — limit 100, spends RM150 in each of the last 3 months →
 *     over-limit every month → right-size to RM150.
 *   Entertainment — no budget, spends RM40 this month only → create-missing.
 */
test.describe('89 — Budgets suggestions', () => {
  function monthKeyOffset(offset: number): string {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  async function mkCategory(page: Page, name: string) {
    return (await page.request.post(`${API}/categories`, {
      data: { name, type: 'expense', icon: 'tag', color: '#378ADD' },
    })).json()
  }

  async function spend(page: Page, accountId: string, categoryId: string, month: string, amount: number) {
    await page.request.post(`${API}/transactions`, {
      data: { accountId, categoryId, date: `${month}-05`, merchant: 'Store', amount, type: 'expense', tag: '[]' },
    })
  }

  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await newAppPage(browser, '/wallet/budgets')

    const account = await (await page.request.post(`${API}/accounts`, {
      data: { name: 'Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })).json()

    const transport = await mkCategory(page, 'Transport')
    const dining = await mkCategory(page, 'Dining')
    const groceries = await mkCategory(page, 'Groceries')
    const entertainment = await mkCategory(page, 'Entertainment')

    await page.request.post(`${API}/budgets`, { data: { categoryId: transport.id, limitAmount: 100 } })
    await page.request.post(`${API}/budgets`, { data: { categoryId: dining.id, limitAmount: 50 } })
    await page.request.post(`${API}/budgets`, { data: { categoryId: groceries.id, limitAmount: 100 } })

    for (const offset of [-2, -1, 0]) {
      await spend(page, account.id, transport.id, monthKeyOffset(offset), 20)
      await spend(page, account.id, groceries.id, monthKeyOffset(offset), 150)
    }
    await spend(page, account.id, dining.id, monthKeyOffset(0), 90)
    await spend(page, account.id, entertainment.id, monthKeyOffset(0), 40)

    await page.reload()
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  test('renders one row per suggestion type', async () => {
    await expect(page.getByTestId('budget-suggestions')).toBeVisible()
    await expect(page.getByTestId('suggestion-row')).toHaveCount(3)
  })

  test('reallocate row names the donor, its rate, and the receiver', async () => {
    const row = page.getByTestId('suggestion-row').filter({ hasText: 'Transport' })
    await expect(row).toContainText('Move RM 40.00 from Transport')
    await expect(row).toContainText('20%')
    await expect(row).toContainText('to Dining')
    await expect(row.getByRole('button', { name: 'Reallocate' })).toBeVisible()
  })

  test('right-size row proposes raising Groceries to actual spend', async () => {
    const row = page.getByTestId('suggestion-row').filter({ hasText: 'Groceries' })
    await expect(row).toContainText('Raise Groceries to what you actually spend')
    await expect(row).toContainText('RM 150.00')
    await expect(row.getByRole('button', { name: 'Raise to RM 150.00' })).toBeVisible()
  })

  test('create-missing row proposes a budget for Entertainment', async () => {
    const row = page.getByTestId('suggestion-row').filter({ hasText: 'Entertainment' })
    await expect(row).toContainText('no Entertainment budget')
    await expect(row).toContainText('RM 40.00/mo')
    await expect(row.getByRole('button', { name: 'Create budget' })).toBeVisible()
  })

  test('clicking "Create budget" creates it and drops the suggestion', async () => {
    const row = page.getByTestId('suggestion-row').filter({ hasText: 'Entertainment' })
    await row.getByRole('button', { name: 'Create budget' }).click()

    const budgetRow = page.getByTestId('budget-row').filter({ hasText: 'Entertainment' })
    await expect(budgetRow).toBeVisible()
    await expect(budgetRow).toContainText('RM 40.00')
    await expect(page.getByTestId('suggestion-row').filter({ hasText: 'Entertainment' })).toHaveCount(0)
  })

  test('clicking "Raise to RM 150.00" updates the budget and drops the suggestion', async () => {
    const row = page.getByTestId('suggestion-row').filter({ hasText: 'Groceries' })
    await row.getByRole('button', { name: 'Raise to RM 150.00' }).click()

    const budgetRow = page.getByTestId('budget-row').filter({ hasText: 'Groceries' })
    await expect(budgetRow).toContainText('RM 150.00')
    await expect(page.getByTestId('suggestion-row').filter({ hasText: 'Groceries' })).toHaveCount(0)
  })

  test('clicking "Reallocate" moves the limit between both budgets and drops the suggestion', async () => {
    const row = page.getByTestId('suggestion-row').filter({ hasText: 'Transport' })
    await row.getByRole('button', { name: 'Reallocate' }).click()

    await expect(page.getByTestId('budget-row').filter({ hasText: 'Transport' })).toContainText('RM 60.00')
    await expect(page.getByTestId('budget-row').filter({ hasText: 'Dining' })).toContainText('RM 90.00')
    await expect(page.getByTestId('suggestion-row')).toHaveCount(0)
    await expect(page.getByTestId('budget-suggestions')).not.toBeVisible()
  })
})
