/**
 * App: mobile-responsive layout — Tier 3 feature.
 * Verifies the app is fully usable on a 390 × 844 mobile viewport
 * (iPhone 14 logical resolution) with no horizontal overflow.
 *
 * ALL TESTS IN THIS FILE ARE EXPECTED TO FAIL until the feature is implemented.
 */

import { test, expect } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { waitForApp } from './helpers'

test.skip(true, 'Tier 3 — not yet implemented')

const MOBILE_VIEWPORT = { width: 390, height: 844 }

// ── No horizontal overflow ─────────────────────────────────────────────

test('tasks page renders without horizontal scroll on 390 px viewport', async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
  const page = await ctx.newPage()
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
