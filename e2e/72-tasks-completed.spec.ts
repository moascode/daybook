/**
 * R5 PR-4 — Completed page (final PR of R5,
 * docs/v2/.flow/R5-completed/flow-plan.md).
 *
 * Covers: completions render grouped by day, un-completing a row removes it
 * from the page, the sidebar's Completed nav item navigates correctly, and
 * Habits renders disabled with its stated reason.
 */

import { test, expect } from '@playwright/test'
import { newAppPage } from './helpers'

const API = '/api'

test.describe('72 — Tasks completed page', () => {
  test('sidebar nav item navigates and shows an empty state with no completions', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const nav = page.getByTestId('nav-tasks-completed')
    await expect(nav).toBeVisible()
    await nav.click()
    await expect(page).toHaveURL(/\/tasks\/completed$/)

    await expect(page.getByTestId('completed-empty')).toBeVisible()
  })

  test('Habits nav item renders disabled with its stated reason', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const habits = page.getByTestId('nav-tasks-habits')
    await expect(habits).toBeVisible()
    await expect(habits).toHaveAttribute('aria-disabled', 'true')
    await expect(habits).toHaveAttribute('aria-label', /Coming in R11/)
  })

  test('completed tasks render grouped by day', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const res1 = await page.request.post(`${API}/tasks`, { data: { content: 'Finish report' } })
    const task1 = await res1.json()
    await page.request.post(`${API}/tasks/${task1.id}/complete`, { data: {} })

    const res2 = await page.request.post(`${API}/tasks`, { data: { content: 'Water the plants' } })
    const task2 = await res2.json()
    await page.request.post(`${API}/tasks/${task2.id}/complete`, { data: {} })

    await page.goto('/tasks/completed')

    await expect(page.getByTestId('completed-day-header').first()).toBeVisible()
    await expect(page.getByText('Finish report')).toBeVisible()
    await expect(page.getByText('Water the plants')).toBeVisible()
  })

  test('un-completing a row removes it from the page', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const res = await page.request.post(`${API}/tasks`, { data: { content: 'Submit expenses' } })
    const task = await res.json()
    await page.request.post(`${API}/tasks/${task.id}/complete`, { data: {} })

    await page.goto('/tasks/completed')
    await expect(page.getByText('Submit expenses')).toBeVisible()

    await page.locator(`[data-task-id="${task.id}"]`).getByLabel('Mark incomplete').click()
    await expect(page.getByText('Submit expenses')).not.toBeVisible()
  })
})
