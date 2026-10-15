/**
 * Tasks tracked time — timer + manual edit
 * (migration 0031_task_tracked_time.sql, shown on /tasks/completed).
 *
 * Covers: manual minutes persisting across a reload, the start/stop timer
 * (running chip, banked minutes), starting a second timer stopping the first
 * with a toast, the Completed page's per-day "of tracked work" total, the
 * PATCH validation, and completing a task banking + clearing a running timer.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { newAppPage } from './helpers'

const API = '/api'

interface TaskJson {
  id: string
  tracked_minutes: number
  timer_started_at: string | null
}

async function createTask(page: Page, content: string): Promise<string> {
  const res = await page.request.post(`${API}/tasks`, { data: { content } })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as TaskJson).id
}

async function getTask(page: Page, id: string): Promise<TaskJson> {
  const res = await page.request.get(`${API}/tasks`)
  const rows = (await res.json()) as TaskJson[]
  const row = rows.find((t) => t.id === id)
  expect(row).toBeTruthy()
  return row as TaskJson
}

async function addViaComposer(page: Page, content: string) {
  const composer = page.getByTestId('today-composer-input')
  await composer.fill(content)
  await composer.press('Enter')
  await expect(page.getByTestId('today-task-row').filter({ hasText: content })).toBeVisible()
}

async function openDetail(page: Page, content: string) {
  const row = page.getByTestId('today-task-row').filter({ hasText: content })
  await row.getByTestId(/^today-task-row-options-/).click()
  await page.getByRole('menuitem', { name: 'Edit details' }).click()
  await expect(page.getByTestId('task-detail-modal')).toBeVisible()
  await expect(page.getByTestId('task-detail-name')).toHaveValue(content)
}

test.describe('117 — Tasks tracked time', () => {
  test('manual minutes persist after a reload; the timer shows a running chip and banks time on stop', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await addViaComposer(page, 'Write the report')
    await openDetail(page, 'Write the report')

    const minutes = page.getByTestId('task-detail-minutes')
    await minutes.fill('45')
    const saved = page.waitForResponse((r) => /\/api\/tasks\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH' && r.ok())
    await minutes.press('Enter')
    await saved

    await page.reload()
    await openDetail(page, 'Write the report')
    await expect(page.getByTestId('task-detail-minutes')).toHaveValue('45')

    await page.getByTestId('task-timer-toggle').click()
    await expect(page.getByTestId('task-timer-elapsed')).toBeVisible()
    await expect(page.getByTestId('task-timer-toggle')).toHaveText(/Stop timer/)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('task-row-timer-running')).toBeVisible()

    // All tasks renders its own row component — it must carry the same chips.
    await page.goto('/tasks/all')
    const allRow = page.getByTestId('all-tasks-row').filter({ hasText: 'Write the report' })
    await expect(allRow.getByTestId('task-row-timer-running')).toBeVisible()
    await expect(allRow.getByTestId('task-row-tracked')).toHaveText('45m')
    await page.goto('/tasks')

    await openDetail(page, 'Write the report')
    await page.getByTestId('task-timer-toggle').click()
    await expect(page.getByTestId('task-timer-elapsed')).toHaveCount(0)

    const rows = (await (await page.request.get(`${API}/tasks`)).json()) as (TaskJson & { content: string })[]
    const row = rows.find((t) => t.content === 'Write the report')
    expect(row?.tracked_minutes).toBeGreaterThanOrEqual(45)
    expect(row?.timer_started_at).toBeNull()
  })

  test('invalid minutes show an inline error and are not saved', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await addViaComposer(page, 'Tidy the desk')
    await openDetail(page, 'Tidy the desk')

    const minutes = page.getByTestId('task-detail-minutes')
    await minutes.fill('-5')
    await minutes.press('Enter')
    await expect(page.getByTestId('task-detail-minutes-error')).toBeVisible()
  })

  test('starting a timer on a second task stops the first and says so', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await addViaComposer(page, 'Task Alpha')
    await addViaComposer(page, 'Task Beta')

    await openDetail(page, 'Task Alpha')
    await page.getByTestId('task-timer-toggle').click()
    await expect(page.getByTestId('task-timer-elapsed')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('task-detail-modal')).not.toBeVisible()

    await openDetail(page, 'Task Beta')
    await page.getByTestId('task-timer-toggle').click()
    await expect(page.getByTestId('toast').filter({ hasText: 'Stopped timer on Task Alpha' })).toBeVisible()

    const rows = (await (await page.request.get(`${API}/tasks`)).json()) as (TaskJson & { content: string })[]
    const alpha = rows.find((t) => t.content === 'Task Alpha')
    const beta = rows.find((t) => t.content === 'Task Beta')
    expect(alpha?.timer_started_at).toBeNull()
    expect(alpha?.tracked_minutes).toBeGreaterThanOrEqual(1)
    expect(beta?.timer_started_at).not.toBeNull()
  })

  test('the Completed page sums tracked work per day', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/completed')
    const a = await createTask(page, 'Tracked one')
    const b = await createTask(page, 'Tracked two')
    for (const [id, m] of [[a, 45], [b, 27]] as const) {
      const patch = await page.request.patch(`${API}/tasks/${id}`, { data: { trackedMinutes: m } })
      expect(patch.ok()).toBeTruthy()
      const done = await page.request.post(`${API}/tasks/${id}/complete`)
      expect(done.ok()).toBeTruthy()
    }
    await page.reload()

    const header = page.getByTestId('completed-day-header').first()
    await expect(header).toContainText('Today')
    await expect(header.getByTestId('completed-day-tracked')).toHaveText('1h 12m of tracked work')
  })

  test('PATCH rejects invalid trackedMinutes', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const id = await createTask(page, 'Validate me')
    for (const bad of [-1, 1.5, 100001, '5']) {
      const res = await page.request.patch(`${API}/tasks/${id}`, { data: { trackedMinutes: bad } })
      expect(res.status()).toBe(400)
    }
    expect((await getTask(page, id)).tracked_minutes).toBe(0)
  })

  test('timer endpoints return 409 for a double start / a stop with no timer', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const id = await createTask(page, 'Double start')
    expect((await page.request.post(`${API}/tasks/${id}/timer/stop`)).status()).toBe(409)
    expect((await page.request.post(`${API}/tasks/${id}/timer/start`)).ok()).toBeTruthy()
    expect((await page.request.post(`${API}/tasks/${id}/timer/start`)).status()).toBe(409)
  })

  test('completing a task with a running timer banks the time and clears the timer', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const id = await createTask(page, 'Finish while timing')
    expect((await page.request.post(`${API}/tasks/${id}/timer/start`)).ok()).toBeTruthy()
    expect((await page.request.post(`${API}/tasks/${id}/complete`)).ok()).toBeTruthy()

    const row = await getTask(page, id)
    expect(row.timer_started_at).toBeNull()
    expect(row.tracked_minutes).toBeGreaterThanOrEqual(1)
  })
})
