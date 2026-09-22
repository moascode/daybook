/**
 * TaskDetailModal (BUG-007/008/009/010/011/012,
 * docs/backlog/EP-07-tasks-depth/). A shared full-edit modal — name, list,
 * due date, priority, note — opened by a click affordance on Today, All
 * tasks and Upcoming, since none of those views could previously show or
 * change every field of a task in one place.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessDatePlus } from './helpers'

const API = '/api'

test.describe('99 — Task detail modal', () => {
  test('opening a task from Today shows all fields and edits persist', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const composer = page.getByTestId('today-composer-input')
    await composer.fill('Renew passport')
    await composer.press('Enter')
    await expect(page.getByText('Renew passport')).toBeVisible()

    const row = page.getByTestId('today-task-row').filter({ hasText: 'Renew passport' })
    // FEAT-054: clicking `.task-title` on Today is now inline click-to-edit
    // (matching TaskListRow.tsx's pattern), not the detail-modal opener —
    // that moved to the kebab menu's "Edit details" action.
    await row.getByTestId(/^today-task-row-options-/).click()
    await page.getByRole('menuitem', { name: 'Edit details' }).click()

    const modal = page.getByTestId('task-detail-modal')
    await expect(modal).toBeVisible()
    await expect(page.getByTestId('task-detail-name')).toHaveValue('Renew passport')

    // Each field auto-saves independently via its own PATCH — waiting for
    // each response before the next edit avoids a real race (not just a
    // test artifact): four near-simultaneous in-flight requests can resolve
    // out of order, and whichever's response lands last overwrites the
    // page's local task with whatever snapshot IT saw, which may predate
    // another field's write landing. One user editing one field at a time
    // (the realistic case) never hits this; this sequencing matches that.
    const patchResponse = () => page.waitForResponse((r) => /\/api\/tasks\/[^/]+$/.test(r.url()) && r.ok())

    // Edit name — blurs to save.
    const nameInput = page.getByTestId('task-detail-name')
    await nameInput.fill('Renew passport (urgent)')
    await Promise.all([patchResponse(), nameInput.blur()])
    await expect(page.getByTestId('task-detail-name')).toHaveValue('Renew passport (urgent)')

    // Edit priority.
    await Promise.all([patchResponse(), page.getByTestId('task-detail-priority').selectOption('high')])

    // Edit list.
    await Promise.all([patchResponse(), page.getByTestId('task-detail-list').selectOption({ label: 'Work' })])

    // Edit note.
    const noteInput = page.getByTestId('task-detail-note')
    await noteInput.fill('Bring old passport + photo')
    await Promise.all([patchResponse(), noteInput.blur()])

    // Close, then reload — the modal never unmounts across a plain
    // close/reopen (it keeps its own `current` state), so reopening without
    // a reload would only prove the modal remembers itself, not that any of
    // this actually reached the server. A reload forces every field to come
    // back from a fresh GET.
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
    await expect(page.getByText('Renew passport (urgent)')).toBeVisible()
    await page.reload()

    const reopenedRow = page.getByTestId('today-task-row').filter({ hasText: 'Renew passport (urgent)' })
    await reopenedRow.getByTestId(/^today-task-row-options-/).click()
    await page.getByRole('menuitem', { name: 'Edit details' }).click()
    await expect(page.getByTestId('task-detail-name')).toHaveValue('Renew passport (urgent)')
    await expect(page.getByTestId('task-detail-priority')).toHaveValue('high')
    await expect(page.getByTestId('task-detail-list').locator('option:checked')).toHaveText('Work')
    await expect(page.getByTestId('task-detail-note')).toHaveValue('Bring old passport + photo')
  })

  test('Today composer creates a task with a chosen list and date', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const future = businessDatePlus(5)

    // FEAT-054 replaced the composer's inline list/date <select>s with the
    // shared New Task modal (opened via the composer's "Task" shortcut,
    // carrying over any text already typed) — same regression guard, new path.
    const composer = page.getByTestId('today-composer-input')
    await composer.fill('Pick up dry cleaning')
    await page.getByRole('button', { name: 'Task', exact: true }).click()

    const modal = page.getByTestId('task-form-modal')
    await expect(modal).toBeVisible()
    await expect(page.getByTestId('task-form-content')).toHaveValue('Pick up dry cleaning')
    await page.getByTestId('task-form-list').selectOption({ label: 'Errands' })
    await page.getByTestId('task-form-due-date').fill(future)
    await page.getByRole('button', { name: 'Add task' }).click()
    await expect(modal).not.toBeVisible()

    // A future-dated task doesn't land in today's groups — it shows in Up next.
    await expect(page.getByTestId('upnext-row').filter({ hasText: 'Pick up dry cleaning' })).toBeVisible()

    // Confirm the list actually persisted (not misparented — regression
    // guard for the addTask/parentId bug this PR also fixed). The raw API
    // returns snake_case columns (`SELECT t.*`), not the camelCase shape
    // useTasks.ts maps to client-side.
    const created = await page.request.get(`${API}/tasks?view=all`)
    const tasks = (await created.json()) as { content: string; list_id: string | null; parent_id: string | null }[]
    const task = tasks.find((t) => t.content === 'Pick up dry cleaning')
    expect(task).toBeTruthy()
    expect(task!.parent_id).toBeNull()
    expect(task!.list_id).not.toBeNull()
  })

  test('priority set from the modal is reflected by the All tasks priority filter', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.request.post(`${API}/tasks`, { data: { content: 'Ship the report' } })
    await page.goto('/tasks/all')

    const row = page.getByTestId('all-tasks-row').filter({ hasText: 'Ship the report' })
    await expect(row).toBeVisible()
    await row.getByTestId(/^task-row-detail-/).click()

    const modal = page.getByTestId('task-detail-modal')
    await expect(modal).toBeVisible()
    await page.getByTestId('task-detail-priority').selectOption('high')
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()

    await page.getByTestId('all-tasks-filter-toggle').click()
    await expect(page.getByTestId('all-tasks-filter-panel')).toBeVisible()
    await page.getByTestId('all-tasks-filter-priority').selectOption('high')
    await expect(page.getByTestId('all-tasks-row').filter({ hasText: 'Ship the report' })).toBeVisible()

    await page.getByTestId('all-tasks-filter-priority').selectOption('low')
    await expect(page.getByTestId('all-tasks-row').filter({ hasText: 'Ship the report' })).not.toBeVisible()
  })

  test('a card on the Upcoming board opens the detail modal', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const today = businessDatePlus(0)

    const created = await page.request.post(`${API}/tasks`, { data: { content: 'Team sync notes', dueDate: today } })
    const task = (await created.json()) as { id: string }
    await page.goto('/tasks/upcoming')

    await page.getByTestId(`upcoming-card-open-${task.id}`).click()
    const modal = page.getByTestId('task-detail-modal')
    await expect(modal).toBeVisible()
    await expect(page.getByTestId('task-detail-name')).toHaveValue('Team sync notes')
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
  })

  test("Upcoming's day-add composer files a new task into the chosen list", async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await page.goto('/tasks/upcoming')

    const today = businessDatePlus(0)
    await page.getByTestId(`upcoming-add-day-${today}`).click()
    await page.getByTestId(`upcoming-add-day-${today}`).fill('Prep standup')
    await page.getByTestId(`upcoming-add-day-list-${today}`).selectOption({ label: 'Household' })
    await page.getByTestId(`upcoming-add-day-${today}`).press('Enter')

    await expect(page.getByText('Prep standup')).toBeVisible()
    const tasks = (await (await page.request.get(`${API}/tasks?view=all`)).json()) as {
      content: string
      list_id: string | null
    }[]
    expect(tasks.find((t) => t.content === 'Prep standup')?.list_id).not.toBeNull()
  })
})
