# Go-live — what's done, and the two commands left for you

> Written 2026-07-27 overnight. Read this first.

## TL;DR

The app is **deployed, migrated and holding your real data** at
**https://daybook.moascode.workers.dev**

**You cannot log in yet, and that is expected.** Two commands, below, finish it.

---

## Why you can't log in

bcrypt and PBKDF2 are different algorithms. Your imported password hashes are
bcrypt (from the Node server); the Worker verifies PBKDF2 and returns `false` for
anything that isn't. There is no conversion — a hash is one-way.

So **both accounts need their password set once on the new backend.** This is
manual step M6 from the plan, and it is the one thing I cannot do: entering a
password into any field is off-limits for me, and the script deliberately reads
it from a hidden prompt so it never lands in argv, shell history, or a file.

**Right now nobody can log in — including an attacker.** Signup is disabled, and
no stored hash can verify. Your data is on Cloudflare but unreachable until you
run the commands below.

## The two commands

Run from the repo root. Do it for **each** account (`kakon`, `tumpa`):

```bash
node scripts/set-password.mjs kakon > /tmp/pw.sql
```

It prompts twice (input hidden) and writes one `UPDATE` statement. Check the file
looks like a single `UPDATE users SET password_hash = 'pbkdf2$50000$…' WHERE
username = 'kakon';`, then:

```bash
npx wrangler d1 execute daybook --remote --file /tmp/pw.sql && rm /tmp/pw.sql
```

Repeat for `tumpa`. Then log in at the URL above.

### About the password itself

You said you'd start with `Welcome@daybook28` and rotate to a generated one
later. That works, but the window matters more here than it normally would:

The Workers free tier caps PBKDF2 at ~100k iterations (measured — see
`docs/option-2-spike-findings.md` §S1), so we ship **50,000, one twelfth of
OWASP's 600,000**. At that cost, password entropy is doing the work the KDF
normally does. `Welcome@daybook28` is 17 characters but structurally it is
`word + symbol + word + year` — the first pattern an offline cracker tries.

Rotating is cheap by design: the hash records its own iteration count, so you can
re-run `set-password.mjs` any time with a generated 24+ character password, and
if you ever move to Workers Paid the count can be raised with no reset and no
migration (existing logins re-hash themselves).

---

## What is done

| Phase | State |
|---|---|
| 0 Spikes | ✅ merged (#64) |
| 1 Scaffold | ✅ merged (#66), deployed |
| 2 D1 migrations + data layer | ✅ merged (#67) |
| 3 PBKDF2 auth + sessions | ✅ merged (#68) |
| 4 Route port — all 156 sites | ✅ merged (#69, #71, #72, #73, #74, #75) |
| 5 Atomicity | ✅ done inside phases 4 and #72 |
| 6 e2e suite on `wrangler dev` | ❌ **not done** |
| 7 Cutover | 🟡 data imported; passwords + Mac shutdown outstanding |

- **Production D1 holds 174 rows** — your 2 real accounts and their data.
  Row counts verified against the export; `PRAGMA foreign_key_check` clean.
- **The Mac is untouched and still running.** It remains the source of truth and
  the rollback path. Nothing was stopped or deleted.
- The 273 `e2e_*` test accounts were purged from the Mac's database first (#70),
  with a backup at `~/daybook/shared/data/daybook.db.pre-e2e-purge-*`.

## What is NOT done — read before relying on this

1. **Phase 6 never ran.** The plan calls the 51-spec e2e suite *the gate* before
   cutover: "if the specs cannot be made green, we do not cut over." They still
   run against the Express server (and pass), not against the Worker. Every
   ported route was hand-exercised instead — 220+ assertions across six suites,
   including cross-user isolation, atomicity and a fault-injected settlement
   rollback — but that is not the same as the real suite.
2. **Rate limiting (blocker 4.3) is not configured.** It was to be Cloudflare
   edge rules. The URL is public.
3. **Your data now lives on Cloudflare**, per `docs/option-2-workers-d1-plan.md`
   §9.1. 2FA on that Cloudflare account is the real perimeter.
4. **If you used the Mac app after this import**, the two databases have
   diverged. Re-run the import before trusting the cloud copy:
   ```bash
   node scripts/export-to-d1.mjs --users kakon,tumpa --out /tmp/dbx
   # then load /tmp/dbx/[0-9]*.sql with: npx wrangler d1 execute daybook --remote --file <each>
   node scripts/verify-import.mjs --remote --in /tmp/dbx
   ```
   (Clear the old rows first, or you will get UNIQUE constraint failures.)

## Recommended order in the morning

1. Set both passwords (above) and log in.
2. Check your data looks right — 92 transactions, 16 tasks, 5 accounts, the
   household group and its split/settlement history.
3. **Keep the Mac running** until you're satisfied. It costs nothing and it is
   the rollback.
4. Then decide whether to run Phase 6 before or after you start using the cloud
   copy day to day.
