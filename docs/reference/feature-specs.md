> **Status:** Live · **Last verified:** 2026-09-16

# Feature specifications

What each module is meant to do. Sections marked as unbuilt are design intent, not behaviour.

> Extracted from `CLAUDE.md` on 2026-09-16. `CLAUDE.md` keeps the rules and the traps;
> this file holds the long-form reference they point at.

---

## 9. Feature Specifications

### 9.1 Tasks Module

#### BulletNode behaviour
- Each task renders as a line with: collapse toggle (▶/▼) | bullet dot | content | options menu
- Clicking the bullet dot zooms in: that task becomes root, breadcrumb shows path back
- Pressing Enter at end of line creates a sibling below
- Pressing Tab indents (makes child of bullet above); Shift+Tab outdents
- Pressing Backspace on empty line deletes it and moves cursor up
- Clicking the content makes it editable inline (contenteditable div, not an input)
- Completed tasks show strikethrough; "hide completed" toggle removes them from view
- Dragging a bullet onto another makes it a child (DnD kit)
- Notes: click the note icon to expand/collapse a textarea below the bullet

#### contenteditable implementation note
React does not manage `contenteditable` cursor position across re-renders. Use a `ref` with `useLayoutEffect` to save and restore the caret position after every state update. Failing to do this causes cursor jumps on every keystroke.

#### Keyboard shortcuts
| Key | Action |
|---|---|
| Enter | New sibling below |
| Tab | Indent (make child) |
| Shift+Tab | Outdent |
| Backspace (empty) | Delete + move up |
| Cmd/Ctrl+Enter | Complete/uncomplete |
| Cmd/Ctrl+. | Collapse/expand |
| Cmd/Ctrl+K | Open Claude panel |

#### Sort order
- Use floating point sort order (1.0, 2.0, 3.0…)
- When inserting between two items, use midpoint: `(a.sortOrder + b.sortOrder) / 2`
- Rebalance when any gap falls below 0.001 — batch-update all affected rows in a single transaction from `useTasks.ts`

#### DnD implementation note
Nested tree DnD (Task → child → grandchild + reorder within level) requires custom collision detection with `@dnd-kit`. Use `useSortable` with a `data` payload that includes `depth` and `parentId`. Plan extra development time for this; it is the most complex part of the tasks module.

---

### 9.2 Wallet Module

#### Accounts
- Create, edit, delete accounts
- Each account shows: name, type badge, currency, current balance (calculated from transactions)
- **Balance formula:**
  - `balance = SUM(income transactions) − SUM(expense transactions)`
  - Transfer transactions do NOT count toward income or expense; they only move money between accounts
- Deleting an account deletes all its transactions (CASCADE)

> **A TOTAL is yours alone. `GET /api/accounts` is not.** That route returns
> own **plus shared-in** accounts, so any figure that sums the whole array counts
> other people's money as the viewer's. This shipped: RM100 of own money
> displayed as RM10,099 across "2 accounts" (fixed in PR #101, two independent
> call sites). Sum `ownAccounts` for totals; shared cards still render their real
> individual balance, and an "across N accounts" caption must count the same set
> the figure was summed over.

> **Never read `t.amount` for anything a user compares.** A split transaction's
> effective figure is not its gross. Tiles once used `countableAmount` while the
> cash-flow chart, pie, account chart and merchant list used raw `t.amount`, so a
> split RM100 expense read RM50 in a tile and RM100 in the chart directly beneath
> it (fixed across the dashboard in PR #106, which routed everything through one
> pure module). `TransactionList.tsx` day headers were audited afterwards and now
> use `countableAmount` too, matching the summary row above the list; the
> per-row figure still shows the ledger amount deliberately.

#### Transactions
- Add transaction: date (default today), merchant, description, amount, type (income/expense/transfer), category, tags (multiple, free-text)
- For **transfer** type: show a second account selector for `destinationAccountId`; hide category and tags fields (transfers are not categorised)
- Edit transaction: same form, pre-filled
- Delete transaction: undo-toast (single deletes are reversible; no confirm dialog)
- List view: grouped by day, shows date header with day total
- Filter bar: date range | type (all/income/expense/transfer) | category | account | tag(s) | free-text search (active filters shown as removable chips)
- Summary row: total income, total expense, net for selected period (transfers excluded from totals)

#### CSV Import flow
1. User uploads CSV file → PapaParse reads it
2. Auto-detect columns (date, amount, description/merchant)
3. For each row, compute `import_hash = SHA-256(date + '|' + amount + '|' + merchant)`
4. **Duplicate check:** query DB for existing `import_hash` values; mark matching rows as "already imported" and skip them by default
5. **Merchant name resolution** (shipped, §6/[`feature-specs.md` §AI](feature-specs.md)): for rows whose merchant was
   split out of a single narrative column, `POST /merchants/resolve` runs the
   regex → corrections cache → history → AI ladder and rewrites `merchant` to
   the resolved name before category suggestion runs. A guess the ladder
   cannot improve keeps its regex value and is marked in the review table
   (never silently left looking resolved).
