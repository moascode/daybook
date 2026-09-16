# DAYBOOK — Project Brain (CLAUDE.md)

> **Read this entire file before writing a line of code.** It holds the rules
> and the traps. It deliberately does **not** hold the schema, the file map or
> the feature specs — those live in [`docs/reference/`](docs/reference/) and are
> read on demand. §5 tells you where everything is.

---

## 1. Project Identity

| Field | Value |
|---|---|
| **App name** | Daybook |
| **Owner** | Personal — one household, two real users (kakon, tumpa) |
| **Purpose** | Unified productivity + finance app |
| **Modules** | Wallet · Tasks · Trips · Day |
| **Architecture** | Cloudflare Workers + D1, single origin |
| **Currency** | MYR. Single-currency by decision, not by omission |
| **Live URL** | <https://daybook.moascode.workers.dev> — **public** |

---

## 2. Critical Rules

1. **Read this file first.** Every session.
2. **Never install an unlisted package.** The approved stack is
   [`docs/reference/architecture.md`](docs/reference/architecture.md). Ask before adding anything.
3. **Never change the database schema** without explicit instruction. Schema:
   [`docs/reference/database-schema.md`](docs/reference/database-schema.md). Migrations are
   additive-only and a shipped migration is never edited.
4. **Check before creating.** A component, hook or utility may already exist. Look in `src/` first.
5. **No `any`.** Use `unknown` and narrow it.
6. **One concern per file.** No 500-line god components.
7. **Ask, don't assume.** If a spec is ambiguous, ask. Don't invent behaviour.
8. **Keep `.env.local` out of git.** Never log or expose a key.
9. **Branch before you touch anything.** Never commit to `main` — not for a
   one-line fix, not for a doc typo. `git checkout -b <type>/<desc>`, then a PR. See §4.
10. **Never fail silently.** Every failed operation must say something the user
    can act on — a toast, an inline message, an error state. This overrides the
    tempting "degrade quietly so nothing breaks" pattern. Degrading the feature
    is right; degrading it *invisibly* is not, because a broken service and a
    service with nothing to return render identically, and the user is given no
    reason to retry. A `catch {}` returning `[]`, `null` or a no-op is a bug
    unless the caller surfaces the failure. If a helper must stay total, it
    returns the failure as *data* the caller reports (see `suggestCategoriesAI`'s
    `failedMerchants`). This applies to buttons above all: a click that changes
    nothing on screen and explains nothing is the worst outcome a handler can produce.
11. **Every behaviour change ships an e2e spec.** Run the *targeted* specs
    locally; let CI run the full suite. Conventions and the seven traps this
    suite has already fallen into:
    [`docs/reference/testing.md`](docs/reference/testing.md).
12. **Never spend the Anthropic API without asking.** Any new outbound Claude
    call is a hard stop, every time, in every mode.
13. **Roadmap work runs through its playbook.** Anything that is a numbered
    epic in [`docs/backlog/README.md`](docs/backlog/README.md)
    — including one named only by number ("start R8", which now means an epic,
    not a release) — goes through the [`daybook-flow`](.agents/skills/daybook-flow/SKILL.md)
    skill: its subagent split, and a stop at both its gates. **I don't merge to `main`.**
    "merge" / "ship it" at Gate 2 means the PR is ready for the owner to merge.
    A direct instruction to merge a *specific* PR overrides that for that PR only.
14. **Docs carry a status header** (`Live` / `Plan` / `Archived`) and a
    `Last verified` date. Moving a doc to `archive/` means flipping its header,
    not just its path. New docs never go at `docs/` top level. See
    [`docs/README.md`](docs/README.md).

---

## 3. Traps

Each of these cost a debugging session, and none is guessable from the symptom.
They are listed here — short — because the detail lives in files you would only
open once you already knew to look.

### Money

