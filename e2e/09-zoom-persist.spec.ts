/**
 * Zoom state persistence — e2e tests.
 * Verifies rootId is saved to localStorage and restored on page reload.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, openTaskMenu, waitForApp } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/tasks')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Setup ──────────────────────────────────────────────────────────────

test('setup: create a parent task to zoom into', async () => {
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Zoom parent')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Sibling task')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(600)
})

// ── Zoom in ────────────────────────────────────────────────────────────

test('zooming into a task shows it in the breadcrumb', async () => {
  await openTaskMenu(page, 'Zoom parent')
  await page.getByRole('menuitem', { name: /Focus on this task/ }).click()
  await expect(page.locator('button[title="Zoom parent"]')).toBeVisible()
  // Sibling task is hidden (it's at root level, not a child)
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Sibling task' }),
  ).not.toBeVisible()
})

// ── Persist on reload ──────────────────────────────────────────────────

test('after page reload the zoom level is restored from localStorage', async () => {
  // Reload the same page (keeps IndexedDB and localStorage in the same context)
  await page.reload()
  await waitForApp(page)
  // Wait for tasks to load
  await page.waitForTimeout(500)

  // Breadcrumb should still show "Zoom parent"
  await expect(page.locator('button[title="Zoom parent"]')).toBeVisible()
  // Sibling is still hidden (we're still zoomed in)
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Sibling task' }),
  ).not.toBeVisible()
})

// ── Navigate home ─────────────────────────────────────────────────────

test('clicking the Home button clears zoom and is reflected in localStorage', async () => {
  await page.getByRole('button', { name: 'All tasks' }).click()
  // Breadcrumb "Zoom parent" button should be gone
  await expect(page.locator('button[title="Zoom parent"]')).not.toBeVisible()
  // Both tasks are visible again
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Zoom parent' }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Sibling task' }),
  ).toBeVisible()
})

test('after going home and reloading, zoom is NOT restored (home = null rootId)', async () => {
  await page.reload()
  await waitForApp(page)
  await page.waitForTimeout(500)

  // Should NOT be zoomed in — both tasks visible, no breadcrumb button
  await expect(page.locator('button[title="Zoom parent"]')).not.toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Zoom parent' }),
  ).toBeVisible()
})
