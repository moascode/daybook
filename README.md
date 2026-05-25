# Daybook

A personal productivity and finance app that lives entirely in your browser.

**Tasks** (Workflowy-style bullet tree) + **Wallet** (BudgetBakers-style finance tracker) — no server, no account, no monthly fee.

---

## Overview

Daybook stores all data locally in your browser using [PGlite](https://github.com/electric-sql/pglite) — a full PostgreSQL engine running via WebAssembly, persisted in IndexedDB. It works 100% offline and loads instantly on every visit.

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
- **Dashboard** — weekly cash-flow bar chart, spending by category (pie), spending by account (bar), top merchants.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| Database | PGlite (PostgreSQL in-browser via WASM) |
| Routing | React Router v6 |
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
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Build for Production

```bash
npm run build
npm run preview
```

---

## Project Structure

```
src/
├── db/           — PGlite singleton + schema + seed data
├── stores/       — Zustand stores (tasks, wallet, app)
├── hooks/        — Data hooks (useTasks, useWallet, useSettings)
├── lib/          — Utilities (csv parser, claude client, formatters)
├── modules/
│   ├── tasks/    — Task tree components
│   └── wallet/   — Wallet pages and components
├── components/
│   ├── layout/   — AppShell, Sidebar, TopBar
│   └── ui/       — Reusable primitives (Button, Modal, Select, …)
└── types/        — Shared TypeScript interfaces
```

---

## Roadmap

| Phase | Goal | Status |
|---|---|---|
| 1 | Core scaffold (Vite + PGlite + layout) | ✅ Done |
| 2 | Tasks module | ✅ Done |
| 3 | Wallet module | ✅ Done |
| 4 | Home network multi-user (Node backend) | Planned |
| 5 | AI features (Claude integration) | Planned |
| 6 | Cloud hosting (Supabase + Vercel) | Planned |

See `CLAUDE.md` for detailed specifications.

---

## Data & Privacy

All data is stored in your browser's IndexedDB under the key `daybook`. Nothing is sent to any server. Clearing site data in your browser will erase all data — export is planned for Phase 5.

---

## License

MIT — personal use.
