/**
 * CD-20: Tasks multi-select / bulk-delete — e2e tests.
 * Parity with Wallet's select mode: a "Select" toggle reveals per-node
 * checkboxes, selecting a parent implies its children, and bulk delete offers
 * a 5-second undo.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, bulletNodeFor } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/tasks/lists/unsorted')
})

test.afterAll(async () => {
  await page.context().close()
})

/** Create a root-level task with the given text. */
async function addRootTask(text: string) {
  await page.getByRole('button', { name: 'New task' }).first().click()
  const box = page.getByRole('textbox', { name: 'Task content' }).last()
  await expect(box).toBeFocused()
  await page.keyboard.type(text)
  await box.blur()
  await page.waitForTimeout(300)
}

function checkboxFor(text: string) {
  return bulletNodeFor(page, text).getByTestId('task-select-checkbox')
}

test('setup: create three root tasks', async () => {
  await addRootTask('Alpha')
  await addRootTask('Bravo')
  await addRootTask('Charlie')
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(3)
})

test('Select button reveals per-node checkboxes', async () => {
  // No checkboxes before entering select mode.
  await expect(checkboxFor('Alpha')).toHaveCount(0)

  await page.getByTestId('task-select-btn').click()

  await expect(checkboxFor('Alpha')).toBeVisible()
  await expect(checkboxFor('Bravo')).toBeVisible()
  await expect(checkboxFor('Charlie')).toBeVisible()
})

test('selecting two siblings and bulk-deleting removes them and shows undo', async () => {
  await checkboxFor('Alpha').click()
  await checkboxFor('Bravo').click()

  const deleteBtn = page.getByTestId('task-bulk-delete-btn')
  await expect(deleteBtn).toContainText('Delete 2')
  await deleteBtn.click()

  // Both selected tasks are gone; the unselected one remains.
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Alpha' }),
  ).not.toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Bravo' }),
  ).not.toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Charlie' }),
  ).toBeVisible()

  // Select mode exits and an undo toast appears.
  await expect(checkboxFor('Charlie')).toHaveCount(0)
  const toast = page.getByTestId('toast')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('2 tasks deleted')
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible()
})

test('Undo restores every bulk-deleted task', async () => {
  await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click()
  await page.waitForTimeout(600)

  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Alpha' }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Bravo' }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Task content' })).toHaveCount(3)
})

test('selecting a parent implies its children in the count and delete', async () => {
  // Build a parent/child pair: indent Bravo under Alpha.
  const bravoNode = page.locator('[data-testid="bullet-node"]').filter({
    has: page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Bravo' }),
  })
  const bravoId = await bravoNode.getAttribute('data-task-id')
  await page.evaluate((id) => window.__testIndentTask!(id as string), bravoId)
  await page.waitForTimeout(500)

  await page.getByTestId('task-select-btn').click()

  // Checking the parent auto-selects the child → count is 2.
  await checkboxFor('Alpha').click()
  await expect(checkboxFor('Bravo')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('task-bulk-delete-btn')).toContainText('Delete 2')

  await page.getByTestId('task-bulk-delete-btn').click()

  // Parent and child both gone; the untouched task survives.
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Alpha' }),
  ).not.toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Bravo' }),
  ).not.toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Charlie' }),
  ).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('2 tasks deleted')
})

test('Cancel leaves select mode without deleting', async () => {
  // Restore the previous deletion so we have >1 task again.
  await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click()
  await page.waitForTimeout(600)

  await page.getByTestId('task-select-btn').click()
  await checkboxFor('Charlie').click()
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Back to normal toolbar, nothing deleted.
  await expect(checkboxFor('Charlie')).toHaveCount(0)
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Charlie' }),
  ).toBeVisible()
})
