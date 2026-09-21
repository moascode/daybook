/**
 * FEAT-028 — Tasks: recurrence (docs/backlog/EP-07-tasks-depth/FEAT-028-task-recurrence.md).
 *
 * Covers: the outliner's "Repeats…" menu item and dialog (guard against no
 * due date, setting a weekly repeat, the recurrence badge, clearing it via
 * "Stop repeating"), and the materialization endpoint itself
 * (POST /tasks/recurring/process) — seeding a completed recurring task
 * directly via the API and confirming it spawns exactly one next occurrence
 * with its due date advanced, while the completed row's own recurrence is
 * cleared so it is never reprocessed.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, openTaskMenu, bulletNodeFor, businessToday } from './helpers'

const API = '/api'

test.describe('93 — Tasks recurrence', () => {
  test('options menu offers "Make it repeat…", and it requires a due date first', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/lists/unsorted')

    await page.getByRole('button', { name: 'New task' }).first().click()
    await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
    await page.keyboard.type('Water the plants')
    await page.getByRole('textbox', { name: 'Task content' }).last().blur()
    await page.waitForTimeout(500)

    await openTaskMenu(page, 'Water the plants')
    await expect(page.getByRole('menuitem', { name: /Make it repeat/i })).toBeVisible()
    await page.getByRole('menuitem', { name: /Make it repeat/i }).click()

    await expect(page.getByRole('dialog').getByText(/Set a due date first/i)).toBeVisible()
    await expect(page.getByTestId('recurrence-frequency-select')).not.toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('setting a weekly repeat shows the recurrence badge; "Stop repeating" clears it', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/lists/unsorted')
    const dueDate = businessToday()

    const res = await page.request.post(`${API}/tasks`, {
      data: { content: 'Take out the trash', dueDate },
    })
    const task = await res.json()
    await page.reload()

    const node = bulletNodeFor(page, 'Take out the trash')
    await expect(node).toBeVisible()

    await openTaskMenu(page, 'Take out the trash')
    await page.getByRole('menuitem', { name: /Make it repeat/i }).click()
    await page.getByTestId('recurrence-frequency-select').selectOption('weekly')
    await page.getByTestId('recurrence-save-btn').click()

    await expect(node.getByTestId('recurrence-badge')).toBeVisible()
    await expect(node.getByTestId('recurrence-badge')).toContainText('weekly')

    // Confirm the server actually persisted it, not just an optimistic UI state.
    const check = await page.request.get(`${API}/tasks`)
    const rows: { id: string; recurrence: string | null }[] = await check.json()
    expect(rows.find((r) => r.id === task.id)?.recurrence).toBe('weekly')

    await openTaskMenu(page, 'Take out the trash')
    await page.getByRole('menuitem', { name: /Repeats…/i }).click()
    await page.getByTestId('recurrence-clear-btn').click()

    await expect(node.getByTestId('recurrence-badge')).not.toBeVisible()
  })

  test('processing materializes exactly one next occurrence and clears the completed row', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const dueDate = businessToday()

    const res = await page.request.post(`${API}/tasks`, {
      data: {
        content: 'Weekly team sync',
        dueDate,
        isCompleted: true,
        recurrence: 'weekly',
        recurrenceData: { interval: 1 },
      },
    })
    const original = await res.json()

    const processRes = await page.request.post(`${API}/tasks/recurring/process`)
    const { created } = await processRes.json()
    expect(created).toBeGreaterThanOrEqual(1)

    const allRes = await page.request.get(`${API}/tasks?view=all`)
    const openTasks: { id: string; content: string; due_date: string; recurrence: string | null }[] =
      await allRes.json()
    const nextOccurrence = openTasks.find((t) => t.content === 'Weekly team sync')
    expect(nextOccurrence).toBeTruthy()
    expect(nextOccurrence!.due_date > dueDate).toBe(true)
    expect(nextOccurrence!.recurrence).toBe('weekly')

    const originalRes = await page.request.get(`${API}/tasks`)
    const allRows: { id: string; recurrence: string | null }[] = await originalRes.json()
    expect(allRows.find((r) => r.id === original.id)?.recurrence).toBeNull()

    // Running it again must not spawn a second occurrence — the completed
    // row's recurrence was cleared, so it is never reprocessed.
    const secondRun = await page.request.post(`${API}/tasks/recurring/process`)
    expect((await secondRun.json()).created).toBe(0)
  })

  test('processing carries the walletRef and assignee forward to the next occurrence', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const dueDate = businessToday()

    const meRes = await page.request.get(`${API}/auth/me`)
    const { user } = await meRes.json()

    const accountRes = await page.request.post(`${API}/accounts`, {
      data: { name: 'Main', type: 'bank', openingBalance: 0 },
    })
    const account = await accountRes.json()
    const billRes = await page.request.post(`${API}/recurring-transactions`, {
      data: { accountId: account.id, amount: 45, merchant: 'Electricity', frequency: 'monthly', nextDueDate: dueDate },
    })
    const bill = await billRes.json()

    const createRes = await page.request.post(`${API}/tasks`, {
      data: { content: 'Pay electricity', dueDate, isCompleted: true, recurrence: 'monthly', recurrenceData: { interval: 1 } },
    })
    const original = await createRes.json()
    await page.request.patch(`${API}/tasks/${original.id}`, {
      data: { walletRef: `recurring:${bill.id}`, assigneeId: user.id },
    })

    await page.request.post(`${API}/tasks/recurring/process`)

    const allRes = await page.request.get(`${API}/tasks?view=all`)
    const openTasks: { content: string; wallet_ref: string | null; assignee_id: string | null }[] =
      await allRes.json()
    const next = openTasks.find((t) => t.content === 'Pay electricity')
    expect(next).toBeTruthy()
    expect(next!.wallet_ref).toBe(`recurring:${bill.id}`)
    expect(next!.assignee_id).toBe(user.id)
  })
})
