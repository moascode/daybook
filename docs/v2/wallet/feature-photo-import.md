# Wallet — feature: import transactions from a photo

**Status: implemented (2026-09-06), not yet in a numbered release.** Not in
[release-plan.md](../release-plan.md)'s R1–R17 — this shipped as a standalone
`feat/wallet-photo-import` PR alongside the R3 wallet-import-modal work,
following the same fix/feat-PR pattern as the Accounts/Transactions/Shared
literal ports rather than waiting for a release slot. AI call is registered
as **P2** in [../cross-cutting/ai-usage.md](../cross-cutting/ai-usage.md) —
approved 2026-09-06 in chat, per CLAUDE.md rule 10 and §9.3. That file
remains the single source of truth for the register entry and approval log;
this doc does not duplicate it.

**One-line pitch:** photograph one or more receipts, or a bank/e-statement
screenshot, Claude Haiku extracts the transaction(s) from each photo, the
results land in the existing CSV-import review table so nothing is written
until the user confirms it.

---

## 0. Reconciliation note (2026-09-06)

The final mockups (`transactions.html`, `transactions-import.html`,
`transactions-import-review.html`, `transactions-import-error.html`,
`transactions-import-csv-review.html` in the design repo) landed on a
noticeably different shape than §2 describes below, after three retired
intermediate pages (`transactions-import-select.html`,
`transactions-import-processing.html`, `transactions-import-csv-map.html`)
were folded back into one surface mid-session. This section is the diff;
§2 onward is corrected to match it but kept otherwise intact — the
extraction contract (§3–§6), the mapping to `ImportRow` (§7), and the
checklist (§8) are all still accurate.

**What changed:**

1. **One modal, not a chooser that navigates away.** §2 step 1 originally
   described clicking "Import" as opening "a small chooser: Import CSV or
   Import from photo" that then navigates to a separate flow. The shipped
   design is a single `Modal`-based popup with a type segment (**Photo |
   CSV**) at the top that swaps content **in place** — there is no
   intermediate chooser screen and no navigation until the review step.
   Internally the modal has three views it toggles between (pick → map →
   processing); only the **review** step is still a full page, because a
   wide editable grid doesn't fit a 520px modal.
2. **CSV gets the same modal, not just photo.** The old doc scoped itself to
   photo import only, on the assumption CSV import's existing multi-step page
   (`CsvImport.tsx`) stayed as-is. The final design folds CSV's upload +
   column-mapping steps into the **same modal** photo uses (segment switches
   the whole modal's mode), and only CSV's **review** table remains a
   separate page (already true today). This is a real UI change to
   `CsvImport.tsx` beyond what this doc used to imply — see the companion
   note in `docs/v2/wallet/README.md`-adjacent PR description for the CSV
   side; this doc still owns only the photo-specific pieces (§3 onward).
3. **The composer's "Import CSV" shortcut is renamed "Import"** (single
   entry point, both kinds live behind it) — a small terminology delta from
   R7's `03-feature-waves.md` line "Import CSV" in the shortcut row.
4. **A floating bulk-action bar replaces both review pages' footers** —
   the exact fixed pill `WalletPage.tsx`'s multi-select bar already uses
   (`fixed inset-x-0 bottom-4 ... rounded-full ... shadow-xl`), not a static
   `<div className="mt-3 flex ... border-t">` footer like today's
   `CsvReviewTable.tsx` has. This applies to **both** the CSV review page and
   the photo review page — genuinely new for CSV's review too, not just
   photo's.
