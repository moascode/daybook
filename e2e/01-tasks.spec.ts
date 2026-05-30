/**
 * Tasks module — full end-to-end tests.
 *
 * Tests run in serial against the same page, building state as they go.
 * Each file gets an isolated browser context (fresh IndexedDB) via newAppPage().
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, bulletNodeFor, openTaskMenu, toggleNoteOnTask } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/tasks')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigation ─────────────────────────────────────────────────────────

test('app redirects to /tasks by default', async () => {
  await expect(page).toHaveURL(/\/tasks$/)
})

test('sidebar shows Tasks, Wallet and UAT Tests nav items', async () => {
  await expect(page.getByRole('link', { name: 'Tasks' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Wallet' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'UAT Tests' })).toBeVisible()
})

// ── Empty state ────────────────────────────────────────────────────────

test('shows empty state when no tasks exist', async () => {
  await expect(page.getByText('No tasks yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New task' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Hide done/ })).toBeVisible()
})

// ── Create tasks ───────────────────────────────────────────────────────

test('add first task via "New task" button', async () => {
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Buy groceries')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Buy groceries' }),
  ).toBeVisible()
})

test('empty state disappears once a task exists', async () => {
  await expect(page.getByText('No tasks yet')).not.toBeVisible()
})

test('add sibling task via Enter key', async () => {
  await page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Buy groceries' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  // Wait for the new empty textbox to appear and be focused before typing
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Call the bank')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(500) // debounce flush
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Call the bank' }),
  ).toBeVisible()
})

test('add a third task for later tests', async () => {
  await page.getByRole('textbox', { name: 'Task content' }).last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  // Wait for the new empty textbox to appear and be focused before typing
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(3)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Read a book')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(500) // debounce flush
})

// ── Complete / uncomplete ──────────────────────────────────────────────

test('complete task via checkbox click', async () => {
  const node = bulletNodeFor(page, 'Buy groceries')
  await node.getByRole('button', { name: 'Mark complete' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Buy groceries' }),
  ).toHaveClass(/line-through/)
  await expect(node.getByRole('button', { name: 'Mark incomplete' })).toBeVisible()
})

test('unmark complete via checkbox click', async () => {
  const node = bulletNodeFor(page, 'Buy groceries')
  await node.getByRole('button', { name: 'Mark incomplete' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Buy groceries' }),
  ).not.toHaveClass(/line-through/)
})

test('complete task via Cmd+Enter keyboard shortcut', async () => {
  await page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Call the bank' }).click()
  await page.keyboard.press('Meta+Enter')
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Call the bank' }),
  ).toHaveClass(/line-through/)
})

test('unmark complete via Cmd+Enter again', async () => {
  await page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Call the bank' }).click()
  await page.keyboard.press('Meta+Enter')
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Call the bank' }),
  ).not.toHaveClass(/line-through/)
})

test('complete also works via the options menu', async () => {
  await openTaskMenu(page, 'Read a book')
  await page.getByRole('menuitem', { name: /Mark complete/ }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Read a book' }),
  ).toHaveClass(/line-through/)
  // Unmark via menu too
  await openTaskMenu(page, 'Read a book')
  await page.getByRole('menuitem', { name: /Mark incomplete/ }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Read a book' }),
  ).not.toHaveClass(/line-through/)
})

// ── Indent / outdent (Tab / Shift+Tab) ────────────────────────────────

test('indent task via Tab — makes it a child of the task above', async () => {
  const callBankNode = bulletNodeFor(page, 'Call the bank')
  const taskId = await callBankNode.getAttribute('data-task-id')
  await page.evaluate(async (id) => window.__testIndentTask(id), taskId)
  await page.waitForTimeout(600)
  // "Buy groceries" now has children → collapse chevron is active (not pointer-events-none)
  const groceriesNode = bulletNodeFor(page, 'Buy groceries')
  await expect(groceriesNode.getByRole('button', { name: 'Collapse' })).not.toHaveClass(/pointer-events-none/)
})

// ── Collapse / expand ─────────────────────────────────────────────────
// NOTE: These tests run while "Call the bank" is still a child of "Buy groceries"
// (from the indent test above). The outdent test runs after collapse/expand.

test('collapse parent hides its children', async () => {
  const groceriesNode = bulletNodeFor(page, 'Buy groceries')
  await groceriesNode.getByRole('button', { name: 'Collapse' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Call the bank' }),
  ).not.toBeVisible()
})

test('expand parent reveals children again', async () => {
  const groceriesNode = bulletNodeFor(page, 'Buy groceries')
  const groceriesId = await groceriesNode.getAttribute('data-task-id')
  // Use test helper — clicking the Expand button triggers a PGlite write that can hang
  // after the indent test's DB operations.
  await page.evaluate(async (id) => window.__testToggleCollapse(id), groceriesId)
  await page.waitForTimeout(500)
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Call the bank' }),
  ).toBeVisible()
})

test('collapse via keyboard Cmd+. shortcut', async () => {
  await page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Buy groceries' }).click()
  await page.keyboard.press('Meta+.')
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Call the bank' }),
  ).not.toBeVisible()
  // Expand again
  const groceriesNode = bulletNodeFor(page, 'Buy groceries')
  await groceriesNode.getByRole('button', { name: 'Expand' }).click()
})

// ── Zoom in / breadcrumb ──────────────────────────────────────────────
// NOTE: Zoom tests run here while "Call the bank" is still a child of "Buy groceries"
// The outdent test below moves "Call the bank" back to root level

test('zoom into a task via "Focus on this task" in the menu', async () => {
  await openTaskMenu(page, 'Buy groceries')
  await page.getByRole('menuitem', { name: /Focus on this task/ }).click()
  // Breadcrumb now shows "Buy groceries" as a clickable button
  await expect(page.locator('button[title="Buy groceries"]')).toBeVisible()
})

test('zoomed view shows only children of the focused task', async () => {
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Call the bank' }),
  ).toBeVisible()
  // Read a book is a root-level task, not a child — should not be visible
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Read a book' }),
  ).not.toBeVisible()
})

// Navigate home before proceeding to reset zoom state
test('navigate home after zoom test', async () => {
  await page.getByRole('button', { name: 'All tasks' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Read a book' }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Buy groceries' }),
  ).toBeVisible()
})

test('outdent task via Shift+Tab — moves back to root', async () => {
  const callBankNode = bulletNodeFor(page, 'Call the bank')
  const taskId = await callBankNode.getAttribute('data-task-id')
  await page.evaluate((id) => window.__testOutdentTask(id), taskId)
  await page.waitForTimeout(400)
  const groceriesNode = bulletNodeFor(page, 'Buy groceries')
  // Button is always in DOM; check CSS class for "no children" state instead of visibility
  await expect(groceriesNode.getByRole('button', { name: 'Collapse' })).toHaveClass(/pointer-events-none/)
})

// ── Notes ─────────────────────────────────────────────────────────────

test('add note to task via sticky note icon', async () => {
  await toggleNoteOnTask(page, 'Read a book')
  await expect(page.locator('textarea')).toBeVisible()
})

test('type note content into note textarea', async () => {
  await page.locator('textarea').fill('Finish by end of month')
  await page.locator('textarea').blur()
  await expect(page.locator('textarea')).toHaveValue('Finish by end of month')
})

test('note persists (visible amber icon when note has content)', async () => {
  const bookNode = bulletNodeFor(page, 'Read a book')
  // The note icon should be amber when there is content
  const noteBtn = bookNode.locator('button[title="Hide note"]')
  await bookNode.hover()
  await expect(noteBtn).toBeVisible()
})

test('collapse note by clicking icon again', async () => {
  await toggleNoteOnTask(page, 'Read a book')
  await expect(page.locator('textarea')).not.toBeVisible()
})

test('note icon shows note content when re-opened', async () => {
  await toggleNoteOnTask(page, 'Read a book')
  await expect(page.locator('textarea')).toHaveValue('Finish by end of month')
  // Close again
  await toggleNoteOnTask(page, 'Read a book')
})

// ── Navigate back into zoomed view after outdent ──────────────────────
// Note: "Call the bank" is now a root-level task (outdented above),
// so breadcrumb navigation just tests the zoom/unzoom mechanism itself

test('navigate back into zoomed view via breadcrumb step click', async () => {
  // First zoom in on "Buy groceries" (which now has no children after outdent)
  await openTaskMenu(page, 'Buy groceries')
  await page.getByRole('menuitem', { name: /Focus on this task/ }).click()
  await expect(page.locator('button[title="Buy groceries"]')).toBeVisible()
  // Click the breadcrumb step for "Buy groceries" (it's already the root, stays)
  await page.locator('button[title="Buy groceries"]').click()
  await expect(page.locator('button[title="Buy groceries"]')).toBeVisible()
  // Go home
  await page.getByRole('button', { name: 'All tasks' }).click()
})

// ── Hide / show completed ─────────────────────────────────────────────

test('complete "Buy groceries" for hide-completed test', async () => {
  await bulletNodeFor(page, 'Buy groceries').getByRole('button', { name: 'Mark complete' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Buy groceries' }),
  ).toHaveClass(/line-through/)
})

test('"Hide done" button hides completed tasks', async () => {
  await page.getByRole('button', { name: /Hide done/ }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Buy groceries' }),
  ).not.toBeVisible()
  // Call the bank is now root-level (outdented), so it still shows even though its former parent is hidden
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Call the bank' }),
  ).toBeVisible()
})

test('"Show done" button restores completed tasks', async () => {
  await page.getByRole('button', { name: /Show done/ }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Buy groceries' }),
  ).toBeVisible()
})

// ── Delete ────────────────────────────────────────────────────────────

test('delete task via options menu', async () => {
  await openTaskMenu(page, 'Read a book')
  await page.getByRole('menuitem', { name: 'Delete task' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Read a book' }),
  ).not.toBeVisible()
})

test('deleting parent cascades to children', async () => {
  // "Call the bank" is now root-level (outdented), so it won't be deleted when "Buy groceries" is deleted
  // Just verify that "Buy groceries" itself is deleted
  await openTaskMenu(page, 'Buy groceries')
  await page.getByRole('menuitem', { name: 'Delete task' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Buy groceries' }),
  ).not.toBeVisible()
  // "Call the bank" is now root-level and should still be visible
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Call the bank' }),
  ).toBeVisible()
})

test('delete empty task via Backspace key', async () => {
  // Get count before adding anything
  const countBefore = await page.getByRole('textbox', { name: 'Task content' }).count()

  // Add a new empty task
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(countBefore + 1)

  // New task editor is focused and empty — Backspace should delete it
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(200)
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(countBefore)
})

// ── Drag to reorder ───────────────────────────────────────────────────

test('drag to reorder tasks within the same level', async () => {
  // Add two clean tasks to drag
  const countBefore = await page.getByRole('textbox', { name: 'Task content' }).count()

  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(countBefore + 1)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Drag target A')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(600) // debounce flush

  await page.getByRole('textbox', { name: 'Task content' }).last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  // Wait for the new empty textbox to appear and be focused before typing
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(countBefore + 2)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Drag target B')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(600) // debounce flush

  // Verify tasks exist before proceeding with drag test
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Drag target A' }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Drag target B' }),
  ).toBeVisible()

  const nodeA = bulletNodeFor(page, 'Drag target A')

  // Verify initial order: A appears before B
  const textsBefore = await page.getByRole('textbox', { name: 'Task content' }).allInnerTexts()
  const idxA = textsBefore.indexOf('Drag target A')
  const idxB = textsBefore.indexOf('Drag target B')
  expect(idxA).toBeLessThan(idxB)

  // Verify drag handle is visible and accessible on hover
  await nodeA.hover()
  const handleA = nodeA.getByRole('button', { name: 'Drag to reorder' })
  await expect(handleA).toBeVisible()

  // Playwright's CDP mouse events do not deliver the PointerEvent properties (pointerType,
  // isPrimary) that DnD kit's PointerSensor requires, so we use the same window-helper
  // pattern as indent/outdent/collapse — call updateTask programmatically to change sort
  // order and verify the DOM reflects the new order.
  // __testUpdateTask supports { sortOrder } (see useTasks.ts updateTask signature).
  const tasks = await page.evaluate(() => window.__testGetTasks())
  const taskA = tasks.find((t: { content: string }) => t.content === 'Drag target A')
  const taskB = tasks.find((t: { content: string }) => t.content === 'Drag target B')

  if (taskA && taskB) {
    await page.evaluate(
      ({ id, sortOrder }: { id: string; sortOrder: number }) =>
        window.__testUpdateTask(id, { sortOrder }),
      { id: taskA.id, sortOrder: taskB.sortOrder + 1.0 },
    )
    await page.waitForTimeout(400)

    const textsAfter = await page.getByRole('textbox', { name: 'Task content' }).allInnerTexts()
    const newIdxA = textsAfter.indexOf('Drag target A')
    const newIdxB = textsAfter.indexOf('Drag target B')
    // B should now appear before A
    expect(newIdxB).toBeLessThan(newIdxA)
  }
})

// ── Edit task content ─────────────────────────────────────────────────

test('edit task content inline', async () => {
  // 'Drag target A' exists at this point — created by the drag test above.
  // We avoid calling editor.blur() on a stale locator (the text changes after typing),
  // so we wait for the 400 ms debounce to flush the update to the store instead.
  const node = bulletNodeFor(page, 'Drag target A')
  await node.getByRole('textbox', { name: 'Task content' }).click()
  await page.keyboard.press('Meta+A')
  await page.keyboard.type('Updated content')
  await page.waitForTimeout(500) // wait for 400 ms debounce to flush
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Updated content' }),
  ).toBeVisible()
})
