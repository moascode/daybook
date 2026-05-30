/**
 * Task search — e2e tests.
 * Tests the always-visible search bar added in the Tier-1 UX pass.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/tasks')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Setup ──────────────────────────────────────────────────────────────

test('setup: create tasks for search tests', async () => {
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Alpha project planning')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Beta reminder note')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(3)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Gamma design review')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(600)

  // Verify all three tasks exist with correct distinct content
  await expect(page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: /^Alpha project planning$/ })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: /^Beta reminder note$/ })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: /^Gamma design review$/ })).toBeVisible()
})

// ── Search bar presence ────────────────────────────────────────────────

test('search bar is always visible on the tasks page', async () => {
  await expect(page.getByPlaceholder(/Search tasks/)).toBeVisible()
})

test('search bar is empty by default and tree is shown normally', async () => {
  await expect(page.getByPlaceholder(/Search tasks/)).toHaveValue('')
  // Tree editors are visible (at least the 3 we created)
  await expect(page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Alpha project planning' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Gamma design review' })).toBeVisible()
})

// ── Cmd+F shortcut ────────────────────────────────────────────────────

test('Cmd/Ctrl+F focuses the search input', async () => {
  // Make sure something else is focused first
  await page.getByRole('textbox', { name: 'Task content' }).first().click()
  // Use Ctrl+F (works on Linux/headless; the handler accepts metaKey or ctrlKey)
  await page.keyboard.press('Control+f')
  await expect(page.getByPlaceholder(/Search tasks/)).toBeFocused()
  await page.keyboard.press('Escape')
})

// ── Live filtering ─────────────────────────────────────────────────────

test('typing a query shows only matching tasks as flat results', async () => {
  await page.getByPlaceholder(/Search tasks/).fill('Alpha')
  // Result for "Alpha project planning" should appear
  await expect(page.getByText('Alpha project planning')).toBeVisible()
  // BulletTree editors should NOT be shown while searching
  await expect(page.getByRole('textbox', { name: 'Task content' })).not.toBeVisible()
})

test('results count label appears below results', async () => {
  // "1 result" label at the bottom of the results
  await expect(page.getByText('1 result')).toBeVisible()
})

test('search for "review" finds the matching task', async () => {
  await page.getByPlaceholder(/Search tasks/).fill('review')
  await expect(page.getByText('Gamma design review')).toBeVisible()
})

test('search is case-insensitive', async () => {
  await page.getByPlaceholder(/Search tasks/).fill('BETA')
  await expect(page.getByText('Beta reminder note')).toBeVisible()
})

// ── No results ────────────────────────────────────────────────────────

test('searching for a non-existent term shows "No tasks found" message', async () => {
  await page.getByPlaceholder(/Search tasks/).fill('zzz-no-match-xyz')
  await expect(page.getByText(/No tasks found/)).toBeVisible()
  // No result buttons should appear
  await expect(page.getByText('Alpha project planning')).not.toBeVisible()
})

// ── Click result navigates ─────────────────────────────────────────────

test('clicking a search result clears search and shows the tree at correct level', async () => {
  await page.getByPlaceholder(/Search tasks/).fill('Gamma')
  await expect(page.getByText('Gamma design review')).toBeVisible()

  // Click the result button
  const resultBtn = page.getByRole('button').filter({ hasText: 'Gamma design review' })
  await resultBtn.first().click()

  // Search should be cleared
  await expect(page.getByPlaceholder(/Search tasks/)).toHaveValue('')
  // Tree should be visible again with the task
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Gamma design review' }),
  ).toBeVisible()
})

// ── Dismiss search ────────────────────────────────────────────────────

test('Escape key clears the search and restores the tree', async () => {
  await page.getByPlaceholder(/Search tasks/).fill('Beta')
  await expect(page.getByText('Beta reminder note')).toBeVisible()
  await page.getByPlaceholder(/Search tasks/).press('Escape')
  await expect(page.getByPlaceholder(/Search tasks/)).toHaveValue('')
  // Tree is back
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Beta reminder note' }),
  ).toBeVisible()
})

test('clear (×) button appears when search has text and clears it on click', async () => {
  await page.getByPlaceholder(/Search tasks/).fill('Alpha')
  const clearBtn = page.getByRole('button', { name: 'Clear search' })
  await expect(clearBtn).toBeVisible()
  await clearBtn.click()
  await expect(page.getByPlaceholder(/Search tasks/)).toHaveValue('')
  // Tree is restored
  await expect(page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Alpha project planning' })).toBeVisible()
})

// ── Search across hierarchy ────────────────────────────────────────────

test('search finds tasks nested under other tasks (cross-level)', async () => {
  // Indent "Beta reminder note" to make it a child of "Alpha project planning"
  const betaNode = page.locator('[data-testid="bullet-node"]').filter({
    has: page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Beta reminder note' }),
  })
  const betaId = await betaNode.getAttribute('data-task-id')
  await page.evaluate(async (id) => window.__testIndentTask(id), betaId)
  await page.waitForTimeout(500)

  // Now search from home level — should still find "Beta" even though it's nested
  await page.getByPlaceholder(/Search tasks/).fill('Beta')
  await expect(page.getByText('Beta reminder note')).toBeVisible()

  // Path breadcrumb should show it's under "Alpha project planning"
  await expect(page.getByText(/Alpha project planning/)).toBeVisible()

  await page.getByPlaceholder(/Search tasks/).press('Escape')
})
