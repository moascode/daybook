# Daybook

A personal productivity and finance app for a household.

**Wallet** (BudgetBakers-style finance tracker) + **Tasks** (Workflowy-style
outliner) + **Trips** + **Day**, running on Cloudflare's edge.

🔗 <https://daybook.moascode.workers.dev>

---

## Features

### Wallet
- **Accounts** — cash, card, e-wallet, bank, investment. Balances computed from the ledger.
- **Transactions** — income, expense, transfer. Grouped by day; filtered by date, type, account, category, tag and free-text search.
- **CSV import** — upload a bank export, auto-detect columns, resolve merchant names, pre-fill categories from your own history, detect duplicates, review, import in bulk.
- **Capture inbox** — an iOS Shortcut (or any client with a capture token) can post a transaction; nothing a machine writes reaches the ledger unreviewed.
- **Budgets, goals, recurring rules, reports.**
- **Household sharing** — groups, shared accounts with optional write access, transaction splits, and settlement that books real ledger entries.

### Tasks
- Infinite-depth bullet outliner: **Enter** for a sibling, **Tab**/**Shift+Tab** to indent and outdent, **Backspace** on an empty line to delete.
- Today, All, per-list and Completed views; lists, priorities, due dates, assignees.
- Click the bullet dot to zoom into a subtree; drag the grip to reorder.
- `Cmd+Enter` toggle complete · `Cmd+.` collapse.

### Trips & Day
- **Day** — a timeline of what happened, with spend and task context.
- **Trips** — travel framed as its own module.

Both are live as designed first-run states; their depth is the current roadmap.

### Everywhere
- **Light and dark themes**, driven by one generated token layer with a WCAG-AA gate in CI.
- **Installs as a PWA** — offline shell, themed iOS launch screens, push notifications.
- **Optional AI** — bring your own Anthropic key for merchant-name resolution and bulk categorisation. The app is fully usable without one; with no key set, every AI entry point is hidden.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS (generated token layer, no `dark:` variants) |
| State | Zustand |
| Backend | Cloudflare Workers + Hono (`worker/`) |
| Database | Cloudflare D1 |
| Auth | PBKDF2-HMAC-SHA256 via Web Crypto + D1-backed sessions behind an HMAC-signed cookie |
| Charts | Recharts |
| Drag & drop | @dnd-kit |
| Tests | Playwright, sharded 8× in CI |

> `server/` is an **Express + SQLite backend that is no longer deployed.** It
> remains in the repo because `scripts/schema-diff.mjs` gates CI on D1 matching
> `server/migrations`. It is a schema reference, not a deployable.

---

## Getting started

### Prerequisites
Node.js 20+, npm 9+.

### Run it

```bash
git clone https://github.com/moascode/daybook.git
cd daybook
npm install
npm run dev:worker
```

Open <http://localhost:8788>. This builds the client, applies D1 migrations to a
local database, and runs the Worker — so `/api` works.

> **Use port 8788, not 5173.** `npm run dev` is plain Vite with no API behind
> it, and the Playwright harness owns 5173 with `reuseExistingServer`, so a
> hand-started server on that port gets silently adopted by the test run.

### Tests

```bash
npx playwright test e2e/01-tasks       # targeted — the normal case
npm run test:e2e:parallel              # full local suite (CI already shards this)
```

---

## Project structure

```
src/                 React client
├── modules/         wallet · tasks · trips · day · settings — pages and features
├── components/      layout (AppShell, AppBar, sidebars) · ui primitives · auth
├── stores/          Zustand stores
├── hooks/           data hooks
├── lib/             api client, CSV, formatters, theme
└── types/           shared interfaces

worker/              Cloudflare Worker (production backend)
├── index.ts         Hono app, route mounts, error handling
├── routes/          auth · tasks · wallet · settings · groups · settlements
├── migrations/      D1 migrations, applied in order
├── crypto.ts        PBKDF2 via Web Crypto
└── session.ts       D1-backed sessions

server/              retired Express backend — schema reference only
e2e/                 Playwright specs, NN-description.spec.ts
docs/                see docs/README.md
```

---

## Where things are documented

| | |
|---|---|
| Rules Claude Code works under | [`CLAUDE.md`](CLAUDE.md) |
| Docs index | [`docs/README.md`](docs/README.md) |
| Deploy, release, rollback | [`docs/guides/ci-cd.md`](docs/guides/ci-cd.md) |
| What's planned | [`docs/roadmap/design-adoption/README.md`](docs/roadmap/design-adoption/README.md) |
| Features, bugs, ideas | [`docs/backlog/README.md`](docs/backlog/README.md) |
| How it got here | [`docs/archive/project-history.md`](docs/archive/project-history.md) |

---

## Data & privacy

Data lives in **Cloudflare D1**, and the app runs on Cloudflare Workers. It is
reachable from the public internet — this is a hosted app, not a home-network
one. It served two users at the time of writing.

- **Per-user scoping.** Every query is scoped by `user_id`; one user cannot read or write another's rows.
- **Household sharing is opt-in.** Shared accounts and split transactions are visible only to invited group members.
- **Signup is disabled in production.** Accounts are provisioned deliberately.
- **AI keys never reach the browser.** A per-user Anthropic key is stored server-side and masked to `'set'`/`''` on read, so one user's spend can never land on another's bill.

---

## License

MIT — personal use.
