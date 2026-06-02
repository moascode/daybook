# Daybook

A personal productivity and finance app for your home network.

**Tasks** (Workflowy-style bullet tree) + **Wallet** (BudgetBakers-style finance tracker) — multi-user on your local network, all data on your hardware.

---

## Overview

Daybook runs on a Node.js backend with a local SQLite database. Access it from any device on your home network. All data stays on your hardware; no cloud, no monthly fees. Phase 4 (v1.0) adds multi-user authentication and per-device data isolation. Phase 5b (v1.0.1) adds household groups, shared accounts, transaction splits, and settlement tracking for family finances.

---

## Features

### Tasks
- Infinite-depth bullet tree — like Workflowy or Notion outliner
- Press **Enter** to add a sibling, **Tab** to indent, **Shift+Tab** to outdent
- Click the **checkbox** to mark a task complete
- Click the **bullet dot** to zoom in and focus on a subtree (breadcrumb navigation back)
- **Drag the grip handle** to reorder tasks within a level
- Collapse/expand child trees with the **›** chevron
- Add notes to any task from the **⋯** options menu
- **Hide/show completed** tasks with one click
- Keyboard: `Cmd+Enter` — toggle complete · `Cmd+.` — collapse · `Backspace` (empty line) — delete

### Wallet
- **Accounts** — cash, card, e-wallet, bank, investment. Balances auto-calculated.
- **Transactions** — income, expense, transfer. Grouped by day. Filtered by date, type, account, category, and tag.
- **CSV Import** — upload a bank export, map columns, review rows, detect duplicates automatically, import in bulk.
- **Household Sharing** — create groups, invite family members, share accounts with optional write access, split transactions, settle balances with real ledger transfers.
- **Dashboard** — weekly cash-flow bar chart, spending by category (pie), spending by account (bar), top merchants.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| Backend | Node.js + Express |
| Database | SQLite (file-based, on your hardware) |
| Routing (Frontend) | React Router v6 |
| Routing (API) | Express routes |
| Auth | Session cookies + bcrypt |
| Charts | Recharts |
| Drag & Drop | @dnd-kit |
| Icons | Lucide React |

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm 9+

### Install & Run

```bash
git clone https://github.com/moascode/daybook.git
cd daybook
npm install
npm run dev:all
```

Open [http://localhost:5173](http://localhost:5173). The `dev:all` command starts both the Vite frontend dev server and the Node.js backend API server.

### Build for Production

```bash
npm run build
npm run preview
```

---

## Project Structure

```
Frontend:
src/
├── stores/       — Zustand stores (tasks, wallet, app, user state)
├── hooks/        — Data hooks (useTasks, useWallet, api calls)
├── lib/          — Utilities (CSV parser, API client, formatters)
├── modules/
│   ├── tasks/    — Task tree components + pages
│   └── wallet/   — Wallet pages, accounts, transactions, dashboard
├── components/
│   ├── layout/   — AppShell, Sidebar, TopBar
│   ├── ui/       — Reusable primitives (Button, Modal, Select, …)
│   └── auth/     — AuthPage, login/signup
└── types/        — Shared TypeScript interfaces

Backend:
server/
├── index.ts      — Express app + server creation
├── db.ts         — SQLite singleton + migration runner
├── seed.ts       — Default category seed data (per-user)
├── lib.ts        — Utilities (updateRow, ownsAllRefs)
├── session-store.ts — express-session SQLite store
├── routes/       — API endpoints (auth, tasks, wallet, settings)
├── migrations/   — Database schema files (applied in order)
└── data/         — SQLite database file (gitignored)
```

---

## Roadmap

| Phase | Goal | Status |
|---|---|---|
| 1 | Core scaffold (Vite + layout + UI primitives) | ✅ v1.0 |
| 2 | Tasks module (Workflowy-style tree) | ✅ v1.0 |
| 3 | Wallet module (accounts, transactions, CSV, dashboard) | ✅ v1.0 |
| 4 | Home network multi-user (Node backend, auth) | ✅ v1.0 |
| 5a | AI features (Claude integration) | 🔄 Deferred |
| 5b | Household sharing (groups, splits, settlements) | ✅ v1.0.1 |
| 5c | Wallet UX improvements (search, accessibility, mobile) | 🔄 In Progress |
| 6 | Cloud hosting (Supabase + Vercel + RLS) | Planned |
| 7 | Advanced features (budgets, goals, more) | Planned |

See `CLAUDE.md` and `docs/` for detailed specifications and plans.

---

## Data & Privacy

**Phase 4 (v1.0+)**: All data is stored in a SQLite database on your hardware (default: `~/daybook/shared/data/daybook.db`). The app runs on your local network via a Node.js backend. Nothing is sent to any external server or cloud provider.

**Per-user data**: Each user has their own authenticated session. Tasks, accounts, and transactions are scoped by user; one user cannot see another's private data.

**Household sharing**: Data can be shared within groups (optional) — shared accounts and split transactions are visible to invited group members only.

**Deployment**: Phase 6 (cloud) will add Supabase + Vercel as optional alternatives. The local version will always be available.

---

## License

MIT — personal use.
