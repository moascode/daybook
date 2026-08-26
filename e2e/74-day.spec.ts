/**
 * R6-day (docs/v2/.flow/R6-day/flow-plan.md, docs/v2/day/02-design-adoption.md).
 *
 * Covers: `/` lands on `/day`, the Day tab is live, the band figures
 * reconcile against an independent computation over seeded tasks +
 * transactions, the timeline merges completed tasks / due-today tasks /
 * today's transactions with the right solid-vs-hollow split around the `now`
 * divider, the date stepper moves the divider, the sidebar's not-yet-built
 * destinations state a reason, and the three live "Show on the timeline"
 * toggles actually filter rows.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

test.describe('74 — Day landing page', () => {
  test('"/" redirects to "/day", and the Day tab is live', async ({ browser }) => {
    const page = await newAppPage(browser, '/')

    await expect(page).toHaveURL(/\/day$/)
    const tab = page.getByTestId('modtab-day').locator('visible=true')
    await expect(tab).not.toHaveAttribute('aria-disabled', 'true')
    await expect(tab).toHaveAttribute('aria-label', 'Day')
  })

  test('renders the band and an empty timeline with nothing seeded', async ({ browser }) => {
    const page = await newAppPage(browser, '/day')

    await expect(page.getByTestId('day-band')).toBeVisible()
    await expect(page.getByTestId('day-tasks-fig')).toContainText('0')
    await expect(page.getByTestId('day-net-fig')).toContainText('0.00')
    await expect(page.getByText('Nothing on the timeline for this day yet.')).toBeVisible()
    // Today, so the now divider still renders even with nothing around it.
    await expect(page.getByTestId('day-now-divider')).toBeVisible()
  })

  test('band and timeline reconcile against an independent computation over seeded data', async ({ browser }) => {
    const page = await newAppPage(browser, '/day')
    const today = businessToday()

    // Task A: open, due today → planned (hollow).
    const taskA = await page.request.post(`${API}/tasks`, { data: { content: 'Task A — due today', dueDate: today } })
    expect(taskA.ok()).toBeTruthy()

    // Task B: created then completed → happened (solid, done).
    const taskBRes = await page.request.post(`${API}/tasks`, { data: { content: 'Task B — done today' } })
    expect(taskBRes.ok()).toBeTruthy()
    const { id: taskBId } = (await taskBRes.json()) as { id: string }
    const completeRes = await page.request.post(`${API}/tasks/${taskBId}/complete`)
    expect(completeRes.ok()).toBeTruthy()

    const account = await page.request.post(`${API}/accounts`, { data: { name: 'Day Test Account' } })
    expect(account.ok()).toBeTruthy()
    const { id: accountId } = (await account.json()) as { id: string }

    const incomeTxn = await page.request.post(`${API}/transactions`, {
      data: { accountId, date: today, amount: 100, type: 'income', merchant: 'Paycheck' },
    })
    expect(incomeTxn.ok()).toBeTruthy()
    const expenseTxn = await page.request.post(`${API}/transactions`, {
      data: { accountId, date: today, amount: 40, type: 'expense', merchant: 'Lunch' },
    })
    expect(expenseTxn.ok()).toBeTruthy()

    await page.reload()

    // doneCount=1 (Task B), totalCount=2 (Task A due + Task B completed).
    await expect(page.getByTestId('day-tasks-fig')).toContainText('1')
    await expect(page.getByTestId('day-tasks-fig')).toContainText('of 2')
    // net = 100 - 40 = 60; income = 100.
    await expect(page.getByTestId('day-net-fig')).toContainText('60.00')
    await expect(page.getByTestId('day-net-sub')).toContainText('100.00 in')

    // Timeline: Task B + both transactions are solid, above the now divider;
    // Task A is hollow ("ahead"), below it.
    const rows = page.getByTestId('day-timeline-row')
    await expect(rows).toHaveCount(4)

    const taskBRow = rows.filter({ hasText: 'Task B — done today' })
    await expect(taskBRow).toHaveClass(/\bdone\b/)
    const taskARow = rows.filter({ hasText: 'Task A — due today' })
    await expect(taskARow).toHaveClass(/\bahead\b/)

    const allNodes = page.locator('[data-testid="day-timeline-row"], [data-testid="day-now-divider"]')
    const testids = await allNodes.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
    const nowIndex = testids.indexOf('day-now-divider')
    expect(nowIndex).toBeGreaterThan(0)
    // Everything before the divider is solid (Task B + 2 txns); Task A is the
    // one row after it.
    expect(testids.slice(0, nowIndex).filter((t) => t === 'day-timeline-row')).toHaveLength(3)
    expect(testids.slice(nowIndex + 1).filter((t) => t === 'day-timeline-row')).toHaveLength(1)
  })

  test('the date stepper moves the now divider off "today"', async ({ browser }) => {
    const page = await newAppPage(browser, '/day')

    await expect(page.getByTestId('day-now-divider')).toBeVisible()
    await expect(page.locator('h1.page-title')).toHaveText('Today')

    await page.getByTestId('day-prev').click()
    await expect(page.getByTestId('day-now-divider')).not.toBeVisible()
    await expect(page.locator('h1.page-title')).not.toHaveText('Today')

    await page.getByTestId('day-today').click()
    await expect(page.getByTestId('day-now-divider')).toBeVisible()
    await expect(page.locator('h1.page-title')).toHaveText('Today')
  })

  test('sidebar destinations not yet built are disabled with a stated reason', async ({ browser }) => {
    const page = await newAppPage(browser, '/day')

    const week = page.getByTestId('nav-day-week')
    await expect(week).toHaveAttribute('aria-disabled', 'true')
    await expect(week).toHaveAttribute('aria-label', 'This week — Coming in R16')

    const notesLink = page.getByTestId('nav-day-notes')
    await expect(notesLink).toHaveAttribute('aria-disabled', 'true')
    await expect(notesLink).toHaveAttribute('aria-label', 'Notes — Coming in R15')

    const notesToggle = page.getByTestId('day-toggle-notes')
    await expect(notesToggle).toHaveAttribute('aria-disabled', 'true')
    await expect(notesToggle).toHaveAttribute('aria-label', 'Notes on the timeline — Coming in R15')

    // "Scheduled & bills" is disabled too — R6 ships no scheduled-row kind
    // in the merge, so a live-looking checkbox here would be a click that
    // changes nothing and explains nothing.
    const scheduledToggle = page.getByTestId('day-toggle-scheduled')
    await expect(scheduledToggle).toHaveAttribute('aria-disabled', 'true')
  })

  test('the "Tasks & habits" toggle hides task rows without touching money rows', async ({ browser }) => {
    const page = await newAppPage(browser, '/day')
    const today = businessToday()

    const taskBRes = await page.request.post(`${API}/tasks`, { data: { content: 'Toggle test task' } })
    const { id: taskBId } = (await taskBRes.json()) as { id: string }
    await page.request.post(`${API}/tasks/${taskBId}/complete`)

    const account = await page.request.post(`${API}/accounts`, { data: { name: 'Toggle Test Account' } })
    const { id: accountId } = (await account.json()) as { id: string }
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: today, amount: 25, type: 'expense', merchant: 'Coffee' },
    })

    await page.reload()
    await expect(page.getByTestId('day-timeline-row')).toHaveCount(2)

    await page.getByTestId('day-toggle-tasks').uncheck()
    await expect(page.getByTestId('day-timeline-row')).toHaveCount(1)
    await expect(page.getByTestId('day-timeline-row')).toContainText('Coffee')

    await page.getByTestId('day-toggle-money').uncheck()
    await expect(page.getByTestId('day-timeline-row')).toHaveCount(0)
  })
})
