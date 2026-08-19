# Business Module — Claude Code Build Brief

This replaces the ChatGPT draft. The product thinking in that draft was
mostly right (the Tasks/Wallet/Business analogy, the MVP ordering, the
invoice field list). What it got wrong is the plumbing: it describes a
backend Daybook no longer ships on, points at a study list that's gone
stale, and never mentions the repo's own `CLAUDE.md` — which is the actual
constitution Claude Code is supposed to obey every session. This brief
fixes the plumbing, keeps the good product decisions, and restructures
delivery to match how this repo actually ships code (small branches, one
PR per slice, e2e-gated).

**How to use this file:** don't paste the whole thing into one Claude Code
session. Section 10 breaks the build into seven session-sized slices, each
ending in its own PR. Point Claude Code at this file (`docs/business-module-plan.md`
once committed) plus `CLAUDE.md` at the start of session 0, then feed each
subsequent session its own slice.

---

## 0. The one correction that matters most

The original prompt says:

> Backend: Node.js, Express, SQLite … Study `server/routes`, `server/migrations`, `server/db.ts`

That was true through Phase 4. It has not been true since Phase 6. Per
`CLAUDE.md` §13 ("Project Status"):

> **LIVE on Cloudflare Workers + D1.** … The Mac (Express + SQLite) is
> retired as a deployment target but still running: it is the rollback of
> last resort. `server/` remains in the repo only as the schema reference
> that `scripts/schema-diff.mjs` gates CI against — it gets no feature work.

So: **the Business module's routes belong in `worker/routes/business.ts`
(Hono, running on Cloudflare D1), not `server/routes/`.** `server/` only
needs the new migration files — mirrored purely so the CI schema-diff gate
doesn't fail — never new route code. Building this against `server/` would
mean shipping a module the live app can't run.

---

## 1. Required reading (corrected — the repo tree has moved on)

Read `CLAUDE.md` in full first, every session, per its own rule 1. It is
1,698 lines; the sections that matter most for this module are §2 (rules),
§5 (folder structure — flagged below as partly stale), §6 (schema
conventions), §10 (coding conventions), §11 (git conventions), §16 (e2e
conventions), §17 (the Haiku/Sonnet delegation workflow this repo already
uses for every task).

`CLAUDE.md` §5 itself warns that its folder tree is the *original* Phase-1
layout and partly historical — "treat `src/` on disk as the real map."
Confirmed by inspection: the actual set of files to study is bigger than
either the old ChatGPT prompt or `CLAUDE.md`'s own tree shows.

Study, in this order:

- `src/modules/wallet/` — the closest sibling module (accounts, transactions,
  a dashboard subfolder, CSV import, budgets, goals, recurring rules,
  sharing). ~40 files. This is the structural template for Business.
- `src/modules/tasks/` — smaller module, useful for the bare-minimum shape.
- `src/stores/wallet.store.ts`, `src/stores/tasks.store.ts` — Zustand
  pattern: entity arrays + a `filters` object + a `dataVersion` counter for
  out-of-band invalidation + plain setter/add/update/remove actions. No
  persistence logic lives in the store.
- `src/hooks/useWallet.ts` — the CRUD-hook pattern: calls `src/lib/api.ts`,
  maps snake_case DB rows to camelCase types, updates the store on success.
- `src/components/layout/AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`.
- `src/components/ui/` — current primitives are `Button`, `Input`,
  `Textarea`, `Select`, `Modal`, `Badge`, `DatePicker`, `DateRangeControl`,
  `EmptyState`, `TagInput`, `Toast`, `Tooltip`, `ConfirmDeleteModal`,
  `NetWorthBanner`, `WelcomeCard`. Reuse these; only add new primitives the
  invoice editor genuinely needs (a line-item row editor, most likely).
- `src/router.tsx` — every route is registered here, nested under
  `AppShell`. Wallet uses a layout route (`WalletLayout`) with children.
- `src/types/wallet.types.ts`, `src/lib/api.ts` (the fetch wrapper — study
  its `ApiError` + 401-redirect handling, reuse as-is).
