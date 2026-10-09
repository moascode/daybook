> **Status:** Archived · **Last verified:** 2026-10-10 · **Filed:** 2026-10-02 · **Shipped:** 2026-10-07 (PR #251) · **Epic:** [EP-06](../../backlog/EP-06-wallet-depth/README.md)

# FEAT-063 — Transactions: category-coloured row avatar

**What.** `TransactionList.tsx`'s `.tavatar` (the leading icon on every
transaction row) currently renders a generic glyph keyed only to
`transaction.type` — `+` for income, `-` for expense, an `ArrowRightLeft`
icon for transfer — on a flat red/green/blue tint. The mockup's `.tavatar`
renders the transaction's **category** icon (a real `lucide` icon — grocery
bag, coffee cup, shirt, car, etc.) on that category's own accent colour.
Both pieces of data already exist and are already loaded on this page:
`worker/seed.ts`'s default categories each carry a real icon name
(`utensils`, `car`, `shopping-bag`, `zap`, `heart-pulse`, `gamepad-2`,
`plane`, `graduation-cap`, `sparkles`, `tag`, `banknote`, `laptop`,
`trending-up`, `gift`, `plus-circle`) and a hex `color`, and a user's custom
categories carry the same two fields (`POST /categories` accepts
`icon`/`color`). `TransactionList.tsx` already receives `categories` as a
prop and looks up `category` per row for the category chip — it just never
reads `category.icon`/`category.color` for the avatar itself. No new data,
no schema change: wiring only.

**Confirmed against the real rendered mockup DOM**
(`document.querySelector('main').outerHTML` on both
`http://localhost:4873/transactions.html` and the real app's `/wallet` with
seeded data, 2026-10-02):

```html
<!-- mockup, transactions.html -->
<div class="tavatar" style="background:rgb(var(--calm-bg));color:rgb(var(--calm-fg))">
  <svg class="icon-sm" viewBox="0 0 24 24"><path d="M4 7h16l-1.5 12.5a2 2 0 0 1-2 1.5H7.5a2 2 0 0 1-2-1.5Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/></svg>
</div>

<!-- real app, TransactionList.tsx:191-208 -->
<div class="tavatar flex-shrink-0 bg-red-50 text-red-600">-</div>
```

**Also affects.** `Dashboard.tsx`'s "Recent activity" card renders the same
rows through the same `<TransactionList readOnly showDayTotals={false} />`
(`Dashboard.tsx:617`) — fixing the avatar here fixes both surfaces from one
change, with no separate Dashboard-side work. `SharedActivity.tsx` (the
Shared page's activity list) has its **own**, separate `.tavatar` that
always renders a generic `Receipt` icon regardless of category — that is a
different file and is tracked under the Shared page's own item instead
(FEAT-069), not here.

## Acceptance criteria

- [ ] `TransactionList.tsx`'s row avatar renders the transaction's category
      icon (looked up the same way the existing category chip already does,
      via `categories.find(c => c.id === transaction.categoryId)`) instead
      of the type-keyed `+`/`-`/`ArrowRightLeft` glyph.
- [ ] Avatar background/foreground follow the category's own `color` (same
      hex the category chip's dot already uses), not a fixed
      red/green/blue-by-type tint.
- [ ] **Transfers** (no category) and any transaction whose category lookup
      fails keep a sane fallback: the existing `ArrowRightLeft` icon for
      transfers, and a neutral icon (not a blank avatar, not a crash) for an
      uncategorised expense/income — never silently render nothing (CLAUDE.md
      §2 rule 10).
- [ ] The category chip elsewhere on the row is untouched — this only
      changes the avatar.
- [ ] Icon name → component resolved via a small lookup table (the category
      seed's icon names are a fixed, known set:
      `utensils`/`car`/`shopping-bag`/`zap`/`heart-pulse`/`gamepad-2`/`plane`/
      `graduation-cap`/`sparkles`/`tag`/`banknote`/`laptop`/`trending-up`/
      `gift`/`plus-circle`), falling back to the existing generic icon for
      any custom category whose `icon` isn't in that set (custom categories
      are free-text today — see `CategoryManager.tsx`).
- [ ] No computed money figure changes. No schema change.

## Out of scope

Redesigning the category icon picker in `CategoryManager.tsx`, or expanding
the set of selectable icons — this item only wires up icons that already
exist on every category today.

**Still needed?** No — shipped 2026-10-07 (PR #251).
