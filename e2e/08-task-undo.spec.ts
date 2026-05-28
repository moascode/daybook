/**
 * Task delete undo — e2e tests.
 * Tests the 5-second undo toast added in the Tier-1 UX pass.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, openTaskMenu } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/tasks')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Setup ──────────────────────────────────────────────────────────────

test('setup: create tasks for undo tests', async () => {
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Undo target task')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Second task')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(600)
})

// ── Menu delete shows toast ───────────────────────────────────────────

test('deleting via options menu shows a "Task deleted" toast', async () => {
  await openTaskMenu(page, 'Undo target task')
  await page.getByRole('menuitem', { name: 'Delete task' }).click()

  // Task is gone from the tree
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Undo target task' }),
  ).not.toBeVisible()

  // Toast appears with correct message
  const toast = page.getByTestId('toast')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('Task deleted')
})

test('the toast has a visible Undo button', async () => {
  const toast = page.getByTestId('toast')
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible()
})

// ── Undo restores task ────────────────────────────────────────────────

test('clicking Undo in the toast restores the deleted task', async () => {
  const toast = page.getByTestId('toast')
  await toast.getByRole('button', { name: 'Undo' }).click()
  await page.waitForTimeout(600) // allow DB re-insert + loadTasks to complete

  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Undo target task' }),
  ).toBeVisible()
})

// ── Backspace delete shows toast ──────────────────────────────────────

test('deleting an empty task via Backspace also shows the undo toast', async () => {
  // Add a new empty task
  const countBefore = await page.getByRole('textbox', { name: 'Task content' }).count()
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(countBefore + 1)

  // The new editor is focused and empty — Backspace should delete it and show a toast
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(200)

  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(countBefore)
  await expect(page.getByTestId('toast')).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('Task deleted')
})

// ── Second delete replaces the first toast ────────────────────────────

test('a new deletion replaces the previous undo toast', async () => {
  // First delete: "Undo target task" — already restored so re-delete it
  await openTaskMenu(page, 'Undo target task')
  await page.getByRole('menuitem', { name: 'Delete task' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Undo target task' }),
  ).not.toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('Task deleted')

  // Immediately do a second delete: "Second task"
  await openTaskMenu(page, 'Second task')
  await page.getByRole('menuitem', { name: 'Delete task' }).click()

  // Wait for Second task to disappear before asserting toast count
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Second task' }),
  ).not.toBeVisible()

  // Only one toast should be visible (the second one replaced the first)
  await expect(page.getByTestId('toast')).toHaveCount(1)
  await expect(page.getByTestId('toast')).toContainText('Task deleted')
})

// ── Undo of task with children ────────────────────────────────────────

test('undo restores parent and all children', async () => {
  // Wait for any in-flight deletions from prior tests to settle
  await page.waitForTimeout(500)

  // Capture baseline count then create a parent/child pair
  const n = await page.getByRole('textbox', { name: 'Task content' }).count()
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(n + 1)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Parent task')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(n + 2)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Child task')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(500)

  // Indent "Child task" under "Parent task"
  const childNode = page.locator('[data-testid="bullet-node"]').filter({
    has: page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Child task' }),
  })
  const childId = await childNode.getAttribute('data-task-id')
  await page.evaluate(async (id) => (window as any).__testIndentTask(id), childId)
  await page.waitForTimeout(500)

  // Delete "Parent task" — this cascades to "Child task"
  await openTaskMenu(page, 'Parent task')
  await page.getByRole('menuitem', { name: 'Delete task' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Parent task' }),
  ).not.toBeVisible()

  // Undo should restore both parent and child
  await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click()
  await page.waitForTimeout(600)

  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Parent task' }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Child task' }),
  ).toBeVisible()
})