- **A TOTAL is yours alone; `GET /api/accounts` is not.** That route returns own
  **plus shared-in** accounts, so any figure summing the whole array counts other
  people's money as the viewer's. This shipped: RM100 of own money displayed as
  RM10,099 across "2 accounts". Sum `ownAccounts` for totals, and make an
  "across N accounts" caption count the same set the figure summed over.
- **Never read `t.amount` for anything a user compares.** A split transaction's
  effective figure is not its gross. A split RM100 expense once read RM50 in a
  tile and RM100 in the chart directly beneath it. Route everything through
  `countableAmount`. ⚠️ `TransactionList.tsx` day headers are **still unaudited**
  for this — see §8.
- **`POST /settlements` is hand-built for concurrency. Do not "simplify" it.**
  D1 has no interactive transactions, so it hoists every read, computes the
  write set in JS, then issues one `batch()` whose split updates are
  compare-and-swap guarded on the exact `settled_amount` read.
  **`batch()` is atomic, but a CAS matching 0 rows is a *successful* statement** —
  so `meta.changes` is inspected afterwards and a lost race is compensated back
  out, returning 409. Verified by fault injection.
- **Paying implies agreeing.** Every post-settlement resting state is `approved`.
  A debtor-side CAS probe once wrote `status='pending'` as a supposed no-op —
  true only while `pending` was the sole payable state. Once `approved` became
  payable too, it silently demoted agreed claims back into the review queue on
  every payment. It now assigns `settled_amount` to itself.
- **Lifecycle UI groups on a DERIVED claim state, never on `status`.** A
  claimed-but-unconfirmed split deliberately stays `pending`; grouping on the raw
  column shows a paid claim as untouched and invites paying it twice.

### D1

- **No named parameters.** better-sqlite3 binds `@key` from an object; D1's
  `.bind()` is positional only. Hence `worker/lib.ts` `updateRow()` building an
  ordered argument list.
- **D1 strips SQL comments** from the DDL in `sqlite_master`; SQLite keeps them.
  Any schema comparison must strip comments or every commented table reports as drift.
- **Low `SQLITE_MAX_COMPOUND_SELECT`.** An 18-term `UNION ALL` is rejected. Use
  scalar subqueries to project many aggregates in one query.
- **`compatibility_date` must not exceed the bundled `workerd` version's date**
  (`node_modules/workerd/package.json`). A future date is a hard `wrangler dev`
  startup failure, not a warning.

### Theming

- **Never write a `dark:` variant.** There is not one in the codebase; one would
  be the first. The token layer already mirrors the accent ramps (50↔950), so
  `bg-amber-50` *already* resolves to a dark tint in dark mode — pairing it with
  `dark:bg-amber-950` inverts a second time and lands on near-white. Eight of
  these shipped into review during a dashboard rebuild. **The type checker
  cannot see it and neither can a diff reviewer — look at the rendered page.**
- **Never hand-edit `src/index.css`.** It is generated. Edit
  `scripts/gen-theme-tokens.mjs` and run `npm run gen:tokens`; CI fails on drift.
- **Branch on `resolvedTheme`, never `theme`.** `theme` is the tri-state
  preference; `resolvedTheme` is what is on screen.
- **`manifest.json` `background_color` stays `#ffffff`.** It cannot follow the
  theme and this is not a bug to fix. The *launch image* can and does, via
  `apple-touch-startup-image` — a different mechanism. Full reasoning:
  [`docs/reference/theming.md`](docs/reference/theming.md).

### Tests

- **The suite runs on ONE clock.** Never call `toISOString()` for a date — use
  `businessToday()` / `businessDatePlus()`. For the eight hours a day when UTC
  and Malaysian dates differ, rows the Worker stamps "today" land outside the
  month the client shows; there was once **no timezone at which the whole suite
  was green** inside that window.
- **`getByLabel()` matches SUBSTRINGS.** A new control's accessible name can
  silently capture unrelated specs anywhere in the suite. Fix it in the app by
  renaming the control, not by patching specs.
