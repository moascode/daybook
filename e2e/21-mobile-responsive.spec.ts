/**
 * App: mobile-responsive layout — Tier 3 feature.
 * Verifies the app is fully usable on a 390 × 844 mobile viewport
 * (iPhone 14 logical resolution) with no horizontal overflow.
 *
 * ALL TESTS IN THIS FILE ARE EXPECTED TO FAIL until the feature is implemented.
 */

import { test, expect } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { waitForApp, signUpOnPage, fillAccountForm, fillTransactionForm } from './helpers'

const MOBILE_VIEWPORT = { width: 390, height: 844 }
// Short viewport for modal/drawer scroll checks (Wave 2 — B3/C11)
const SHORT_MOBILE_VIEWPORT = { width: 390, height: 600 }

// ── No horizontal overflow ─────────────────────────────────────────────

test('tasks page renders without horizontal scroll on 390 px viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/tasks')
  await waitForApp(page)

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1) // 1 px tolerance for sub-pixel rounding
  await ctx.close()
})

test('wallet page renders without horizontal scroll on 390 px viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/wallet')
  await waitForApp(page)

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  await ctx.close()
})

// ── Navigation accessible on mobile ───────────────────────────────────

test('main navigation is accessible on mobile (hamburger menu or visible nav links)', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/tasks')
  await waitForApp(page)

  // On mobile the sidebar may collapse to a hamburger toggle
  const hasHamburger = await page
    .getByRole('button', { name: /Menu|Open navigation|Open sidebar/i })
    .isVisible()
    .catch(() => false)
  const hasNavLinks = await page.getByRole('link', { name: 'Tasks' }).isVisible().catch(() => false)

  expect(hasHamburger || hasNavLinks).toBeTruthy()
  await ctx.close()
})

test('tapping the mobile menu button reveals navigation links', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/tasks')
  await waitForApp(page)

  const hamburger = page.getByRole('button', { name: /Menu|Open navigation|Open sidebar/i })
  const isHamburgerVisible = await hamburger.isVisible().catch(() => false)

  if (isHamburgerVisible) {
    await hamburger.click()
    await expect(page.getByRole('link', { name: 'Tasks' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Wallet' })).toBeVisible()
  } else {
    // If no hamburger, nav links must already be visible
    await expect(page.getByRole('link', { name: 'Tasks' })).toBeVisible()
  }
  await ctx.close()
})

// ── Core interactions work on mobile ──────────────────────────────────

test('can add a task on mobile viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/tasks')
  await waitForApp(page)

  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Task content' }).last()).toBeFocused()
  await page.keyboard.type('Mobile task')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(500)
  await expect(
    page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: 'Mobile task' }),
  ).toBeVisible()
  await ctx.close()
})

test('wallet "Add Transaction" button is tappable on mobile viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/wallet')
  await waitForApp(page)

  await expect(page.getByRole('button', { name: 'Add Transaction' })).toBeVisible()
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await ctx.close()
})

// ── Readable font size ─────────────────────────────────────────────────

test('task content text is at least 14 px on mobile viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/tasks')
  await waitForApp(page)

  // Add a task so there is something to measure
  await page.getByRole('button', { name: 'New task' }).first().click()
  await page.keyboard.type('Font size check')
  await page.getByRole('textbox', { name: 'Task content' }).last().blur()
  await page.waitForTimeout(500)

  const fontSize = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Task content"]')
    if (!el) return 0
    return parseFloat(getComputedStyle(el).fontSize)
  })
  expect(fontSize).toBeGreaterThanOrEqual(14)
  await ctx.close()
})

// ── Wave 2 (Phase 5c): modal scroll, dashboard reflow, drawer scroll ───

test('transaction form Type and Save are both reachable on a short mobile viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: SHORT_MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/wallet/accounts')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Mobile Cash' })

  await page.goto('/wallet')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Type toggle at the top of the form is on screen
  await expect(dialog.getByRole('button', { name: 'Expense' })).toBeVisible()

  // The dialog itself must not extend beyond the viewport (B3 max-height)
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(SHORT_MOBILE_VIEWPORT.height + 1)

  // Save at the bottom is reachable by scrolling inside the dialog
  const save = dialog.getByRole('button', { name: /Add Transaction/ })
  await save.scrollIntoViewIfNeeded()
  await expect(save).toBeVisible()
  await ctx.close()
})

test('dashboard reflows without horizontal scroll at 390 px with chart data', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  await page.goto('/wallet/accounts')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Dash Cash' })

  await page.goto('/wallet')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, { amount: '80', merchant: 'Market' })
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, { type: 'Income', amount: '3200', merchant: 'Salary' })

  await page.goto('/wallet/dashboard')
  await waitForApp(page)
  await expect(page.getByText('Cash Flow by Week')).toBeVisible()

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  await ctx.close()
})

test('sidebar drawer keeps Settings reachable on a short mobile viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: SHORT_MOBILE_VIEWPORT })
  const page = await ctx.newPage()
  await signUpOnPage(page)
  // /wallet auto-expands the wallet nav section — the long-list case (C11)
  await page.goto('/wallet')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Open sidebar' }).click()

  // Settings is pinned below the scrollable nav and stays fully on screen
  const settings = page.getByRole('link', { name: 'Settings' })
  await expect(settings).toBeVisible()
  const box = await settings.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(SHORT_MOBILE_VIEWPORT.height + 1)

  // The nav list itself scrolls, so the last wallet sub-item is reachable too
  const importLink = page.getByRole('link', { name: 'Import CSV' })
  await importLink.scrollIntoViewIfNeeded()
  await expect(importLink).toBeVisible()
  await ctx.close()
})
