> **Status:** Live · **Last verified:** 2026-09-16

# E2E testing conventions

How the Playwright suite is organised, how to run it, and the seven traps it has already fallen into.

> Extracted from `CLAUDE.md` on 2026-09-16. `CLAUDE.md` keeps the rules and the traps;
> this file holds the long-form reference they point at.

---

## 16. E2E Testing Conventions

### Rule (from Section 2, Rule 11)
Every new feature or behaviour change **must** have a Playwright test. Run `npx playwright test` before marking any feature complete.

### File naming
```
e2e/
  01-tasks.spec.ts          ← Tasks module tests
  02-wallet-accounts.spec.ts
  03-wallet-transactions.spec.ts
  04-wallet-csv.spec.ts
  05-wallet-dashboard.spec.ts
  06-uat-runner.spec.ts      ← Full UAT smoke test
  NN-description.spec.ts     ← New specs follow this pattern (two-digit prefix)
  helpers.ts                 ← Shared test utilities (newAppPage, etc.)
  fixtures/                  ← Test CSV files and other test data
```

### Conventions
- Each spec file gets an isolated browser context (fresh IndexedDB) via `newAppPage()`.
- Use `test.describe.configure({ mode: 'serial' })` when tests build state sequentially.
- Prefer assertions on visible UI text (`getByText`, `getByRole`) over CSS selectors.
- For async DB operations, `await page.waitForTimeout(500)` is acceptable only when no reliable DOM signal exists; prefer `waitForSelector` or `waitForResponse`.
- Do not skip (`test.skip`) a failing test to make CI green — fix it or file it as a known issue with a comment explaining why.

### When to add tests
| Scenario | Action |
|---|---|
| New page or route | New spec file `NN-feature.spec.ts` |
| New form or user interaction | New `test()` block in the relevant spec |
| Bug fix | Add a regression test that would have caught the bug |
| Refactor (no behaviour change) | Run existing suite; no new tests needed unless coverage gaps are found |

### Running tests

**Run targeted specs locally; rely on CI for the full-suite, end-to-end
result.** Do not run the full suite locally — not `npm run test:e2e:parallel`,
not a bare `npx playwright test`, and not from inside a review/verification
subagent either. This was standing advice to "default to the parallel runner"
until an R3 session actually did that repeatedly in a resource-constrained
sandbox: the local sharded runner's own D1/`wrangler dev` isolation
requirement (below) makes it fragile there, a subagent misreported a
targeted 16-spec count as if it were the ~450-680-test full suite, and a
full local run partially crashed mid-way and returned inflated, garbled
numbers — none of which added signal beyond CI, all of which burned real
time. **GitHub Actions already shards the whole suite** (10 jobs — pass `10` to
`test:e2e:parallel` to match exactly; its own default stays a lower,
core-capped number for local resource safety) — after pushing, poll the PR's
check runs (or read the `check_suite.completed` webhook event on a subscribed
PR) for the authoritative result instead of reproducing it yourself.

```bash
npx playwright test e2e/01-tasks   # Targeted — the specs touching what you changed. This is the default.
npx playwright test --headed       # Watch mode (headed), for one file while debugging
npx playwright show-report         # View last HTML report
```

`npm run test:e2e:parallel` and a bare full-suite `npx playwright test` still
exist and still work as manual, human-driven tools (a developer debugging
something CI itself can't reproduce, or wanting the full local signal before
even opening a PR) — `scripts/e2e-parallel.sh` gives each of its N shards an
isolated `wrangler dev` process, port, and D1 `--persist-to` directory, and
retries once a shard whose *server* crashed mid-run (the known
wrangler/workerd "empty ✘ [ERROR]" fragility documented in
`playwright.config.ts`, not a real test failure; a shard whose server stayed
healthy but whose tests failed is never retried). If a shard's server dies
repeatedly even after the retry, a smaller `N` (`npm run test:e2e:parallel
-- 2`) reduces the CPU/memory pressure of N concurrent `wrangler dev` +
Chromium processes. None of this is a session's default move, though —
targeted-local-plus-CI is.

### Traps this suite has already fallen into

Each of these cost a debugging session and none is guessable from the symptom.

1. **The suite runs on ONE clock — never call `toISOString()` for a date.**
   `todayStr()` is pinned to Asia/Kuala_Lumpur (B-11), so for the eight hours a
   day when the UTC date and the Malaysian date differ, rows the Worker stamps
   "today" land outside the month the client is showing. Specs were once split
   between `toISOString()` (UTC) and local date parts (host), so there was **no
   timezone at which the whole suite was green** inside that window — fixing one
   convention broke the other. `playwright.config.ts` now pins the browser *and*
   the test process to the business timezone (the `TZ` assignment must precede
   the imports — Node caches the zone on first use). Use
   `businessToday()` / `businessDatePlus()` from `e2e/helpers.ts`.
