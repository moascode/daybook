/**
 * BUG-006 (docs/backlog/EP-07-tasks-depth/BUG-006-no-due-date-change-in-list-view.md)
 * + FEAT-052 (docs/backlog/EP-07-tasks-depth/FEAT-052-edit-task-from-row.md).
 *
 * Both fixes land on TaskListRow.tsx, shared by every non-outliner Tasks
 * view. Covers the two representative pages that exercise it differently:
 * TasksAllPage (due-date-grouped, so a date change must move the row between
 * groups) and TasksListDetailPage's List view (ungrouped by date, so this
 * only needs to confirm the row itself works there too).
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

test.describe('97 — Task row inline editing', () => {
  test('editing content on the All tasks page saves on Enter, and Escape reverts', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const res = await page.request.post(`${API}/tasks`, { data: { content: 'Fix the sink' } })
    const task = await res.json()
    await page.goto('/tasks/all')

    // A `data-task-id` locator, not a text filter: once editing starts the
    // title becomes an <input>, whose `value` isn't part of the DOM's text
    // content, so a `hasText` filter would stop matching its own row.
    const row = page.locator(`[data-task-id="${task.id}"]`)
    await row.getByTestId('all-tasks-row-title').click()
    const input = row.getByTestId('all-tasks-row-content-input')
    await expect(input).toBeFocused()
    await input.fill('Fix the leaky sink')
    await input.press('Enter')

    await expect(row.getByTestId('all-tasks-row-title')).toHaveText('Fix the leaky sink')

    // Reload to confirm it actually persisted server-side, not just optimistic UI.
    await page.reload()
    await expect(row.getByTestId('all-tasks-row-title')).toHaveText('Fix the leaky sink')

    // Escape reverts an in-progress edit without saving.
    await row.getByTestId('all-tasks-row-title').click()
    await row.getByTestId('all-tasks-row-content-input').fill('discarded text')
    await row.getByTestId('all-tasks-row-content-input').press('Escape')
    await expect(row.getByTestId('all-tasks-row-title')).toHaveText('Fix the leaky sink')
  })

  test('setting, changing, and clearing a due date moves the row between date groups', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const today = businessToday()
    const tomorrow = businessDatePlus(1)

    const res = await page.request.post(`${API}/tasks`, { data: { content: 'Renew passport' } })
    const task = await res.json()
    await page.goto('/tasks/all')

    // A `data-task-id` locator throughout: TasksAllPage re-groups rows by
    // due date (dateGroups is derived from openTasks), so the row's row
    // DIVIDER changes on every step below — a text/position-based locator
    // would need re-deriving each time.
    const row = page.locator(`[data-task-id="${task.id}"]`)
    await expect(page.getByTestId('all-tasks-no-due-date-group')).toBeVisible()
    await expect(row).toBeVisible()

    // Set a due date via the bare calendar icon (no due date yet).
    await row.locator('button[aria-label^="Set due date"]').click()
    const dateInput = row.locator('input[type="date"]')
    await dateInput.fill(today)
    await dateInput.press('Enter')

    await expect(page.getByTestId('all-tasks-no-due-date-group')).not.toBeVisible()
    const dayHeaders = page.getByTestId('all-tasks-day-header')
    await expect(dayHeaders.filter({ hasText: today.slice(8, 10) })).toBeVisible()
    await expect(row).toBeVisible()

    // Change it to tomorrow via the now-visible due-date badge.
    await row.locator('button.task-when').click()
    const dateInput2 = row.locator('input[type="date"]')
    await dateInput2.fill(tomorrow)
    await dateInput2.press('Enter')

    await expect(dayHeaders.filter({ hasText: tomorrow.slice(8, 10) })).toBeVisible()

    // Clear it — the row returns to the undated group.
    await row.locator('button.task-when').click()
    await row.getByRole('button', { name: 'Clear due date' }).click()

    await expect(page.getByTestId('all-tasks-no-due-date-group')).toBeVisible()
    await expect(row).toBeVisible()

    // Confirm the clear persisted server-side.
    await page.reload()
    await expect(page.getByTestId('all-tasks-no-due-date-group')).toBeVisible()
    await expect(page.locator(`[data-task-id="${task.id}"]`)).toBeVisible()
  })

  test('content editing also works from a list’s List view', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/lists/unsorted')
    const res = await page.request.post(`${API}/tasks`, { data: { content: 'Water the ferns' } })
    const task = await res.json()
    await page.reload()

    await page.getByTestId('list-view-list').click()
    const row = page.locator(`[data-task-id="${task.id}"]`)
    await row.getByTestId('all-tasks-row-title').click()
    const input = row.getByTestId('all-tasks-row-content-input')
    await input.fill('Water the ferns twice a week')
    await input.press('Enter')

    await expect(row.getByTestId('all-tasks-row-title')).toHaveText('Water the ferns twice a week')
  })
})