- **The harness runs a PRODUCTION build**, so anything gated on
  `import.meta.env.DEV` vanishes. Test hooks use `TEST_HOOKS_ENABLED`.
- **Don't hand-start a dev server on 5173.** The harness owns that port with
  `reuseExistingServer` and will silently adopt yours — without `VITE_E2E=1`,
  every spec relying on `window.__test*` then fails with no hint why.
  `npm run dev:worker` uses **:8788** for exactly this reason.
- **Never run the full suite locally.** CI already shards it 8×. Attempts to
  reproduce it here have returned inflated, garbled numbers and burned real time
  without adding signal.
- **Playwright cannot intercept a Worker→third-party fetch.** Branch on
  `DAYBOOK_TEST` and read a canned response from a `settings` row instead.

---


## 4. Git Conventions

### The non-negotiable rule
**Never commit directly to `main`.** Every task starts on a branch and ends with a PR.
This applies to everything — a one-line fix, a doc update, a new feature.

### Workflow for every task

```
1. BRANCH   git checkout -b <type>/<short-description>
2. BUILD    make changes, commit incrementally
3. VERIFY   run tsc + affected e2e tests (Haiku agent — see §7)
4. PR       gh pr create … (see template below)
5. MERGE    owner reviews + merges; delete branch
```

### Branch naming
```
feat/wallet-quick-filters        ← new feature
fix/csv-header-toggle-reparse    ← bug fix
chore/update-claude-md           ← docs / config / tooling
refactor/transaction-list-props  ← no behaviour change
test/add-csv-e2e-coverage        ← tests only
```

### Commit format (Conventional Commits)
```
feat(tasks): add bullet collapse toggle
fix(wallet): correct balance calculation for transfers
chore: update CLAUDE.md with Phase 2 status
test(csv): add header-toggle and no-account e2e tests
```
- Subject ≤ 50 chars, imperative mood
- Body only when the *why* isn't obvious from the subject
- Always include `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

### PR template (use `gh pr create`)
```
gh pr create \
  --title "<type>(<scope>): short description" \
  --body "$(cat <<'EOF'
## What
- Bullet summary of changes

## Why
One sentence on the motivation.

## Test plan
- [ ] tsc clean
- [ ] Affected e2e specs pass
- [ ] Manual smoke (if UI change)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### What to commit
- ✅ All source files
- ✅ `.env.example`
- ✅ `CLAUDE.md`
- ✅ `.agents/skills/` (skill files)
- ❌ `.env.local` (gitignored)
- ❌ `node_modules/`
- ❌ `.DS_Store`
- ❌ `server/data/*.db` (gitignored)

---

---

## 5. Where everything else lives

This file is deliberately short. The long-form material is one click away.

| You need | File |
|---|---|
| Database schema, types, env vars | [`docs/reference/database-schema.md`](docs/reference/database-schema.md) |
| Architecture + the approved package list | [`docs/reference/architecture.md`](docs/reference/architecture.md) |
| The file map | [`docs/reference/project-structure.md`](docs/reference/project-structure.md) |
| What each module is meant to do | [`docs/reference/feature-specs.md`](docs/reference/feature-specs.md) |
| E2E conventions, how to run, the seven traps | [`docs/reference/testing.md`](docs/reference/testing.md) |
| Theme tokens, the two colour families | [`docs/reference/theming.md`](docs/reference/theming.md) |
| Why a past choice was made | [`docs/reference/decisions.md`](docs/reference/decisions.md) |
| Deploy, release, rollback | [`docs/guides/ci-cd.md`](docs/guides/ci-cd.md) |
| What's planned, and whether it's still wanted | [`docs/backlog/README.md`](docs/backlog/README.md) |
| Undecided design questions (D-5, D-6, D-9) | [`docs/reference/open-decisions.md`](docs/reference/open-decisions.md) |
| Everything that shipped | [`docs/archive/README.md`](docs/archive/README.md) |
| The whole docs tree and its rules | [`docs/README.md`](docs/README.md) |

---

---

