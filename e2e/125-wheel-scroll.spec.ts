/**
 * Mouse-wheel scrolling over page content must scroll the page.
 *
 * <main> used to carry overflow-y-auto, but the shell never constrains its
 * height, so it never scrolled — the document does. A global
 * `overscroll-behavior: contain` on every .overflow-*-auto then made that
 * empty scroll container swallow the wheel instead of chaining it to the page:
 * scrolling worked over the sidebar and did nothing over the content.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, waitForApp } from './helpers'

test('wheel over page content scrolls the document', async ({ browser }) => {
  // Help is long on any viewport and needs no seeded data.
  const page = await newAppPage(browser, '/help')
  await waitForApp(page)

  const box = await page.locator('main').boundingBox()
  if (!box) throw new Error('main has no layout box')

  await page.mouse.move(box.x + box.width / 2, 300)
  await page.mouse.wheel(0, 600)

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
})

test('<main> does not trap overscroll', async ({ browser }) => {
  const page = await newAppPage(browser, '/help')
  await waitForApp(page)

  const overscroll = await page
    .locator('main')
    .evaluate((el) => getComputedStyle(el).overscrollBehaviorY)
  expect(overscroll).toBe('auto')
})