2. **Never hardcode a future date.** `32-wallet-error-toasts` pinned
   `nextDueDate: '2026-08-01'` and began failing when that day arrived. A spec
   that fails on a *schedule* rather than on a change is the worst kind to debug.
3. **`getByLabel()` matches SUBSTRINGS**, so a new control's accessible name can
   silently capture unrelated specs' lookups anywhere in the suite. A theme
   toggle shipped as "Switch to dark theme" made `getByLabel('To')` (date-range
   inputs, spec 03) and `getByLabel('Theme')` (spec 11) resolve to three
   elements. **Fix it in the app, not by patching specs** — name new controls
   after what they control, not as a sentence — then grep every `getByLabel`
   string in `e2e/` before shipping the name.
4. **`AppShell` renders both the mobile and desktop bars**, so chrome controls
   are in the DOM twice. Match `visible=true`, not `.first()`.
5. **The harness runs a PRODUCTION build**, so anything gated on
   `import.meta.env.DEV` vanishes. Test hooks are gated on `TEST_HOOKS_ENABLED`
   (`src/lib/utils.ts`), true when DEV **or** `VITE_E2E=1`, which only the
   Playwright build sets.
6. **Playwright cannot intercept a Worker→third-party fetch.** It intercepts
   requests the *browser* makes; `wrangler dev` runs an outbound Worker call from
   a separate process the test has no route into. The pattern to reuse:
   branch on `DAYBOOK_TEST` (already the flag gating `worker/routes/test.ts`) and
   read a canned response from a `settings` row, stashed by a test-only route —
   see `worker/lib/anthropic.ts` and `POST /test/mock-ai-response`. Production
   never sets `DAYBOOK_TEST`, so the branch is unreachable there.
7. **Don't hand-start a dev server on 5173.** The harness owns that port and
   sets `reuseExistingServer`, so it silently adopts yours — and without
   `VITE_E2E=1` every spec relying on `window.__test*` fails with no hint that
   the wrong server answered. `npm run dev:worker` uses **:8788** for this
   reason.

### Local UAT (manual testing) convention

When starting a local dev server for the owner to click through a change
before merging (not the automated e2e suite — that signs up its own fresh
user per spec), always sign up and use this fixed account:

```
username: demo
password: demo123456789
```

**Not literally `demo`/`demo`** — `worker/routes/auth.ts`'s `MIN_PASSWORD` is
12 characters, so a bare 4-character password is rejected at signup.
`demo123456789` is the shortest memorable password that clears the
constraint; don't substitute a different one without asking, and don't
lower `MIN_PASSWORD` to make the literal word fit.

Reuse this same account across sessions rather than minting a fresh
`mockuser`/`photodemo`-style name each time — sign up once per fresh D1
state (dev's `--local` D1 resets when the `wrangler dev` process restarts,
so a restart means signing up `demo` again, not inventing a new username).
Seed whatever accounts/transactions/categories the feature under test needs
directly via the API (`page`-style `fetch` calls or `curl`), then hand the
owner the URL plus these credentials.

**Never run `npx playwright test` against a manual preview session without
`E2E_PERSIST_TO`.** `wrangler dev --local` persists D1 to
`.wrangler/state/v3/d1/...sqlite` by default, and both the manual
`dev:worker` preview (:8788) and Playwright's own `webServer` (:5173,
`playwright.config.ts`) use that same default path unless told otherwise —
they are two different processes sharing one file. `e2e/global-setup.ts`
calls `POST /api/test/reset` (a full-table wipe, by design, to bound DB
growth across runs) before every `npx playwright test` invocation, so running
a targeted e2e spec while a manual preview session is up silently deletes the
`demo` account and everything seeded on it. Set an isolated persist directory
for the e2e run instead:

```bash
E2E_PERSIST_TO=/tmp/daybook-e2e-state npx playwright test e2e/some.spec.ts
```

This was misdiagnosed as a flaky D1 several times before being traced to this
file-sharing default — the fix is confirmed by a live run: seed `demo`, run a
spec with `E2E_PERSIST_TO` set, then reload the :8788 preview and confirm
`demo`'s data is still there.

### Development workflow

**Default:** Branch → Plan (for non-trivial changes) → Implement → Test → PR →
wait for merge.

**Full 12-step workflow** (branch → plan → implement → test → review → PR → CI →
merge) is available on demand via the `dev-workflow` skill — use it for
significant changes where you want the whole process enforced.

**Small tasks** (typos, one-line fixes): skip the full workflow. Still branch
first, still test, still PR.

---