## 6. Coding Conventions

### Component structure
```tsx
// Always in this order:
// 1. Imports
// 2. Types/interfaces (local to this file)
// 3. Component function
// 4. Subcomponents (if small and only used here)
// 5. Default export

import { useState } from 'react'
import type { Task } from '@/types/tasks.types'

interface BulletNodeProps {
  task: Task
  depth: number
  onUpdate: (id: string, content: string) => void
}

export function BulletNode({ task, depth, onUpdate }: BulletNodeProps) {
  // ...
}
```

### Path aliases (configured in vite.config.ts + tsconfig.json)
```
@/            → src/
@/types/      → src/types/
@/lib/        → src/lib/
@/hooks/      → src/hooks/
@/stores/     → src/stores/
@/modules/    → src/modules/
@/components/ → src/components/
```

### Utility function
```typescript
// Always use this for className merging
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs))
}
```

### Currency formatting
```typescript
// Always use this — never raw toFixed()
export function formatMYR(amount: number): string {
  return new Intl.NumberFormat('ms-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2,
  }).format(amount)
}
```

### Date handling
```typescript
// Store as YYYY-MM-DD strings in DB
// Display using date-fns v3
import { format, parseISO } from 'date-fns'

const display = format(parseISO(transaction.date), 'dd MMM yyyy')
const today = format(new Date(), 'yyyy-MM-dd')
```

### Zustand ↔ server sync pattern
> **Updated for Phase 4.** Persistence now lives on the Node + SQLite backend,
> reached through `src/lib/api.ts` (not the removed in-browser PGlite). The
> principle is unchanged: **server write first, then update the store on success.**

Zustand is the source of truth for UI rendering. The server (SQLite) is the source
of truth for persistence. Always write to the server (`api.post`/`api.put`/…) first,
then update the Zustand store on success. Never update the store optimistically
without a server write, as this creates divergence on refresh.

```typescript
// Pattern: server write first, then store update
async function addTask(content: string) {
  const newTask = await api.post<Task>('/tasks', { content })
  useTasksStore.getState().setTasks([...currentTasks, newTask])
}
```

### Delete confirmation policy
Two patterns, chosen by consequence:
- **Undo-toast** (no confirm dialog): single/low-consequence deletes — a task, a
  single transaction. Delete immediately, then offer a 5-second "Undo" toast.
- **`ConfirmDeleteModal`** (`src/components/ui/ConfirmDeleteModal.tsx`): high-consequence,
  bulk, or cascading deletes — deleting an account (cascades to all its
  transactions), bulk-deleting selected transactions, budgets, goals, recurring
  rules. Never hand-roll a `Modal` + `variant="danger"` confirm dialog for these;
  use `ConfirmDeleteModal` and, if a stable test hook is needed, its optional
  `confirmTestId` prop.

> **Tasks are the deliberate exception (CD-20).** Both single and bulk task
> deletes use the **undo-toast**, not `ConfirmDeleteModal` — the outliner is
> keyboard-first and every delete is instantly and fully reversible (the bulk
> path snapshots each selected subtree and restores it on Undo). Wallet's
> multi-select uses the confirm modal; Tasks' multi-select intentionally does
> not.

---

---

## 7. Model Routing

The full routing table, cost intuition and spawn templates live in the
[`smart-delegate`](.agents/skills/smart-delegate/SKILL.md) skill. It is the
single source of truth — this section is only the part that is non-negotiable:

1. **Never work on `main`** — branch first.
2. **Never run tests inline** — always a Haiku agent.
3. **Never do git inline** — always a Haiku agent.
4. **Haiku prompts must be tight** — exact commands, exact paths. Haiku doesn't explore.
5. **Independent verifications run in parallel** — spawn them in one message.
6. **Work is not done until the PR exists.**

---

---

## 8. Project Status

