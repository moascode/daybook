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
  webServer: [
    {
      // Phase 4 API server, isolated test DB, with the test-only reset route on.
      // Runs on a dedicated port (not the default 3001) so it never collides
      // with the always-on local/LAN server — letting e2e run on the same Mac
      // while the launchd service keeps serving.
      command: 'npx tsx server/index.ts',
      url: 'http://localhost:3099/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        PORT: '3099',
        DAYBOOK_TEST: '1',
        DAYBOOK_DB_PATH: 'server/data/e2e.db',
      },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // Point the dev server's /api proxy at the isolated test API above.
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { DAYBOOK_API_TARGET: 'http://localhost:3099' },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
