/**
 * Tasks: task templates — Tier 3 feature.
 * Save a bullet structure as a named template and reuse it for recurring projects.
 *
 * ALL TESTS IN THIS FILE ARE EXPECTED TO FAIL until the feature is implemented.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, openTaskMenu } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/tasks')
  // Seed a task to save as template
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Project kickoff')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(500)
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Save as template ───────────────────────────────────────────────────

test('task options menu has a "Save as template" item', async () => {
  await openTaskMenu(page, 'Project kickoff')
  await expect(page.getByRole('menuitem', { name: /Save as template/i })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('clicking "Save as template" opens a dialog with a template name input', async () => {
  await openTaskMenu(page, 'Project kickoff')
  await page.getByRole('menuitem', { name: /Save as template/i }).click()
  await expect(page.getByRole('dialog').getByLabel(/Template name/i)).toBeVisible()
})

test('confirming the save creates the template and shows a success message', async () => {
  await page.getByRole('dialog').getByLabel(/Template name/i).fill('Project Kickoff Template')
  await page.getByRole('dialog').getByRole('button', { name: /Save|Create/i }).click()
  await expect(page.getByText(/Template saved|Template created/i)).toBeVisible()
})

// ── Apply template button ──────────────────────────────────────────────

test('"Templates" button is visible in the tasks toolbar', async () => {
  await expect(page.getByRole('button', { name: /Templates/i })).toBeVisible()
})

test('clicking "Templates" opens a dialog listing saved templates', async () => {
  await page.getByRole('button', { name: /Templates/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Project Kickoff Template')).toBeVisible()
})

// ── Apply template ─────────────────────────────────────────────────────

test('selecting a template and clicking Apply creates tasks from it', async () => {
  await page.getByRole('dialog').getByText('Project Kickoff Template').click()
  await page.getByRole('dialog').getByRole('button', { name: /Apply|Insert/i }).click()
  await page.waitForTimeout(600)
  // A copy of the template's root task should appear
  const matches = await page
    .getByRole('textbox', { name: 'Task content' })
    .filter({ hasText: 'Project kickoff' })
    .count()
  expect(matches).toBeGreaterThanOrEqual(2) // original + newly applied copy
})

// ── Delete template ────────────────────────────────────────────────────

test('opening Templates again shows the saved template', async () => {
  await page.getByRole('button', { name: /Templates/i }).click()
  await expect(page.getByRole('dialog').getByText('Project Kickoff Template')).toBeVisible()
})

test('deleting a template removes it from the list', async () => {
  const row = page.getByRole('dialog').locator(':has-text("Project Kickoff Template")')
  await row.getByRole('button', { name: /Delete/i }).click()
  await expect(page.getByRole('dialog').getByText('Project Kickoff Template')).not.toBeVisible()
})

test('templates list shows empty state after all templates are deleted', async () => {
  await expect(
    page.getByRole('dialog').getByText(/No templates|Save your first template/i),
  ).toBeVisible()
  await page.keyboard.press('Escape')
})
