# Context Map: AI-assisted merchant canonicalization

## Relevant files
- `src/lib/csv.ts` — `canonicalizeMerchantForCsv()` (client-side regex, title-case output), `buildImportRows()` (calls it when `isNarrativeColumn`). Entry point for Phase 1 of the new flow.
- `worker/lib/merchant.ts` — `canonicalMerchant()` (all-caps matching key, used for category-suggestion grouping), `canonicalizeMerchantForDisplay()` (title-case wrapper, used by the bulk-cleanup endpoint).
- `worker/lib/anthropic.ts` — existing AI-calling infra to mirror. `suggestCategoriesWithAI(env, userId, apiKey, categoryNames, merchants)`: plain `fetch` to `api.anthropic.com`, model `claude-haiku-4-5`, `MAX_TOKENS=2000`, JSON-in/JSON-out with fence-stripping salvage (`jsonCandidates`), `DAYBOOK_TEST` mock branch for e2e. Symbols: `suggestCategoriesWithAI`, `parseSuggestions`, `jsonCandidates`.
- `worker/routes/wallet.ts:1026` — `POST /transactions/suggest-categories-ai`: the exact pattern to mirror for the new merchant-derivation endpoint — canonical-key dedup before spending tokens, per-user API key from `settings`, `AI_CHUNK_SIZE=50` / `AI_CHUNK_CONCURRENCY=4` chunking via `Promise.allSettled`, hourly rate limit (`overAiRateLimit`, atomic INSERT..ON CONFLICT on `settings`, 20/hour), partial-failure reporting (`failedMerchants`, `failureReason`).
- `worker/migrations/0009_absorbed_import_hashes.sql` — pattern to mirror for the new corrections table: small per-user side table, `user_id REFERENCES users(id) ON DELETE CASCADE`, composite primary key, one index.
- `worker/routes/wallet.ts:2820` (`POST /merchants/canonicalize`) — existing bulk-cleanup endpoint (preview/apply, `DB.batch()`), built this session. Distinct-merchant history query (`SELECT DISTINCT merchant ... GROUP BY merchant`) already exists here and is the same query the new "history validation" step needs.
- `src/modules/wallet/CanonicalizeMerchantsPage.tsx`, `src/modules/wallet/CsvImport.tsx`, `src/modules/wallet/CsvReviewTable.tsx` — client call sites that will need the new history+AI-aware flow wired in.

## Entry points / call sites
- CSV import: `CsvImport.tsx` → `buildImportRows()` (`csv.ts`) → today: pure regex, no server round-trip for merchant text. New flow needs a server round-trip (client cannot canonicalize itself — G12), likely piggybacking the same round-trip `suggestCategories()` already makes during `handleProceedToReview`.
- Bulk cleanup: `CanonicalizeMerchantsPage.tsx` → `POST /merchants/canonicalize` (preview/apply) — could also benefit from the same regex→history→corrections→AI ladder instead of raw `canonicalizeMerchantForDisplay()` only.

## Design (from conversation — already decided, not open)
Per-row resolution order:
1. Regex derives guess `G` from raw text `R` (existing `canonicalizeMerchantForCsv`/`canonicalizeMerchantForDisplay`).
2. Look up `G` in a new **corrections table** (`user_id`, `regex_guess` normalized lower-case, `corrected_name`). Hit → use it, done.
3. Miss → check `G` (case-insensitive) against the user's own distinct transaction merchant history. Hit → trust `G`, done.
4. Miss on both → call AI (mirror `suggestCategoriesWithAI` pattern: chunking, rate limit, per-user key, partial-failure reporting) with the **raw text** `R` (not just `G` — more context for the model) to get corrected name `C`.
5. Store `G → C` in the corrections table (memoization — this regex-guess pattern is now resolved forever for this user).
6. Use `C`.

History/corrections lookups both need a server round-trip (G12: canonicalization/matching logic is Worker-owned). Efficient approach: one request per import batch (not per row) — client sends all regex guesses + raw text for rows needing resolution, server does history+corrections+AI in one round-trip, returns final names per row.

## Open questions for planner
- **New endpoint shape**: one combined endpoint (`POST /merchants/resolve` — takes `[{raw, guess}]`, returns `[{raw, resolved, source: 'guess'|'history'|'correction'|'ai'}]`) vs. reusing/extending `suggest-categories-ai`. Recommend a new endpoint — different concern (name resolution vs. category suggestion), different table, different caller (CSV import review step, not bulk-edit dialog).
- **Corrections table AI key/model reuse**: should the new AI call reuse `AI_RATE_LIMIT_KEY`/budget or get its own hourly bucket? Recommend a separate rate-limit key (`ai_rate_limit_resolve_merchants`) — merchant-name resolution and category suggestion are different features and one heavy CSV import shouldn't exhaust the budget for the other.
- **Where does history come from for a NOT-YET-imported CSV batch?** — the existing `transactions` table (already-saved rows), same query the bulk-cleanup endpoint uses. Straightforward.
- **Does the bulk-cleanup tool (`CanonicalizeMerchantsPage`) also get the AI ladder, or stay regex-only?** Recommend: bulk tool stays as shipped this session (regex-only, `canonicalizeMerchantForDisplay`) for now — it's a one-time historical cleanup, not the recurring-import path this design is optimizing. Confirm with user at Plan/Clarify gate rather than assuming.
