/**
 * Tasks: Upcoming range switcher (`/tasks/upcoming?range=week|fortnight|month`).
 *
 * Covers: Fortnight draws 14 day columns, shows a task 9 days out and puts
 * `range=fortnight` in the URL; Month draws the month label, tasks in their
 * cells, "+N more" past three, card click opens the detail modal and "+N more"
 * jumps to that day's week; prev/next change the label; a reload keeps the range.
 * All dates come from businessToday()/businessDatePlus() — never toISOString().
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const asUtc = new Date(Date.UTC(y, m - 1, d))
  asUtc.setUTCDate(asUtc.getUTCDate() + days)
  return asUtc.toISOString().slice(0, 10)
}

/** Days since this week's Monday (0 = Monday) for an ISO date. */
function offsetFromMonday(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return dow === 0 ? 6 : dow - 1
}

function monthLabel(dateIso: string, monthShift = 0): string {
  const [y, m] = dateIso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + monthShift, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

async function seed(page: import('@playwright/test').Page, content: string, dueDate: string): Promise<string> {
  const res = await page.request.post(`${API}/tasks`, { data: { content, dueDate } })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).id as string
}

test.describe('113 — Tasks upcoming ranges', () => {
  test('Fortnight shows 14 day columns, a task 9 days out, and range=fortnight in the URL', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const today = businessToday()
    const monday = addDaysIso(today, -offsetFromMonday(today))
    // businessDatePlus(9) falls past day 14 only when today is a Sunday
    // (Mon+15); clamp to the fortnight's last day then so the spec stays green.
    const lateOffset = Math.min(9, 13 - offsetFromMonday(today))
    const lateDate = lateOffset === 9 ? businessDatePlus(9) : addDaysIso(today, lateOffset)
    const id = await seed(page, 'Fortnight far task', lateDate)

    await page.goto('/tasks/upcoming')
    await expect(page.getByTestId('upcoming-day-column-' + monday)).toBeVisible()
    await expect(page.locator('[data-testid^="upcoming-day-column-"]')).toHaveCount(7)

    await page.getByRole('tab', { name: 'Fortnight' }).click()
    await expect(page).toHaveURL(/range=fortnight/)
    await expect(page.locator('[data-testid^="upcoming-day-column-"]')).toHaveCount(14)
    await expect(page.getByTestId(`upcoming-day-column-${addDaysIso(monday, 13)}`)).toBeVisible()
    await expect(page.getByTestId(`upcoming-card-${id}`)).toContainText('Fortnight far task')
    await expect(page.getByTestId('upcoming-band-stats')).toContainText('tasks across fourteen days')
    await expect(page.getByTestId('upcoming-week-this')).toBeDisabled()

    // Prev/next move by 14 days.
    await page.getByTestId('upcoming-week-next').click()
    await expect(page.getByTestId(`upcoming-day-column-${addDaysIso(monday, 14)}`)).toBeVisible()
    await expect(page.getByTestId(`upcoming-card-${id}`)).toHaveCount(0)
    await page.getByTestId('upcoming-week-this').click()
    await expect(page.getByTestId(`upcoming-card-${id}`)).toBeVisible()
  })

  test('Month shows the label, tasks in their cells, +N more, and the detail modal', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const today = businessToday()
    const [y, m] = today.split('-').map(Number)
    const first = `${today.slice(0, 7)}-01`
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const lateDate = last !== today ? last : first

    const single = await seed(page, 'Month late task', lateDate)
    for (const n of [1, 2, 3, 4]) await seed(page, `Busy day ${n}`, today)

    await page.goto('/tasks/upcoming?range=month')
    await expect(page.getByTestId('upcoming-week-range')).toHaveText(monthLabel(today))
    await expect(page.getByRole('tab', { name: 'Month' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('upcoming-band-stats')).toContainText('This month')

    const lateCell = page.getByTestId(`upcoming-month-cell-${lateDate}`)
    await expect(lateCell.getByTestId(`upcoming-month-card-${single}`)).toContainText('Month late task')

    const todayCell = page.getByTestId(`upcoming-month-cell-${today}`)
    await expect(page.getByTestId(`upcoming-month-count-${today}`)).toHaveText(/^[4-9]$/)
    await expect(todayCell.locator('[data-testid^="upcoming-month-card-"]')).toHaveCount(3)
    await expect(page.getByTestId(`upcoming-month-more-${today}`)).toHaveText(/^\+\d+ more$/)

    // A card opens the shared detail modal.
    await lateCell.getByTestId(`upcoming-month-card-${single}`).click()
    await expect(page.getByTestId('task-detail-modal')).toBeVisible()
    await expect(page.getByTestId('task-detail-name')).toHaveValue('Month late task')
    await page.keyboard.press('Escape')

    // "+N more" switches to Week on that day's week.
    await page.getByTestId(`upcoming-month-more-${today}`).click()
    await expect(page).not.toHaveURL(/range=/)
    await expect(page.getByTestId(`upcoming-day-column-${today}`)).toBeVisible()
    await expect(page.locator('[data-testid^="upcoming-day-column-"]')).toHaveCount(7)
  })

  test('Month prev/next change the label and a reload keeps the range', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/upcoming?range=month')
    const today = businessToday()

    await expect(page.getByTestId('upcoming-week-range')).toHaveText(monthLabel(today))
    await page.getByTestId('upcoming-week-next').click()
    await expect(page.getByTestId('upcoming-week-range')).toHaveText(monthLabel(today, 1))
    await page.getByTestId('upcoming-week-prev').click()
    await page.getByTestId('upcoming-week-prev').click()
    await expect(page.getByTestId('upcoming-week-range')).toHaveText(monthLabel(today, -1))

    await page.reload()
    await expect(page).toHaveURL(/range=month/)
    await expect(page.getByRole('tab', { name: 'Month' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('upcoming-week-range')).toHaveText(monthLabel(today))
  })
})
