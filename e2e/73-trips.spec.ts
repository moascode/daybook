/**
 * R6-trips (docs/v2/.flow/R6-trips/flow-plan.md, docs/v2/trips/02-design-adoption.md).
 *
 * Covers: /trips is a live route (tab, sidebar, empty states), the
 * "travel as a category of your life" figures are real and reconcile against
 * an independent computation over the same seeded data, and every
 * not-yet-built destination (module tab sub-nav, "Plan a trip") is disabled
 * with a stated reason rather than silently doing nothing.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

test.describe('73 — Trips landing page', () => {
  test('the Trips tab is live, not "coming soon"', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    // AppBar and MobileTabBar both render a "modtab-trips" copy (only one
    // visible per viewport) — same duplicate-testid convention as
    // nav-tasks/nav-wallet (e2e/65-app-shell.spec.ts).
    const tab = page.getByTestId('modtab-trips').locator('visible=true')
    await expect(tab).not.toHaveAttribute('aria-disabled', 'true')
    await expect(tab).toHaveAttribute('aria-label', 'Trips')

    await tab.click()
    await expect(page).toHaveURL(/\/trips$/)
  })

  test('renders the travel band and both empty-state sections with nothing seeded', async ({ browser }) => {
    const page = await newAppPage(browser, '/trips')

    await expect(page.getByTestId('trips-travel-band')).toBeVisible()
    await expect(page.getByTestId('trips-travel-total')).toContainText('0.00')
    await expect(page.getByTestId('trips-travel-pct')).toHaveText('0.0%')
    await expect(page.getByTestId('trips-travel-days')).toHaveText('0')

    await expect(page.getByText('No active trip')).toBeVisible()
    await expect(page.getByText('Nothing upcoming, past, or on the wishlist')).toBeVisible()
  })

  test('"Plan a trip" is disabled with a stated reason, not a dead click', async ({ browser }) => {
    const page = await newAppPage(browser, '/trips')

    const planBtn = page.getByTestId('trips-plan-a-trip')
    await expect(planBtn).toBeDisabled()
    await expect(planBtn).toHaveAttribute('title', 'Coming in R12')
    await expect(page.getByTestId('trips-plan-a-trip-reason')).toHaveText('Coming in R12')
  })

  test('travel figures reconcile against an independent computation over the seeded transactions', async ({ browser }) => {
    const page = await newAppPage(browser, '/trips')

    const account = await page.request.post(`${API}/accounts`, { data: { name: 'Trips Test Account' } })
    const { id: accountId } = (await account.json()) as { id: string }

    const categoriesRes = await page.request.get(`${API}/categories`)
    const categories = (await categoriesRes.json()) as { id: string; name: string }[]
    const travel = categories.find((c) => c.name === 'Travel')
    if (!travel) throw new Error('Expected the seeded "Travel" category to exist')

    const today = businessToday()
    const yesterday = businessDatePlus(-1)

    // Two travel-category expenses on two different days — proves distinct-day
    // counting, not just a transaction count.
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: today, amount: 100, type: 'expense', categoryId: travel.id, merchant: 'Flight' },
    })
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: yesterday, amount: 50, type: 'expense', categoryId: travel.id, merchant: 'Hotel' },
    })
    // A non-travel expense — counts toward the denominator only.
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: today, amount: 200, type: 'expense', merchant: 'Groceries' },
    })

    await page.reload()

    // travelTotal = 150, totalExpense = 350, pct = 150/350*100 = 42.857...% → 42.9%
    await expect(page.getByTestId('trips-travel-total')).toContainText('150.00')
    await expect(page.getByTestId('trips-travel-pct')).toHaveText('42.9%')
    await expect(page.getByTestId('trips-travel-days')).toHaveText('2')
  })

  test('sidebar destinations are disabled with a stated reason, not a dead link', async ({ browser }) => {
    const page = await newAppPage(browser, '/trips')

    const active = page.getByTestId('nav-trips-active')
    await expect(active).toHaveAttribute('aria-disabled', 'true')
    await expect(active).toHaveAttribute('aria-label', 'Active trip — Coming in R12')

    const allTrips = page.getByTestId('nav-trips-all')
    await expect(allTrips).toHaveAttribute('aria-disabled', 'true')
    await expect(allTrips).toHaveAttribute('aria-label', 'All trips — Coming in R12')

    // Clicking does nothing — still on /trips, not a 404.
    await active.click({ force: true })
    await expect(page).toHaveURL(/\/trips$/)
  })
})