- `worker/routes/wallet.ts`, `worker/routes/tasks.ts` — the Hono route
  pattern: a `Record<string,string>` column map, an `*InputError(body,
  partial)` validator function per entity, `c.env.DB.prepare(...).bind(...).all()`
  / `.first()`, every query scoped by `c.get('userId')`.
- `worker/index.ts` — how routers are mounted (`protectedApi.route('/', wallet)`
  inside a `requireAuth`-guarded sub-app).
- `worker/lib.ts` — `updateRow()`, the shared partial-update helper; D1
  binds are **positional only**, unlike `better-sqlite3`'s named `@key`
  binds in `server/lib.ts`. Follow `worker/lib.ts`'s style, not `server/lib.ts`'s.
- `worker/migrations/` + `worker/migrations/README.md` — the exact
  migration-mirroring rule (§6 below).
- `server/migrations/` — read-only, for numbering parity. Do not add route
  code under `server/`.

---

## 2. Philosophy — unchanged, keep this framing

Tasks is Workflowy for productivity. Wallet is BudgetBakers for personal
finance. Business is Shopify Lite for small business operations — deliberately
minimal, not QuickBooks/SAP/Odoo/Xero. Every screen should feel like it
shipped alongside Tasks and Wallet on day one: same primitives, same
Zustand pattern, same undo/confirm conventions, same theme tokens.

---

## 3. Technology — corrected

**Frontend:** React 18, TypeScript, Vite, Tailwind, Zustand, React Router
v6 — all already approved. Also already in the approved stack and worth
reusing rather than reinventing: `@radix-ui/react-dialog` (modals),
`lucide-react` (icons), `date-fns` v3 (date formatting/parsing), `clsx` +
`tailwind-merge` via the shared `cn()` helper in `src/lib/utils.ts`. None
of this needs a new dependency.

**Backend:** Cloudflare Workers (Hono) + Cloudflare D1, **not** Node/Express/SQLite.
Migrations are plain SQL, additive-only, applied with `wrangler d1
migrations apply`. `server/` is a frozen schema reference only.

**No new npm packages without asking first** — this is `CLAUDE.md` rule 2,
verbatim. The one place the original prompt implies a new dependency is PDF
generation ("Download as PDF"). See the decision in §4b — the recommended
default needs zero new packages, but if that gets overridden, flag it and
ask before installing anything.

---

## 4. Two decisions to lock in before Claude Code writes anything

The original prompt doesn't address either of these, and both are real
architectural forks. Pick one for each, or hand this section to Claude
Code in plan mode and let it ask.

### 4a. Is Business data shareable with household group members, like Wallet accounts?

Wallet has a whole subsystem for this (`groups`, `group_members`,
`account_shares`, `transaction_splits`, `settlements` — `CLAUDE.md` §6).
Tasks has none of it — purely single-user.

**Recommended default: no sharing in v1.** A small business's customers,
invoices and stock are normally one operator's data, and "Shopify Lite"
reads as single-operator. Bolting on Wallet's sharing model would roughly
double the schema and contradicts "simplicity is the primary requirement."
If shared bookkeeping (e.g. a spouse co-managing the business) turns out to
matter, treat it as a v2 addition modeled on `account_shares`, not a v1
requirement.

### 4b. How does invoice PDF generation actually work?