6. Category suggestion (PR #109/#112): a category is pre-filled per non-duplicate
   row from the user's own history / the builtin cold-start map, with an "Ask AI"
   fallback in the bulk-edit dialog for whatever the rule pass found nothing for.
7. Show review table: all rows, each row editable, checkbox to exclude (duplicates pre-unchecked)
8. User reviews + confirms → batch insert transactions with `import_hash` set
9. Show success summary: X imported, Y skipped (duplicates), Z excluded by user

#### Dashboard
- Date range selector (this month / last month / custom)
- Cash flow bar chart: income vs expense by week (Recharts)
- Spending by category: pie chart (Recharts)
- Spending by account: bar chart (Recharts)
- Top merchants list
- `DailyGroup` totals are computed from a DB `GROUP BY date` query, not in-memory — use this approach at scale

---

### 9.3 Claude AI Layer

> 🟢 **STATUS: FOUR FEATURES SHIP.** Do not read this subsection as "AI is
> deferred" — that was true until 2026-08-08 and has been wrong since. The
> authoritative list is the exported functions in `worker/lib/anthropic.ts`;
> check it before believing any prose here, including this block.
>
> **What exists**, each with its own per-user hourly rate-limit bucket so one
> feature exhausting its budget never starves another:
>
> | Feature | Function | Bucket |
> |---|---|---|
> | "Ask AI" fallback in the bulk edit dialog — only the merchants the rule pass missed (`docs/archive/ai-bulk-categorize-feature.md`) | `suggestCategoriesWithAI` | `ai_rate_limit_suggest_categories` |
> | Merchant-name resolution for CSV import + bulk cleanup (`docs/archive/flow-plan.md`, §6's `merchant_corrections`) | `resolveMerchantsWithAI` | `ai_rate_limit_merchant` |
> | **Composer free-text parse** — one natural-language entry → a transaction draft (R7) | `parseComposerWithAI` | `ai_rate_limit_composer` |
> | **Photo-statement import** (v3.3.0–v3.5.0) | `parsePhotoImportWithAI` | `ai_rate_limit_photo_import` |
>
> Plus the API-key infrastructure below. **Any new AI work reuses all of this —
> do not rebuild it.**
>
> **What does not exist:** the Claude panel, the daily briefing, natural-language
> *task* creation, "ask about tasks/finances", financial insights, prompt
> caching, and Sonnet-tier model routing (every shipped call is Haiku).
> `src/components/claude/*`, `src/hooks/useClaude.ts`, `src/lib/claude.ts` and
> `src/lib/claude-prompts.ts` still do **not exist** — no shipped feature needed
> them; each Worker route owns its own prompt. Treat the rest of this subsection
> as design intent, not current behaviour, and get owner sign-off per rule 10
> before building any more of it.
>
> **Natural-language *transaction* entry is NOT on the missing list** — it
> shipped as the composer parse above. This block claimed otherwise until
> 2026-09-16 while the code was live, which is exactly the trap this header now
> warns about.

#### API setup
> **Shipped in PR #112, with one deviation.** There is no `ApiKeySetup`
> first-run screen: the key lives in an "AI categorisation" section on the
> Settings page (enter / replace / clear), which states plainly that it is
> stored as plain text. A first-run gate would have been wrong for a feature
> that is optional — the app must stay fully usable with no key, and every AI
> entry point is hidden or linked to Settings when none is set.
> `GET /api/settings` masks the value to `'set'`/`''` so the key never
> round-trips to the browser; `app.store`'s `hasAnthropicKey` is that presence
> flag, never the key itself.

- ~~On first launch (or if no key set): show ApiKeySetup component~~ → Settings page section
- User enters their Anthropic API key → stored in `settings` table under key `anthropic_api_key`
- Key is read at runtime from the DB, not from env vars (env var is a fallback for dev convenience only)
- Per-user, per-hour rate limit on any route that spends the key
  (`ai_rate_limit_*` in `settings`; one unit per request, not per Claude call)

#### Model routing (cost optimisation)
```typescript
// Simple tasks → Haiku (cheap, fast)
// Complex reasoning → Sonnet (quality)
type TaskComplexity = 'simple' | 'complex'

const MODEL = {
  simple: 'claude-haiku-4-5-20251001',  // categorisation, parsing, short queries
  complex: 'claude-sonnet-4-6',          // daily briefing, financial insights, chat
}
```

#### Prompt caching
- System prompt + task/wallet context must use `cache_control: { type: "ephemeral" }`
- Cache TTL: 5 minutes (resets on each hit)
- Always put the static system prompt first (gets cached), dynamic context second
- **Do not include timestamps or any volatile data in the cached context block.** Cache hits only occur when the block is byte-for-byte identical between calls.
- Await all PGlite queries before building the prompt — context must be ready before the API call is made

#### System prompt structure (in `claude-prompts.ts`)
```
SYSTEM (cached):
  You are the AI assistant for Daybook, a personal productivity and finance app.
  You have access to the user's tasks and wallet data below.
  Rules: respond concisely, use MYR currency, dates in DD/MM/YYYY format.

USER CONTEXT (cached if unchanged):
  TASKS: [serialised task tree — top 3 levels only]
  WALLET: [last 30 days of transactions + account balances]

USER MESSAGE:
  [the actual user input]
```

#### Claude features
| Feature | Model | Max output tokens |
|---|---|---|
| Natural language task creation | Haiku | 300 |
| Natural language transaction entry | Haiku | 200 |
| CSV batch categorisation | Haiku | 500 |
| Ask about tasks | Sonnet | 600 |
| Ask about finances | Sonnet | 600 |
| Daily briefing | Sonnet | 800 |
| Financial insights | Sonnet | 800 |

#### Natural language → task (expected JSON output)
```json
{
  "tasks": [
    { "content": "Book flight", "parentContent": "Penang Trip", "note": "" },
    { "content": "Book hotel", "parentContent": "Penang Trip", "note": "" }
  ]
}
```

#### Natural language → transaction (expected JSON output)
```json
{
  "date": "2024-01-15",
  "merchant": "Uncle Din's",
  "description": "Nasi lemak breakfast",
  "amount": 9.50,
  "type": "expense",
  "category": "Food & Drink",
  "tag": ""
}
```

---
