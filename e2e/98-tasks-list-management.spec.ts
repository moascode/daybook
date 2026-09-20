/**
 * FEAT-051 (docs/backlog/EP-07-tasks-depth/FEAT-051-task-list-picker.md)
 * + FEAT-053 (docs/backlog/EP-07-tasks-depth/FEAT-053-create-task-list.md) —
 * two halves of the same gap: FEAT-053 lets you create a list, FEAT-051 lets
 * you file a task into one.
 *
 * Covers: creating a list from the sidebar, assigning a task to a list from
 * a row's picker (TasksAllPage) with the dot surviving a reload, and the
 * outliner's own "Move to list…" dialog.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, openTaskMenu } from './helpers'

const API = '/api'

test.describe('98 — Tasks list management', () => {
  test('creating a list from the sidebar navigates to it and adds it to Lists', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.getByTestId('new-list-btn').click()
    await page.getByTestId('new-list-name-input').fill('Groceries')
    await page.getByTestId('new-list-color-swatch').nth(3).click()
    await page.getByTestId('new-list-create-btn').click()

    await expect(page).toHaveURL(/\/tasks\/lists\/[a-f0-9]+$/)
    await expect(page.getByTestId('list-detail-title')).toHaveText('Groceries')

    // Reload to confirm it actually persisted server-side.
    await page.reload()
    const navLink = page.locator('[data-testid^="nav-tasks-list-"]').filter({ hasText: 'Groceries' })
    await expect(navLink).toBeVisible()
  })

  test('assigning a task to a list from the All tasks row picker persists after reload', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const listRes = await page.request.post(`${API}/task-lists`, { data: { name: 'Work', color: '#3b82f6' } })
    const list = await listRes.json()
    const taskRes = await page.request.post(`${API}/tasks`, { data: { content: 'Send invoice' } })
    const task = await taskRes.json()

    await page.goto('/tasks/all')
    const row = page.locator(`[data-task-id="${task.id}"]`)
    await expect(row.getByTestId('all-tasks-row-list-chip')).toHaveAttribute('title', 'Unsorted')

    await row.getByTestId(`task-row-list-${task.id}`).selectOption(list.id)

    await expect(row.getByTestId('all-tasks-row-list-chip')).toHaveAttribute('title', 'Work')

    await page.reload()
    const rowAfter = page.locator(`[data-task-id="${task.id}"]`)
    await expect(rowAfter.getByTestId('all-tasks-row-list-chip')).toHaveAttribute('title', 'Work')
    await expect(rowAfter.getByTestId(`task-row-list-${task.id}`)).toHaveValue(list.id)
  })

  test('the outliner’s "Move to list…" dialog assigns a task to a list', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/lists/unsorted')

    const listRes = await page.request.post(`${API}/task-lists`, { data: { name: 'Errands 2', color: '#f97316' } })
    const list = await listRes.json()
    // TasksPage.tsx fetches taskLists once on mount — created after that
    // fetch already ran, so the picker needs a reload to see it.
    await page.reload()

    await page.getByRole('button', { name: 'New task' }).first().click()
    await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
    await page.keyboard.type('Drop off dry cleaning')
    await page.getByRole('textbox', { name: 'Task content' }).last().blur()
    await page.waitForTimeout(500)

    await openTaskMenu(page, 'Drop off dry cleaning')
    await expect(page.getByRole('menuitem', { name: /Move to list/i })).toBeVisible()
    await page.getByRole('menuitem', { name: /Move to list/i }).click()

    await page.getByTestId('task-list-select').selectOption(list.id)
    await page.getByTestId('task-list-save-btn').click()

    await openTaskMenu(page, 'Drop off dry cleaning')
    await expect(page.getByRole('menuitem', { name: `List: ${list.name}` })).toBeVisible()
    await page.keyboard.press('Escape')

    // Confirm the server actually has it, not just an optimistic UI state.
    const check = await page.request.get(`${API}/tasks`)
    const rows: { content: string; list_id: string | null }[] = await check.json()
    expect(rows.find((r) => r.content === 'Drop off dry cleaning')?.list_id).toBe(list.id)
  })
})
