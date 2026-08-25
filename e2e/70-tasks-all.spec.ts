/**
 * R5 PR-2 — All tasks page (docs/v2/.flow/R5-all-tasks/flow-plan.md,
 * docs/v2/tasks/02-design-adoption.md §All tasks).
 *
 * Covers: stat cards render, filtering by priority and free-text narrows the
 * list with a removable chip, the "No due date" group + "Schedule these"
 * moves a task into a dated group, and the completions chart / age-breakdown
 * sentence render with seeded data.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

test.describe('70 — All tasks page', () => {
  test('sidebar nav item is visible and stat cards render with no tasks yet', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const navAll = page.getByTestId('nav-tasks-all')
    await expect(navAll).toBeVisible()
    await navAll.click()
    await expect(page).toHaveURL(/\/tasks\/all$/)

    await expect(page.getByTestId('stat-open')).toHaveText('0')
    await expect(page.getByTestId('stat-overdue')).toHaveText('0')
    await expect(page.getByTestId('stat-due-today')).toHaveText('0')
    await expect(page.getByTestId('stat-no-due-date')).toHaveText('0')
  })

  test('filtering by priority narrows the list and shows a removable chip', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.request.post(`${API}/tasks`, { data: { content: 'High prio task', priority: 'high' } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Low prio task', priority: 'low' } })

    await page.goto('/tasks/all')
    await expect(page.getByText('High prio task')).toBeVisible()
    await expect(page.getByText('Low prio task')).toBeVisible()

    await page.getByTestId('all-tasks-filter-toggle').click()
    await page.getByTestId('all-tasks-filter-priority').selectOption('high')

    await expect(page.getByText('High prio task')).toBeVisible()
    await expect(page.getByText('Low prio task')).not.toBeVisible()

    const chip = page.getByTestId('all-tasks-filter-chip')
    await expect(chip).toContainText('Priority: High')

    // Removing the chip restores the full list.
    await chip.getByRole('button', { name: 'Remove filter' }).click()
    await expect(page.getByText('Low prio task')).toBeVisible()
    await expect(page.getByTestId('all-tasks-filter-chip')).toHaveCount(0)
  })

  test('free-text filter narrows the list with a removable chip via Clear all', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.request.post(`${API}/tasks`, { data: { content: 'Buy groceries' } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Book flight' } })

    await page.goto('/tasks/all')
    await page.getByTestId('all-tasks-filter-input').fill('groceries')

    await expect(page.getByText('Buy groceries')).toBeVisible()
    await expect(page.getByText('Book flight')).not.toBeVisible()

    const clearAll = page.getByTestId('all-tasks-filter-clear-all')
    await expect(clearAll).toBeVisible()
    await clearAll.click()

    await expect(page.getByTestId('all-tasks-filter-input')).toHaveValue('')
    await expect(page.getByText('Book flight')).toBeVisible()
  })

  test('"No due date" group renders with a Schedule-these button that moves tasks into today\'s group', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')
    const today = businessToday()

    await page.request.post(`${API}/tasks`, { data: { content: 'Someday task' } })
    await page.goto('/tasks/all')

    const undatedGroup = page.getByTestId('all-tasks-no-due-date-group')
    await expect(undatedGroup).toBeVisible()
    await expect(undatedGroup).toContainText('No due date')

    const scheduleBtn = page.getByTestId('schedule-undated-btn')
    await expect(scheduleBtn).toBeVisible()
    await scheduleBtn.click()

    // The undated group disappears and a dated group for today appears with
    // the task now inside it.
    await expect(page.getByTestId('all-tasks-no-due-date-group')).not.toBeVisible()
    const dayHeaders = page.getByTestId('all-tasks-day-header')
    await expect(dayHeaders.filter({ hasText: today.slice(8, 10) })).toBeVisible()
    await expect(page.getByTestId('all-tasks-row').filter({ hasText: 'Someday task' })).toBeVisible()
  })

  test('completions chart and age-breakdown sentence render with seeded data', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    // A fresh task shouldn't count; a 100-day-old one should.
    const oldCreatedAt = `${businessDatePlus(-100)} 00:00:00`

    await page.request.post(`${API}/tasks`, { data: { content: 'Fresh task' } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Old task', createdAt: oldCreatedAt } })

    await page.goto('/tasks/all')
    await expect(page.getByTestId('age-breakdown')).toContainText('1 open task is older than three months.')

    await expect(page.getByText('Completed, last 12 weeks')).toBeVisible()

    // Complete a task so the chart has at least one data point this week.
    const row = page.getByTestId('all-tasks-row').filter({ hasText: 'Fresh task' })
    await row.getByRole('button', { name: 'Mark complete' }).click()
    await page.reload()

    await expect(page.getByText('Completed, last 12 weeks')).toBeVisible()
  })
})
