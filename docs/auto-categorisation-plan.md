# Feature Spec: Merchant Canonicalisation + Category Suggestions

> Status: **Approved, ready to build.** Written 2026-08-07 from a Haiku
> pre-analysis (`auto-categorization-feature-spec.md`, v3). This document
> supersedes it: the intent survives, most of the mechanism does not. §2 lists
> every gap found against the real codebase, with evidence. Owner decisions
> recorded 2026-08-07 in §8.

## 1. Goal

When a statement is imported, most rows are for merchants the user has already
categorised. Daybook cannot see that, because a bank writes the same merchant
differently on every line:

```
MCDONALDS-MY TOWN00368 KUALA LUMPUR  MY 28/07/2026 •••• •••• •••• 3523
MCDONALDS-PAVILION KL  MY 03/08/2026 •••• •••• •••• 3523
```

Two rows, one merchant, zero recognition. Every import is categorised from
scratch by hand.

**The feature:** collapse noisy merchant strings to a canonical name, then
suggest the category the user themselves has picked for that merchant before.
Two entry points — CSV import review, and the existing multi-select toolbar on
Transactions.

**Non-goals (v1):** no AI, no API calls, no rewriting of stored merchant text,
no automatic application of anything the user has not seen.

---

## 2. Gap analysis: pre-analysis vs. this codebase

The pre-analysis is directionally right — extract, normalise, suggest from
frequency, keep the user in control. Nine of its specifics do not survive
contact with Daybook.

