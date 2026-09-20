> **Status:** Live · **Last verified:** 2026-09-16

# CI/CD — from a commit to production

Production is a **Cloudflare Worker + D1**, served at
<https://daybook.moascode.workers.dev>. There are exactly two workflows.

```
  push / PR ──► CI (.github/workflows/ci.yml)
                 checks job   typecheck ×3 · lint · doc links · tokens · contrast · build · schema parity
                 e2e job      full Playwright suite, sharded 10×

  push tag  ──► Release (.github/workflows/release.yml)
                 1. require a green CI run FOR THAT COMMIT
                 2. build the client bundle (bakes VITE_APP_VERSION)
                 3. apply D1 migrations  ── remote, production
                 4. wrangler deploy      ── remote, production
                 5. smoke-test the live URL (auto-rollback if it fails)
                 6. publish the GitHub Release
```

---

## 1. The tag is the deploy

There is no separate deploy step and no deploy button. Pushing a semver tag is
what ships.

```bash
git checkout main && git pull
git tag -a v3.13.0 -m "v3.13.0 — summary"
git push origin v3.13.0
```

**The release does not re-run the tests.** It asserts that CI already passed
*for that exact SHA*, waiting up to 25 minutes if CI is still running. Re-running
the suite here would cost ~4 minutes and duplicate the flake surface while
proving nothing new — but the guarantee it bought (a tag can point at any commit,
including one CI never saw) is preserved by asserting the SHA's result instead.

**Migrations run before the deploy, and a failure there stops the job.**
Deployed code querying a column the database doesn't have is a total outage, not
a degraded feature. This exact hazard sat live for a day while W2/W3 were on
`main` with migration 0010 unapplied.

### If you can't push a tag

`release.yml` has a `workflow_dispatch` trigger taking a `version` input. It
exists because some sandboxed sessions get HTTP 403 on tag refs while branch
pushes succeed — without it, "the tag is the deploy" would mean no deploy at
all. The Publish step creates the tag at the commit it deployed, so a dispatched
release is indistinguishable from a pushed one afterwards.

---

## 2. When a release fails

The usual cause is **not** a real break. `release.yml` gates on the CI run for
the tagged commit, so the known `wrangler dev` broken-pipe flake
(see `playwright.config.ts`) fails the release *indirectly*: a shard's server
dies, CI on the merge commit goes red, and the release exits with
`CI concluded 'failure'`.

Retrying the release does not help — it re-reads the same red CI result.

```bash
gh run rerun <ci-run-id> --failed      # 1. fix CI for that commit
                                       # 2. wait for green
gh run rerun <release-run-id>          # 3. then re-run the release
```

Re-tagging is not needed. Confirm it's the flake and not a real break by running
just the failing shard locally — `npx playwright test --shard=N/10` — before
re-running anything.

---

## 3. Rollback

The smoke test runs against the live URL after deploying: `/api/health` reports
`"db":true`, `/` returns 200, and an unmatched `/api/*` path returns a JSON
error rather than the SPA's `index.html`. If any of that fails, the workflow
runs `wrangler rollback` automatically rather than leaving a broken deployment
up while someone reads the logs.

To roll back by hand:

```bash
npx wrangler rollback --message "why" --env=""
```

D1 migrations are **not** rolled back, by design — they are additive-only
(`ALTER TABLE … ADD COLUMN`, `CREATE TABLE IF NOT EXISTS`), so the previous
Worker version runs fine against the newer schema.

---

## 4. CI gates, and what each one is for

| Gate | Catches |
|---|---|
| `tsc -b`, `typecheck:server`, `typecheck:worker` | type errors in all three trees |
| `npm run lint` | 38 known warnings baseline — no new ones |
| `npm run check:doc-links` | Markdown links that no longer resolve |
| `gen:tokens` + `git diff --exit-code src/index.css` | hand-edits to the generated theme file |
| `npm run check:contrast` | WCAG AA regressions below 4.5:1 |
| `npm run build` + `wrangler deploy --dry-run` | a bundle that won't build or won't deploy |
| `npm run d1:schema-diff` | D1 drifting from `server/migrations` |
| Playwright, 10 shards | behaviour |

---

## 5. What this no longer does

Until 2026-07-29 the pipeline packaged the Express server plus the built
frontend into a tarball for a Mac deploy tool (`infra/daybook deploy`), with
launchd running the service and a symlink flip for rollback. **The Mac is
retired as a deployment target.** `server/` stays in the repo only because
`scripts/schema-diff.mjs` gates CI on D1 matching `server/migrations` — it is a
schema reference now, not a deployable, and it receives no feature work.

Shipping it had a concrete failure mode worth remembering: because `server/`
stopped getting feature work at the Workers cutover but kept being packaged,
releases silently lagged several waves behind what was actually on `main`.