**Update this section at the end of every Claude Code session.** Keep it to
*current state* — what is live, what is blocked, what is next. The
session-by-session narrative lives in
[`docs/archive/project-history.md`](docs/archive/project-history.md); append there rather than
growing this section back to the 871 lines it reached before 2026-08-08.

### Where the app runs

**LIVE on Cloudflare Workers + D1** — <https://daybook.moascode.workers.dev>.
Two real users (kakon, tumpa). The Mac (Express + SQLite) is retired as a
deployment target but still running: it is the rollback of last resort.
`server/` remains in the repo only as the schema reference that
`scripts/schema-diff.mjs` gates CI against — it gets no feature work.

### Released

**Latest tag: `v3.12.2`** (2026-09-13). The full table with dates and contents
is in [`docs/archive/project-history.md`](docs/archive/project-history.md#release-record).

> **The release list is derived from `git tag`, not from memory.** It drifted
> three times by being updated only by whichever PR happened to touch this
> section — most recently sitting at "v2.4.0 PENDING" while v2.4.0, v2.5.0 and
> v2.6.0 were all tagged and deployed. When you cut a release, reconcile the
> history doc's table against:
>
> ```
> git for-each-ref --sort=-creatordate --format='%(refname:short) %(creatordate:short)' refs/tags
> ```

> ⚠️ **Never state whether `main` is released — measure it.** This block used
> to assert a snapshot ("as of 2026-08-25, `main` is NOT fully released … 47+
> commits pending"), and that assertion is exactly what rotted: it still named
> `v2.9.2` as the tip while v3.x had been shipping for weeks, and on 2026-09-13
> it sent a session to tell the owner a one-file fix would drag 47 unreleased
> commits to production when `main` was in fact fully released. A sentence about
> release state is wrong the moment anything merges, so the only safe form is
> the command:
>
> ```
> git fetch origin main --tags
> git log --oneline "$(git describe --tags --abbrev=0 origin/main)..origin/main"
> ```
>
> Empty → `main` is released. Non-empty → those commits ship with the next tag,
> so read them before cutting one; a release is never only the change you just
> made unless that output says so.

**Pushing a tag ref can fail with HTTP 403** from the container agent proxy.
The symptom is specific: branch pushes succeed and only tag refs are rejected
(`RPC failed; HTTP 403`, then `send-pack: unexpected disconnect`). It has come
and gone — do not trust a note claiming it is fixed, including this one.

When it hits, release through `release.yml`'s `workflow_dispatch` instead of
pushing the tag (added in PR #197 for this exact case):

```
gh workflow run release.yml --ref main -f version=vX.Y.Z
```

The dispatch validates the version's shape and that it is unused, waits for the
same green-CI-for-this-SHA gate, and its Publish step creates the tag at the
commit it deployed — so the end state is indistinguishable from a tag push. Do
not hand-create the tag afterwards. Used for v3.12.1 and v3.12.2.

**The tag is the deploy** — `release.yml` holds the Cloudflare credentials and
runs end to end: full suite → D1 migrations → Worker deploy → smoke test →
GitHub Release.

```
git checkout main && git pull
git tag -a vX.Y.Z -m "vX.Y.Z — summary"
git push origin vX.Y.Z
```

### Phase status

| Phase | State |
|---|---|
| 0–4 (scaffold → home network) | ✅ shipped, v1.0 |
| 5a (AI) | 🟢 four features ship — bulk categorisation, merchant resolution, composer parse, photo import. See [`docs/reference/feature-specs.md` §AI](docs/reference/feature-specs.md) for the authoritative list and what is still missing. |
| 5b (sharing), 5c (wallet UX) | ✅ shipped, v1.0.1 |
| 6 (Workers + D1) | ✅ COMPLETE — production has run on the Worker since v2; the full suite is green in CI, sharded across 8 jobs |
| 7 (advanced) | ongoing; recurring rules, budgets, goals already shipped |

### Blockers

**None blocking work.** Production is live and serving.

### Open risks and known bugs

**Tracked in [`docs/backlog/README.md`](docs/backlog/README.md)**, not here — a
bug listed in a status section gets skimmed; one in the backlog can be worked.
File new ones with the `intake` skill.

| | |
|---|---|
| [BUG-001](docs/backlog/EP-05-production-hardening/BUG-001-no-rate-limiting.md) | No rate limiting on the public URL — the oldest open risk on a live money app |
| [BUG-002](docs/backlog/EP-04-money-figure-correctness/BUG-002-impossible-calendar-dates.md) | ISO validation accepts Feb 30 / Apr 31 |
| [BUG-003](docs/backlog/EP-04-money-figure-correctness/BUG-003-day-header-split-totals.md) | Day headers may double-count splits (§3 trap) |
| [BUG-004](docs/backlog/EP-05-production-hardening/BUG-004-e2e-account-residue.md) | `e2e_*` account residue on the retired Mac |

Not a bug, and not to be "fixed": `manifest.json`'s `background_color` cannot
follow the theme. The launch *image* does, since v3 P5. See
[`docs/reference/theming.md`](docs/reference/theming.md).

### Next, in rough order of value

1. **Rate limiting** for the public URL ([BUG-001](docs/backlog/EP-05-production-hardening/BUG-001-no-rate-limiting.md)).
2. **Watch the netting paths with real use.** Every new column defaults to 0 and
   one-directional debt takes the old code path exactly, so nothing changes
   until two users genuinely owe each other both ways.
3. **Ready-to-build backlog, no sign-off needed:** waves F1–F3 in
   [EP-03](docs/backlog/EP-03-consistency-remainder/README.md) — but read its table first: most of that plan already shipped. §4.4 the per-claim timeline (every timestamp
   already exists).
4. **Needs owner sign-off:** each remaining [`docs/reference/feature-specs.md` §AI](docs/reference/feature-specs.md) AI item (the list shrank — four
   features already ship); D-5 auto-approve as a per-group "we trust each other"
   setting; the parked D-items/C9 in `docs/archive/phase-5c-wallet-ux.md` §D.

> **The PWA quality track (`docs/v3/` P1–P5) is DONE**, and the day-header audit
> with it — both sat in this list as "next" long after shipping. P1 install
> quality, P2 offline, P3 code-splitting (1,251 kB → 390 kB entry), P4 push
> notifications and P5 themed splash screens shipped as `v3.7.0`–`v3.11.0`;
> `docs/archive/pwa/README.md`'s own board marks all five merged. P4 still **needs its
> two secrets set** (`docs/guides/push-setup.md`) before it does anything.
>
> A "next" list is the same decaying assertion §8's release block warns about.
> Before trusting a row here, check whether it already shipped.

### Standing notes

- Releases are tag-triggered; `release.yml` gates on the full suite, applies D1
  migrations **before** deploying, smoke-tests, then publishes the Release.
- **`release.yml` gates on a green *CI run for the tagged commit*, not on its
  own test run.** So the `wrangler dev` broken-pipe flake (documented in
  `playwright.config.ts`) fails the release indirectly: the shard dies, CI on
  the merge commit goes red, and the release exits with "CI concluded
  'failure'". Retries do not save it — once the server is dead every retry in
  that shard also fails on `ECONNREFUSED ::1:5173`. The fix is
  `gh run rerun <ci-run-id> --failed`, wait for green, **then**
  `gh run rerun <release-run-id>`. Re-tagging is not needed. Confirm it is the
  flake and not a real break by running the failing shard locally
  (`npx playwright test --shard=N/8`) before re-running anything.
- A local `wrangler … --remote` still fails from the owner's Mac (account not
  authorised). Only CI holds a token — verify remote D1 from the release log.
- D1 migrations are additive-only; rename via `ALTER TABLE … RENAME TO` is
  lossless and allowed with owner sign-off. Applied in lexicographic order.
- e2e uses a fresh DB per context; CI shards across 8 jobs.
- Pre-existing lint: 38 warnings (react-hooks, test-only shims).

---
