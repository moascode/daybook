/**
 * R5 PR-3 — List detail page (docs/v2/.flow/R5-list-detail/flow-plan.md).
 *
 * Covers: the band renders a real list's name/colour and progress, the
 * List/Outline toggle switches views without losing the underlying task
 * set, List mode groups Open / Done-this-week correctly, and renaming a
 * list via the rail's settings panel persists across a reload.
 */

import { test, expect, type Page } from '@playwright/test'
import { newAppPage } from './helpers'

const API = '/api'

test.describe('71 — Tasks list detail page', () => {
  // Outline mode (this page's default — see TasksListDetailPage.tsx's doc
  // comment) mounts the unmodified TasksPage, which has a pre-existing,
  // out-of-scope perf issue (its `useTasks().loadTasks()` mount effect keeps
  // re-firing as long as it's mounted, see useTasks.ts's `store` dependency).
  // Left running, each leaked context in this file compounds that load on
  // top of the others and starts flaking later tests' timing. Track and
  // close the context after every test (unlike sibling spec files, whose
  // pages never hit this route) so they don't pile up across the file.
  let openPage: Page | undefined
  test.afterEach(async () => {
    await openPage?.context().close()
    openPage = undefined
  })

  test('band renders list name, colour swatch and progress for a real list', async ({ browser }) => {
    const page = (openPage = await newAppPage(browser, '/tasks'))

    const created = await page.request.post(`${API}/task-lists`, {
      data: { name: 'Groceries', color: '#3b82f6' },
    })
    const list = await created.json()

    await page.request.post(`${API}/tasks`, { data: { content: 'Buy milk', listId: list.id } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Buy eggs', listId: list.id } })

    await page.goto(`/tasks/lists/${list.id}`)
    await expect(page.getByTestId('list-detail-title')).toHaveText('Groceries')
    await expect(page.getByTestId('list-detail-swatch')).toBeVisible()
    await expect(page.getByTestId('list-detail-progress')).toHaveText('0 of 2')
  })

  test('List/Outline toggle switches views without losing the underlying task set', async ({ browser }) => {
    const page = (openPage = await newAppPage(browser, '/tasks'))

    const created = await page.request.post(`${API}/task-lists`, {
      data: { name: 'Chores', color: '#ef4444' },
    })
    const list = await created.json()
    await page.request.post(`${API}/tasks`, { data: { content: 'Take out trash', listId: list.id } })

    await page.goto(`/tasks/lists/${list.id}`)

    // Outline is the default view (kept identical to 01-tasks.spec.ts's
    // expectations at /tasks/lists/unsorted) — it should show the outliner
    // chrome, not the grouped List rows.
    await expect(page.getByTestId('list-view-outline')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'New task' }).first()).toBeVisible()

    await page.getByTestId('list-view-list').click()
    await expect(page.getByTestId('list-view-list')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Take out trash')).toBeVisible()
    await expect(page.getByTestId('list-detail-open-header')).toBeVisible()

    // Switch back — the task is still there, nothing was lost.
    await page.getByTestId('list-view-outline').click()
    await expect(page.getByRole('button', { name: 'New task' }).first()).toBeVisible()
  })

  test('List mode groups Open and Done-this-week correctly', async ({ browser }) => {
    const page = (openPage = await newAppPage(browser, '/tasks'))

    const created = await page.request.post(`${API}/task-lists`, {
      data: { name: 'Bills', color: '#f97316' },
    })
    const list = await created.json()

    await page.request.post(`${API}/tasks`, { data: { content: 'Pay rent', listId: list.id } })
    const doneRes = await page.request.post(`${API}/tasks`, {
      data: { content: 'Pay internet', listId: list.id },
    })
    const doneTask = await doneRes.json()
    await page.request.post(`${API}/tasks/${doneTask.id}/complete`, { data: {} })

    await page.goto(`/tasks/lists/${list.id}`)
    await page.getByTestId('list-view-list').click()

    await expect(page.getByTestId('list-detail-open-header')).toContainText('1')
    await expect(page.getByText('Pay rent')).toBeVisible()

    const doneToggle = page.getByTestId('list-detail-done-toggle')
    await expect(doneToggle).toBeVisible()
    await expect(doneToggle).toContainText('1')
    await expect(page.getByText('Pay internet')).toBeVisible()

    // Collapsing hides the done row without losing the open one.
    await doneToggle.click()
    await expect(page.getByText('Pay internet')).not.toBeVisible()
    await expect(page.getByText('Pay rent')).toBeVisible()
  })

  test('renaming a list via the rail settings panel persists across reload', async ({ browser }) => {
    const page = (openPage = await newAppPage(browser, '/tasks'))

    const created = await page.request.post(`${API}/task-lists`, {
      data: { name: 'Old name', color: '#10b981' },
    })
    const list = await created.json()

    await page.goto(`/tasks/lists/${list.id}`)
    await expect(page.getByTestId('list-detail-rail')).toBeVisible()

    const nameInput = page.getByTestId('list-detail-name-input')
    await nameInput.fill('New name')
    await page.getByTestId('list-detail-save-settings').click()
    await expect(page.getByTestId('list-detail-title')).toHaveText('New name')

    await page.reload()
    await expect(page.getByTestId('list-detail-title')).toHaveText('New name')
  })

  test('the unsorted pseudo-list has no settings rail', async ({ browser }) => {
    const page = (openPage = await newAppPage(browser, '/tasks/lists/unsorted'))
    await expect(page.getByTestId('list-detail-title')).toHaveText('Unsorted')
    await expect(page.getByTestId('list-detail-rail')).not.toBeVisible()
  })
})
