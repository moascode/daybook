// ── One clock for the whole suite ─────────────────────
//
// Set before anything else in this file, because Node resolves the local
// timezone lazily and caches it on first use — after that, changing TZ does
// nothing.
//
// Three clocks have to agree or the suite fails on a schedule instead of on a
// change: the Worker stamps rows via worker/lib.ts todayStr(), pinned to
// Asia/Kuala_Lumpur (B-11); the browser decides which month the transaction
// list defaults to; and the spec process computes the dates it expects to see.
// Left to the host, the third is whatever the machine is set to — UTC in CI —
// so for the eight hours a day when the UTC date and the Malaysian date differ,
// rows created "today" landed outside the month the client was showing.
//
// Pinning `use.timezoneId` alone is not enough: it moves the browser but leaves
// spec-side date arithmetic on the host clock, which just relocates the seam.
process.env.TZ = 'Asia/Kuala_Lumpur'

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
  // Wipe the local D1 before each run — see e2e/global-setup.ts. Without this
  // the database accumulates every user the suite has ever created, across runs.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Local runs stay strict — a failure on this machine is a failure.
  //
  // CI retries twice, and this is MITIGATION, not a fix. `wrangler dev` dies
  // mid-run on CI runners with:
  //   kj/async-io-unix.c++:186: disconnected: ::write(...): Broken pipe
  // which is workerd writing to a pipe whose reader has gone. It takes whatever
  // test happened to be running with it, so the failure lands on an arbitrary
  // spec and looks like a different bug every time. It cost most of a session to
  // place, because the message was empty until the e2e jobs moved into the
  // Playwright container.
  //
  // Every genuine app and test bug found while chasing it has been fixed
  // separately (the unbounded D1 growth, two async-<select> races, the
  // transaction form's account list). What is left is the runtime itself, in a
  // dev-only tool, and it is not worth blocking releases on.
  //
  // Retries keep this visible rather than hidden: Playwright reports a
  // retried-then-passed test as **flaky**, so a real regression that fails every
  // attempt still goes red, and a rising flaky count is a signal to come back to
  // this. Revisit if wrangler ever exposes a way to turn the inspector off —
  // there is none as of 4.114.
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    // Pin the browser to the app's business timezone — the same one
    // worker/lib.ts todayStr() is pinned to (B-11), so the clock the server
    // stamps rows with and the clock the client filters months by agree.
    //
    // Without this the suite is only green when the host happens to sit in a
    // timezone where the UTC date and the Malaysian date coincide — false for
    // eight hours out of every twenty-four. Rows created "today" server-side
    // landed outside the client's current-month filter, and specs failed on a
    // schedule rather than on a change. CLAUDE.md records specs 03 and 37
    // being patched for this one at a time; this fixes the cause.
    //
    // Test code must not read the host clock either — use businessToday()
    // from e2e/helpers.ts, never new Date().toISOString().
    timezoneId: 'Asia/Kuala_Lumpur',
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
        // --var DAYBOOK_QUIET_LOGS:1 silences the Worker's per-request log line for
        // this harness only. Every console.log is forwarded through wrangler's
        // InspectorProxyWorker, and a full suite emitted 15,480 of them with no
        // devtools attached; workerd died writing to that pipe
        // ("Broken pipe", kj/async-io-unix.c++:186), taking the rest of the shard
        // with it. Production and `npm run dev:worker` keep their request logs.
        'npx wrangler dev --env dev --port 5173 --show-interactive-dev-session false ' +
        '--var DAYBOOK_QUIET_LOGS:1',
      url: 'http://localhost:5173/api/health',
      reuseExistingServer: !process.env.CI,
      // Generous: covers a cold `vite build` as well as wrangler's ~3s start.
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
