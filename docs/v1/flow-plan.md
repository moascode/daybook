# Plan: AI-assisted merchant name resolution for CSV import

## Clarification check

**Already decided — implementing as specified, not re-litigating:**
- Regex stays as the first stage; AI supplements it, never replaces it.
- Output is title-case, no country/location suffix — reuse the existing
  `canonicalizeMerchantForCsv` / `canonicalizeMerchantForDisplay`, do not rewrite them.
- Resolution ladder order per row: **regex guess `G`** → **corrections table hit** →
  **user's own merchant history hit (case-insensitive)** → **AI on the raw narrative `R`**
  → **memoize `G → C`**.
- One request per import batch, not per row.
- Cost is not a design constraint beyond what the corrections cache naturally saves.

**Resolved by planner (judgment calls — flag if you disagree, cheap to reverse):**
- **Q1 — new endpoint.** `POST /api/merchants/resolve`, not an extension of
  `POST /transactions/suggest-categories-ai`. Different input (raw+guess pairs, not
  merchant keys), different output (names, not category ids), different backing table,
  different caller, different failure semantics. Confirmed sound.
- **Q2 — separate rate-limit bucket.** Yes. Key `ai_rate_limit_merchant` alongside the
  existing `ai_rate_limit_suggest_categories`, same atomic `INSERT..ON CONFLICT`
  mechanism, same 20/hour ceiling. A 400-row import must not consume the
  bulk-categorisation budget, and the two features should fail independently.
- **Ladder step 3 scope.** History = `SELECT DISTINCT merchant FROM transactions WHERE
  user_id = ?` — the viewer's own rows only, not shared-in accounts.
- **Not in scope (deliberate exclusion):** capturing a *manual* edit in the review table
  as a correction row. The table supports it as a future increment; not part of this build.

**Q3 — RESOLVED.** User's answer: bulk-cleanup tool also gets the AI ladder. Implementation
decision (logged, auto mode): `POST /merchants/canonicalize` reuses the same
`/merchants/resolve` ladder rather than a parallel bespoke path — the "current stored
merchant" is treated as the raw input, run through the same regex → corrections → history →
AI steps. The history-check step is NOT skipped: it still matches the *cleaned candidate*
against real history, which is a valid free win even during bulk cleanup, not a
match-against-the-mess.

## Acceptance criteria

1. New table `merchant_corrections (user_id, regex_guess, corrected_name, created_at)`,
   `PRIMARY KEY (user_id, regex_guess)`, `user_id` cascading from `users`, added via paired
   migrations in `server/migrations/` and `worker/migrations/`; `node scripts/schema-diff.mjs`
   passes.
2. `POST /api/merchants/resolve` accepts `{ items: Array<{ raw: string; guess: string }> }`
   and returns `{ resolutions: Array<{ guess, name, source: 'correction'|'history'|'ai' }>,
   failedGuesses: string[], failureReason?: string }`. Auth-required; every query scoped by
   `user_id`.
3. A guess already in `merchant_corrections` for that user → stored `corrected_name`,
   `source: 'correction'`, zero outbound AI calls.
4. A guess (case-insensitively) matching an existing transaction merchant for that user →
   guess returned unchanged, `source: 'history'`, zero outbound AI calls.
5. A guess in neither table → AI called with the **raw** narrative, AI's name returned with
   `source: 'ai'`, one `merchant_corrections` row written. A second call with the same guess
   then returns `source: 'correction'` with no AI call (memoization proven).
6. Duplicate guesses within one request are deduplicated before any lookup or AI call.
7. AI calls chunk at 50 with concurrency 4 via `Promise.allSettled`, model
   `claude-haiku-4-5` through plain `fetch`, per-user key from `settings`. No key set → ladder
   stops after history; unresolved guesses reported in `failedGuesses` with a `failureReason`
   naming the missing key.
8. Rate limit bucket is distinct from category-suggestion's; exceeding it returns the partial
   result plus `failedGuesses`/`failureReason`, never a bare 429 that discards resolved names.
9. CSV import applies resolution **before** category suggestion (category grouping keys off
   the final merchant name — order is load-bearing).
10. Rule 13: any unresolved guess keeps its regex value **and** the user is told — a toast
    naming the count/reason, plus a per-row visual marker in `CsvReviewTable`. No path leaves
    an unresolved name looking identical to a resolved one.
