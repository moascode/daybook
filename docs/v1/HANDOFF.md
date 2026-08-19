# Session handoff — post-migration work

> Written 2026-07-27, after the Cloudflare Workers + D1 migration went live.
> Each section below is self-contained: start a fresh session on any one of them
> without reading the others.

## Current state

The app runs on **Cloudflare Workers + D1** at https://daybook.moascode.workers.dev

- Phases 0–6 of `docs/option-2-workers-d1-plan.md` are complete and merged.
- Production D1 holds the real data (174 rows, 2 users, row counts and
  `PRAGMA foreign_key_check` verified).
- Both accounts have working `pbkdf2` passwords and can log in.
- Settings → Change password works (`POST /api/auth/change-password`).
- e2e: 461 tests across 52 specs, green against the Worker, gated in CI.

**Owner decisions already made — do not re-litigate these:**

| Item | Decision |
|---|---|
| Offsite backups to R2 (blocker 4.6) | **Declined. Risk accepted.** Do not build. |
| Cloudflare account 2FA (M1) | Done. |
| The Mac / Express server | No longer used. Safe to retire — see task B. |
| Phase 5a (AI features) | Deferred indefinitely. |
| Password rotation | Owner will do it via Settings. Not a code task. |

Because the Mac is no longer in use, the imported data is **current** — there is
no divergence to reconcile, and the re-import instructions in `GO-LIVE.md` are
now moot.

---

## Task A — Rate limiting (blocker 4.3)

**Priority: highest of what remains.** The URL is public, signup is disabled, and
`POST /api/auth/login` is unauthenticated and unthrottled. Nothing currently
stops an attacker making unlimited password guesses against a KDF running at
50,000 iterations — one twelfth of OWASP's recommendation. The whole security
argument for that iteration count rests on password entropy, and rate limiting
is the control that stops the entropy being ground down online.

`docs/option-2-workers-d1-plan.md` §4 always specified this as **Cloudflare edge
configuration, not application code** — that was one of the stated advantages of
Option 2 over the Express plan (`express-rate-limit` does not run on Workers).

**What to do**

Prefer edge Rate Limiting Rules over anything in the Worker: they reject floods
before a request costs CPU or a D1 read, which is the point.

- At minimum, throttle `POST /api/auth/login` — the only unauthenticated,
  credential-accepting endpoint. Something like 10 attempts / 10 min / IP.
- Consider a looser global cap on `/api/*` as a blunt backstop.
- The free plan includes basic Rate Limiting Rules. Confirm what the account has
  before designing around a tier it does not have.
- If edge rules turn out to be unavailable, the fallback is a Durable Object
  counter — but that is a real cost increase, so check the tier first.

**Watch out for**

- `CF-Connecting-IP` is the real client IP on Workers; there is no `trust proxy`
  problem to solve here (that was blocker 4.1, which Option 2 eliminated).
- Do not rate-limit `/api/health` — CI and uptime checks hit it.
- Whatever you build, verify it with a burst of real requests against the
  deployed URL, not just a config screenshot.

**Done when** repeated failed logins from one source start being rejected, a
normal login still works immediately afterwards, and the behaviour is written
into CLAUDE.md §13.

---

## Task B — Retire the Mac and remove the Express backend

The owner has stopped using the Mac. It is currently still running as a rollback
that is no longer needed.

**Keep this isolated from other work** — it is a large deletion and wants its own
PR and its own review.

**What to do, in this order**

1. **Take one final snapshot of the Mac's database before touching anything.**
   `~/daybook/shared/data/daybook.db` is the only copy of the pre-migration
   state, and backups to R2 were declined, so this file is the last line of
   defence. Copy it somewhere off that machine and confirm the copy opens.
2. Stop and disable the launchd service so it does not restart on boot.
3. Remove the server tree and its tooling:
   - `server/` (entire directory)
   - `infra/daybook`, `port-forward.js`, `setup-lan`, the release/tarball tooling
   - the `release.yml` workflow if it only builds Mac artifacts
4. Remove now-unused dependencies: `express`, `express-session`,
   `better-sqlite3`, `bcrypt`, `tsx`, and `@types/express`,
   `@types/express-session`, `@types/better-sqlite3`, `@types/bcrypt`.