The approved stack has no PDF library (no `jspdf`, `react-pdf`, `puppeteer`,
`html2canvas` — checked `package.json`). The original prompt's requirements
("A4 layout," "Browser printing," "Download as PDF," "professional
typography," "proper page margins") are all satisfiable with **zero new
dependencies**: an `@media print` stylesheet on the invoice preview pane,
`@page { size: A4; margin: ... }`, and the browser's native `window.print()`
→ "Save as PDF." That's the recommended v1 approach.

A server-rendered PDF (needed later for, say, emailing an invoice
automatically) is a real stack change and needs explicit sign-off per rule
2 — scope it as a separate follow-up, not part of this build.

---

## 5. Module registration — corrected structure and exact wiring points

```
src/modules/business/
├── BusinessLayout.tsx        ← layout route, mirrors WalletLayout.tsx
├── DashboardPage.tsx         ← route: /business/dashboard (or index)
├── CustomersPage.tsx         ← route: /business/customers
├── CustomerForm.tsx          ← modal form, same shape as AccountForm.tsx
├── ProductsPage.tsx          ← route: /business/products
├── ProductForm.tsx
├── InvoicesPage.tsx          ← route: /business/invoices (list)
├── InvoiceEditorPage.tsx     ← route: /business/invoices/:id (split-screen editor+preview)
├── InvoicePreview.tsx        ← the print-styled right pane, also the print target
├── PurchasesPage.tsx         ← route: /business/purchases
├── PurchaseForm.tsx
├── SalesPage.tsx             ← route: /business/sales
├── SaleForm.tsx
└── dashboard/                ← mirrors wallet/dashboard/ — small presentational pieces only
    ├── SummaryCards.tsx
    └── RecentLists.tsx
```

`src/types/business.types.ts`, `src/stores/business.store.ts`,
`src/hooks/useBusiness.ts` — same three-file split Wallet uses, same
internal shape (store = arrays + filters + `dataVersion`; hook = API calls
+ snake_case→camelCase mapping + store updates on success, never
optimistic-only).

**Router** (`src/router.tsx`) — add a nested layout route the same way
`wallet` is nested today:

```tsx
{
  path: 'business',
  element: <BusinessLayout />,
  children: [
    { index: true, element: <Navigate to="dashboard" replace /> },
    { path: 'dashboard', element: <DashboardPage /> },
    { path: 'customers', element: <CustomersPage /> },
    { path: 'products', element: <ProductsPage /> },
    { path: 'invoices', element: <InvoicesPage /> },
    { path: 'invoices/:id', element: <InvoiceEditorPage /> },
    { path: 'purchases', element: <PurchasesPage /> },
    { path: 'sales', element: <SalesPage /> },
  ],
},
```

**Sidebar** (`src/components/layout/Sidebar.tsx`) — Business has six
sub-pages, exactly the shape Wallet's expandable `walletGroups` section
already solves. Add a parallel `businessGroups` constant and a second
expandable top-level item, reusing `topLinkClass`/`subLinkClass` and the
same expand/collapse-on-route-change logic already written for Wallet —
don't invent a new nav pattern.

---

## 6. Backend and database — grounded in the real schema conventions

New tables (naming call: the existing schema doesn't prefix table names by
module — plain `accounts`, `transactions` — but Business is nine tables to
Wallet's two or three, so a `business_` prefix is worth doing deliberately
here for scannability. Confirm this with the user rather than silently
diverging from house style):

```
business_customers, business_products,
business_invoices, business_invoice_items,
business_purchases, business_purchase_items,
business_sales, business_sale_items,
business_payments
```

Every table follows the exact conventions already in `CLAUDE.md` §6:

```sql
id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
created_at TEXT DEFAULT (datetime('now')),
updated_at TEXT DEFAULT (datetime('now')),
-- booleans as INTEGER 0/1, SQLite has no BOOLEAN
```

**Migration files and the mirroring rule.** Per
`worker/migrations/README.md`, every schema change needs the identical SQL
in both trees, with a permanent +1 numbering offset baked in from an old
duplicate-number fix:

- `server/migrations/0012_business_core.sql` (next free number in that tree)
- `worker/migrations/0013_business_core.sql` (next free number in that tree)

Same statements in both files (`CREATE TABLE IF NOT EXISTS` only —
additive, never edit a shipped migration). `scripts/schema-diff.mjs` gates
CI on these two trees producing an identical schema, comment- and
whitespace-insensitive — it does not look at route code at all, which is
why routes only need to exist in `worker/`.

**D1 quirks to carry over** (from `CLAUDE.md` §5, Phase 6 notes):
positional `.bind()` only, no named `@params` — follow `worker/lib.ts`'s
`updateRow()` pattern, not `server/lib.ts`'s. D1 strips SQL comments from
stored DDL (already handled by `schema-diff.mjs`'s normalizer, no action
needed). Keep any dashboard aggregate query under D1's low
`SQLITE_MAX_COMPOUND_SELECT` — use scalar subqueries instead of a wide
`UNION ALL` if the summary cards end up computed in one query.

**Routes:** `worker/routes/business.ts`, a single Hono sub-router exporting
`business`, mounted in `worker/index.ts` next to the others:

```ts
import { business } from './routes/business.ts'
// …
protectedApi.route('/', business)
```

Every handler reads `c.get('userId')` and scopes every query by it, exactly
like `worker/routes/wallet.ts`. Validate bodies with a per-entity
`*InputError(b, partial)` function (see `accountInputError` in
`worker/routes/wallet.ts` for the shape), return `{error}` JSON on 400 —
`src/lib/api.ts` already knows how to surface that message.

**API surface:** `/api/business/customers`, `/products`, `/invoices` (+
`/invoices/:id/items`), `/purchases`, `/sales` — list/create/get/update/delete
per entity, same REST shape Wallet already uses.

---

## 7. Invoices — the core feature, grounded in your actual reference

`docs/business-module-invoice-reference.pdf` (placed alongside this file)
is the real design reference — your own AboveStyle invoice (`INV-0019`).
Its information hierarchy, described so Claude Code can replicate it
without needing to re-read the PDF every time:

- **Top:** company block on the left (logo mark, company name bold,
  address) — big "Invoice" heading + `# INV-0019` on the right.
- **Second row:** "Bill To" block on the left (customer name bold, address,
  country) — a right-aligned two-column key/value stack on the right
  (Invoice Date, Due Date, P.O.#).
- **Subject line**, own row.
- **Line items table**, dark header row: `# | Item & Description | Qty | Rate | Amount`.
- **Summary block**, right-aligned under the table: Subtotal (with a
  "Tax Inclusive" caption), Shipping charge, Total, then Balance Due in
  its own shaded row.
- **Free-text notes block**, bottom-left: in the reference this is a
  currency-conversion note ("BANGLADESHI TAKA / Rate (RM to BDT): 29.02 /
  Total (With Bank Charge): BDT2,24,800.00"). This is real usage, not a
  hypothetical field — the app is MYR-only internally (per `CLAUDE.md` §6,
  the per-account currency selector was removed for that reason), so keep
  invoices MYR-denominated with this note staying a free-text field for
  cross-border customers, not a second currency system.

**Export filename convention** (confirmed against a second real invoice,
`INV-0020-16082026.pdf`, in the `abovestyle` folder): exported PDFs are
named `INV-<number>-<DDMMYYYY>.pdf`, where the date is the invoice date,
not the export date. Match this as the suggested filename in the
"Print / Save as PDF" flow if the browser API allows setting one;
otherwise it's a naming convention to document for the user, not something
to enforce in code.

Replicate this hierarchy, not the pixel styling — use Daybook's own theme
tokens for the on-screen editor chrome. The **printed/exported** invoice
should use its own dedicated print stylesheet independent of the app's
light/dark theme (`CLAUDE.md` §18) — a themed invoice would print with a
dark background on some setups, which is a real bug class to avoid, not a
hypothetical one.

Field list, numbering, split-screen editor/live-preview UX, line-item
add/remove/inline-edit/keyboard-nav, `Amount = Qty × Unit Price` with
instant summary recalculation, and the Draft/Sent/Paid/Overdue/Cancelled
status set — all as specified in the original draft; that part was already
correct. Two implementation notes:

- The split-screen layout is a two-pane CSS grid, no new state-management
  layer — either component-local state or a `business.store.ts` slice
  feeding a memoized total calculation, same shape as Wallet's live balance
  math.
- Invoice numbering config (prefix + next sequence) belongs in the existing
  per-user `settings` key-value table (`CLAUDE.md` §6) — e.g.
  `business_invoice_prefix` (default `'INV-'`), `business_invoice_next_seq`
  — not a new settings table.

---

## 8. Customers, Products, Purchases, Sales — mostly as originally specified

Field lists from the original draft are reasonable as-is for customers,
purchases and sales (customers: name/company/phone/email/billing+shipping
address/country/notes; purchases and sales: header + line items). Products
needs two additions, learned from actually building a real invoice from a
real purchase receipt (see §16) — purchase price and invoice-selling price
are never the same string, and the multiplier between them isn't always 1:

- Products need a `purchase_unit_label` + `purchase_unit_size` pair (e.g.
  `'kodi'` / `20`) — purchase receipts are commonly priced per bundle (a
  *kodi* is a 20-piece wholesale textile unit), not per piece, while invoice
  line items are always per piece. Without this factor on the product
  record, that conversion has to be re-derived by hand on every invoice.
- Products need an `invoice_description` field distinct from the internal
  `name` — the name on a purchase receipt (`SHAWL JERSEY PLAIN`) is never
  what should appear on a customer-facing invoice (`Plain Jersey`). See
  `item-description-mapping.md` in the `abovestyle` folder for the real
  mapping this is based on — seed the Products table from those eleven
  rows when session 3 builds it, rather than inventing placeholder names.
- Optional: a `default_markup` field (a flat currency amount added to the
  per-piece purchase cost) to pre-fill a *suggested* selling rate on a new
  invoice line. The rate must stay editable per line — this is a starting
  suggestion, never an enforced formula.

Full Products field list: `sku`, `name` (purchase/internal name),
`invoice_description`, `description`, `purchase_price`,
`purchase_unit_label`, `purchase_unit_size`, `selling_price`,
`default_markup`, `unit`, `active`.

Two conventions to apply that the original prompt didn't know about:

- **Forms:** modal forms following `AccountForm.tsx` — shared `Modal` +
  `Input`/`Select`/`Textarea`/`TagInput` primitives, not new one-off inputs.
- **Deletes:** these are cascading, higher-consequence deletes (a customer
  or product with existing invoice history, an invoice itself) — use
  `ConfirmDeleteModal` (`CLAUDE.md` §10's delete-confirmation policy), not
  the undo-toast pattern Tasks and single transactions use. Undo-toast is
  reserved for low-consequence, non-cascading deletes.

---

## 9. Dashboard — unchanged from the original

Keep it deliberately simple: summary cards (total sales, total purchases,
outstanding invoices, paid invoices, monthly profit) and three recent-activity
lists (invoices, purchases, sales). No charts in v1 — Wallet already owns
analytics, and `CLAUDE.md` explicitly warns against duplicating that
surface.

---

## 10. Delivery plan — one PR-sized Claude Code session per slice

This repo never lands one giant diff. Every task branches, gets verified
(`tsc` + the affected e2e spec), and ends in a PR — that's `CLAUDE.md` §11
and the mandatory four-phase workflow in §17
(Branch → Plan → Build → Verify → PR, Haiku for the mechanical steps,
Sonnet for the design/build steps). An 11-deliverable build like this
should not be one session. Run it as seven sessions, each scoped to one
branch and one PR, in this order:

| # | Slice | Branch | New e2e spec |
|---|---|---|---|
| 0 | Foundation — all 9 tables, types, empty store/hook, empty routed pages + nav | `feat/business-foundation` | `e2e/61-business-foundation.spec.ts` |
| 1 | Invoices (core feature) | `feat/business-invoices` | `e2e/62-business-invoices.spec.ts` |
| 2 | Customers | `feat/business-customers` | `e2e/63-business-customers.spec.ts` |
| 3 | Products | `feat/business-products` | `e2e/64-business-products.spec.ts` |
| 4 | Purchases | `feat/business-purchases` | `e2e/65-business-purchases.spec.ts` |
| 5 | Sales | `feat/business-sales` | `e2e/66-business-sales.spec.ts` |
| 6 | Dashboard | `feat/business-dashboard` | `e2e/67-business-dashboard.spec.ts` |

(`e2e/` currently ends at `60-*`, confirmed by listing the directory — next
free number is 61.)

Every session's prompt should:

1. Point Claude Code at `CLAUDE.md` and `docs/business-module-plan.md` and
   say "read both in full before writing code."
2. Name exactly one slice from the table above as in scope — nothing else.
3. Require a Playwright spec at the listed path before the slice counts as
   done (`CLAUDE.md` §16, rule 11).
4. Require the standard branch → verify → PR flow (§11/§17) — Claude Code
   already knows this workflow; just don't let it skip straight to code on
   `main`.
5. On the last commit of the session, update `CLAUDE.md` §13 (Project
   Status) and add a Business row to the §14 phase table under Phase 7 —
   this repo's own rule ("update this section at the end of every Claude
   Code session") applies here too.

---

## 11. Copy-paste prompt — Session 0 (Foundation)

```
Read CLAUDE.md in full, then read docs/business-module-plan.md in full.
Both are required context before writing any code — do not skip either.

Scope for this session: ONLY the foundation slice (see business-module-plan.md
§10, row 0). That means:

- Migrations: server/migrations/0012_business_core.sql and
  worker/migrations/0013_business_core.sql, byte-identical SQL, creating all
  nine business_* tables from business-module-plan.md §6. Additive only.
- src/types/business.types.ts — interfaces for every entity, camelCase,
  matching the DB→client mapping convention in src/hooks/useWallet.ts.
- src/stores/business.store.ts — Zustand store, same shape as
  src/stores/wallet.store.ts (arrays + filters + dataVersion + plain
  setters), empty of real data for now.
- src/hooks/useBusiness.ts — CRUD functions per entity following
  src/hooks/useWallet.ts's pattern, calling worker/routes/business.ts
  endpoints (create this route file now with real handlers for all nine
  entities' list/create/get/update/delete — this is backend-complete work,
  not stubs).
- worker/routes/business.ts mounted in worker/index.ts.
- src/modules/business/ — BusinessLayout.tsx and six placeholder pages
  (Dashboard/Customers/Products/Invoices/Purchases/Sales), each rendering
  a heading and an EmptyState for now — real UI comes in later sessions.
- src/router.tsx — nested business route tree per business-module-plan.md §5.
- src/components/layout/Sidebar.tsx — businessGroups nav section, same
  expandable pattern as walletGroups.

Do NOT build invoice editor UI, customer/product forms, or dashboard cards
in this session — those are separate sessions. Do NOT add any new npm
dependency. Do NOT touch server/routes/ — server/ only gets the migration file.

Before marking this done: run tsc, add e2e/61-business-foundation.spec.ts
covering nav → each placeholder page renders → each empty-list API call
returns 200, run the full suite for that spec, update CLAUDE.md §13 and
§14 (Business row under Phase 7), then open the PR per CLAUDE.md §11.
```

---

## 12. Prompt template — Sessions 2–5 (Customers / Products / Purchases / Sales)

These four are structurally identical CRUD slices — reuse this template,
swapping the entity name and field list from §8:

```
Read CLAUDE.md and docs/business-module-plan.md first (foundation from
session 0 is already merged — the table, types, store, hook and empty page
already exist for this entity).

Scope: ONLY <Customers|Products|Purchases|Sales> — build the real list
page, the create/edit modal form, and delete handling for this entity.

- Follow AccountsPage.tsx + AccountForm.tsx as the structural template:
  list/grid with search, modal form using existing ui/ primitives
  (Input/Select/Textarea/TagInput inside Modal), inline edit/delete actions.
- Wire it to the already-existing worker/routes/business.ts endpoints and
  useBusiness.ts hook from the foundation session — don't re-implement
  backend logic that already exists; extend it only if a field was missed.
- Deletes are cascading/higher-consequence (per business-module-plan.md
  §8) — use ConfirmDeleteModal, not undo-toast.
- No new npm dependencies.

Before marking done: tsc, add e2e/<N>-business-<entity>.spec.ts (see the
numbering table in business-module-plan.md §10), run it, update CLAUDE.md
§13, open the PR.
```

## 13. Copy-paste prompt — Session 1 (Invoices)

```
Read CLAUDE.md and docs/business-module-plan.md first, especially §7
(Invoices) and the attached docs/business-module-invoice-reference.pdf.
Foundation (session 0) is merged — tables, types, store, hook and the
worker route handlers for business_invoices/business_invoice_items already
exist.

Scope: ONLY the invoice system —
- InvoicesPage.tsx: list view with status filter.
- InvoiceEditorPage.tsx: split-screen layout — left pane is the editor
  (header fields, customer picker, dynamically add/remove line items with
  inline editing and keyboard navigation, notes), right pane is
  InvoicePreview.tsx, a live, real-time render of the invoice matching the
  hierarchy described in business-module-plan.md §7 — no "Preview" button,
  it updates on every keystroke.
- Amount = Qty × Unit Price per line, and the summary block
  (Subtotal/Shipping/Discount/Tax/Total) recalculates instantly.
- Invoice numbering: read/write business_invoice_prefix and
  business_invoice_next_seq from the settings table.
- Status field: Draft/Sent/Paid/Overdue/Cancelled.
- PDF: an @media print stylesheet on InvoicePreview (A4 page size, proper
  margins, print-safe colors independent of light/dark theme) plus a
  "Print / Save as PDF" button that calls window.print(). No PDF library —
  see business-module-plan.md §4b for why.
- Company info (name/logo/address) for the invoice header comes from
  settings, editable somewhere reachable from Settings or the invoice
  editor itself — ask if unclear where.

No new npm dependencies without asking first.

Before marking done: tsc, add e2e/62-business-invoices.spec.ts covering
create → add line items → totals recalc → change status → print stylesheet
present, run it, update CLAUDE.md §13, open the PR.
```

---

## 14. Session 6 — Dashboard (brief, it's the simplest slice)

Summary cards (total sales, total purchases, outstanding invoices, paid
invoices, monthly profit) computed via scoped D1 queries — keep any
multi-aggregate query under the compound-SELECT limit noted in §6 (scalar
subqueries over a wide `UNION ALL`). Three recent-activity lists (invoices,
purchases, sales). No charts. Same branch/e2e/PR/CLAUDE.md-update discipline
as every other slice.

---

## 15. Future integrations — kept from the original, grounded in what already exists

Design the extension points; don't build them yet.

- **Business → Tasks:** creating a follow-up task or payment reminder from
  an invoice should call the existing Tasks API the same way a user would
  manually — no new task-creation path.
- **Business → Wallet:** "convert this purchase to an expense" / "convert
  this sale to income" should post through the existing
  `POST /api/transactions` endpoint Wallet already exposes, not a new
  ledger-writing path. This is also the natural place a future "shared
  Business + Wallet" decision (§4a) would connect if it's ever revisited.
- **Business → AI:** reuse the existing per-user `anthropic_api_key`
  infrastructure and Settings UI from `CLAUDE.md` §9.3 (the one AI feature
  shipped so far, PR #112) — don't stand up a second key-storage mechanism.
  Any new AI feature here still needs owner sign-off per rule 10, same as
  every other §9.3 item.

---

## 16. Real reference data collected since this brief was written

After this brief was drafted, an actual invoice got built by hand from a
real purchase receipt and a real shipping invoice. That produced concrete
grounding worth pointing later Claude Code sessions at directly, rather
than re-deriving it from prose:

- **`INV-0020-16082026.pdf`** (and its editable `.html` source), in the
  `abovestyle` folder — a second real invoice, built from a real purchase
  receipt (AISYAH EXCLUSIVE, StoreHub POS, items priced per *kodi*) and a
  real shipping invoice (KM Cargo, whose "Payable Amount" became the
  invoice's "Shipping charge" line directly). Confirms the hierarchy in §7
  holds up with live numbers, not just the original INV-0019 sample.
- **`item-description-mapping.md`**, same folder — the actual
  purchase-name → invoice-description table for eleven real products. This
  is the seed data for the first real `business_products` rows once
  session 3 (§10/§12) builds that table — use it instead of placeholder
  product names in e2e fixtures.
- The **kodi → piece conversion** (1 kodi = 20 pieces — a standard textile
  wholesale unit, not specific to this one receipt) and the **flat
  per-piece markup** pricing rule (selling rate ≈ purchase cost per piece +
  a fixed RM amount) are real, recurring business logic, not one-off
  guesses — see the Products field additions in §8.
- The RM→BDT conversion note is genuinely free-text and genuinely manual —
  the rate used is whatever the sender's bank or money-changer quotes that
  day, not a market/interbank rate, and the two can differ by a meaningful
  margin. Nothing to build here beyond the plain-text field already
  specced in §7 — don't wire this to a live FX API.
