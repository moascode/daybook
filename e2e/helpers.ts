import type { Page, Browser } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Today, in the app's business timezone (Asia/Kuala_Lumpur).
 *
 * The one correct way for a spec to say "today". Two wrong ways were in use and
 * they fail at opposite ends of the same eight-hour window:
 *
 *   new Date().toISOString().slice(0, 10)  → the UTC date, which is yesterday
 *                                            in Malaysia after 16:00 UTC
 *   local date parts                       → the host's date, which is whatever
 *                                            the machine happens to be set to
 *
 * The server stamps rows via worker/lib.ts todayStr(), pinned to this zone, and
 * playwright.config.ts pins the browser to it too. Deriving dates the same way
 * keeps all three in agreement no matter what the host clock says.
 */
export function businessToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** `days` from today, in the business timezone. Negative goes back. */
export function businessDatePlus(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Wait for the app shell to confirm the app has mounted */
export async function waitForApp(page: Page) {
  // On desktop the sidebar aside is visible; on mobile the main element is visible.
  // We check for the main content area which is always present in both viewports.
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 })
}

let userSeq = 0

/**
 * Sign up a fresh user on an existing page's context (sets the session cookie),
 * for specs that build their own context — e.g. a custom mobile viewport — and
 * navigate themselves. Call before page.goto().
 */
export async function signUpOnPage(page: Page) {
  const username = `e2e_${Date.now()}_${userSeq++}`
  await page.request.post('/api/auth/signup', {
    data: { username, password: 'test-password' },
  })
}

/**
 * Create an isolated browser context, sign up a brand-new user, and navigate to
 * the app already authenticated.
 *
 * Phase 4: data lives in the shared server DB scoped per user, so a fresh user
 * per page is what now gives each test the clean slate it had under the old
 * fresh-IndexedDB-per-context model. The signup sets the session cookie in the
 * browser context, so the subsequent navigation loads logged in.
 */
export async function newAppPage(browser: Browser, path = '/') {
  const context = await browser.newContext()
  const page = await context.newPage()
  const username = `e2e_${Date.now()}_${userSeq++}`
  await page.request.post('/api/auth/signup', {
    data: { username, password: 'test-password' },
  })
  await page.goto(path)
  await waitForApp(page)
  return page
}

/** Hover a bullet node to reveal its hidden actions, then click the note (sticky) icon */
export async function toggleNoteOnTask(page: Page, taskContent: string) {
  const node = bulletNodeFor(page, taskContent)
  await node.hover()
  // Title switches between "Add note", "Show note", and "Hide note"
  await node.locator('button[title="Add note"], button[title="Show note"], button[title="Hide note"]').first().click()
}

/** Hover a bullet node and open its ⋯ dropdown */
export async function openTaskMenu(page: Page, taskContent: string) {
  const node = bulletNodeFor(page, taskContent)
  await node.hover()
  await node.getByRole('button', { name: 'Task options' }).click()
}

/** Return a locator scoped to the bullet node that contains taskContent */
export function bulletNodeFor(page: Page, taskContent: string) {
  return page.locator('[data-testid="bullet-node"]').filter({
    has: page.getByRole('textbox', { name: 'Task content' }).filter({ hasText: taskContent }),
  })
}

/** Return a locator scoped to the account card with the given account name */
export function accountCardFor(page: Page, accountName: string) {
  return page.locator('[data-testid="account-card"]').filter({ hasText: accountName })
}

/** Return a locator scoped to the transaction row that contains the given merchant text */
export function transactionRowFor(page: Page, merchant: string) {
  return page.locator('[data-testid="transaction-row"]').filter({ hasText: merchant })
}

/**
 * Open a transaction row's ⋯ actions dropdown (mockup parity — a single
 * "More" trigger per row, not always-visible Edit/Delete/Split buttons).
 * Call this before clicking 'Edit transaction' / 'Delete transaction' /
 * the split-transaction-btn menu item.
 */
export async function openTransactionRowMenu(page: Page, merchant: string) {
  const row = transactionRowFor(page, merchant)
  await row.getByRole('button', { name: 'Transaction options' }).click()
}

/** Fill the AccountForm modal and submit it */
export async function fillAccountForm(
  page: Page,
  fields: { name: string; type?: string },
) {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Account Name').fill(fields.name)
  if (fields.type) await dialog.getByLabel('Type').selectOption(fields.type)
  await dialog.getByRole('button', { name: /Create Account|Save Changes/ }).click()
  await expect(dialog).toBeHidden()
}

