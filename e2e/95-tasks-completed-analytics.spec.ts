/**
 * FEAT-030 — Tasks: Completed analytics (`/tasks/completed`,
 * docs/backlog/EP-07-tasks-depth/FEAT-030-tasks-completed-analytics.md).
 *
 * Covers: the analytics panel stays hidden with zero completions, appears
 * once something is completed with a correct total/average, the heatmap
 * shows today's cell, the by-list breakdown resolves list names, and the
 * server aggregation endpoint itself.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

test.describe('95 — Tasks completed analytics', () => {
  test('analytics panel is hidden with no completions', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/completed')
    await expect(page.getByTestId('completed-empty')).toBeVisible()
    await expect(page.getByTestId('completed-analytics')).not.toBeVisible()
  })

  test('completing tasks in different lists shows the panel with a correct total and by-list breakdown', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const today = businessToday()

    const listsRes = await page.request.get(`${API}/task-lists`)
    const lists: { id: string; name: string }[] = await listsRes.json()
    const someday = lists.find((l) => l.name === 'Someday')!
    const household = lists.find((l) => l.name === 'Household')!

    const t1 = await (
      await page.request.post(`${API}/tasks`, { data: { content: 'Quick chore', listId: household.id } })
    ).json()
    await page.request.post(`${API}/tasks/${t1.id}/complete`, { data: {} })

    const t2 = await (
      await page.request.post(`${API}/tasks`, { data: { content: 'Someday thing', listId: someday.id } })
    ).json()
    await page.request.post(`${API}/tasks/${t2.id}/complete`, { data: {} })

    await page.goto('/tasks/completed')

    const panel = page.getByTestId('completed-analytics')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('2 completed')
    await expect(page.getByTestId(`heatmap-day-${today}`)).toBeVisible()

    const byList = page.getByTestId('completed-by-list')
    await expect(byList).toContainText('Household')
    await expect(byList).toContainText('Someday')
  })

  test('GET /tasks/completed/analytics aggregates count and average correctly', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const t1 = await (await page.request.post(`${API}/tasks`, { data: { content: 'A' } })).json()
    await page.request.post(`${API}/tasks/${t1.id}/complete`, { data: {} })
    const t2 = await (await page.request.post(`${API}/tasks`, { data: { content: 'B' } })).json()
    await page.request.post(`${API}/tasks/${t2.id}/complete`, { data: {} })

    const res = await page.request.get(`${API}/tasks/completed/analytics`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.totalCompleted).toBe(2)
    expect(body.overallAvgDays).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(body.byList)).toBe(true)
    expect(Array.isArray(body.heatmap)).toBe(true)
    // Both tasks were created and completed the same instant, in Unsorted (no listId).
    const unsortedRow = body.byList.find((r: { listId: string | null }) => r.listId === null)
    expect(unsortedRow.count).toBe(2)
  })
})
