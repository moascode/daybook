/**
 * Design tokens (R1) — e2e tests.
 *
 * The token layer is invisible to tsc and to a reviewer reading CSS (the
 * double-inversion class of bug ships green — CLAUDE.md §18). These tests pin
 * the four things R1 must guarantee at runtime:
 *
 *   1. Semantics resolve through the primitive layer, and to DIFFERENT colours
 *      per theme (dark mode genuinely repaints, not just adds a class).
 *   2. Both theme markers work independently — the `.dark` class AND the
 *      [data-theme] attribute (D-2) — so the two theming mechanisms cannot drift.
 *   3. The tabular-nums rule is present, so money never renders in proportional
 *      figures once a component carries the class.
 *   4. No Tailwind `dark:` variant leaks into the compiled CSS — the token layer
 *      is the only theming mechanism (CLAUDE.md §18: there are none, and one
 *      would be the first).
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/settings')
})

test.afterAll(async () => {
  await page.context().close()
})

/** Resolve any CSS colour expression (incl. rgb(var(--token))) to its computed
 *  rgb string, using a throwaway probe element so var() chains are actually
 *  substituted by the browser rather than read back literally. */
function resolveColor(p: Page, expr: string) {
  return p.evaluate((c) => {
    const el = document.createElement('div')
    el.style.color = c
    document.body.appendChild(el)
    const v = getComputedStyle(el).color
    el.remove()
    return v
  }, expr)
}

// ── 1. Semantics resolve, and differ per theme ──────────────────────────

test('semantic tokens resolve to real colours, not a fallback', async () => {
  // --surface = --n-0 in light (white). If the primitive layer were missing,
  // the var() chain would collapse to transparent/black.
  expect(await resolveColor(page, 'rgb(var(--surface))')).toBe('rgb(255, 255, 255)')
  expect(await resolveColor(page, 'rgb(var(--canvas))')).toBe('rgb(246, 247, 249)')
  // A hue role resolves through its primitive too.
  expect(await resolveColor(page, 'rgb(var(--accent))')).not.toBe('rgb(0, 0, 0)')
})

test('dark mode re-maps the same roles to different colours', async () => {
  const lightSurface = await resolveColor(page, 'rgb(var(--surface))')

  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
    document.documentElement.dataset.theme = 'dark'
  })

  const darkSurface = await resolveColor(page, 'rgb(var(--surface))')
  expect(darkSurface).not.toBe(lightSurface)
  // --surface = --n-900 in dark.
  expect(darkSurface).toBe('rgb(22, 26, 33)')
  // --canvas = --n-1000 in dark.
  expect(await resolveColor(page, 'rgb(var(--canvas))')).toBe('rgb(9, 11, 15)')

  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.dataset.theme = 'light'
  })
})

// ── 2. Both markers work independently (D-2) ─────────────────────────────

test('the [data-theme] attribute alone drives the theme (ported CSS path)', async () => {
  // No `dark` class — only the attribute, which is what the ported proposal
  // CSS keys off. If only .dark worked, ported components would stay light.
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.dataset.theme = 'dark'
  })
  expect(await resolveColor(page, 'rgb(var(--surface))')).toBe('rgb(22, 26, 33)')

  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  expect(await resolveColor(page, 'rgb(var(--surface))')).toBe('rgb(255, 255, 255)')
})

test('the .dark class alone drives the theme (Tailwind utilities path)', async () => {
  // No data-theme=dark — only the class, which is what Tailwind darkMode:'class'
  // utilities key off. Both must resolve to the same dark surface.
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.classList.add('dark')
  })
  expect(await resolveColor(page, 'rgb(var(--surface))')).toBe('rgb(22, 26, 33)')

  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
  })
})

// ── 3. Tabular numerals ──────────────────────────────────────────────────

test('the tabular-nums rule is present for money classes', async () => {
  const variant = await page.evaluate(() => {
    const el = document.createElement('span')
    el.className = 'money'
    el.textContent = '1111.00'
    document.body.appendChild(el)
    const v = getComputedStyle(el).fontVariantNumeric
    el.remove()
    return v
  })
  expect(variant).toContain('tabular-nums')
})

// ── 4. No dark: variant leakage ──────────────────────────────────────────

test('no Tailwind dark: variant is compiled into the app CSS', async () => {
  const hasDarkVariant = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRule[]
      try {
        rules = Array.from(sheet.cssRules)
      } catch {
        continue // cross-origin sheet; skip
      }
      for (const rule of rules) {
        // A `dark:` utility compiles to a selector containing `.dark\:` under
        // darkMode:'class'. The token layer's own `.dark { … }` block is a bare
        // class and does not match.
        if (rule.cssText.includes('.dark\\:')) return true
      }
    }
    return false
  })
  expect(hasDarkVariant).toBe(false)
})
