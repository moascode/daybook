# AI Fallback for Bulk Categorisation

**Status:** Feature spec — draft, not approved
**Scope:** Transactions module → select mode → bulk edit dialog
**Depends on:** a prerequisite phase that does not exist yet (§2)
**Phase:** a narrow slice of Phase 5a, which CLAUDE.md §9.3 records as deferred

---

## 1. What this actually is

The bulk edit dialog **already suggests categories.** [`BulkEditDialog.tsx`](../src/modules/wallet/BulkEditDialog.tsx)
calls `suggestCategories()` → `POST /api/transactions/suggest-categories`
(shipped in PR #110), which resolves a category per merchant from the user's own
history, falling back to a builtin cold-start map. The dialog groups the
selection by canonical merchant and offers **Apply suggestions**.

So this feature is **not** "add suggestions to the dialog". It is:

> For the transactions the existing rule-based pass produced **no** suggestion
> for, ask Claude.

That count is already computed and displayed — `noSuggestionCount` in
[BulkEditDialog.tsx](../src/modules/wallet/BulkEditDialog.tsx), rendered as
*"N transactions have no suggestion"*. This feature turns that line into an
action.

**Why this framing matters:** the rules are free, deterministic, and get better
every time the user categorises something. AI is the paid, non-deterministic
last resort. Any design that sends the whole selection to Claude is both more
expensive and *worse* — it discards a real history match in favour of a guess.

### Non-goals

- Replacing or bypassing the rule-based pass.
- AI on CSV import. Same endpoint could serve it later; not in this scope.
- Auto-applying anything. Suggestions are shown; the user applies them.

---

## 2. Prerequisite: there is no API key infrastructure

**This is the bulk of the work and it does not exist.** `grep -ri anthropic
src worker server` returns zero matches. Specifically, none of this is built:

| Missing | Where it has to go |
|---|---|
| `anthropic_api_key` settings key | Already reserved in CLAUDE.md §6 "Known keys" — never written |
| Settings UI to enter/clear the key | `src/modules/settings/` |
| Server-side read of the key, per user | `worker/routes/` — read from `settings` inside the request |
| First outbound third-party call from the Worker | `worker/` — nothing calls out today |
| A rate limit on a paid endpoint | Nothing exists; CLAUDE.md lists rate limiting as the one open production risk |

`@anthropic-ai/sdk@^0.39` is in `package.json` but has never been imported.

**Ship this as its own PR before any AI feature.** It is independently
reviewable, it is where all the security questions live, and it unblocks every
other Phase 5a item equally.

### Key handling decisions

- **Per user, in `settings`** — matches CLAUDE.md §9.3 ("read at runtime from
  the DB, not env vars") and means one user's spend can't be charged to the
  other's key.
- **Stored in plaintext in D1.** State this in the Settings UI rather than
  implying it's a secret store. It is the same trust level as the transaction
  data already in there.
- **Never returned to the client.** `GET /api/settings` must mask it —
  return `"set"` / `""`, never the value. Otherwise the key round-trips
  through the browser on every page load.
- **Never in a URL.** Request body only.

---

## 3. User flow

1. Select rows → **Edit N transactions** (existing dialog).
2. The rule-based suggestion block renders as it does today.
3. When `noSuggestionCount > 0` **and** a key is set, a button appears under it:
   **Ask AI for the remaining N**.
   - No key set → the button is not rendered at all, and the line reads
     *"N transactions have no suggestion — set an Anthropic API key in Settings
     to ask AI"* with a link. (A disabled button with a hover tooltip is not
     reachable on touch, which is half of this app's usage.)
4. Click → button shows a spinner. **No auto-fetch on open** — see §5.
5. Results merge into the same suggestion list, visually marked as AI-sourced
   (`matchCount` semantics: `-1` = AI, `0` = builtin, `>0` = history).
   Caption: *"suggested by AI"*.
6. **Apply suggestions** applies rule and AI suggestions together, through the
   existing `onApplySuggestions` → `POST /transactions/bulk-update` path.
   Unchanged permission model, unchanged transfer skipping.
7. On failure: **always a message**, never a silent no-op. A click on a paid
   button that changes nothing on screen and explains nothing is the one
   outcome this must not produce. Three cases, all rendered in the suggestion
   panel: the whole call failed ("Could not reach Claude"), some batches failed
   ("N of M merchants could not be categorised — ask AI again to retry those"),
   or Claude answered but had no confident suggestion (said as much). The
   rate-limit 429 and the over-ceiling 400 surface the same way.

   > **Revised during implementation (PR #112).** This originally said "no
   > suggestions, no error toast", matching `suggestCategories()`, which
   > swallowed errors and returned `[]`. Both now throw and both are surfaced —
   > a broken service and a service with nothing to say were rendering
   > identically, which left the user no reason to retry. See CLAUDE.md rule 13.

### Why click-to-fetch, not a toggle

The doc this replaces proposed a toggle with `useEffect(..., [useAi,
selectedTransactions])`. That is a live bug in this exact component: the parent
passes `selectedTransactionIds` as a fresh `Array.from(...)` on **every**
`WalletPage` render, which is why the existing code derives a NUL-joined
`merchantsKey` and depends on that instead (see the comment at
[BulkEditDialog.tsx](../src/modules/wallet/BulkEditDialog.tsx)). A paid API call
on that dependency array fires repeatedly while the dialog sits open.

An explicit button removes the class of bug entirely: one click, one call.

---

## 4. Server: `POST /api/transactions/suggest-categories-ai`

Mirrors the shape of the existing rule-based route so the client can merge the
two result sets without a second code path.

**Request** — `{ merchants: string[] }`, distinct raw strings.
**Response** — `{ suggestions: MerchantSuggestion[], askedMerchants, failedMerchants }`.
`suggestions` uses the same interface the rule route returns (`raw`,
`canonical`, `categoryId`, `categoryName`, `categoryType`, `matchCount`,
`totalCount`); the two counts let the caller report a partial result.

> **Revised during implementation (PR #112).** The original 100-merchant cap
> returned a 400 the client swallowed, so a large selection produced a button
> that did nothing. Replaced with: chunk server-side (`AI_CHUNK_SIZE` 50, four
> chunks in flight), and a ceiling of **500 distinct canonical merchants**
> measured *after* canonicalisation — raw strings carry per-transaction noise,
> so counting them refused selections nowhere near the real limit. A failed
> chunk costs only its own merchants and is reported through `failedMerchants`.

Returning the *same* type is the point: `categoryType` is what lets
`suggestionFitsType()` keep an expense category off a money-in row — the guard
added in [77a95ea](https://github.com/moascode/daybook/commit/77a95ea) after
exactly that bug. Claude returns a bare name with no direction; the server must
resolve it against the user's own categories and carry the type back.

### Handler outline

```ts
wallet.post('/transactions/suggest-categories-ai', async (c) => {
  const userId = c.get('userId')
  const b = await body(c)
  const input: unknown[] = Array.isArray(b.merchants) ? b.merchants : []
  if (input.length === 0) return c.json({ suggestions: [] })
  if (input.length > MAX_AI_MERCHANTS) {
    return c.json({ error: `cannot request more than ${MAX_AI_MERCHANTS} merchants at once` }, 400)
  }

  // Key is per user and read per request — the Worker has no module scope to
  // cache it in, and it is not the same key for both users.
  const key = await c.env.DB.prepare(
    `SELECT value FROM settings WHERE user_id = ? AND key = 'anthropic_api_key'`,
  ).bind(userId).first<{ value: string }>()
  if (!key?.value) return c.json({ error: 'no API key configured' }, 400)

  // The user's OWN categories, not the seed list — they can rename and add.
  const cats = await c.env.DB.prepare(
    'SELECT id, name, type FROM categories WHERE user_id = ?',
  ).bind(userId).all<{ id: string; name: string; type: string }>()

  // …canonicalise + dedupe input, call Claude, map names back to ids…
})
```

### The prompt

**Model:** `claude-haiku-4-5` (alias; resolves to `claude-haiku-4-5-20251001`).
Categorisation is a classification task — no reasoning needed, and Haiku 4.5 is
the cheapest current model.

**`max_tokens`: 2000.** The superseded draft said 500. 70 merchants of
`{"merchant": "...", "category": "..."}` is ~1,400 output tokens; at 500 the
JSON truncates, `JSON.parse` throws, and the silent-failure rule turns that into
"no suggestions" with no clue why. Batch above ~100 merchants rather than
raising this further.

**`temperature: 0`** — accepted on Haiku 4.5, and this should be reproducible.

System prompt (static, so it caches if this ever gets chatty):

```
You categorise bank transactions for a personal finance app used in Malaysia.
For each merchant string, choose exactly one category from the list provided.
Return JSON: {"suggestions":[{"merchant":"<verbatim input>","category":"<exact name from the list>"}]}
Omit any merchant you are not reasonably confident about — omission is correct
and expected; a wrong category is worse than none.
Use only the category names given. Do not invent categories.
```

User message carries the user's real category names and the deduped merchants:

```
Categories: Food & Drink, Transport, Shopping, ...   ← from the query above
Merchants:
- UNCLE DINS
- PETRONAS KLCC
```

**Merchant strings only, not descriptions.** Descriptions are free text the user
typed and may hold anything personal; the merchant string is what the bank
wrote. Sending less is both cheaper and a smaller disclosure.

### Post-processing (all of it mandatory)

1. Parse defensively. A throw fails **that chunk only**, is logged, and is
   counted into `failedMerchants` — never silently folded into "no suggestions".
2. Drop any `category` not matching a real category name for this user
   (exact match — no fuzzy resolution, that is how a wrong category lands).
3. Drop any `merchant` not in the request.
4. Resolve to `{ categoryId, categoryName, categoryType }`; set
   `matchCount: -1`, `totalCount: 0`.
5. Echo one entry per **raw** input string that resolved, as the rule route
   does — the client cannot canonicalise (`canonicalMerchant` is Worker-owned).

### Dedup and batching

Send **distinct canonical merchants**, not one entry per row. 70 selected rows
are routinely ~20 distinct merchants, and the existing route already dedups this
way. Cap at 100 per call.

---

## 5. Cost

Haiku 4.5 is **$1.00 / $5.00 per MTok** (input/output).

| Scenario | Input | Output | Cost |
|---|---|---|---|
| 20 distinct merchants | ~500 | ~400 | **~$0.003** |
| 70 distinct merchants | ~1,500 | ~1,400 | **~$0.008** |

Under a cent per click. The superseded draft claimed `$0.0001` from a price
~100× too low, and set a DoD gate of `<$0.001` that the real price cannot meet.

Cost control comes from the design, not from a budget check: the rule pass runs
first, only the remainder is sent, merchants are deduped, and nothing fires
without a click.

---

## 6. Implementation order

**PR 1 — API key infrastructure** *(prerequisite, no AI)*
- `anthropic_api_key` in `settings`; `GET /api/settings` masks it.
- Settings UI: enter, replace, clear; states plaintext storage plainly.
- Rate limit on the routes that will spend it.
- Spec `60-api-key-settings.spec.ts`: set → masked on read → cleared.

**PR 2 — server route**
- `POST /transactions/suggest-categories-ai` per §4.
- Dedup, cap, name→id resolution, defensive parse.
- Spec `61-ai-suggestions.spec.ts`, Claude call stubbed at the network layer:
  400 without a key; invented category names dropped; merchants not requested
  dropped; malformed JSON → `[]` and 200; over-cap → 400.

**PR 3 — dialog**
- Button under the existing suggestion block, gated on
  `noSuggestionCount > 0 && hasKey`.
- Merge into the existing `suggestionGroups`; `matchCount: -1` → "suggested by AI".
- `suggestionFitsType()` applied to AI suggestions exactly as to rule ones.
- Extend spec 61: button hidden without a key; AI suggestions apply through
  `bulk-update`; an expense AI suggestion never lands on a money-in row.

> Spec numbering: `25-` was the draft's proposal and is already taken twice
> (`25-wallet-intuitiveness`, `25-splits`). Next free prefix is **60**.

---

## 7. Decisions

| Question | Decision | Why |
|---|---|---|
| Which rows go to AI? | Only those the rule pass missed | Rules are free, deterministic, and improve with use. AI is the last resort. |
| Trigger | Explicit button | A toggle + effect refetches on unrelated parent renders — a paid call on a known-buggy dependency. |
| Model | `claude-haiku-4-5` | Classification; cheapest current model. |
| `max_tokens` | 2000 | 500 truncates at ~25 merchants and fails silently. |
| Category list | The user's own, sent in the prompt | Categories are per-user and editable; the seed 10 are not the whole set. |
| Unknown category name | Dropped | A near-miss name resolving fuzzily is how a wrong category gets applied. |
| On error | ~~Silent, no suggestions~~ **Always a message** | Revised in PR #112. Degrade the feature, never the screen — but say so. A silent failure is indistinguishable from "nothing to suggest". |
| Batch size | 50 per Claude call, 4 in flight | One call is all-or-nothing on truncation; chunking bounds what a failure costs and keeps the wait short. |
| Ceiling | 500 distinct **canonical** merchants | Revised in PR #112. Counting raw strings refused selections nowhere near the limit. Over it, the caller is told the number. |
| Quota accounting | One unit per request | The cap stops a runaway loop; one click should not spend several units because the selection was large. |
| Key storage | Per user, `settings`, masked on read | CLAUDE.md §9.3. |
| Transfers | Excluded | §9.2 — they carry neither category nor tags. |

---

## 8. Open questions — all closed by the owner, 2026-08-08

1. **Is this worth building now?** ~~Measure `noSuggestionCount` for a week
   first.~~ **Closed: yes.** The gap is real and already observed — coverage was
   poor because most merchants had exactly one previously categorised row, which
   is *why* `MIN_MATCHES` went 2 → 1 on 2026-08-07. The owner intends to raise
   the threshold back gradually as history accumulates, which widens the gap
   this fills rather than closing it. No measurement period needed.
2. **Whose key?** **Closed: per user**, as designed here. Two keys, two bills,
   and one user's spend can never land on the other's account.
3. **Phase discipline (CLAUDE.md rule 10).** **Closed: approved.** Nothing in
   §9.3 is a technical prerequisite — this feature brought its own key storage,
   Settings UI, model choice, and prompt, and depends on no other Phase 5a
   component. Phase 5a is no longer wholly deferred; the key infrastructure it
   adds is the shared foundation any later 5a item (daily briefing, natural
   language entry) should reuse rather than rebuild. Recorded in CLAUDE.md §14.
