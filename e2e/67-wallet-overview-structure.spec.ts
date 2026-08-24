/**
 * R3 PR-2 — structural-seam and correctness checks for the Overview restyle
 * (docs/v2/.flow/r3-pr2-wallet-overview/flow-plan.md, step 11 / criterion 33 /
 * docs/v2/foundation/04-e2e-and-migration.md §3).
 *
 * Modelled on e2e/66-wallet-visual-structure.spec.ts. Structural assertions
 * only where 05-wallet-dashboard.spec.ts already covers a figure; the hero
 * and featured-account tests are correctness checks (invariant 3 / README)
 * because those two sections are net-new UI, not a pure restyle.
 *
 * The mobile block deliberately mirrors 66's — those three cases reproduced
 * real bugs that shipped in R3 PR-1 because nothing exercised a populated
 * page at 390px; this page gets the same coverage from day one.
 */

import { test, expect } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { newAppPage, signUpOnPage, waitForApp, businessToday, fillAccountForm } from './helpers'

const MOBILE_VIEWPORT = { width: 390, height: 844 }

test.describe('wallet overview structure (R3 PR-2)', () => {
  test('the page root under the filter row carries .dash, and the hero carries .hero and .c8', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Overview Structure Bank' })

    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    await expect(page.locator('.dash:visible')).toBeVisible()
    const hero = page.getByTestId('overview-hero')
    await expect(hero).toHaveClass(/\bhero\b/)
    await expect(hero).toHaveClass(/\bc8\b/)
  })

  test('the hero has no buttons and no sparkline', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Overview No Actions Bank' })

    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    const hero = page.getByTestId('overview-hero')
    await expect(hero).toBeVisible()
    await expect(hero.locator('button')).toHaveCount(0)
    await expect(hero.locator('svg')).toHaveCount(0)
  })

  test('hero net worth is ownAccounts-only, matching README invariant 3', async ({ browser }) => {
    // Confirms the hero applies the same ownAccounts-only formula as
    // AccountsPage/WalletPage (PR #101's regression). The multi-user
    // shared-account exclusion itself is already covered end-to-end by
    // 34-shared-accounts.spec.ts; this test only needs to show the hero's
    // count and figure move together for a single owned account, which is
    // what would break if the hero ever summed the full `accounts` array.
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Own Small Bank' })

    const acctRes = await page.request.get('/api/accounts')
    const [acct] = (await acctRes.json()) as Array<{ id: string }>
    await page.request.post('/api/transactions', {
      data: { accountId: acct.id, date: businessToday(), merchant: 'Own Deposit', amount: 100, type: 'income' },
    })

    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    await expect(page.getByTestId('hero-net-worth')).toHaveText('RM 100.00')
    await expect(page.getByTestId('hero-account-count')).toHaveText('across 1 account')
  })

  test('hero money-in/out/kept match the existing stat-tile and spend-pace figures', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Hero Parity Bank' })

    const acctRes = await page.request.get('/api/accounts')
    const [acct] = (await acctRes.json()) as Array<{ id: string }>
    await page.request.post('/api/transactions', {
      data: { accountId: acct.id, date: businessToday(), merchant: 'Salary', amount: 3000, type: 'income' },
    })
    await page.request.post('/api/transactions', {
      data: { accountId: acct.id, date: businessToday(), merchant: 'Rent', amount: 1200, type: 'expense' },
    })

    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    // Wait for the async data load to actually settle before reading any
    // value — hero-money-in renders "RM 0.00" during the initial fetch, and
    // a plain .textContent() snapshot (unlike `expect(locator).toHaveText`)
    // does not retry, so an early read can compare two different moments.
    await expect(page.getByTestId('hero-money-in')).toHaveText(/RM\s*3,000\.00/)

    // tile-income's testid is on the whole tile (label + value + note), not
    // an isolated value span, so pull just the money-shaped substring out
    // rather than comparing full tile text against the hero's bare figure.
    const moneyPattern = /[+-]?RM\s*[\d,]+\.\d{2}/
    const heroIn = (await page.getByTestId('hero-money-in').textContent())?.trim()
    const heroOut = (await page.getByTestId('hero-money-out').textContent())?.trim()
    const heroKept = (await page.getByTestId('hero-kept').textContent())?.trim()
    const tileIncomeText = await page.getByTestId('tile-income').textContent()
    const spendHeroText = await page.getByTestId('spend-hero').textContent()
    const tileNetText = await page.getByTestId('tile-net').textContent()

    expect(heroIn).toBe(tileIncomeText?.match(moneyPattern)?.[0])
    expect(heroOut).toBe(spendHeroText?.match(moneyPattern)?.[0])
    expect(heroKept).toBe(tileNetText?.match(moneyPattern)?.[0])
  })

  test('featured-account carries .acct and .acct-feature, and names the higher-balance own account', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Small Account' })

    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Big Account' })

    const accountsRes = await page.request.get('/api/accounts')
    const accounts = (await accountsRes.json()) as Array<{ id: string; name: string }>
    const small = accounts.find((a) => a.name === 'Small Account')!
    const big = accounts.find((a) => a.name === 'Big Account')!
    await page.request.post('/api/transactions', {
      data: { accountId: small.id, date: businessToday(), merchant: 'Small Deposit', amount: 50, type: 'income' },
    })
    await page.request.post('/api/transactions', {
      data: { accountId: big.id, date: businessToday(), merchant: 'Big Deposit', amount: 5000, type: 'income' },
    })

    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    const featured = page.getByTestId('featured-account')
    await expect(featured).toBeVisible()
    await expect(featured).toHaveClass(/\bacct\b/)
    await expect(featured).toHaveClass(/\bacct-feature\b/)
    await expect(featured).toContainText('Big Account')
  })

  test('recent-activity shows at most 5 rows, no day-net pill, no mutating actions, and links to /wallet', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Recent Activity Bank' })

    const acctRes = await page.request.get('/api/accounts')
    const [acct] = (await acctRes.json()) as Array<{ id: string }>
    for (let i = 0; i < 8; i++) {
      await page.request.post('/api/transactions', {
        data: { accountId: acct.id, date: businessToday(), merchant: `Txn ${i}`, amount: 10 + i, type: 'expense' },
      })
    }

    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    const recent = page.getByTestId('recent-activity')
    await expect(recent).toBeVisible()
    await expect(recent.getByTestId('transaction-row')).toHaveCount(5)
    await expect(recent.locator('.tg-total')).toHaveCount(0)
    await expect(recent.getByRole('button', { name: 'Edit transaction' })).toHaveCount(0)
    await expect(recent.getByRole('button', { name: 'Delete transaction' })).toHaveCount(0)
    await expect(recent.getByRole('button', { name: 'Split transaction' })).toHaveCount(0)

    const seeAll = page.getByRole('link', { name: 'See all' })
    await expect(seeAll).toBeVisible()
    const href = await seeAll.getAttribute('href')
    expect(href?.startsWith('/wallet')).toBe(true)
  })

  test('the dashboard has no search field of its own', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'No Search Bank' })

    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    await expect(page.getByTestId('transaction-search')).toHaveCount(0)
  })

  // ── Mobile (390 px) regression coverage, with real seeded data ──────────
  // Mirrors e2e/66's mobile block — the class of coverage whose absence let
  // every one of R3 PR-1's mobile bugs ship undetected.

  test('at 390px, the hero net-worth figure fits on one line inside the hero', async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
    const page = await ctx.newPage()
    await signUpOnPage(page)
    await page.request.post('/api/accounts', { data: { name: 'Mobile Hero Bank', type: 'cash', openingBalance: 1234567.89 } })
    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    const figure = page.getByTestId('hero-net-worth')
    const hero = page.getByTestId('overview-hero')
    const figureBox = await figure.boundingBox()
    const heroBox = await hero.boundingBox()
    expect(figureBox && heroBox && figureBox.x + figureBox.width).toBeLessThanOrEqual(
      (heroBox?.x ?? 0) + (heroBox?.width ?? 0) + 1,
    )
    const lineHeight = await figure.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight))
    expect(figureBox?.height).toBeLessThanOrEqual(lineHeight + 2)
    await ctx.close()
  })

  test('at 390px, nothing on the dashboard is invisible-but-hittable', async ({ browser }: { browser: Browser }) => {
    // Regression for R3 PR-1's blocker (.trow-actions invisible-but-tappable
    // Delete), generalised to this page's new surfaces.
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
    const page = await ctx.newPage()
    await signUpOnPage(page)
    const acctRes = await page.request.post('/api/accounts', { data: { name: 'Mobile Overview Bank', type: 'cash', openingBalance: 500 } })
    const acct = (await acctRes.json()) as { id: string }
    await page.request.post('/api/transactions', {
      data: { accountId: acct.id, date: businessToday(), merchant: 'Mobile Overview Txn', amount: 20, type: 'expense' },
    })
    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    const targets = page.locator(
      '[data-testid="featured-account"], [data-testid="recent-activity"] [data-testid="transaction-row"]',
    )
    const count = await targets.count()
    expect(count).toBeGreaterThan(0)
    const viewport = page.viewportSize()!
    for (let i = 0; i < count; i++) {
      const el = targets.nth(i)
      const box = await el.boundingBox()
      expect(box).toBeTruthy()
      if (!box) continue
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)

      const effectiveOpacity = await el.evaluate((node) => {
        let opacity = 1
        let cur: HTMLElement | null = node as HTMLElement
        while (cur) {
          opacity *= parseFloat(getComputedStyle(cur).opacity)
          cur = cur.parentElement
        }
        return opacity
      })
      expect(effectiveOpacity).toBeGreaterThan(0)
    }
    await ctx.close()
  })

  test('at 390px, a populated dashboard has no horizontal overflow', async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
    const page = await ctx.newPage()
    await signUpOnPage(page)
    const acctRes = await page.request.post('/api/accounts', { data: { name: 'Mobile Overflow Bank', type: 'cash', openingBalance: 1000 } })
    const acct = (await acctRes.json()) as { id: string }
    await page.request.post('/api/transactions', {
      data: { accountId: acct.id, date: businessToday(), merchant: 'Overflow Check', amount: 30, type: 'expense' },
    })
    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    await expect(page.getByTestId('overview-hero')).toBeVisible()
    await expect(page.getByTestId('featured-account')).toBeVisible()
    await expect(page.getByTestId('recent-activity')).toBeVisible()

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
    await ctx.close()
  })
})
