/**
 * R5 PR-1 — Today page (docs/v2/.flow/R5-foundation-today/flow-plan.md item
 * 10, docs/v2/tasks/02-design-adoption.md §Today).
 *
 * Covers: the band renders, adding a task via the composer's Enter-to-add,
 * Overdue/Today/Done-today grouping, the reschedule-all button, and the
 * Up-next rail. Sidebar Lists/Unsorted coverage (plan item 11) lives here too
 * since it's the same page's shell.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessDatePlus } from './helpers'

const API = '/api'

test.describe('69 — Tasks Today page', () => {
  test('renders the band and an empty Today group with no tasks yet', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await expect(page.getByTestId('today-band')).toBeVisible()
    await expect(page.getByTestId('today-band')).toContainText('done today')
    await expect(page.getByText('Nothing due today.')).toBeVisible()
    // 7-day load strip renders all seven days.
    await expect(page.getByTestId('load-day')).toHaveCount(7)
  })

  test('adding a task via the composer (Enter) lands it in the Today group', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const composer = page.getByTestId('today-composer-input')
    await composer.fill('Water the plants')
    await composer.press('Enter')

    await expect(composer).toHaveValue('')
    await expect(page.getByText('Water the plants')).toBeVisible()
    await expect(page.getByText('Nothing due today.')).not.toBeVisible()
  })

  test('completing a Today task moves it into the collapsible Done today group', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const composer = page.getByTestId('today-composer-input')
    await composer.fill('Reply to email')
    await composer.press('Enter')
    await expect(page.getByText('Reply to email')).toBeVisible()

    const row = page.getByTestId('today-task-row').filter({ hasText: 'Reply to email' })
    await row.getByRole('button', { name: 'Mark complete' }).click()

    // Moves out of Today into Done today, which starts expanded.
    const doneToggle = page.getByTestId('done-today-toggle')
    await expect(doneToggle).toBeVisible()
    await expect(doneToggle).toContainText('Done today')
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Reply to email' })).toBeVisible()

    // Collapsing hides the row; expanding again shows it.
    await doneToggle.click()
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Reply to email' })).not.toBeVisible()
    await doneToggle.click()
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Reply to email' })).toBeVisible()
  })

  test('an overdue task groups under Overdue, and "Reschedule all" moves it to today', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const yesterday = businessDatePlus(-1)

    // Seed an overdue task directly via the API — the minimal composer has no
    // due-date input yet (that's R7's full syntax composer).
    await page.request.post(`${API}/tasks`, { data: { content: 'Overdue thing', dueDate: yesterday } })
    await page.reload()

    const overdueRow = page.getByTestId('today-task-row').filter({ hasText: 'Overdue thing' })
    await expect(overdueRow).toBeVisible()
    await expect(page.getByText('Overdue', { exact: true })).toBeVisible()

    const rescheduleBtn = page.getByTestId('reschedule-all-btn')
    await expect(rescheduleBtn).toBeVisible()
    await rescheduleBtn.click()

    // Rescheduled to today: the Overdue group (and its button) disappears,
    // and the task now shows in Today.
    await expect(page.getByTestId('reschedule-all-btn')).not.toBeVisible()
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Overdue thing' })).toBeVisible()
  })

  test('Up next rail lists a future-dated task, tasks-only', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const nextWeek = businessDatePlus(7)

    await page.request.post(`${API}/tasks`, { data: { content: 'Future thing', dueDate: nextWeek } })
    await page.reload()

    await expect(page.getByText('Nothing scheduled yet.')).not.toBeVisible()
    const upNextRow = page.getByTestId('upnext-row').filter({ hasText: 'Future thing' })
    await expect(upNextRow).toBeVisible()
    // Not grouped into Today/Overdue — it's a week out.
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Future thing' })).not.toBeVisible()
  })

  test('sidebar shows the default Lists plus a fixed Unsorted item', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    // Signup seeds four default lists (68-tasks-api.spec.ts).
    await expect(page.getByTestId('nav-tasks-today')).toBeVisible()
    await expect(page.getByTestId('nav-tasks-list-unsorted')).toBeVisible()
    await expect(page.locator('[data-testid^="nav-tasks-list-"]')).toHaveCount(5) // 4 lists + Unsorted
  })

  test('Upcoming and Assigned to me are disabled with a stated reason', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const upcoming = page.getByTestId('nav-tasks-upcoming')
    await expect(upcoming).toHaveAttribute('aria-disabled', 'true')
    await expect(upcoming).toHaveAttribute('aria-label', 'Upcoming — Coming in R10')

    const assigned = page.getByTestId('nav-tasks-assigned')
    await expect(assigned).toHaveAttribute('aria-disabled', 'true')
    await expect(assigned).toHaveAttribute('aria-label', 'Assigned to me — Coming in R10')

    // Clicking does nothing — still on Today, not a 404.
    await upcoming.click()
    await expect(page).toHaveURL(/\/tasks$/)
  })
})
