/**
 * FEAT-055 / FEAT-056 — the composer's Reminder and Checklist acts
 * (docs/archive/ep-07-tasks-depth/). Reminder: a task with `remind_at` and no
 * due date, listed on Today, delivered by the reminder sweep. Checklist: a
 * parent plus `parentId` children, editable from the task detail modal.
 *
 * Push delivery itself cannot be asserted (no VAPID keys in the harness), so
 * the sweep is exercised through POST /api/test/run-reminders and its
 * observable effect — the in-app notification — instead.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

test.describe('116 — Composer reminder + checklist', () => {
  test('Reminder mode creates an undated task with a reminder chip that lists on Today', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const today = businessToday()

    const reminderAct = page.getByTestId('composer-act-reminder')
    await reminderAct.click()
    await expect(reminderAct).toHaveAttribute('aria-pressed', 'true')

    const input = page.getByTestId('today-composer-input')
    await input.fill('Check on the roast')

    // The time is required: Send stays disabled and says why until it is set.
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled()
    await expect(page.getByTestId('composer-reminder-hint')).toBeVisible()

    await page.getByTestId('composer-reminder-date').fill(today)
    await page.getByTestId('composer-reminder-time').fill('23:59')
    await page.getByRole('button', { name: 'Send' }).click()

    const row = page.getByTestId('today-task-row').filter({ hasText: 'Check on the roast' })
    await expect(row).toBeVisible()
    await expect(row.getByTestId('today-task-row-reminder')).toContainText('23:59')

    // Push is not enabled in the harness, so the toast must not promise one.
    await expect(page.getByText(/show in Daybook's notifications/)).toBeVisible()
    await expect(page.getByText(/turn on phone notifications in Settings/)).toBeVisible()

    // Composer left reminder mode.
    await expect(reminderAct).toHaveAttribute('aria-pressed', 'false')

    // No due date was set — missing the reminder can never make it overdue.
    const rows = (await (await page.request.get(`${API}/tasks?view=all`)).json()) as {
      content: string
      due_date: string | null
      remind_at: string | null
    }[]
    const saved = rows.find((r) => r.content === 'Check on the roast')
    expect(saved?.due_date).toBeNull()
    expect(saved?.remind_at).toBe(`${today}T23:59`)

    // And it survives a reload on Today (selection comes from the server's remind_at).
    await page.reload()
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Check on the roast' })).toBeVisible()
  })

  test('a reminder for a later day does not list on Today and its chip names the day', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/all')
    const res = await page.request.post(`${API}/tasks`, {
      data: { content: 'Call the plumber', remindAt: `${businessDatePlus(2)}T09:00` },
    })
    expect(res.ok()).toBe(true)
    await page.reload()
    const row = page.getByTestId('all-tasks-row').filter({ hasText: 'Call the plumber' })
    await expect(row.getByTestId('all-tasks-row-reminder')).toContainText('09:00')

    await page.goto('/tasks')
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Call the plumber' })).toHaveCount(0)
  })

  test('the reminder sweep puts "Reminder: <content>" into the pending notifications', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const today = businessToday()

    const create = await page.request.post(`${API}/tasks`, {
      data: { content: 'Take the bread out', remindAt: `${today}T00:00` },
    })
    expect(create.status()).toBe(201)

    const sweep = await page.request.post(`${API}/test/run-reminders`, { data: { now: `${today}T00:05` } })
    expect(sweep.ok()).toBe(true)
    const run = (await sweep.json()) as { due: number; claimed: number }
    expect(run.due).toBeGreaterThanOrEqual(1)
    expect(run.claimed).toBeGreaterThanOrEqual(1)

    const pending = (await (await page.request.get(`${API}/notifications/pending`)).json()) as {
      notifications: { kind: string; title: string; attention: boolean }[]
    }
    const reminder = pending.notifications.find((n) => n.kind === 'reminders')
    expect(reminder?.title).toBe('Reminder: Take the bread out')
    expect(reminder?.attention).toBe(true)

    // A second sweep claims nothing new — each reminder fires once.
    const again = (await (await page.request.post(`${API}/test/run-reminders`, { data: { now: `${today}T00:10` } })).json()) as {
      claimed: number
    }
    expect(again.claimed).toBe(0)
  })

  test('a malformed remindAt is rejected with 400 and null clears it', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    for (const bad of ['tomorrow 5pm', '2026-13-45T25:99', '2026-10-15 09:00', '2026-10-15T9:00']) {
      const res = await page.request.post(`${API}/tasks`, { data: { content: 'Bad reminder', remindAt: bad } })
      expect(res.status(), bad).toBe(400)
    }

    const ok = await page.request.post(`${API}/tasks`, {
      data: { content: 'Good reminder', remindAt: `${businessToday()}T18:30` },
    })
    const task = (await ok.json()) as { id: string; remind_at: string }
    expect(task.remind_at).toBe(`${businessToday()}T18:30`)

    const badPatch = await page.request.patch(`${API}/tasks/${task.id}`, { data: { remindAt: 'soon' } })
    expect(badPatch.status()).toBe(400)

    const cleared = await page.request.patch(`${API}/tasks/${task.id}`, { data: { remindAt: null } })
    expect(cleared.ok()).toBe(true)
    expect(((await cleared.json()) as { remind_at: string | null }).remind_at).toBeNull()
  })

  test('the detail modal sets and clears a reminder on any task', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const input = page.getByTestId('today-composer-input')
    await input.fill('Water the plants')
    await input.press('Enter')

    const row = page.getByTestId('today-task-row').filter({ hasText: 'Water the plants' })
    await row.getByTestId(/^today-task-row-options-/).click()
    await page.getByRole('menuitem', { name: 'Edit details' }).click()
    await expect(page.getByTestId('task-detail-modal')).toBeVisible()

    const patched = () => page.waitForResponse((r) => /\/api\/tasks\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH' && r.ok())
    await page.getByTestId('task-detail-remind-date').fill(businessToday())
    await Promise.all([patched(), page.getByTestId('task-detail-remind-time').fill('21:15')])

    await page.keyboard.press('Escape')
    await expect(row.getByTestId('today-task-row-reminder')).toContainText('21:15')

    await row.getByTestId(/^today-task-row-options-/).click()
    await page.getByRole('menuitem', { name: 'Edit details' }).click()
    await Promise.all([patched(), page.getByTestId('task-detail-remind-clear').click()])
    await page.keyboard.press('Escape')
    await expect(row.getByTestId('today-task-row-reminder')).toHaveCount(0)
  })

  test('Checklist mode creates a parent with three subtasks, visible in the detail modal', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.getByTestId('composer-act-checklist').click()
    await page.getByTestId('today-composer-input').fill('Packing list')

    // Enter in the title moves to the first item; Enter in an item adds the next.
    await page.getByTestId('today-composer-input').press('Enter')
    const items = page.getByTestId('composer-checklist-item')
    await expect(items.first()).toBeFocused()
    await items.first().fill('Passport')
    await items.first().press('Enter')
    await expect(items).toHaveCount(2)
    await items.nth(1).fill('Charger')
    await items.nth(1).press('Enter')
    await expect(items).toHaveCount(3)
    await items.nth(2).fill('Sunscreen')

    // Backspace on an empty item removes it.
    await items.nth(2).press('Enter')
    await expect(items).toHaveCount(4)
    await items.nth(3).press('Backspace')
    await expect(items).toHaveCount(3)

    await page.getByRole('button', { name: 'Send' }).click()

    const row = page.getByTestId('today-task-row').filter({ hasText: 'Packing list' })
    await expect(row).toBeVisible()
    await expect(row.getByTestId('today-task-row-subtasks')).toHaveText('0 of 3')
    // Mode closed again.
    await expect(page.getByTestId('composer-checklist-items')).toHaveCount(0)

    // Children exist server-side, in order, under the parent.
    const all = (await (await page.request.get(`${API}/tasks`)).json()) as {
      id: string
      content: string
      parent_id: string | null
    }[]
    const parent = all.find((t) => t.content === 'Packing list')
    expect(parent).toBeTruthy()
    const children = all
      .filter((t) => t.parent_id === parent!.id)
    expect(children.map((c) => c.content)).toEqual(['Passport', 'Charger', 'Sunscreen'])

    // Open the detail modal: the three items are listed.
    await row.getByTestId(/^today-task-row-options-/).click()
    await page.getByRole('menuitem', { name: 'Edit details' }).click()
    const subtasks = page.getByTestId('task-detail-subtask')
    await expect(subtasks).toHaveCount(3)
    await expect(subtasks.nth(0)).toContainText('Passport')
  })

  test('an item added from the detail modal persists after a reload and updates the badge', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const input = page.getByTestId('today-composer-input')
    await input.fill('Trip prep')
    await input.press('Enter')

    const row = page.getByTestId('today-task-row').filter({ hasText: 'Trip prep' })
    await row.getByTestId(/^today-task-row-options-/).click()
    await page.getByRole('menuitem', { name: 'Edit details' }).click()

    const itemInput = page.getByTestId('task-detail-subtask-input')
    await itemInput.fill('Book hotel')
    await itemInput.press('Enter')
    await expect(page.getByTestId('task-detail-subtask')).toHaveCount(1)
    await expect(itemInput).toHaveValue('')

    // Tick it: the row badge follows without a reload.
    await page.getByRole('checkbox', { name: /Item done: Book hotel/ }).click()
    await page.keyboard.press('Escape')
    await expect(row.getByTestId('today-task-row-subtasks')).toHaveText('1 of 1')

    await page.reload()
    const reloaded = page.getByTestId('today-task-row').filter({ hasText: 'Trip prep' })
    await expect(reloaded.getByTestId('today-task-row-subtasks')).toHaveText('1 of 1')
    await reloaded.getByTestId(/^today-task-row-options-/).click()
    await page.getByRole('menuitem', { name: 'Edit details' }).click()
    await expect(page.getByTestId('task-detail-subtask')).toHaveCount(1)
    await expect(page.getByTestId('task-detail-subtask').first()).toContainText('Book hotel')
  })

  test('Escape leaves checklist mode and switching acts exits it', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.getByTestId('composer-act-checklist').click()
    await expect(page.getByTestId('composer-checklist-items')).toBeVisible()
    await page.getByTestId('today-composer-input').press('Escape')
    await expect(page.getByTestId('composer-checklist-items')).toHaveCount(0)

    await page.getByTestId('composer-act-checklist').click()
    await page.getByTestId('composer-act-reminder').click()
    await expect(page.getByTestId('composer-checklist-items')).toHaveCount(0)
    await expect(page.getByTestId('composer-reminder-fields')).toBeVisible()
  })
})