/**
 * Open a blank TransactionForm (create mode). R7 replaced the page header's
 * "Add Transaction" button with the composer's shortcut row — this opens the
 * same modal via the Expense shortcut (present whenever the page has at
 * least one account), which callers then drive with `fillTransactionForm`
 * exactly as before, including switching to a different `type` inside the
 * dialog if needed.
 */
export async function openBlankTransactionForm(page: Page) {
  await page.getByRole('button', { name: 'Expense' }).first().click()
}

/** Fill the TransactionForm modal and submit it */
export async function fillTransactionForm(
  page: Page,
  fields: {
    type?: 'Expense' | 'Income' | 'Transfer'
    amount: string
    account?: string
    toAccount?: string
    merchant?: string
    date?: string
    category?: string
    /** Tags to add — each is typed into the TagInput and confirmed with Enter */
    tags?: string[]
  },
) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // The form's account list is populated from GET /accounts after the dialog
  // opens. Filling and saving before that resolves submits with no account, the
  // save fails, and the dialog stays open — surfacing as `expect(dialog)
  // .toBeHidden()` timing out at the very bottom of this helper, which points
  // nowhere near the actual cause. Waiting here fixes every caller at once;
  // several tests open this form immediately after navigating to /wallet.
  const accountSelect = dialog.locator('#account, #from-account').first()
  if (await accountSelect.count()) {
    await expect
      .poll(async () => accountSelect.locator('option[value]:not([value=""])').count(), {
        timeout: 15_000,
        message: 'transaction form never loaded an account to select',
      })
      .toBeGreaterThan(0)
  }

  if (fields.type) await dialog.getByRole('button', { name: fields.type }).click()
  if (fields.date) await dialog.getByLabel('Date').fill(fields.date)
  await dialog.getByLabel('Amount').fill(fields.amount)
  if (fields.account) {
    // WalletPage filter bar and TransactionForm share select id="account"/"from-account".
    // Use ID selector scoped to dialog to avoid getByLabel resolving to the filter bar.
    const accountId = fields.type === 'Transfer' ? 'from-account' : 'account'
    await dialog.locator(`#${accountId}`).selectOption(fields.account)
  }
  if (fields.toAccount) await dialog.locator('#to-account').selectOption(fields.toAccount)
  if (fields.merchant) await dialog.getByLabel('Merchant').fill(fields.merchant)
  if (fields.category) await dialog.locator('#category').selectOption(fields.category)
  if (fields.tags) {
    const tagInput = dialog.locator('#tags')
    for (const tag of fields.tags) {
      await tagInput.fill(tag)
      await tagInput.press('Enter')
    }
  }
  await dialog.getByRole('button', { name: /Add Transaction|Save Changes/ }).click()
  await expect(dialog).toBeHidden()
}

/**
 * Shell navigation, anchored to identity not copy/role.
 *
 * The sidebar links (and, from R2, the module tabs that replace them) carry a
 * form-agnostic `data-testid="nav-<dest>"`, so a nav click survives the shell
 * reskin that would otherwise break `getByRole('link', { name: 'Wallet' })`.
 *
 * `:visible` because AppShell renders the nav twice — the desktop <aside> and
 * the mobile drawer — so on a mobile viewport both copies are in the DOM (the
 * desktop one display:none). Matching the visible instance keeps strict mode
 * happy in both viewports. See CLAUDE.md §16 trap 4.
 *
 * `dest` is the suffix after `nav-`: tasks · wallet · transactions ·
 * dashboard · accounts · shared · budgets · goals · recurring · reports ·
 * settings · uat · menu-open · menu-close. (`import` and `wallet-toggle`
 * were removed by R2 — see {@link navigateToImportCsv}.)
 */
export function navItem(page: Page, dest: string) {
  return page.locator(`[data-testid="nav-${dest}"]:visible`)
}

/** Click a shell nav destination. See {@link navItem} for the dest vocabulary. */
export async function navTo(page: Page, dest: string) {
  await navItem(page, dest).click()
}

/**
 * Navigate to CSV Import via the account menu. R2 moved it off the sidebar
 * (design spec §4 / D-14 — "Import CSV leaves the sidebar... becomes a
 * button on the Transactions page and *Import & export data* in the profile
 * menu"), so `navTo(page, 'import')` no longer resolves to anything.
 * Assumes the account menu is currently closed.
 */
export async function navigateToImportCsv(page: Page) {
  await page.getByTestId('account-menu-button').click()
  await page.getByTestId('account-menu-settings').click()
  await page.getByTestId('account-menu-import-csv').click()
}
