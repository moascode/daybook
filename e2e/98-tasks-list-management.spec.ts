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

  test('assigning a task to a list from the All tasks row menu persists after reload', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.request.post(`${API}/task-lists`, { data: { name: 'Client work', color: '#3b82f6' } })
    const taskRes = await page.request.post(`${API}/tasks`, { data: { content: 'Send invoice' } })
    const task = await taskRes.json()

    await page.goto('/tasks/all')
    const row = page.locator(`[data-task-id="${task.id}"]`)
    await expect(row.getByTestId('all-tasks-row-list-chip')).toHaveAttribute('title', 'Unsorted')

    // The list move lives in the row's kebab ("Move to list"), as tasks-all.html puts row actions.
    await row.getByTestId(`all-tasks-row-options-${task.id}`).click()
    await page.getByTestId(`task-row-move-${task.id}`).hover()
    await page.getByRole('menuitemradio', { name: 'Client work', exact: true }).click()

    await expect(row.getByTestId('all-tasks-row-list-chip')).toHaveAttribute('title', 'Client work')

    await page.reload()
    const rowAfter = page.locator(`[data-task-id="${task.id}"]`)
    await expect(rowAfter.getByTestId('all-tasks-row-list-chip')).toHaveAttribute('title', 'Client work')
  })

  test('the outliner’s "Move to list…" dialog assigns a task to a list', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/lists/unsorted')

    const listRes = await page.request.post(`${API}/task-lists`, { data: { name: 'Errands 2', color: '#f97316' } })
    const list = await listRes.json()
    // TasksPage.tsx fetches taskLists once on mount — created after that
    // fetch already ran, so the picker needs a reload to see it.
    await page.reload()

    // This test exercises the OUTLINER's own "Move to list…" dialog
    // (BulletNode.tsx), not the List view's kebab — List is now the
    // page's default (tasks-lists-parity), so Outline needs selecting first.
    await page.getByTestId('list-view-outline').click()

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

    // Unsorted's Outline is scoped to list_id IS NULL roots only
    // (TasksPage.tsx's `listFilter`, tasks-lists-parity P0) — the task just
    // got filed under "Errands 2", so it no longer belongs on THIS page and
    // disappears the moment the store re-renders. Re-opening its menu here
    // to check "List: Errands 2" was the old (pre-scoping) assumption that
    // Outline showed every task regardless of list; re-verify the label on
    // the list it actually lives on now instead.
    await expect(page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Drop off dry cleaning' })).toHaveCount(0)

    await page.goto(`/tasks/lists/${list.id}`)
    await page.getByTestId('list-view-outline').click()
    await openTaskMenu(page, 'Drop off dry cleaning')
    await expect(page.getByRole('menuitem', { name: `List: ${list.name}` })).toBeVisible()
    await page.keyboard.press('Escape')

    // Confirm the server actually has it, not just an optimistic UI state.
    const check = await page.request.get(`${API}/tasks`)
    const rows: { content: string; list_id: string | null }[] = await check.json()
    expect(rows.find((r) => r.content === 'Drop off dry cleaning')?.list_id).toBe(list.id)
  })
})
