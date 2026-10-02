/**
 * FEAT-030 — Tasks: Completed analytics (`/tasks/completed`,
 * docs/backlog/EP-07-tasks-depth/FEAT-030-tasks-completed-analytics.md).
 *
 * Covers: the analytics panel stays hidden with zero completions, appears
 * once something is completed with a correct total/average, the heatmap
 * shows today's cell, the by-list breakdown resolves list names, and the
 * server aggregation endpoint itself.
 */

import { test, expect, type Page } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

/**
 * Create a task via POST /tasks, then PATCH it completed with a specific
 * `completedAt` — the create-then-PATCH seeding hook documented in
 * e2e/92-tasks-assigned.spec.ts: `POST /tasks` deliberately excludes
 * `completedAt` from its INSERT (D-3), but the generic PATCH's `TASK_COLS`
 * allowlist (worker/routes/tasks.ts) includes it, so the backdate has to go
 * through that second request.
 */
async function createCompletedAt(page: Page, content: string, completedAt: string) {
  const created = await page.request.post(`${API}/tasks`, { data: { content } })
  const task = await created.json()
  await page.request.patch(`${API}/tasks/${task.id}`, { data: { isCompleted: true, completedAt } })
  return task
}

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
    // Scoped to the band figure itself, not the whole panel — the panel's text
    // also contains day-of-month numbers (e.g. "2 October") that could
    // coincidentally match a loose `toContainText('2')`.
    await expect(page.getByTestId('completed-total-fig')).toHaveText('2')
    await expect(panel).toContainText('tasks completed')
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

  // FEAT-060 (docs/backlog/EP-07-tasks-depth/FEAT-060-tasks-completed-design-adoption.md)
  // — the 30d/6m/All range toggle, Export CSV, and the heatmap card's
  // streak/busiest-day band-stats.

  test('range toggle defaults to 6m and filters the day-grouped list without affecting the heatmap total', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const recentContent = 'Recent completion'
    const oldContent = 'Old completion'
    // 5 days ago: inside both 30d and 6m. 60 days ago: inside 6m, outside 30d.
    await createCompletedAt(page, recentContent, `${businessDatePlus(-5)} 09:00:00`)
    await createCompletedAt(page, oldContent, `${businessDatePlus(-60)} 09:00:00`)

    await page.goto('/tasks/completed')

    await expect(page.getByTestId('completed-range-6m')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(recentContent)).toBeVisible()
    await expect(page.getByText(oldContent)).toBeVisible()
    // Heatmap total counts both, unfiltered by the range toggle.
    await expect(page.getByTestId('completed-total-fig')).toHaveText('2')

    await page.getByTestId('completed-range-30d').click()
    await expect(page.getByTestId('completed-range-30d')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(recentContent)).toBeVisible()
    await expect(page.getByText(oldContent)).not.toBeVisible()

    // The heatmap/by-list cards aren't range-filtered — "a year of finishing
    // things" stays constant regardless of the day-grouped list's toggle.
    await expect(page.getByTestId('completed-total-fig')).toHaveText('2')
  })

  test('switching to 30d with only an older completion shows the range-empty state, not the never-completed one', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await createCompletedAt(page, 'Old only', `${businessDatePlus(-45)} 09:00:00`)

    await page.goto('/tasks/completed')
    await page.getByTestId('completed-range-30d').click()

    await expect(page.getByTestId('completed-empty-range')).toBeVisible()
    await expect(page.getByTestId('completed-empty-range')).toContainText('Nothing completed in the last 30 days')
    await expect(page.getByTestId('completed-empty')).not.toBeVisible()
  })

  test('Export CSV escapes a comma-and-quote-containing task per RFC 4180', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const content = 'Buy milk, eggs, and "the good" bread'
    const t = await (await page.request.post(`${API}/tasks`, { data: { content } })).json()
    await page.request.post(`${API}/tasks/${t.id}/complete`, { data: {} })

    await page.goto('/tasks/completed')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('completed-export-btn').click(),
    ])
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as ArrayBuffer))
    const csv = Buffer.concat(chunks).toString('utf-8')
    const lines = csv.split('\n')

    expect(lines[0]).toBe('content,list,completed date')
    const today = businessToday()
    // The embedded comma must not split the field, and the embedded " must be
    // doubled, not left unescaped (RFC 4180) — the whole field double-quoted.
    expect(lines).toContain(`"Buy milk, eggs, and ""the good"" bread","Unsorted",${today}`)
  })

  test('band-stats show a correct current streak across two consecutive days', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const yesterday = businessDatePlus(-1)
    await createCompletedAt(page, 'Yesterday task', `${yesterday} 09:00:00`)
    const t = await (await page.request.post(`${API}/tasks`, { data: { content: 'Today task' } })).json()
    await page.request.post(`${API}/tasks/${t.id}/complete`, { data: {} })

    await page.goto('/tasks/completed')

    await expect(page.getByTestId('completed-streak-current')).toHaveText('2 days')
  })
})