5. Remove the scripts that only existed to migrate off the Mac:
   `scripts/export-to-d1.mjs`, `scripts/verify-import.mjs`,
   `scripts/analyse-users.mjs`, `scripts/purge-e2e-users.mjs`. Keep
   `set-password.mjs` and `check-password.mjs` — they are still the bootstrap
   path for any future backend.
6. **`scripts/schema-diff.mjs` must go or change.** It compares D1 against
   `server/migrations/` by running the server's own migration runner. With
   `server/` deleted it cannot work, and the CI step that calls it will fail.
   Either delete both, or repoint it at a checked-in schema snapshot.
7. Update `CLAUDE.md`: §3 architecture, §4 stack table (drop the Phase 4 backend
   rows), §5 folder structure, §13 status. Delete the historical
   `<details>` blocks describing the PGlite era if they are now two migrations
   stale.
8. `npm run typecheck:server` and its package.json script disappear with
   `server/` — remove them from `.github/workflows/ci.yml` too.

**Watch out for**

- `worker/lib.ts`, `worker/seed.ts` and `worker/lib/sharing.ts` carry comments
  saying "keep in sync with server/…". Those become stale and should be reworded,
  not just left pointing at deleted files.
- `worker/migrations/README.md` documents a renumbering relative to
  `server/migrations/`. That mapping is still worth keeping as history — reword
  rather than delete.

**Done when** CI is green with no `server/` references anywhere, `npm ci &&
npm run build && npx playwright test` passes, and the deployed app is unchanged.

---

## Task C — Impossible calendar dates are accepted

**Pre-existing bug, not caused by the migration.** A background task chip was
already filed for this.

`2026-02-30` and `2026-04-31` pass validation and get stored. The check is:

```js
ISO_DATE_RE.test(v) && !Number.isNaN(Date.parse(v))
```

`Date.parse('2026-04-31')` does **not** return `NaN` — V8 rolls the out-of-range
day into the next month rather than rejecting it. Only an out-of-range *month*
(`2026-13-01`) is caught. Verified empirically.

**Effect:** a transaction or recurring rule can be stored on a day that does not
exist. It sorts and displays oddly, and recurring catch-up will post on it. Found
when a test accidentally generated `2026-04-31` and the API accepted it.

**Where**

- `worker/routes/wallet.ts` — `transactionInputError` and `isoDateError`
- `server/routes/wallet.ts:356` and `:1206` — same code, **only if `server/` still
  exists**. If Task B has already run, this is Worker-only.

**Fix** — round-trip the components and confirm they survive:

```js
const [y, m, d] = v.split('-').map(Number)
const dt = new Date(Date.UTC(y, m - 1, d))
if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
  return '<field> must be a real calendar date'
}
```

**Done when** `POST /api/transactions` and `POST /api/recurring-transactions`
both reject `2026-02-30` with 400, there is an e2e regression test, and existing
specs still pass. Check whether any stored rows already carry impossible dates
before deciding whether a data fix is also needed.

---

## Task D — Investigate the spec 34 flake

Low priority. Worth one focused look rather than ignoring.

`e2e/34-shared-accounts.spec.ts` → *"Alice unshares account → Bob no longer sees
it"* failed **once** during a full 455-test run, and passed immediately when run
in isolation and in every full run since.

**The likely cause is worth checking before assuming it is noise.** Under the new
harness every spec shares **one** local D1 for the whole run, where the old
harness used a SQLite file per server process. Isolation relies on
fresh-user-per-test (`e2e/helpers.ts`), which is sound for user-scoped data — but
this spec exercises groups and account shares, which are the tables where
cross-user visibility is the entire point.

**What to do**

- Re-run the full suite several times to establish a real failure rate.
- If it recurs, check whether the spec depends on state another spec leaves
  behind, rather than adding a retry or a `waitForTimeout`.
- Resist `retries: 1` in `playwright.config.ts` as a fix. This suite is the
  cutover gate for a financial app; a masked flake in the sharing tests is
  exactly the thing that gate exists to catch.

**Done when** either the cause is found and fixed, or ten consecutive full runs
are clean and the finding is recorded as noise in CLAUDE.md §13.
