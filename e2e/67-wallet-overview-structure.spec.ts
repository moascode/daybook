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
import { newAppPage, signUpOnPage, waitForApp, businessToday, businessDatePlus, fillAccountForm } from './helpers'

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
    // Regression for PR #101 ("RM100 displayed as RM10,099"), restated for
    // this new surface — 56-wallet-bug-fixes.spec.ts covers /wallet and
    // /wallet/accounts but has no dashboard/hero coverage at all, so this
    // must genuinely seed a shared-in account large enough that summing the
    // full `accounts` array (not just ownAccounts) would be obvious.
    const ownerCtx = await browser.newContext()
    const viewerCtx = await browser.newContext()
    const ownerPage = await ownerCtx.newPage()
    const viewerPage = await viewerCtx.newPage()
    const stamp = Date.now()
    const ownerName = `hero_owner_${stamp}`
    const viewerName = `hero_viewer_${stamp}`

    await ownerPage.request.post('/api/auth/signup', { data: { username: ownerName, password: 'test-password' } })
    await viewerPage.request.post('/api/auth/signup', { data: { username: viewerName, password: 'test-password' } })

    const group = (await (await ownerPage.request.post('/api/groups', { data: { name: 'Hero House' } })).json()) as { id: string }
    await ownerPage.request.post(`/api/groups/${group.id}/invites`, { data: { username: viewerName } })
    const invites = (await (await viewerPage.request.get('/api/invites')).json()) as { id: string }[]
    await viewerPage.request.post(`/api/invites/${invites[0].id}/accept`)

    // The owner's large account, shared read-only into the viewer's view.
    const shared = (await (await ownerPage.request.post('/api/accounts', {
      data: { name: 'Owner Savings', type: 'bank', openingBalance: 9999 },
    })).json()) as { id: string }
    await ownerPage.request.post(`/api/accounts/${shared.id}/shares`, { data: { groupId: group.id, canWrite: 0 } })

    // The viewer's own, much smaller account.
    await viewerPage.request.post('/api/accounts', { data: { name: 'Viewer Cash', type: 'cash', openingBalance: 100 } })

    await viewerPage.goto('/wallet/dashboard')
    await waitForApp(viewerPage)

    // 100, not 10,099 — the shared 9,999 must not leak into the hero total.
    await expect(viewerPage.getByTestId('hero-net-worth')).toHaveText('RM 100.00')
    await expect(viewerPage.getByTestId('hero-account-count')).toHaveText('across 1 account')

    await ownerCtx.close()
    await viewerCtx.close()
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
    // No bills yet on the featured account — plain balance copy, not a
    // manufactured "after RM0 of bills" sentence.
    await expect(featured).toContainText('Largest balance')

    // A bill due on the FEATURED account reduces what's safe to spend; the
    // account's own balance (5000) minus that bill (800) is what should show.
    // Due date must be a few days OUT, not today — a rule due today or
    // earlier is auto-posted into a real transaction on the next app boot
    // (worker/routes/wallet.ts's boot-time recurring processor), which would
    // both change the balance itself and roll the rule's next_due_date
    // forward out of the "upcoming" window before this assertion ever runs.
    await page.request.post('/api/recurring-transactions', {
      data: {
        accountId: big.id,
        amount: 800,
        merchant: 'Rent',
        type: 'expense',
        frequency: 'monthly',
        nextDueDate: businessDatePlus(3),
      },
    })
    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    const safeToSpend = page.getByTestId('featured-account-safe-to-spend')
    await expect(safeToSpend).toBeVisible()
    await expect(safeToSpend).toContainText(/4,200\.00 safe to spend after RM\s*800\.00 of bills/)

    // Two things that must NOT move the figure: a bill on a DIFFERENT
    // account (safeToSpend's whole reason to exist — a bill drawn from
    // Small Account has no claim on Big Account's balance), and a recurring
    // INCOME rule on the SAME account (money arriving isn't a bill; summing
    // it in would flip the sign and make "safe to spend" go down right
    // before money comes in — the exact bug this pair of rules regresses).
    await page.request.post('/api/recurring-transactions', {
      data: {
        accountId: small.id,
        amount: 999,
        merchant: 'Someone Else’s Bill',
        type: 'expense',
        frequency: 'monthly',
        nextDueDate: businessDatePlus(3),
      },
    })
    await page.request.post('/api/recurring-transactions', {
      data: {
        accountId: big.id,
        amount: 3000,
        merchant: 'Payday',
        type: 'income',
        frequency: 'monthly',
        nextDueDate: businessDatePlus(3),
      },
    })
    await page.goto('/wallet/dashboard')
    await waitForApp(page)
    await expect(page.getByTestId('featured-account-safe-to-spend')).toContainText(
      /4,200\.00 safe to spend after RM\s*800\.00 of bills/,
    )
    // Same bug, one card over: "Coming up" is account-agnostic (it lists
    // every upcoming bill, not just the featured account's), so its total is
    // Rent (800, Big Account) + Someone Else's Bill (999, Small Account) =
    // 1,799 — the Payday INCOME rule (3000) must be excluded either way.
    await expect(page.getByTestId('upcoming-bills-total')).toContainText(/1,799\.00/)
    await expect(page.getByTestId('upcoming-bills-total')).not.toContainText(/4,799\.00/)
    await expect(page.getByTestId('bill-reminder').filter({ hasText: 'Payday' })).toHaveCount(0)
  })

  test('the category donut folds spending past the top 6 into "Everything else", not silently', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Donut Bank' })

    const acctRes = await page.request.get('/api/accounts')
    const [acct] = (await acctRes.json()) as Array<{ id: string }>
    const catsRes = await page.request.get('/api/categories')
    const categories = (await catsRes.json()) as Array<{ id: string; name: string; type: string }>
    // 8 distinct categories — comfortably past MAX_DONUT_SLICES (6) — each with
    // a DIFFERENT amount so the fold-point is unambiguous: the 2 smallest must
    // be the ones missing from the individual legend rows.
    const expenseCats = categories.filter((c) => c.type !== 'income').slice(0, 8)
    expect(expenseCats.length).toBe(8)
    for (const [i, cat] of expenseCats.entries()) {
      await page.request.post('/api/transactions', {
        data: {
          accountId: acct.id,
          date: businessToday(),
          merchant: cat.name,
          amount: 100 - i, // 100, 99, 98, ... 93 — strictly descending, no ties
          type: 'expense',
          categoryId: cat.id,
        },
      })
    }

    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    const rows = page.getByTestId('category-donut-legend-row')
    await expect(rows).toHaveCount(7) // top 6 individually + 1 "Everything else"
    const everythingElse = rows.filter({ hasText: 'Everything else' })
    await expect(everythingElse).toBeVisible()
    // The 2 smallest categories (amounts 94, 93 → sum 187) are folded in; they
    // must NOT also appear as their own row.
    const smallest = expenseCats[6].name
    const secondSmallest = expenseCats[7].name
    await expect(rows.filter({ hasText: smallest })).toHaveCount(0)
    await expect(rows.filter({ hasText: secondSmallest })).toHaveCount(0)
    await expect(everythingElse).toContainText(/187\.00/)
    // Unlike a real category row, "Everything else" has nowhere specific to
    // link — it must render as plain text, not a broken transactions link.
    await expect(everythingElse.getByRole('link')).toHaveCount(0)
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

  test('at 390px, the hero net-worth figure fits on one line for a large but plausible balance', async ({ browser }: { browser: Browser }) => {
    // RM 234,567.89 (6 figures) is a large but genuinely plausible net worth
    // — the bar this test holds is "no overflow/clipping for a real user",
    // not "any arbitrarily large number stays one line at full display
    // size". At --t-3xl (44px), a 7-figure balance physically cannot fit
    // one line in ~310px without either shrinking the hero's signature
    // figure for everyone or clipping digits — .hero-figure's
    // overflow-wrap:anywhere fallback (below) covers that genuinely extreme
    // case by wrapping instead of clipping, which is still correct, just
    // not single-line; that fallback is exercised separately below.
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
    const page = await ctx.newPage()
    await signUpOnPage(page)
    await page.request.post('/api/accounts', { data: { name: 'Mobile Hero Bank', type: 'cash', openingBalance: 234567.89 } })
    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    const figure = page.getByTestId('hero-net-worth')
    const hero = page.getByTestId('overview-hero')
    const figureBox = await figure.boundingBox()
    const heroBox = await hero.boundingBox()
    expect(figureBox).toBeTruthy()
    expect(heroBox).toBeTruthy()
    const heroPadRight = await hero.evaluate((e) => parseFloat(getComputedStyle(e).paddingRight))
    const contentRight = heroBox!.x + heroBox!.width - heroPadRight
    expect(figureBox!.x + figureBox!.width).toBeLessThanOrEqual(contentRight + 1)
    const lineHeight = await figure.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight))
    expect(figureBox!.height).toBeLessThanOrEqual(lineHeight + 2)
    await ctx.close()
  })

  test('at 390px, an extreme net-worth figure wraps instead of overflowing the hero', async ({ browser }: { browser: Browser }) => {
    // A 7-figure balance cannot fit one line at --t-3xl in ~310px (see the
    // previous test) — the bar here is that it degrades to a second line
    // rather than clipping past the hero's edge, which would hide digits.
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
    const page = await ctx.newPage()
    await signUpOnPage(page)
    await page.request.post('/api/accounts', { data: { name: 'Extreme Hero Bank', type: 'cash', openingBalance: 1234567.89 } })
    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    const figure = page.getByTestId('hero-net-worth')
    const hero = page.getByTestId('overview-hero')
    const figureBox = await figure.boundingBox()
    const heroBox = await hero.boundingBox()
    expect(figureBox).toBeTruthy()
    expect(heroBox).toBeTruthy()
    const heroPadRight = await hero.evaluate((e) => parseFloat(getComputedStyle(e).paddingRight))
    const contentRight = heroBox!.x + heroBox!.width - heroPadRight
    expect(figureBox!.x + figureBox!.width).toBeLessThanOrEqual(contentRight + 1)
    await ctx.close()
  })

  test('at 390px, the hero Money in/out/Kept figures never overflow the hero and stay one line', async ({ browser }: { browser: Browser }) => {
    // Regression for a real bug found by manual visual review: at <=900px
    // .hero-stats becomes a 3-up row, and a flex item's default min-width
    // is `auto` — for a formatMYR figure (a non-breaking-space-joined,
    // unbreakable text run) that means "at least as wide as the longest
    // value", so a long Kept figure refused to shrink to its 1/3 share and
    // pushed the row past the hero's right edge. A first fix attempt
    // (min-width:0 + overflow-wrap alone) traded the overflow for an ugly
    // mid-number wrap — the exact round-1 mistake PR-1 made with
    // .stat-value — so below 480px the three stats now stack as full-width
    // rows instead of 3 narrow columns; min-width:0/overflow-wrap stay as
    // defensive fallbacks. Chosen amounts give a 4-figure Kept (the shape
    // that broke it, not a token amount). Compared against the hero's
    // CONTENT box (inside its own padding), not its border box — comparing
    // against the border box would have let this exact bug pass, since the
    // clipped text still sat inside the outer edge.
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
    const page = await ctx.newPage()
    await signUpOnPage(page)
    const acctRes = await page.request.post('/api/accounts', { data: { name: 'Mobile Hero Stats Bank', type: 'cash', openingBalance: 0 } })
    const acct = (await acctRes.json()) as { id: string }
    await page.request.post('/api/transactions', {
      data: { accountId: acct.id, date: businessToday(), merchant: 'Salary', amount: 6000, type: 'income' },
    })
    await page.request.post('/api/transactions', {
      data: { accountId: acct.id, date: businessToday(), merchant: 'Rent', amount: 346.7, type: 'expense' },
    })
    await page.goto('/wallet/dashboard')
    await waitForApp(page)

    const hero = page.getByTestId('overview-hero')
    const heroBox = await hero.boundingBox()
    expect(heroBox).toBeTruthy()
    const heroPadRight = await hero.evaluate((e) => parseFloat(getComputedStyle(e).paddingRight))
    const contentRight = heroBox!.x + heroBox!.width - heroPadRight

    for (const id of ['hero-money-in', 'hero-money-out', 'hero-kept']) {
      const el = page.getByTestId(id)
      const box = await el.boundingBox()
      expect(box).toBeTruthy()
      expect(box!.x + box!.width).toBeLessThanOrEqual(contentRight + 1)
      const lineHeight = await el.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight))
      expect(box!.height).toBeLessThanOrEqual(lineHeight + 2)
    }
    await ctx.close()
  })

  test('at 390px, nothing on the dashboard is invisible-but-hittable', async ({ browser }: { browser: Browser }) => {
    // Regression for R3 PR-1's blocker: the invisible-but-tappable Delete
    // button was a DESCENDANT of the row (.trow-actions inside .trow), not
    // the row itself — a check that only walks a container's own ancestor
    // chain, the way this test originally did, cannot reproduce that shape.
    // This walks every interactive descendant of each container instead.
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

    const containers = page.locator('[data-testid="featured-account"], [data-testid="recent-activity"]')
    const containerCount = await containers.count()
    expect(containerCount).toBeGreaterThan(0)
    const viewport = page.viewportSize()!

    for (let i = 0; i < containerCount; i++) {
      const container = containers.nth(i)
      const box = await container.boundingBox()
      expect(box).toBeTruthy()
      if (!box) continue
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)

      // Every interactive descendant (the container itself, plus any link,
      // button, or role="button" inside it — e.g. a transaction row and its
      // action buttons) must be either genuinely reachable (in-viewport,
      // non-zero effective opacity) or not rendered at all — never present
      // with a real hit target but invisible.
      const interactive = container.locator('a, button, [role="button"]')
      const total = await interactive.count()
      for (let j = 0; j < total; j++) {
        const el = interactive.nth(j)
        const elBox = await el.boundingBox()
        if (!elBox || (elBox.width === 0 && elBox.height === 0)) continue // legitimately not rendered
        const effectiveOpacity = await el.evaluate((node) => {
          let opacity = 1
          let cur: HTMLElement | null = node as HTMLElement
          while (cur) {
            opacity *= parseFloat(getComputedStyle(cur).opacity)
            cur = cur.parentElement
          }
          return opacity
        })
        // A zero-opacity element with a real, positive-area box is exactly
        // PR-1's bug shape: present in the layout and hittable, invisible.
        expect(effectiveOpacity, `descendant ${j} of container ${i} is invisible but occupies a real box`).toBeGreaterThan(0)
      }
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