| # | Pre-analysis says | Reality | Severity |
|---|---|---|---|
| G1 | `RENAME COLUMN merchant TO merchant_raw` | CLAUDE.md §6: *"Never drop a table or column"*, migrations are additive-only. A rename also breaks the search filter (`worker/routes/wallet.ts:664`), the export projection (`:738`), the insert column list (`:468`), and `merchantSpendCore` on the dashboard (`src/modules/wallet/dashboard/insights.ts:485`). | **Blocker** |
| G2 | Frequency query filters `WHERE ... is_deleted = 0` | There is no `is_deleted` column anywhere in the repo. Daybook hard-deletes and restores from an undo-toast snapshot. The query would fail outright. | **Blocker** |
| G3 | Pattern E (bank transfers) extracted by asking Claude Haiku, ~$0.0005/row | Phase 5a is **deferred** (CLAUDE.md §9.3): no Anthropic wiring exists, no key storage on Workers, no server-side proxy, and `@anthropic-ai/sdk` is not installed. Adding it violates rule 2 (no unlisted packages) and rule 10 (phase discipline). It also contradicts the pre-analysis' own subtitle, *"no AI"*. | **Blocker** |
| G4 | One migration, added once | Every migration must be mirrored in **both** `worker/migrations/` and `server/migrations/`, under **different numbers** (the two trees diverged at 0003). `scripts/schema-diff.mjs` gates CI on parity and fails the build otherwise. | High |
| G5 | Builtin merchant DB maps to `Groceries`, `Transportation`, `Subscriptions` | None of those categories exist. The per-user seed (`worker/seed.ts:19-38`) is Food & Drink, Transport, Shopping, Bills & Utilities, Health, Entertainment, Travel, Education, Personal Care, Other + 5 income. Categories are **per user** and referenced by id, so a builtin table keyed on category *name* must resolve against that user's own rows and tolerate renames and deletions. | High |
| G6 | `POST /suggest-rules` takes a list of merchants; the SQL runs per merchant | That is one query per merchant — the S2 N+1 pattern the Workers migration exists to eliminate, on a platform where each query is a network round trip. It also blows D1's **100-bound-parameter cap** on a 50-row statement, the exact failure that produced v2.3.1 (PR #103). | High |
| G7 | Persist a `categorization_rules` row per learned pairing, with `match_count` and `confidence` | The counts are already in `transactions`. A materialised copy is a second source of truth that drifts on every edit, delete, undo, and re-categorisation — which is why the pre-analysis then needs *two* of its own risk rows ("rules become stale", "rule explosion") plus an "archive old rules" chore to manage a problem it created. | High |
| G8 | Add "Apply rules" as a new button on the multi-select toolbar | The toolbar already has **Categorise** (`BulkEditDialog`, PR #102). A second, adjacent, near-synonymous button is the worse half of the feature-consistency problem the repo has already been through once. Suggestions belong *inside* that dialog. | Medium |
| G9 | Success metric: *"API cost < $1/month"*; placement "Phase 5c Increment 6", delivery "Phase 5d" | There is no API. Phase 5c is complete (PRs #29–#33, all 5 waves merged); "Increment" numbering belongs to the Phase 4 route port. Phase 5d does not exist. | Medium |
| G10 | No mention of tests, theming, or transfers | Rule 11 requires a Playwright spec per feature. Rule from §18: **no `dark:` variants** — new UI uses semantic tokens. And transfers carry no category (§9.2); `bulk-update` *skips* rather than rejects them (`worker/routes/wallet.ts`), a convention this feature must match. | Medium |

Two further findings that the pre-analysis does not raise at all:

- **G11 — the import hash is computed over the raw merchant, client-side, before
  the review table.** `computeImportHash(date, amount, merchant)`
  (`src/lib/csv.ts:154`) runs in `buildImportRows` (`:382`), and the review table
  lets the user *edit* `merchant` afterwards (`CsvReviewTable.tsx:103`) without
  recomputing. Duplicate detection therefore keys on the **original CSV string**,
  which is the only stable thing about it. Any canonicalisation must leave that
  invariant alone — canonicalise for *display and matching*, never for hashing.
  Get this wrong and every re-imported statement duplicates itself.
- **G12 — there is no code shared between `src/` and `worker/`.**
  `worker/tsconfig.json` includes `["**/*.ts"]` relative to `worker/` only. A
  canonicaliser needed by both the import UI and the bulk path must therefore
  either be duplicated (and drift) or live on one side and be reached over the
  API. This spec puts it in the Worker.

---

## 3. Design

### 3.1 Principles

1. **Derive, don't store.** The user's own transaction history *is* the rule
   table. Nothing is materialised that can be recomputed, so there is nothing to
   go stale, nothing to archive, and no reconciliation on edit or delete.
2. **Canonicalise at read time, never at write time.** `transactions.merchant`
   keeps exactly what the bank wrote (or what the user typed). This preserves
   G11, keeps the audit trail, and means an improved canonicaliser instantly
   improves every historical row with no backfill and no migration.
3. **One query per request, not one per merchant.** The whole suggestion set is
   built from a single grouped read (G6).
4. **Suggestions are shown, never silently applied.**

Principle 2 is the load-bearing one. It removes the migration, the backfill
question, the `merchant_name` column, the `merchant_extraction_confidence`
column, and the entire `categorization_rules` table from v1.

### 3.2 Stage 1 — canonicalisation (pure function, Worker-owned)

`worker/lib/merchant.ts`, one exported pure function:

```ts
/** Collapse a bank-written merchant string to a stable matching key. */
export function canonicalMerchant(raw: string): string | null
```

`null` means "no usable name" — the caller then offers no suggestion rather than
guessing. Deterministic, no I/O, unit-testable in isolation.

Applied in order:

| Step | Rule | Example |
|---|---|---|
| 1 | Uppercase, collapse whitespace | |
| 2 | Strip a card mask and everything after it (`••••`, `****`, `xxxx`) | `… MY 28/07/2026 •••• 3523` → `… MY 28/07/2026` |
| 3 | Strip an embedded `DD/MM/YYYY` (or `-`, 2- or 4-digit year) and everything after it | → `MCDONALDS-MY TOWN00368 KUALA LUMPUR` |
| 4 | Strip a trailing 2-letter country code | `… ANTHROPIC.COM CA` → `… ANTHROPIC.COM` |
| 5 | Strip a leading rail prefix: `DUITNOW QR`, `DUITNOW`, `TRANSFER DEBIT/CREDIT`, `MEPS PAYMENT FROM`, `MEPS`, `IBG`, `FPX`, `POS DEBIT` | `DUITNOW QR DODO KOREA SDN BHD` → `DODO KOREA SDN BHD` |
| 6 | Strip a trailing domain suffix (`.COM`, `.COM.MY`, `.MY`, `.NET`, `.CO`), then remove remaining `.` and `'` | `BOOKING.COM` → `BOOKING`; `WATSON'S` → `WATSONS` |
| 7 | Split on the first `-`, `*`, `/`, `|`, or run of 2+ spaces; keep the head | `MCDONALDS-MY TOWN00368 …` → `MCDONALDS` |
| 8 | Strip trailing entity suffixes: `SDN BHD`, `SDN`, `BHD`, `PLT`, `ENTERPRISE`, `TRADING`, `HOLDINGS`, `GROUP` | `DODO KOREA SDN BHD` → `DODO KOREA` |
| 9 | Strip a trailing digit run of 3+ | `MCDONALDS 1010501` → `MCDONALDS` |
| 10 | Trim edge punctuation | → `MCDONALDS` |
| 11 | Reject: fewer than 3 characters, or all digits | → `null` |

Order matters — step 7 must follow 2–6, or the separator split keeps a head that
still carries a date or a domain. Reference implementation:

```ts
// worker/lib/merchant.ts
const CARD_MASK   = /[•*·]{3,}.*$|\bx{4,}\b.*$/i
const DATE_TAIL   = /\s\d{1,2}[/-]\d{1,2}[/-]\d{2,4}.*$/
const COUNTRY     = /\s+(?:MY|SG|US|CA|GB|AU|TH|ID|JP|HK|CN|IN|NL|DE|IE)\s*$/
const RAIL_PREFIX = /^(?:DUITNOW\s+QR|DUITNOW|TRANSFER\s+(?:DEBIT|CREDIT)|MEPS\s+PAYMENT\s+FROM|MEPS|IBG|FPX|POS\s+DEBIT)\s+/
const DOMAIN_TAIL = /\.(?:COM\.MY|COM|NET|CO|MY)\b.*$/
const SEPARATOR   = /\s{2,}|[-*/|]/
const ENTITY_TAIL = /\s+(?:SDN\s+BHD|SDN|BHD|PLT|ENTERPRISE|TRADING|HOLDINGS|GROUP)\s*$/
const DIGIT_TAIL  = /\s*\d{3,}\s*$/

export function canonicalMerchant(raw: string): string | null {
  let s = raw.toUpperCase().replace(/\s+/g, ' ').trim()
  if (!s) return null
  s = s.replace(CARD_MASK, '').replace(DATE_TAIL, '').replace(COUNTRY, '')
  s = s.replace(RAIL_PREFIX, '')
  s = s.replace(DOMAIN_TAIL, '').replace(/[.']/g, '')
  s = s.split(SEPARATOR)[0]
  s = s.replace(ENTITY_TAIL, '').replace(DIGIT_TAIL, '')
  s = s.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '').trim()
  if (s.length < 3 || /^\d+$/.test(s)) return null
  return s
}
```

**No location-suffix list.** The pre-analysis proposes stripping `PAVILION`,
`MALL`, `SUNWAY`, `BDR` and flags its own risk that `SUNWAY VELOCITY MALL` is a
merchant. Step 5 already removes location tails that follow a separator, which
is how banks actually write them, and it does so without a hand-maintained list
of Malaysian place names that will be wrong for the first merchant named after
a place. Dropped deliberately — see §8.

**No confidence score.** The pre-analysis attaches 95%/88%/75%/80% to its
patterns, but those numbers are unmeasured, and nothing downstream can act on
them differently: a row either gets a suggestion the user accepts or it does
not. The honest signal — *how many times you have categorised this merchant
before* — comes from Stage 2 and is a real count, not an estimate.

**The DuitNow person-vs-merchant problem is not solved, and does not need to
be.** `DUITNOW QR SAMUEL LIM` canonicalises to `SAMUEL LIM`. That is fine: a
one-off person generates no history, so Stage 2 offers nothing and the row is
untouched. If the user pays the same person repeatedly and categorises it, the
"merchant" is a legitimate recurring payee and suggesting its usual category is
correct. The problem the pre-analysis spends a risk row and an open question on
only exists because it tries to write the extracted name into the database.

### 3.3 Stage 2 — suggestions (derived, one query)

`worker/routes/wallet.ts`, new route:

```
POST /api/transactions/suggest-categories
  body: { merchants: string[] }          // raw strings, ≤ 500, deduped by caller
  200:  { suggestions: Array<{
            raw: string                  // echoed, so the client can map back
            canonical: string
            categoryId: string
            categoryName: string
            matchCount: number           // how many of your own past rows
            totalCount: number           // …out of how many categorised rows
          }> }                           // absent entry = no suggestion
```

Implementation:

1. Canonicalise every input in memory. Discard `null`s and duplicates.
2. **One** grouped read of the caller's own categorised history:

   ```sql
   SELECT merchant, category_id, COUNT(*) AS n
     FROM transactions
    WHERE user_id = ?
      AND type != 'transfer'
      AND category_id IS NOT NULL
      AND merchant != ''
      AND date >= ?                      -- lookback bound, §3.5
    GROUP BY merchant, category_id
   ```

   Two bound parameters regardless of how many merchants were asked about — the
   100-parameter cap (G6) cannot be reached. The result is bounded by *distinct
   merchant strings the user has categorised*, not by the import size.
3. Canonicalise each returned `merchant` in the Worker, folding the raw variants
   into canonical buckets and summing `n` per `(canonical, category_id)`.
4. For each requested canonical name, take the highest-count category. Emit it
   only if `matchCount >= MIN_MATCHES` (2) **and** it holds a majority
   (`matchCount * 2 > totalCount`). One prior sighting is not a pattern; a 4–3
   split is not a suggestion.
5. Resolve `categoryName` from the caller's `categories`, and drop any row whose
   category has since been deleted.

Reference implementation of the handler body:

```ts
wallet.post('/transactions/suggest-categories', async (c) => {
  const userId = c.get('userId')
  const b = await body(c)
  const input: string[] = Array.isArray(b.merchants) ? b.merchants : []
  if (input.length === 0) return c.json({ suggestions: [] })
  if (input.length > MAX_MERCHANTS) {
    return c.json({ error: `cannot request more than ${MAX_MERCHANTS} merchants at once` }, 400)
  }

  // raw -> canonical, keeping the echo map for the response.
  const wanted = new Map<string, string>()          // canonical -> first raw seen
  const rawToCanonical = new Map<string, string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const key = canonicalMerchant(raw)
    if (!key) continue
    rawToCanonical.set(raw, key)
    if (!wanted.has(key)) wanted.set(key, raw)
  }
  if (wanted.size === 0) return c.json({ suggestions: [] })

  const since = businessDatePlus(-LOOKBACK_DAYS)     // worker/lib.ts, MYT-pinned
  const [{ results: history }, { results: cats }] = await c.env.DB.batch<...>([
    c.env.DB.prepare(
      `SELECT merchant, category_id, COUNT(*) AS n FROM transactions
        WHERE user_id = ? AND type != 'transfer' AND category_id IS NOT NULL
          AND merchant != '' AND date >= ?
        GROUP BY merchant, category_id`,
    ).bind(userId, since),
    c.env.DB.prepare('SELECT id, name, type FROM categories WHERE user_id = ?').bind(userId),
  ])

  // Fold raw history variants into canonical buckets.
  const buckets = new Map<string, { total: number; byCategory: Map<string, number> }>()
  for (const row of history) {
    const key = canonicalMerchant(row.merchant)
    if (!key || !wanted.has(key)) continue
    const bucket = buckets.get(key) ?? { total: 0, byCategory: new Map() }
    bucket.total += row.n
    bucket.byCategory.set(row.category_id, (bucket.byCategory.get(row.category_id) ?? 0) + row.n)
    buckets.set(key, bucket)
  }
  // …pick the max per bucket, apply MIN_MATCHES + the majority rule,
  // then fall back to builtinCategory(key) for canonical names with no bucket.
})
```

Two bound parameters on the only unbounded query — the 100-parameter cap (G6)
cannot be reached no matter how large the import. The two statements go out as
one `batch()`, so the whole endpoint is a single round trip.

`businessDatePlus` is the existing MYT-pinned helper (`worker/lib.ts`); using
`Date.now()` directly would shift the lookback window by a day for eight hours
out of every twenty-four, the same class of bug the e2e timezone fix addressed.

Note step 3 canonicalises *history* too. This is what makes principle 2 work:
`MCDONALDS-PAVILION` and `MCDONALDS-MY TOWN00368` in the existing table are
already contributing to the `MCDONALDS` bucket on day one, with no backfill
(cf. the pre-analysis' open question 4, which is thereby moot).

**Cost.** Two live users; the grouped read returns one row per
(merchant, category) pair. At ~2,000 categorised transactions with heavy repeats
that is a few hundred rows — one round trip, well inside a Worker's budget. The
bound is stated in §6 as a thing to watch, not a thing to pre-optimise.

### 3.4 Stage 3 — the builtin merchant map

Consulted **only** when Stage 2 produces nothing for a canonical name. A
hardcoded map from canonical merchant → **seed category name**, resolved against
the caller's own categories by name and silently skipped if that category was
renamed or deleted (G5). Scoped to the ten seed expense categories — nothing
else is guaranteed to exist for a given user.

**What this actually buys.** Going to the same shop every month is covered by
Stage 2, which is strictly better than any list — it learns *your* answer, not a
guessed one. The map earns its place on the two cases Stage 2 cannot reach:

1. **The first two visits** to any merchant, before history exists. On a ~78
   transactions/month statement with a long tail of one-offs, that is a real
   slice of every import.
2. **Merchants whose statement string keeps mutating** in a way step 7 does not
   fully collapse, so each visit lands in a slightly different bucket and never
   accumulates two matches.

That framing sets the size: broad enough to cover the Klang Valley chains a
household actually touches, and no broader. ~115 entries.

#### Lookup: longest word-boundary prefix

Exact match alone is not enough. Canonicalising `INDAH WATER 26 GRACE WONG LING
SAN` yields the whole string — there is no separator and the payer name is not a
trailing digit run — so an exact lookup misses. The map is therefore consulted
by **progressively shorter word prefixes**, longest first:

```ts
// worker/lib/merchant-map.ts
export function builtinCategory(canonical: string): SeedCategoryName | null {
  const words = canonical.split(' ')
  for (let n = Math.min(words.length, 4); n > 0; n--) {
    const hit = MERCHANT_MAP[words.slice(0, n).join(' ')]
    if (hit) return hit
  }
  return null
}
```

At most four `Record` lookups, O(1) each. Word-boundary matching is what keeps it
safe: `GRAB` (Transport) does **not** capture `GRABFOOD` (Food & Drink) or
`GRABPAY`, because those are single tokens, not `GRAB` + a space.

#### The map (v1, ~115 entries)

Keys are already-canonical (uppercase, no punctuation, no entity suffix).

| Seed category | Keys |
|---|---|
| **Food & Drink** (28) | MCDONALDS, KFC, PIZZA HUT, DOMINOS, BURGER KING, SUBWAY, TEXAS CHICKEN, MARRYBROWN, NANDOS, KENNY ROGERS, SUSHI KING, SUKISHI, SECRET RECIPE, PAPPARICH, OLDTOWN, STARBUCKS, CBTL, COFFEE BEAN, ZUS COFFEE, GIGI COFFEE, TEALIVE, CHATIME, DUNKIN, KRISPY KREME, BASKIN ROBBINS, LLAOLLAO, GRABFOOD, FOODPANDA |
| **Transport** (14) | PETRONAS, SHELL, PETRON, CALTEX, BHPETROL, BHP, TOUCH N GO, TNG, GRAB, MYTEKSI, RAPID KL, KTMB, PLUS, SMART TAG |
| **Shopping** (24) | SHOPEE, LAZADA, ZALORA, AMAZON, TEMU, AEON, AEON BIG, LOTUSS, TESCO, GIANT, MYDIN, NSK, 99 SPEEDMART, ECONSAVE, JAYA GROCER, VILLAGE GROCER, COLD STORAGE, KK SUPERMART, FAMILYMART, MYNEWS, IKEA, MR DIY, DAISO, UNIQLO |
| **Bills & Utilities** (17) | TENAGA NASIONAL, TNB, INDAH WATER, IWK, SYABAS, AIR SELANGOR, PENGURUSAN AIR, UNIFI, TM, TELEKOM, MAXIS, CELCOM, CELCOMDIGI, DIGI, UMOBILE, ASTRO, TIME DOTCOM |
| **Personal Care** (7) | WATSONS, GUARDIAN, CARING PHARMACY, ALPRO, BIG PHARMACY, SASA, BODY SHOP |
| **Health** (7) | SUNWAY MEDICAL, PANTAI, GLENEAGLES, KPJ, PRINCE COURT, BP HEALTHCARE, QUALITAS |
| **Entertainment** (10) | NETFLIX, SPOTIFY, DISNEY, VIU, TGV, GSC, MBO, STEAM, PLAYSTATION, NINTENDO |
| **Travel** (10) | AIRASIA, MALAYSIA AIRLINES, BATIK AIR, FIREFLY, AGODA, BOOKING, AIRBNB, TRIP, KLOOK, TRAVELOKA |

Four deliberate calls in that table, each of which would otherwise look like an
oversight:

- **Groceries live under Shopping.** Daybook's seed has no Groceries category
  (G5), and inventing one is a schema decision this feature has no business
  making. A user who wants the split creates the category and categorises twice;
  Stage 2 then overrides the builtin permanently.
- **WATSONS and GUARDIAN are Personal Care, not Health.** Household spend at
  both is overwhelmingly toiletries. This is the mixed-use case the majority
  rule handles once history exists — the builtin just has to pick the likelier
  side.
- **Productivity and AI subscriptions are excluded** — ANTHROPIC, MICROSOFT,
  ADOBE, NOTION, GOOGLE and friends appear in real July data, but no seed
  category fits them. Mapping them to *Other* carries zero information and
  mapping them to *Entertainment* is wrong. Two sightings and Stage 2 answers it
  correctly; a wrong builtin would have to be corrected forever.
- **`GOOGLE` is absent on purpose.** It fronts Play, Cloud, Workspace, YouTube
  and Ads — one key cannot be right for those, and a prefix match on `GOOGLE`
  would swallow all of them.

#### Growing the map

The list is a starting point, not a fixed asset — the intent is that it grows as
new regulars appear. The growth loop needs no infrastructure and no D1 access
(which the owner's machine does not have — only CI holds a Cloudflare token):

1. Export transactions from the app (Wallet → Export, the existing
   `GET /transactions/export` route).
2. `node scripts/merchant-map-gaps.mjs export.csv` — canonicalises every row with
   the **same** `canonicalMerchant()` the Worker uses, then prints canonical
   names that (a) appear ≥ 3 times, (b) are consistently categorised, and (c) are
   **not** covered by `builtinCategory()`, alongside the category the user picked.
3. Append the worthwhile ones to `MERCHANT_MAP`. One-line diff, no migration.

Step 2's output is the same evidence the map should have been built from in the
first place, and it is the only defensible way to decide whether entry #116 is
worth adding.

#### Labelling

Builtin hits carry `matchCount: 0` and the UI labels them **"common merchant"**,
distinct from history's **"you categorised this 12×"**. A guessed suggestion
dressed up as personal history is the one way this feature loses trust.

### 3.5 Constants

| Name | Value | Why |
|---|---|---|
| `MIN_MATCHES` | 2 | One sighting is a coincidence. |
| `LOOKBACK_DAYS` | 730 | Long enough that annual bills contribute; bounds the scan. |
| `MAX_MERCHANTS` | 500 | Matches the existing bulk-update ceiling. |

### 3.6 Schema

**No migration in v1.** Nothing is persisted. This is the single largest
simplification against the pre-analysis (G1, G4, G7) and it is what makes the
feature a ~2-day change instead of a ~10-day one.

The one thing worth persisting later — a user override that says "SHELL is
always Transport regardless of history", or "never suggest for SAMUEL LIM" —
is deferred to v2 (§7), because it is only worth building once we know whether
derived suggestions are ever wrong in practice.

---

## 4. UX

### 4.1 CSV import review (`CsvImport.tsx` / `CsvReviewTable.tsx`)

After `buildImportRows` resolves and before `step` flips to `'review'`, call
`/transactions/suggest-categories` with the distinct merchant strings. Rows that
get a suggestion have `categoryId` **pre-filled** in the existing Category
select — no new column, no new control, no new confirm step.

The header gains one line above the table:

```
Suggested a category for 34 of 50 rows — check the Category column before importing.
```

and each pre-filled select gets a small caption beneath it:

```
MCDONALDS · you categorised this 12×
SHELL · common merchant
```

Rationale for pre-filling rather than adding an accept/reject gate: the review
table is *already* the accept/reject gate — every category is a live select the
user can change, and nothing is written until they press Import. The
pre-analysis' `[Auto-apply all] [Auto-apply & review] [Skip rules]` three-way is
a decision the user cannot yet make, offered before they have seen the rows it
applies to. Pre-filling degrades to exactly today's behaviour when there is no
history.

One new control, for the case where the suggestions are wrong in bulk: a
**Clear suggestions** link in the header that nulls every pre-filled category
(and only those — a category the user chose by hand is untouched).

Rows the user edits the merchant on are **not** re-suggested. The hash is
already fixed (G11) and re-running suggestions under the cursor is hostile.

**Implementation.** `ImportRow` (`src/lib/csv.ts:19`) gains two optional fields,
set only by the suggestion pass and never sent to the server:

```ts
suggestedFrom?: { canonical: string; matchCount: number }   // 0 = builtin
suggestionApplied?: boolean                                  // for Clear suggestions
```

In `CsvImport.tsx:113`, between `buildImportRows` and `setStep('review')`:

```ts
const rows = await buildImportRows(rawRows, mapping)
const merchants = [...new Set(rows.filter(r => r.merchant).map(r => r.merchant))]
const { suggestions } = await api.post<SuggestResponse>(
  '/transactions/suggest-categories', { merchants },
).catch(() => ({ suggestions: [] }))        // never block the import on this
```

The `.catch` is deliberate: a failed suggestion call must degrade to today's
manual import, not to an error screen. Suggestions are applied only to rows
where `categoryId === null` and `type !== 'transfer'`, matching the
transfer convention (G10) that `bulk-update` and `BulkEditDialog` already use.

New UI is styled with semantic tokens only — `text-fg-subtle` for the caption,
`bg-surface-sunken` for the suggested-row tint. **No `dark:` variants** (§18);
the token layer already inverts.

### 4.2 Transactions page (`WalletPage.tsx` / `BulkEditDialog.tsx`)

**No new toolbar button** (G8). The existing **Categorise** action opens
`BulkEditDialog`; that dialog gains a suggestions block above the Category
select, shown only when the selection has at least one suggestible row:

```
Suggested from your history                          [Apply suggestions]

  MCDONALDS   → Food & Drink    3 transactions · you categorised this 12×
  SHELL       → Transport       1 transaction  · you categorised this 47×
  2 transactions have no suggestion
```

`Apply suggestions` sends **one** `POST /transactions/bulk-update` per distinct
suggested category (typically 2–5 requests, not one per row), reusing the route,
its permission model, and its transfer-skipping behaviour unchanged. The
existing manual Category select still overrides everything below it.

Transfers in the selection are excluded from the suggestion list up front, with
the same wording the dialog already uses for them (`bulk-edit-transfer-note`).

### 4.3 What is not built

- **No Wallet Settings → Categorization Rules page.** With no rule table there
  are no rules to manage, disable, delete, or archive. The transparency the page
  was for is delivered inline, at the point of decision, by the "you categorised
  this 12×" caption — which is strictly better than a settings page the user
  must go and read. This deletes PR 3 of the pre-analysis' roadmap entirely.
- **No extraction on manual entry.** The suggestion path reads history and
  writes nothing; a user typing `MCDONALDS` into `TransactionForm` already
  matches. (A merchant autocomplete on that form is an obvious follow-on and is
  listed in §7.)

---

## 5. Delivery

Two PRs. Both client + Worker; neither has a migration, so neither blocks on a
D1 apply.

**PR 1 — `feat/merchant-suggestions` (~1.5 days)**
- `worker/lib/merchant.ts`: `canonicalMerchant()`.
- `worker/lib/merchant-map.ts`: `MERCHANT_MAP` (~115) + `builtinCategory()`
  prefix lookup.
- `worker/routes/wallet.ts`: `POST /transactions/suggest-categories`, registered
  on `protectedApi` alongside the other transaction routes.
- `scripts/merchant-map-gaps.mjs`: the map-growth loop of §3.4.
- `src/lib/csv.ts` `ImportRow` fields; wire into `CsvImport.tsx` (pre-fill,
  header count, per-row caption, Clear suggestions).
- e2e `59-merchant-suggestions.spec.ts`: canonical folding across three
  spellings of one merchant; suggestion appears only at ≥2 matches; majority
  rule withholds on a 4–3 split; builtin fallback labelled "common merchant";
  `INDAH WATER 26 GRACE WONG` hits the map by prefix; `GRAB` does not capture
  `GRABFOOD`; transfers never suggested; Clear suggestions leaves hand-picked
  categories alone; a failed suggestion call still imports; and **re-import of
  the same file is still detected as duplicate** (the G11 regression test).

**PR 2 — `feat/bulk-suggestions` (~0.5 day)**
- Suggestions block in `BulkEditDialog`, `Apply suggestions` grouping into
  per-category `bulk-update` calls.
- e2e additions to `57-bulk-category-tags.spec.ts`: suggestions appear for a
  mixed selection, transfers excluded and reported, manual override wins.

Verification per PR: `tsc`, `typecheck:worker`, lint, plus specs 03, 04, 45, 49,
51, 57, 59.

**Placement:** Phase 7 (Advanced Features) — Phase 5c is closed and this is not
a cloud-migration item (G9). **Release:** its own minor tag after v2.4.0 ships.
It does not compete with rate limiting (blocker 4.3), which stays the higher
priority: this is convenience on a live money app, that is the open security
risk.

---

## 6. Risks

| Risk | Assessment | Mitigation |
|---|---|---|
| Canonicaliser over-collapses — two real merchants fold into one key | The realistic case is `PETRONAS DAGANGAN` vs `PETRONAS` style sub-brands landing in the same bucket, where the category is the same anyway. | Step 5 splits on separators, not on word count, so it cannot truncate a genuine multi-word name that has no separator. Run it over both users' real history before merging PR 1 and eyeball the buckets — that is a 10-minute check, not a test. |
| Suggestions confidently wrong on a mixed-use merchant (`WATSONS` = Health or Personal Care) | Real; the pre-analysis flags it too. | The majority rule (§3.3 step 4) withholds a suggestion on a genuine split rather than picking a side, and the caption shows the count so the user can judge. |
| The grouped read grows | Bounded by *distinct categorised merchant strings*, which grows sub-linearly. At 10k transactions it is still a few thousand rows. | Stated bound; revisit only if a real import feels slow. If it ever matters, the fix is the deferred `merchant_key` column, not a rule table. |
| Users stop checking the Category column because it is usually right | The genuine long-term risk of pre-filling. | The per-row caption keeps the provenance visible on every suggested row, and the import summary states how many were suggested. |
| Canonicaliser changes silently reclassify history | Improving a rule re-folds old buckets and can move a suggestion. | Acceptable and intended (principle 2) — nothing stored changes, only what is *offered*. Note it in the PR body so it is not mistaken for a bug. |

---

## 7. Deferred to v2

- **Merchant overrides** (`merchant_overrides`: pin a canonical name to a
  category, or suppress it). Needs a migration in *both* trees (G4); build only
  if derived suggestions prove wrong often enough to be worth managing.
- **`merchant_key` persisted column** — same canonical value, written on insert,
  purely as an index for grouping in Reports and the dashboard's
  `merchantSpend`. Independent of this feature; would let the dashboard stop
  keying on `t.merchant.trim().toLowerCase()` (`insights.ts:486`), which today
  treats the three MCDONALDS spellings as three merchants.
- **Merchant autocomplete on `TransactionForm`**, fed by the same canonical set
  — the analogue of the existing `GET /api/tags` (`worker/routes/wallet.ts:430`).
- **AI extraction** for the bank-transfer rail (pre-analysis Pattern E), if and
  only if Phase 5a is picked up. Out of scope until then (G3).

---

## 8. Owner decisions (2026-08-07)

The three open questions are resolved; the pre-analysis' other four are answered
by the design rather than by a decision (person-vs-merchant is moot per §3.2;
location strictness is dropped per §3.2; backfill is moot per §3.3; rule
learning is moot per §3.1).

1. **Pre-fill the Category select** on the import review table, as §4.1
   describes. No separate confirm step — the review table *is* the
   confirmation, and a gate in front of it only teaches the user to click
   through without reading.
2. **`MIN_MATCHES = 2`.** The majority rule does the real filtering.
3. **Ship the builtin map, at ~115 entries rather than ~40**, and treat it as a
   list that grows. Hence `scripts/merchant-map-gaps.mjs` (§3.4) — without a
   repeatable way to find what is missing, the list decays into whatever was
   guessed on day one.

   Recorded because it shapes expectations: the owner's reason for wanting the
   map large was *"we usually go to the same shop every month"*. Monthly repeats
   are the case **Stage 2 already owns** — after two visits, history overrides
   the map permanently and answers with the user's own category, not a guess.
   The map is worth its ~115 lines for the first-two-visits window and for
   merchants whose statement string never settles (§3.4), not for the regulars.
   If the map ever appears to be carrying the regulars, that is a symptom of the
   canonicaliser failing to fold their variants together — a bug in step 7, not
   an argument for more entries.

---

## 9. What was kept from the pre-analysis

Recorded so the ancestry is clear: the two-stage shape (normalise, then match),
frequency-over-history as the primary signal, a builtin map as the cold-start
fallback, "suggestions not magic" as the interaction principle, the observation
that Malaysian statements come in ~5 distinct rail formats, and the specific
rails themselves (card, online, DuitNow QR, utilities, MEPS/IBG transfers) —
which is real information from real data and is what §3.2's step list is built
from.