5. **No-key gating isn't shown in the mockup and needs an explicit call.**
   The mockup's type-segment always shows both "Photo" and "CSV" tabs
   (it's a static demo with no real settings state) — but §6's rule that
   "Import from photo" simply doesn't appear with no `anthropic_api_key` set
   still stands and is **stricter** to implement now: with no key, the type
   segment must not offer "Photo" at all (either hide the segment and open
   straight to the CSV pick view, or render it as CSV-only with no toggle).
   This is a judgment call the mockup doesn't resolve; flagging it rather
   than guessing, per CLAUDE.md rule 8 — the owner should confirm the
   "segment collapses to CSV-only, no toggle shown" behavior is right before
   it ships. (Made autonomously and documented here rather than blocked on,
   since this call is fully reversible and stated plainly for review.)
6. **Default tab matches the mockup's own default: Photo when a key is set,
   CSV otherwise.** Confirmed by the owner 2026-09-06, once P2 shipped —
   Photo is the richer, less-typing path and wins by default whenever it's
   actually usable; the segment defaults to CSV only when there's no key to
   spend (the same condition that hides the segment entirely).

---

## 1. Why this is CSV import's sibling, not a new subsystem

Everything downstream of "we now have N candidate rows" already exists and is
proven: duplicate detection via `import_hash`, merchant-history category
matching, the "Ask AI" fallback, and the review UI itself
(`CsvReviewTable.tsx`, operating on `ImportRow[]` from `src/lib/csv.ts`). The
genuinely new pieces are (a) turning a photo into that same `ImportRow[]`
shape and (b) fanning that out across a user-selected batch of photos. So
this spec is scoped narrowly: **a new extraction step, called once per photo,
that feeds the existing pipeline** — not a parallel import flow.

## 2. User flow

1. On the Transactions page, the composer's shortcut row carries a single
   **"Import"** action (replacing the old dedicated "Import CSV" shortcut).
   Clicking it opens a small chooser: **Import CSV** or **Import from
   photo**.
2. Picking "Import from photo" asks for two things, in order:
   - **One or more photos** (camera or file picker — multi-select is
     supported; see §3.1 for how a batch is processed).
   - **A type for the whole batch**: **Receipt** (one transaction per photo)
     or **Bank/e-statement screenshot** (multiple transactions per photo).

   Asking the user to pick the type up front (rather than having Claude
   classify each image first) is deliberate: it halves the prompt complexity
   and removes a failure mode (misclassifying the image type) for the cost of
   one tap the user can answer without thinking. It applies to every photo in
   the batch — mixing a receipt and a statement screenshot in one batch isn't
   supported; the user runs two imports.
3. Client resizes/compresses each image (§3.2) and calls the extraction
   endpoint once per photo, showing per-photo progress as calls resolve.
4. Each successful call returns one or more transaction drafts, already
   carrying a category guess (§4). A failed call (blurry photo, network
   error, malformed response) does not block the rest of the batch — see
   §3.1.
5. All drafts, across every photo that succeeded, are mapped into
   `ImportRow[]` and rendered in the **same `CsvReviewTable`** used by CSV
   import (with one small additive change — §6) — duplicate rows flagged via
   `import_hash`, every field editable, nothing written yet. Any photo that
   failed outright is surfaced as a dismissable notice above the table,
   naming the file and the reason, so a failure is never silently absent from
   what the user sees (rule 13) — it just doesn't block the rows that did
   extract.
6. User reviews, edits, confirms → the existing batch-insert path
   (`POST /api/transactions/import`, `worker/routes/wallet.ts:1302`) runs
   unchanged.

No new confirm step, no new undo/error surface to design for the *review*
stage — rule 13 is satisfied there by reusing a component that already
satisfies it. The new surface this feature does need is the per-photo
progress and partial-failure notice, both scoped in §3.1.

## 3. New endpoint

```
POST /api/transactions/import-photo
Body: { image: <base64>, imageType: 'image/jpeg' | 'image/png' | 'image/webp', kind: 'receipt' | 'statement' }
Response: { rows: PhotoImportRow[], failureReason?: string }

interface PhotoImportRow {
  date: string          // YYYY-MM-DD, best-effort; empty string if unreadable — user fills in
  merchant: string
  amount: number
  type: 'income' | 'expense'   // photo import never produces 'transfer' — see §5
  categoryGuess: string | null // exact category name, or null if the model wasn't confident
}
```

One photo per call, deliberately — see §3.1 for why a batch is client-side
fan-out rather than a multi-image request.

Always 200 on a reachable model response, even when some line items are
unreadable — an empty/garbled row is marked for the user to fix or exclude in
the review table, never silently dropped (rule 13, same posture as
`POST /merchants/resolve`'s `failedGuesses`). A hard failure for one photo
(no key, rate limit, network, malformed response) returns `failureReason` and
an empty `rows` array for *that call* — the client's job is to keep going
with the rest of the batch (§3.1), not to treat one bad photo as a reason to
show nothing.

### 3.1 Batches: client-side fan-out, one call per photo

A multi-select batch is **N independent calls to this same single-image
endpoint**, run with `Promise.allSettled` (the same pattern
`resolveMerchantsWithAI`'s callers already use for chunked calls) — not one
request carrying N images.

This was a deliberate choice over bundling multiple images into one Anthropic
message:

- **Attribution.** A failure is scoped to the one photo that caused it, so
  the review table can show exactly which rows came from which photo and the
  failure notice can name the specific file — bundling would make a
  truncated or malformed reply ambiguous about which image(s) it covered.
- **Truncation blast radius.** `max_tokens` (§4) is sized per photo. One call
  per photo means a long statement only risks truncating *that* statement's
  own line items, never spilling budget pressure onto unrelated photos in
  the same batch.

The tradeoff, accepted deliberately rather than engineered around: the
existing rate-limit convention is **one unit per request**
([ai-usage.md](../cross-cutting/ai-usage.md) §3 rule 4), and every other AI
route in the app already works this way — CSV categorisation counts one unit
per chunk, not per import. Photo import keeps that same convention rather
than inventing per-action batching: **a batch of N photos costs N units**
against `ai_rate_limit_photo_import` (§6). A large multi-select import can
therefore consume a meaningful slice of the 20/hour budget in one submit.
That is a known, honestly-documented limitation, not a bug — the same
limitation already exists for anyone doing several manual "Ask AI"
categorisation passes today.

Client responsibility for a batch: fire all N calls, show progress as each
settles (`"2 of 3 photos processed"`), and on completion build one combined
`ImportRow[]` from every succeeded call plus one failure notice listing every
photo whose call rejected or returned a `failureReason` — never fewer photos
processed than requested with no explanation (rule 13).

### 3.2 Image constraints

Resize client-side before sending: cap the longest edge at **1568px** (the
size beyond which Claude's vision input stops gaining resolution, per
Anthropic's documented image guidance) and target **under 5MB** post-encode.
A phone photo straight off the camera can be 10–20MB; sending that
unresized wastes upload time and buys no extraction quality. `imageType`
accepts `image/jpeg`, `image/png`, and `image/webp` — the three formats a
phone camera or a screenshot realistically produces and that the Anthropic
API accepts directly.

### 3.3 Privacy

A receipt or statement photo leaves the device and is sent to Anthropic for
processing, same as every other AI call in the app (per the existing
`anthropic_api_key`-gated posture in §9.3) — worth stating plainly here
because a *photograph of a bank statement* reads as more sensitive than a
merchant string, even though the handling is identical: the image is not
stored server-side beyond the single request/response, and the feature is
invisible with no API key set (§6).

## 4. The two prompts (Haiku, per [ai-usage.md](../cross-cutting/ai-usage.md) rule 1)

Two separate system prompts, selected by `kind` — not one prompt that
branches internally. Matches the reasoning that started this spec: a receipt
and a statement screenshot are different extraction problems, and splitting
them keeps each prompt small and testable.

**Receipt prompt** — extract exactly one transaction: date, merchant name
(the business, not the payment processor), total amount, and a category guess
chosen from the caller's own category list (same "only real names, omit if
unsure" contract `suggestCategoriesWithAI`'s prompt already uses). Always
`type: 'expense'` — nothing about a receipt implies income.

**Statement prompt** — extract every line item visible in the screenshot as
an array of the same shape, inferring `type` per line (a "-RM45.00" line is
`expense`, "+RM2,300.00" is `income`) since a statement legitimately mixes
both, unlike a receipt.

Both prompts pass the user's real category names in the message (same
mechanism `buildUserMessage`/`buildComposerUserMessage` already use for
accounts/categories) so the model can only select a category that exists —
never invent one.

### Category guess precedence

The vision call's `categoryGuess` is a **starting point, not the final
answer**. Before a row reaches the review table, run it through the existing
merchant-history lookup first — if this merchant already has a categorised
history in the user's own data, that match wins over the AI's guess, exactly
the precedence the CSV "Ask AI" fallback already respects (rule pass first,
AI only fills gaps). This keeps categorisation behaviour identical across
both import paths instead of photo-import quietly using different logic than
CSV-import — see §6 for exactly how this maps onto `ImportRow`'s
`suggestedFrom`/`suggestionApplied` fields.

## 5. Vision call shape

Same `fetch`-based call as every other Worker→Anthropic call in
`worker/lib/anthropic.ts` — no new dependency, no SDK. The only structural
difference is the `messages[0].content` array carries an `image` block ahead
of the `text` block instead of a plain string:

```ts
messages: [{
  role: 'user',
  content: [
    { type: 'image', source: { type: 'base64', media_type: imageType, data: base64Image } },
    { type: 'text', text: buildPhotoImportUserMessage(kind, categoryNames) },
  ],
}]
```

`claude-haiku-4-5` (the `MODEL` constant already in `anthropic.ts`) accepts
image blocks the same way Sonnet/Opus do — no model change needed, consistent
with ai-usage.md rule 1 (Haiku only, no exceptions).

`max_tokens`: a new constant sized for the job — a receipt needs perhaps 60
tokens (one row), a statement screenshot could show 15–20 line items, so size
it like the existing batch categorisation limit (`MAX_TOKENS = 2000`) rather
than the small composer limit (150). Because each photo is already its own
call (§3.1), a long statement's fix is simply **more photos**, each with its
own full 2000-token budget — that *is* the chunking lever here, unlike
`suggestCategoriesWithAI` where one call's budget is shared across many
merchants by design. Truncation can still happen within a single very-long
statement photo; document that as a known limit rather than engineering
around it in v1.

## 6. What this does NOT do (v1 scope)

- **No transfers.** A photo alone can't reliably identify a transfer's
  destination account. If a receipt/statement looks like a transfer, it comes
  in as expense/income and the user re-types it as a transfer in review, same
  as CSV import already requires today.
- **No OCR fallback / no non-AI path.** Unlike the composer (A1–A3 in
  ai-usage.md), which degrades to a form with no API key, this feature has no
  non-AI degradation — extracting structured data from a photo has no rules
  engine to fall back to. **With no `anthropic_api_key` set, "Import from
  photo" simply doesn't appear** in the Import chooser (same gating
  `hasAnthropicKey` already provides everywhere else), rather than showing an
  option that always errors.
- **No cross-photo dedup within a batch.** Each photo is extracted
  independently; if the same receipt is photographed twice in one batch, both
  copies reach the review table (the existing `import_hash` duplicate check
  still catches a re-import of a receipt already in the ledger, just not two
  copies of the same new receipt in the same batch). Flagging in-batch
  duplicates is a reasonable v2 addition, not required for v1.

## 7. `PhotoImportRow` → `ImportRow`, and the one change to `CsvReviewTable`

`ImportRow` (`src/lib/csv.ts`) requires several fields `PhotoImportRow`
doesn't carry, and one field (`categoryId`) in a different shape
(`categoryGuess` is a name; `categoryId` is an id). The mapping, run once per
successful `PhotoImportRow` after every photo's calls have settled:

- `date`, `merchant`, `amount`, `type` — copied straight across.
- `description` — **amended 2026-09-07.** Originally always `''` on the
  reasoning that "a photo has no raw narrative text the way a CSV bank column
  does." True for a receipt (the business name printed on it IS the
  merchant — nothing else to keep), false for a statement screenshot, which
  *is* raw narrative text, the same as a CSV bank column. `merchant` is now
  an AI-cleaned display name and `description` the line as printed,
  unedited — the same split CSV import already makes between a resolved
  merchant and its raw narrative. Still `''` for a receipt row.
- `categoryId` — resolve `categoryGuess` (a name) against the caller's own
  category list (the same list already sent into the prompt, so a non-null
  guess is guaranteed to match by name) to get an id; `null` guess → `null`
  id.
- `originalRow` — `{}`. No source columns exist for a photo row the way they
  do for a parsed CSV line.
- `importHash` — computed identically to CSV rows:
  `SHA-256(date + '|' + amount + '|' + merchant)`.
- `isDuplicate` / `included` — same duplicate-check call CSV import already
  makes (`POST /transactions/check-duplicates`), pre-unchecking duplicates
  exactly as CSV rows are today.
- `suggestedFrom` / `suggestionApplied` — set by the **same** category
  precedence step §4 describes: if the merchant-history lookup produced the
  final `categoryId`, `suggestedFrom = { canonical: merchant, matchCount }`
  with the real match count, same as CSV's own history hits; if the AI's
  `categoryGuess` was kept as-is (no history match), `suggestedFrom = {
  canonical: merchant, matchCount: 0 }` — the same "no history, but a
  category is pre-filled" shape the CSV cold-start map already produces, so
  the "Suggested a category for N rows / Clear suggestions" banner reads
  identically regardless of import source. `suggestionApplied = true`
  whenever `categoryId` ends up non-null via either path.
- A row belonging to a photo whose extraction was low-confidence or partly
  garbled (empty `date`/`merchant`, or the model flagged it) is still mapped
  and included — never dropped — with a warning marker on the row so the
  reviewer notices it, the same treatment `merchantUnresolved` already gives
  an unresolved CSV merchant name.

**The one change to `CsvReviewTable.tsx`:** a new optional
`photoMode?: boolean` prop. CSV rows never set `photoMode`, so CSV import's
rendering is byte-for-byte unchanged. A single review session is always
all-CSV or all-photo — the two sources are never mixed in one table — so
this is a table-level prop, not a per-row field.

**Amended 2026-09-07.** Originally, when `photoMode` was true, the
**Description** column was replaced entirely by a **Photo** column: a
36×36px thumbnail of the source image next to each row. Two problems
surfaced with real use: (1) `description` isn't always empty for a photo row
any more — see the §7 amendment above — so hiding the column lost real,
editable data; (2) a 36×36px thumbnail turned out to be too small to
distinguish one photo from another in a multi-photo batch, the opposite of
its "for attribution" purpose. `photoMode` now *adds* a **Source photo**
column (the filename, as a link to the full-size `photoUrl` object URL —
reliably identifies which photo a row came from, and stays clickable if you
want to actually look at it) ahead of **Description**, which is now always
rendered, exactly as it is for CSV rows.

## 8. New pieces checklist — as actually built (2026-09-06)

- `worker/lib/anthropic.ts`: `parsePhotoImportWithAI()` following the exact
  shape of `suggestCategoriesWithAI`/`resolveMerchantsWithAI` — same
  `jsonCandidates` salvage parsing, same THROWS-on-failure contract, same
  `DAYBOOK_TEST` mock-response branch (`TEST_MOCK_KEY_PHOTO_IMPORT`) so e2e
  can cover it without a real network call (CLAUDE.md §16 trap 6). Two
  system prompts (`PHOTO_RECEIPT_SYSTEM_PROMPT` / `PHOTO_STATEMENT_SYSTEM_PROMPT`),
  `PHOTO_MAX_TOKENS = 2000`, image content block ahead of the text block.
- `worker/routes/wallet.ts`: `POST /transactions/import-photo` — new rate
  limit bucket `ai_rate_limit_photo_import` (`PHOTO_AI_RATE_LIMIT_KEY`), same
  20/hour shape and `overAiRateLimit()` helper as the other three buckets,
  one unit per call (§3.1). Always returns 200 — even no-key, rate-limited,
  and a malformed AI reply come back as `{ rows: [], failureReason }`, never
  an HTTP error status, so the client's `Promise.allSettled` fan-out treats
  every outcome uniformly.
  `worker/routes/test.ts`'s `mock-ai-response` route gained
  `feature: 'photo_import'`.
- `src/modules/wallet/import/ImportModal.tsx` (not a separate chooser or a
  separate `PhotoImport.tsx` — see §0's reconciliation): the modal's
  **Photo** tab (type segment, only rendered when `hasAnthropicKey`), the
  Receipt/Bank-statement kind picker, a multi-file dropzone, and the
  processing view that calls `extractPhotoBatch`.
- `src/lib/photo-import.ts`: `extractPhotoBatch()` — client-side resize (cap
  the longest edge at 1568px, re-encode as JPEG via canvas) then
  `Promise.allSettled` across `POST /transactions/import-photo`, one call
  per photo — and `photoResultsToImportRows()`, the `PhotoImportRow` →
  `ImportRow` mapping from §7 (`import_hash` computation, category-name-to-id
  lookup via the caller's own category list, `photoUrl` for the review
  table's thumbnail).
- `src/modules/wallet/CsvReviewTable.tsx`: the `photoMode` prop and its
  Photo-column rendering (§7) — the only change to this existing file.
- `src/modules/wallet/CsvImport.tsx`: the partial-failure notice
  (transactions-import-error.html), rendered above the review table whenever
  any photo in the batch failed.
- e2e: `76-wallet-photo-import.spec.ts` — both `kind` values, a malformed AI
  response, no-API-key, an invalid `kind`/`imageType`, the rate-limit bucket's
  independence from the other three, the Photo tab's key-gating, and (via
  intercepting the browser's own call to the route, since the real
  Worker→Anthropic call is invisible to Playwright per trap 6) a 2-photo
  batch with one failing — the partial-failure notice and the surviving row.
