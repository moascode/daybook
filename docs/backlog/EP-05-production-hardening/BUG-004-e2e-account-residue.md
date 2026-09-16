> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** [EP-05](README.md) · **Severity:** low

# BUG-004 — 273 `e2e_*` accounts pollute the retired Mac's database

**Expected.** Test accounts don't accumulate in a production database.

**Actual.** 273 `e2e_*` user accounts sit in the Mac's SQLite database, left by
e2e runs against it before the Workers cutover.

**Why it's low.** They were **not** migrated to D1 — only kakon and tumpa were —
so the live Cloudflare database is clean. This is Mac-local cleanup on a machine
that is retired as a deployment target and kept only as the rollback of last
resort.

**Where it lives.** `scripts/purge-e2e-users.mjs` already exists for this.

**Out of scope.** Anything touching D1. Nothing about this affects production.

**Consider `Dropped`.** If the Mac is never going to be used as a rollback in
practice, this is cleanup on a machine nobody reads, and closing it is more
honest than carrying it.

**Still needed?** Consider dropping — the live D1 database is clean