11. No `any` types in new code; `npm run typecheck:worker` and client typecheck clean.
12. New spec `e2e/64-merchant-ai-resolve.spec.ts` covers: correction hit, history hit, AI
    fallback + memoization, AI-failure surfacing, no-API-key surfacing. All AI goes through
    the `DAYBOOK_TEST` mock branch — no test hits api.anthropic.com.
13. Full suite green; no regressions in specs 45, 49, 51, 60, 61, 62, 63.
14. `POST /merchants/canonicalize` preview rows include `source` per merchant (which ladder
    step resolved it), and `CanonicalizeMerchantsPage.tsx` displays it. The ladder logic is
    a single shared helper called by both `/merchants/resolve` and `/merchants/canonicalize`
    — not duplicated.

## Locked file list

**New**
- `server/migrations/0012_merchant_corrections.sql`
- `worker/migrations/0013_merchant_corrections.sql`
- `e2e/64-merchant-ai-resolve.spec.ts`
- `e2e/fixtures/narrative-unknown-merchants.csv`

**Modified**
- `worker/migrations/README.md` (renumber-mapping table gains the new pair)
- `worker/lib/merchant.ts` (add `correctionKey()`)
- `worker/lib/anthropic.ts` (add `resolveMerchantsWithAI` + parser)
- `worker/routes/wallet.ts` (new route, new rate-limit constant)
- `worker/routes/test.ts` (only if the existing AI mock slot is single-keyed — verify in Step 7)
- `src/lib/csv.ts` (retain raw narrative text on each built row)
- `src/modules/wallet/CsvImport.tsx` (round-trip, ordering, failure surfacing)
- `src/modules/wallet/CsvReviewTable.tsx` (unresolved-row marker)

## Steps

1. **[sequential] Migration pair.** `server/migrations/0012_merchant_corrections.sql` +
   byte-identical `worker/migrations/0013_merchant_corrections.sql` (matches the existing
   +1 offset documented in `worker/migrations/README.md`). DDL:
   `CREATE TABLE IF NOT EXISTS merchant_corrections (user_id TEXT NOT NULL REFERENCES
   users(id) ON DELETE CASCADE, regex_guess TEXT NOT NULL, corrected_name TEXT NOT NULL,
   created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (user_id, regex_guess));` with a
   leading comment explaining the memoization rationale, matching
   `0009_absorbed_import_hashes.sql`'s style. No extra index — the composite PK already
   covers `WHERE user_id = ? AND regex_guess IN (...)`. Update the mapping table in
   `worker/migrations/README.md`.

2. **[parallel with 3] `correctionKey()` in `worker/lib/merchant.ts`.** Pure function: trim
   → collapse internal whitespace → lower-case. Used for both the corrections-table key and
   the case-insensitive history comparison — both stages call it, neither hand-rolls its own
   `.toLowerCase()`. Export it; do not change `canonicalMerchant` or
   `canonicalizeMerchantForDisplay`.

3. **[parallel with 2] `resolveMerchantsWithAI()` in `worker/lib/anthropic.ts`.** Mirror
   `suggestCategoriesWithAI`: plain `fetch`, `claude-haiku-4-5`, `MAX_TOKENS`, JSON-in/
   JSON-out reusing `jsonCandidates`, `DAYBOOK_TEST` mock branch via `fetchTestText`. Input
   `Array<{ raw: string; guess: string }>`, output a map of guess → resolved name plus any
   unparseable guesses. Prompt: return the merchant's clean display name in Title Case,
   drop branch codes/city/country/payment-rail noise; return the guess unchanged if the raw
   text carries no better signal. No `any` types.

4. **[sequential, after 1-3] `POST /merchants/resolve` in `worker/routes/wallet.ts`.** Place
   beside `POST /merchants/canonicalize`. Flow: validate body → dedupe by
   `correctionKey(guess)`, keeping one representative `raw` per key → one `SELECT` from
   `merchant_corrections` for all keys → one `SELECT DISTINCT merchant FROM transactions
   WHERE user_id = ?` compared through `correctionKey` → remaining misses go to AI. Read
   per-user `anthropic_api_key` from `settings`; check the new rate-limit bucket (same
   atomic helper, one unit per request); chunk 50/concurrency 4 via `Promise.allSettled`.
   Persist AI results with one `DB.batch()` of `INSERT OR IGNORE INTO merchant_corrections`.
   Always return 200 with whatever resolved, plus `failedGuesses` + `failureReason` for the
   rest.

