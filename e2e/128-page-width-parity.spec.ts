/**
 * 128 — Tasks and Wallet pages share one page container. Wallet used its own
 * max-w-5xl wrapper, so the same viewport gave a narrower page that started
 * higher than Tasks'. Every module page now uses `.content`.
 */

import { test, expect } from '@playwright/test'
import { newAppPage } from './helpers'

const PATHS = ['/tasks', '/wallet', '/wallet/dashboard', '/wallet/accounts', '/wallet/budgets']

test('Tasks and Wallet pages render at the same width and top offset', async ({ browser }) => {
  const page = await newAppPage(browser, '/tasks')
  await page.setViewportSize({ width: 1600, height: 900 })

  const boxes: { path: string; x: number; y: number; width: number }[] = []
  for (const path of PATHS) {
    await page.goto(path)
    const content = page.locator('.content').first()
    await expect(content, path).toBeVisible()
    const box = await content.boundingBox()
    if (!box) throw new Error(`no .content box on ${path}`)
    boxes.push({ path, x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) })
  }

  for (const b of boxes) {
    expect({ x: b.x, width: b.width }, b.path).toEqual({ x: boxes[0].x, width: boxes[0].width })
    // 2px slack: /wallet lands 1px lower on some runs (sub-pixel rounding), which is not the bug.
    expect(Math.abs(b.y - boxes[0].y), b.path).toBeLessThanOrEqual(2)
  }
})
