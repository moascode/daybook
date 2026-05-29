/**
 * Tasks: due dates — Tier 2 feature.
 * Each task can have an optional due date. Overdue tasks show a visual indicator.
 * A "sort by due date" option reorders the list with soonest-due first.
 *
 * ALL TESTS IN THIS FILE ARE EXPECTED TO FAIL until the feature is implemented.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, bulletNodeFor, openTaskMenu } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/tasks')
  // Seed a task to work with
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Plan project launch')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(500)
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Menu entry ─────────────────────────────────────────────────────────

test('task options menu has a "Set due date" item', async () => {
  await openTaskMenu(page, 'Plan project launch')
  await expect(page.getByRole('menuitem', { name: /Set due date/i })).toBeVisible()
  await page.keyboard.press('Escape')
})

// ── Open date picker ───────────────────────────────────────────────────

test('clicking "Set due date" opens a dialog with a date input', async () => {
  await openTaskMenu(page, 'Plan project launch')
  await page.getByRole('menuitem', { name: /Set due date/i }).click()
  await expect(page.getByRole('dialog').getByLabel(/Due date/i)).toBeVisible()
})

// ── Future due date ────────────────────────────────────────────────────

test('setting a future due date shows the date on the task row', async () => {
  await page.getByRole('dialog').getByLabel(/Due date/i).fill('2099-12-31')
  await page.getByRole('dialog').getByRole('button', { name: /Save|Set|Confirm/i }).click()
  await expect(
    bulletNodeFor(page, 'Plan project launch').getByText(/31 Dec 2099|2099-12-31/),
  ).toBeVisible()
})

test('task with a future due date has no overdue indicator', async () => {
  const node = bulletNodeFor(page, 'Plan project launch')
  await expect(node.locator('[data-testid="overdue-indicator"]')).not.toBeVisible()
})

// ── Overdue indicator ──────────────────────────────────────────────────

test('setting a past due date shows an overdue indicator on the task', async () => {
  await openTaskMenu(page, 'Plan project launch')
  await page.getByRole('menuitem', { name: /Set due date/i }).click()
  await page.getByRole('dialog').getByLabel(/Due date/i).fill('2020-01-01')
  await page.getByRole('dialog').getByRole('button', { name: /Save|Set|Confirm/i }).click()
  await expect(
    bulletNodeFor(page, 'Plan project launch').locator('[data-testid="overdue-indicator"]'),
  ).toBeVisible()
})

// ── Sort by due date ───────────────────────────────────────────────────

test('"Sort by due date" button is visible in the tasks toolbar', async () => {
  await expect(page.getByRole('button', { name: /Sort by due date/i })).toBeVisible()
})

test('sort by due date puts overdue tasks before far-future tasks', async () => {
  // Add a second task with a far-future due date
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Far future task')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(500)
  await openTaskMenu(page, 'Far future task')
  await page.getByRole('menuitem', { name: /Set due date/i }).click()
  await page.getByRole('dialog').getByLabel(/Due date/i).fill('2099-06-01')
  await page.getByRole('dialog').getByRole('button', { name: /Save|Set|Confirm/i }).click()

  await page.getByRole('button', { name: /Sort by due date/i }).click()

  const texts = await page.getByRole('textbox', { name: 'Task content' }).allInnerTexts()
  const idxOverdue = texts.indexOf('Plan project launch') // 2020 — overdue
  const idxFuture = texts.indexOf('Far future task')     // 2099 — future
  expect(idxOverdue).toBeLessThan(idxFuture)
})

// ── Clear due date ─────────────────────────────────────────────────────

test('clearing the due date removes the date label and overdue indicator', async () => {
  await openTaskMenu(page, 'Plan project launch')
  await page.getByRole('menuitem', { name: /Set due date/i }).click()
  await page.getByRole('dialog').getByLabel(/Due date/i).fill('')
  await page.getByRole('dialog').getByRole('button', { name: /Save|Set|Confirm/i }).click()
  const node = bulletNodeFor(page, 'Plan project launch')
  await expect(node.locator('[data-testid="overdue-indicator"]')).not.toBeVisible()
  await expect(node.getByText(/2020-01-01/)).not.toBeVisible()
})
