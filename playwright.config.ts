import { defineConfig, devices } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Cross-platform browser resolution.
// - Mac (local dev): PLAYWRIGHT_BROWSERS_PATH is unset → return undefined so
//   Playwright uses its own installed browser (run `npx playwright install
//   chromium` once).
// - Linux (Claude cloud/CI): browsers are pre-installed under
//   PLAYWRIGHT_BROWSERS_PATH, but the build number drifts between Playwright
//   versions. Glob for whatever chromium-* build is actually present instead
//   of hardcoding it, then use its platform-specific binary.
function resolveChromiumPath(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const builds = readdirSync(root)
    .filter((d) => d.startsWith('chromium-') && !d.includes('headless_shell'))
    .sort()
    .reverse() // prefer the highest build number
  for (const build of builds) {
    const candidates = [
      join(root, build, 'chrome-linux', 'chrome'),
      join(root, build, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]
    for (const c of candidates) if (existsSync(c)) return c
  }
  return undefined
}

const chromiumPath = resolveChromiumPath()

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use the pre-installed Chromium when one is found (cloud/CI). On Mac
        // this is undefined → Playwright resolves its own browser.
        // executablePath must live under launchOptions — at the top level of
        // `use` the test runner silently ignores it.
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
  // ── One server, not two ───────────────────────────────
  //
  // This replaced a two-server setup: `tsx server/index.ts` on :3099 for the API
  // plus Vite on :5173, wired together by a DAYBOOK_API_TARGET proxy so the dev
  // server forwarded /api to the isolated test instance.
  //
  // Under Workers none of that plumbing exists — `wrangler dev` serves the SPA
  // and the API from one origin, which is the property the whole migration is
  // built on. So the harness collapses to a single command and no proxy
  // (spike S4, docs/option-2-spike-findings.md).
  //
  // Two consequences worth knowing:
  //   • It serves BUILT assets from dist/, not Vite — hence the `npm run build`
  //     prefix, and no HMR in the test loop. Arguably better: the suite now
  //     tests what actually ships.
  //   • Port 5173 is kept deliberately so `baseURL` and every spec stay
  //     unchanged. Nothing about the tests knows the backend moved.
  //
  // Isolation is unchanged: e2e/helpers.ts signs up a fresh user per page and
  // relies on per-user scoping, which is database-agnostic. `--env dev` supplies
  // DAYBOOK_TEST=1 and DAYBOOK_ALLOW_SIGNUP=true.
  webServer: [
    {
      // VITE_E2E=1 keeps the window.__test* hooks and the UAT Tests nav in the
      // built bundle. They are gated on it (src/lib/utils.ts TEST_HOOKS_ENABLED)
      // because a production build has import.meta.env.DEV === false, which the
      // old Vite-dev-server harness never exercised.
      // The migration apply is not optional: a fresh checkout (every CI run)
      // has no .wrangler/state, so the local D1 exists with no tables and every
      // test dies on "no such table: users". Applying here makes the harness
      // self-bootstrapping instead of depending on someone having run it.
      // It is idempotent — wrangler skips migrations already recorded.
      command:
        'VITE_E2E=1 npm run build && ' +
        'npx wrangler d1 migrations apply daybook --env dev --local && ' +
        // --show-interactive-dev-session=false: `wrangler dev` otherwise runs an
        // interactive session with hotkeys (b/d/l/x) that reads stdin. Playwright's
        // webServer gives it no stdin, and in CI the process exited ~30s in with an
        // empty error, taking every remaining test with it (ECONNREFUSED :5173).
        // Turning the interactive layer off makes it a plain long-running server.
        'npx wrangler dev --env dev --port 5173 --show-interactive-dev-session false',
      url: 'http://localhost:5173/api/health',
      reuseExistingServer: !process.env.CI,
      // Generous: covers a cold `vite build` as well as wrangler's ~3s start.
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