5. **[sequential, after 4] Client round-trip in `src/lib/csv.ts` + `CsvImport.tsx`.** In
   `csv.ts`, retain the raw narrative text on each built row so the client can send
   `{raw, guess}`; regex guess remains the `merchant` value written today, so the flow
   degrades to current behaviour if the round-trip fails. In
   `CsvImport.tsx#handleProceedToReview`, after `buildImportRows` and before
   `suggestCategories()`, POST the distinct narrative-derived pairs to `/merchants/resolve`
   and rewrite each row's `merchant` from the returned map. Only narrative-derived rows
   participate — rows from a real merchant column are untouched (spec 61's contract).

6. **[sequential, after 5] Failure surfacing (rule 13).** In `CsvImport.tsx`: on network/HTTP
   failure of `/merchants/resolve`, proceed to review with regex names and raise an error
   toast. On a partial result, raise a warning toast with the count and `failureReason`
   (missing key → link to Settings; rate limit → "try again next hour"). Mark unresolved
   rows in the row model and render a marker in `CsvReviewTable.tsx` (icon + accessible
   text) so unresolved is visually distinguishable from resolved. Semantic theme tokens
   only, no `dark:` variants.

7. **[sequential, after 3] Verify the e2e AI mock slot.** Read `worker/routes/test.ts` and
   `fetchTestText`. If the canned response is stored under a single `settings` key shared
   with the category feature, add a second per-feature key so spec 60 and spec 64 cannot
   clobber each other; if already keyed per caller, change nothing.

8. **[sequential, after 6-7] `e2e/64-merchant-ai-resolve.spec.ts` + fixture.** Serial mode,
   `newAppPage()`, business-timezone date helpers, mock AI via `POST /test/mock-ai-response`.
   Cases: (a) correction pre-seeded → name applied, mock AI never consumed; (b) matching
   transaction already in history → guess kept verbatim, no AI; (c) fresh narrative → AI
   name applied and re-importing resolves from the corrections cache with the mock cleared,
   proving memoization; (d) AI failure → regex names survive, warning toast and row markers
   visible; (e) no API key → unresolved rows surfaced with Settings pointer. New fixture
   `e2e/fixtures/narrative-unknown-merchants.csv`.

9. **[sequential, after 4]** Extend `POST /merchants/canonicalize` to call the same
   resolution logic as `/merchants/resolve` (extract the ladder into a shared helper
   function both routes call, rather than duplicating it) — for each distinct stored
   merchant, run regex → corrections → history → AI exactly as CSV import does. Preview
   response gains `source` per row so `CanonicalizeMerchantsPage.tsx` can show *how* each
   name was derived (e.g. a small badge: "from history" / "AI-suggested" / "already
   corrected"). Apply mode unchanged (still `DB.batch()`, still requires `confirm=true`).
   New e2e case in `e2e/62-canonicalize-merchants.spec.ts`: a messy merchant with no
   corrections/history match resolves via the mocked AI, and the preview table shows the
   AI-derived name before Apply.

10. **[sequential, last] Docs.** Update `CLAUDE.md` §6 with the `merchant_corrections` DDL
    block and §9.2's CSV Import flow with the resolution ladder; append the session note to
    `docs/project-history.md`. §9.3's AI inventory gains this as the second shipped 5a slice.

## Checks to run

- `npm run typecheck:worker` and the client typecheck — clean, zero `any` in new code.
- `node scripts/schema-diff.mjs` — CI drift gate; must pass with the new table in both trees.
- `diff server/migrations/0012_merchant_corrections.sql worker/migrations/0013_merchant_corrections.sql` — must be empty.
- `npx playwright test e2e/64-merchant-ai-resolve.spec.ts` — new coverage.
- `npx playwright test e2e/45-csv-parse-formats.spec.ts e2e/49-csv-transfer-import.spec.ts e2e/51-reimport-dedup.spec.ts e2e/60-ai-bulk-categorize.spec.ts e2e/61-csv-merchant-column-priority.spec.ts e2e/62-canonicalize-merchants.spec.ts e2e/63-csv-narrative-split.spec.ts` — regression set.
- `npx playwright test` — full suite before PR.
- `grep -rn "getByLabel" e2e/` against any new accessible name added in Step 6 (§16 trap 3).
