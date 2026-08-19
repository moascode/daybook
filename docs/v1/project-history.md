# Daybook — Project History

Moved out of `CLAUDE.md` §13 on 2026-08-08. That section had grown to 871 lines
(37% of a file read in full every session) by accumulating one narrative block
per session, newest first, with nothing ever retired. It had also drifted badly:
its release list stopped at "v2.4.0 PENDING" while v2.4.0, v2.5.0 and v2.6.0
were all tagged and deployed.

**`CLAUDE.md` §13 now carries current state only** — what is live, what is
blocked, what is next. This file carries the record of how it got there.

**What lives where now.** The *lessons* from these entries were not moved here —
they were promoted into the topical sections of `CLAUDE.md` where someone would
actually look for them (§16 for the e2e traps, §18 for theming, §5 for the D1
and port gotchas, §9.2 for the wallet money-semantics rules). This file is the
narrative; `CLAUDE.md` is the standing instruction. If the two ever disagree,
`CLAUDE.md` wins.

---

## Release record

Reconciled against `git tag` on 2026-08-09. Regenerate with:

```
git for-each-ref --sort=-creatordate --format='%(refname:short) %(creatordate:short) %(subject)' refs/tags
```

| Tag | Date | What |
|---|---|---|
| v2.9.0 | 2026-08-09 | Split percentage auto-adjust + uniform bulk split (#119) |
| v2.8.0 | 2026-08-08 | Split-by-percentage mode for wallet transactions |
| v2.7.3 | 2026-08-08 | Surface AI categorisation errors (#115) |
| v2.7.2 | 2026-08-08 | CLAUDE.md restructure (#114) |
| v2.7.1 | 2026-08-08 | AI bulk-categorise feature follow-up (#112) |
| v2.7.0 | 2026-08-08 | AI bulk-categorisation fallback (#112) + `MIN_MATCHES` 2→1 (#111) |
| v2.6.0 | 2026-08-07 | Merchant categorisation with bulk suggestions (#109, #110) |
| v2.5.0 | 2026-08-07 | Dashboard dual-mode periods, Shared/Goals panels, dark-mode fixes (#107, #108) |
| v2.4.0 | 2026-08-05 | Dark mode (#104, #105) |
| v2.3.1 | 2026-08-03 | CSV import D1 100-bound-param cap (#103) |
| v2.3.0 | 2026-08-03 | Bulk categories + tags (#102) |
| v2.2.0 | 2026-08-03 | Settle by netting (#96, #97, #98) |
| v2.1.0 | 2026-08-02 | Shared review flow R1–R3 (#95) |
| v2.0.1 | 2026-07-31 | CI/CD hardening |
| v2.0.0 | 2026-07-31 | Split → settlement review flow (W1–W6) |
| v1.0.0 | 2026-07-27 | Stable Mac-only local release (Phase 4 + 5b + 5c) |
| v0.4.0 | 2026-07-26 | Pre-v1 |

Releases are tag-triggered: `release.yml` gates on the full suite, applies
pending D1 migrations, deploys the Worker, smoke-tests it, then publishes the
GitHub Release. **The tag is the deploy.**

---

## v2.7.0 — AI bulk-categorisation fallback (PR #112)

Branch claude/ai-bulk-categorize-feature-varl0e, built from
docs/ai-bulk-categorize-feature.md in one PR (not the doc's
3-PR split — small enough to review as one diff). New spec
e2e/60-ai-bulk-categorize.spec.ts, 18 tests. tsc -b,
typecheck:worker, lint all clean.

REVIEW ROUND (2026-08-08) changed four things worth knowing,
all of them because a silent failure was hiding behind them.
RULE 13 CAME OUT OF THIS — never fail silently, anywhere.
• THE 100-MERCHANT CAP WAS COUNTING THE WRONG THING. It
  measured RAW strings, but raw strings carry per-row noise
  (`GRAB *ABC123` vs `GRAB *DEF456` = two raws, one
  merchant), so it refused selections nowhere near the real
  limit — and the client swallowed the 400, leaving a button
  that spun and did nothing in exactly the case the feature
  exists for (select-all after an import). Now: chunked
  server-side (50/call, 4 in flight) with the ceiling at 500
  DISTINCT CANONICAL merchants, checked after
  canonicalisation. Raising max_tokens was the wrong lever —
  one call is all-or-nothing, so a truncated response loses
  every answer in it, not just the ones past the limit.
• DEDUPE STAYS, and it costs nothing: the answer is echoed
  back per raw string, so all 400 selected rows still get a
  suggestion. Claude is just not asked the same question 40
  times. This was queried in review and is worth re-reading
  before anyone "fixes" it.
• suggestCategoriesWithAI() NOW THROWS instead of returning
  []. A failed chunk costs only its own merchants and comes
  back as failedMerchants, so the dialog can say "N of M
  could not be categorised" rather than showing an empty
  panel identical to "nothing to suggest".
• THE RULE-BASED suggestCategories() WAS SWALLOWING ERRORS
  TOO (pre-existing, both callers) — now throws, and both
  BulkEditDialog and CsvImport surface it.
Rate limiter is now ATOMIC: the whole window-expiry +
increment happens inside one INSERT … ON CONFLICT …
RETURNING guarded by json_valid(), because a single SQLite
statement cannot interleave. It also moved AFTER the key and
category checks, so a request that spends nothing no longer
costs a slot — a user with no key could previously burn
their whole hour on 400s. One unit PER REQUEST, not per
Claude call: the cap exists to stop a runaway loop, and one
click should not spend eight units because the selection was
large.
@anthropic-ai/sdk REMOVED from package.json — never imported,
24 transitive packages, and a trap for anyone assuming it was
the sanctioned path. The Worker calls Claude with plain
fetch. See §4.
What it is: for the transactions the existing rule-based
suggest-categories pass has NO suggestion for, an explicit
"Ask AI" button in the bulk edit dialog asks Claude — never the
whole selection, only the leftover. §2's prerequisite (no API
key infra existed anywhere) is now built: worker-only, nothing
touches server/ — production has run on the Worker since
Phase 6, so server/ is schema-reference-only and out of scope.
No migration: anthropic_api_key lives in the existing settings
KV table (already reserved in §6), and so does the rate
limiter and the e2e mock hook below — all three are just rows
under reserved key prefixes, so this shipped with zero schema
change.
GET /api/settings now masks anthropic_api_key to 'set'/'' and
drops two internal prefixes entirely (ai_rate_limit_*,
_test_*) rather than leaking Worker bookkeeping into the
client; PUT rejects writes to either prefix (a user resetting
their own rate-limit row via the generic settings endpoint
would defeat the point of having one).
Rate limiting (worker/routes/wallet.ts overAiRateLimit): 20
calls/hour/user, a JSON blob in one settings row, checked
before any tokens are spent. Not atomic against a concurrent
request from the same user — accepted for a two-user app where
the goal is capping a runaway UI loop, not defending a
compromised session. This is the CLAUDE.md-flagged "one open
production risk" closed for this endpoint specifically; the
general public-URL rate-limit gap is unchanged.
THE TESTING TRAP, worth remembering for any future
Worker-originated outbound call: Playwright intercepts
requests the BROWSER makes; it has no route into a
Worker-to-third-party fetch, because `wrangler dev` runs that
call from a separate process. worker/lib/anthropic.ts resolves
this by branching on DAYBOOK_TEST (already the flag that gates
worker/routes/test.ts) — under test it reads a canned response
from a settings row instead of calling api.anthropic.com,
stashed by a new POST /test/mock-ai-response. Production never
sets DAYBOOK_TEST, so the mock path is unreachable there. This
is the pattern to reuse, not a one-off — an env-var-configurable
base URL pointing at a second webServer would also have worked
but needed real infra; this needed none.
Model claude-haiku-4-5, max_tokens 2000, temperature 0, per
the doc's §5 cost analysis (~$0.003-0.008/click). Post-
processing is defensive at every step (§4): malformed JSON,
an invented category name, or a merchant Claude wasn't asked
about all degrade to dropping that entry, never a 500 — same
silent-failure contract suggestCategories() already has.
Client: BulkEditDialog's suggestion panel used to be gated on
`suggestionGroups.length > 0`, which meant a selection with
ZERO rule-based suggestions never showed the "N have no
suggestion" line at all — fixed to gate on
`suggestionGroups.length > 0 || noSuggestionCount > 0` so the
Ask AI button (or the no-key Settings link) is reachable even
then.
THE DOC'S §8 OPEN QUESTIONS ARE ALL CLOSED (owner,
2026-08-08) — see docs/ai-bulk-categorize-feature.md §8.
• Worth building? YES. The gap is real and already observed:
  coverage was poor because most merchants had exactly ONE
  previously categorised row, which is why MIN_MATCHES went
  2->1 on 2026-08-07. The owner intends to RAISE that
  threshold back gradually as history builds, which WIDENS
  this gap rather than closing it. No measurement period.
• Whose key? Per user, as built.
• Phase discipline: approved. Nothing in §9.3 was a
  prerequisite — this feature brought its own key storage,
  Settings UI, model choice and prompt. Phase 5a is now
  "partially started" in §14, and the key infrastructure is
  the foundation later 5a items must REUSE, not rebuild.
  Each remaining §9.3 item still needs its own sign-off.

---

## v2.5.0 — dashboard rebuilt around comparison (PRs #106, #107, #108)

What #106 changed: /wallet/dashboard is now a COMPARISON
view — every figure sits next to its baseline. Aggregation
moved into one pure module (modules/wallet/dashboard/
insights.ts) with the panels as thin components.
Two real bugs fixed with it:
• The charts and the summary tiles disagreed about splits.
  Tiles used countableAmount; the cash-flow chart, pie,
  account chart and merchant list used raw t.amount, so a
  split RM100 expense read RM50 in a tile and RM100 in the
  chart directly beneath it. This ALSO closes the open
  question below about TransactionList's day headers —
  everything on the dashboard now goes through one module
  that only ever uses the effective figure. The day headers
  themselves are still unaudited.
• Uncategorised spending was skipped by the pie, so it never
  summed to the expense total and the one bucket worth
  acting on was the only invisible one. Now a real row.
Three traps worth remembering:
• committedSplit needs the TRAILING months to decide what
  recurs, not just the period's rows — handed only the
  period, every merchant appears in exactly one month and
  nothing is ever committed. Hence its separate
  historyTxns argument.
• DO NOT write dark: variants. The #104 token layer mirrors
  accent ramps (50<->950), so bg-amber-50 ALREADY resolves
  to a dark tint; pairing it with dark:bg-amber-950 inverts
  a second time and lands on near-white. Eight of these
  shipped into review before being caught by looking at the
  rendered page — the type checker cannot see it.
• A linear run-rate is meaningless in the first days of a
  month: on day 4 it turned RM2,940 into a RM22,785
  projection and its y-range flattened the real line into
  the axis. Withheld below MIN_PROJECTION_DAYS (7).
Spending by account was DROPPED (a bookkeeping fact, not a
behaviour) and the pie replaced by bars. The proposal's
household/shared summary panel was deliberately NOT built —
it needs group-balance data the dashboard does not otherwise
load, and the Shared nav badge already carries it.

---

## v2.4.0 — dark mode (PRs #104, #105)

PR #104, merged to main 2026-08-05; tag not yet pushed at
the time of writing. New spec 58 (10 tests).
Client-only diff (72 files) — no D1 migration, no server or
Worker change. The default stays Light, so nothing changed
for either user until they picked otherwise in Settings.
See §18 for the token vocabulary and the rules.
The plumbing already existed (darkMode:'class', a tri-state
theme setting, App.tsx toggling the class); what was missing
was every colour. 64 files carried ~1,026 literal light-only
classes and ZERO dark: variants.
Built as a SEMANTIC TOKEN LAYER, not a dark: sweep. One CSS
variable set per theme in src/index.css (generated by
scripts/gen-theme-tokens.mjs, npm run gen:tokens); components
say bg-surface/text-fg-subtle. There are still zero dark:
variants in the codebase and new components need none.
Neutrals (674 replacements, 59 files) were swept to semantic
names because a literal grey step is meaningless once the
scale inverts. Accents were NOT swept — bg-red-50 etc. keep
their class names and are remapped underneath, light values
byte-identical to Tailwind's, dark values the same ramp
MIRRORED (50<->950 ... 500<->500). That is why a -50 tint
chip becomes a -950 tint chip and -600 accent text becomes
-400 with no per-component work.
Tailwind's DEFAULT border and ring-offset colours are literal
greys, so the bare `border` utility (111 uses), `divide-y`
(12) and `ring-offset-*` (3) had to be overridden in the
config too — they would otherwise have stayed light-grey in
dark with nothing in any component to point at.
Deliberate light-mode changes, the only ones: gray-800/600/300
collapse into fg/fg-muted/fg-faint (= 900/700/400). All three
are small contrast INCREASES on a handful of elements.
THE FOUC IS THE REASON FOR THE INLINE SCRIPT in index.html.
The preference lives on the server and is not readable until
after the session check and /settings, so a dark-themed app
flashed full white on EVERY load. src/lib/theme.ts mirrors it
to localStorage and the inline script replays it pre-paint.
Spec 58 blocks the JS bundle to prove it: asserting after
hydration would pass on the store's localStorage seed alone,
which lands a frame too late — after the white paint.
Recharts takes colours as PROPS, so grids/axes/tooltips
cannot go through CSS; useChartTheme() reads resolvedTheme
(new in app.store — 'system' already collapsed). Recharts'
default white tooltip card was unreadable on a dark canvas.
Toasts/tooltips are surface-inverted: they invert in BOTH
themes, so they read as chrome rather than as another card.
ARIA-LABEL COLLISION, worth remembering: getByLabel()
matches SUBSTRINGS, so a new control's accessible name can
silently capture unrelated specs' lookups anywhere in the
suite. ThemeToggle first shipped as "Switch to dark theme",
which made getByLabel('To') — the date-range inputs in spec
03 — AND getByLabel('Theme') in spec 11 resolve to three
elements. Fixed in the APP, not by patching specs: the
button is now a proper toggle (aria-label "Dark theme" +
aria-pressed), checked against every getByLabel string in
e2e/ so it collides with nothing but 'Theme', which spec 11
and 58 pin with { exact: true }. Name new controls after
what they control, not as a sentence.
Also: AppShell renders both the mobile and desktop bars, so
the toggle is in the DOM twice — specs must match
visible=true, not .first().
Default stays 'light' — nothing changes for the 2 live users
until they choose otherwise. NO MIGRATION: the settings key
already accepted 'dark'.
manifest.json background_color STAYS #ffffff — decided
2026-08-05, do not "fix" it again. The manifest spec gives
background_color a single colour with no media-query form,
and the OS caches the manifest at install time, so unlike
<meta name="theme-color"> (which index.html already swaps
pre-paint) it CANNOT follow the theme. The only choice is
which single colour to commit to, and #ffffff matches the
default Light theme that both users are on. A dark-theme
user gets a brief white splash; the alternative is a dark
splash in front of a white app for everyone else.

---

## v2.3.0 — bulk categories + tags (PR #102)

PR #102, merged and released 2026-08-03. New spec 57 (13
tests).
Select mode gains "Categorise N" alongside Split/Delete:
one dialog sets a category and/or changes tags across the
whole selection.
POST /transactions/bulk-update {ids, categoryId?, tags?}
where tags is {mode: add|replace|remove, values}. ONE
batch() for the whole selection — deliberately NOT a loop
over PATCH /transactions/:id, which is ~130 lines of
split-rescaling and a per-row permission lookup, i.e. 300
sequential D1 round trips for 300 rows (the S2 N+1 shape).
Category and tags cannot change an amount, so none of the
rescale machinery applies.
Permission resolved with ONE writableAccountIds() call,
not canWriteAccount() per row; updates stay scoped to the
ORIGINAL owner's user_id so a co-member editing a
shared-account row does not take ownership of it.
TRANSFERS ARE SKIPPED, NOT REJECTED (§9.2: they carry
neither field). A selection dragged down a list will often
contain one, and failing the whole request over it would
make the feature unusable — the response reports
{updated, skippedTransfers} and the dialog says so up
front rather than letting the count come back short with
no explanation.
'replace' with an empty list is how you clear tags; add/
remove of nothing is rejected as an unintended no-op. The
dialog only treats an empty replace as "clear" once the
user has actually touched the tag controls, so opening it
to change a category cannot wipe tags.
The dialog is MOUNTED ONLY WHILE OPEN, so its fields reset
by unmounting rather than through a state-resetting effect
(which react-hooks/set-state-in-effect flags as an error,
not a warning).

---

## v2.2.0 — settling now nets (PRs #96, #97, #98)

Settling reads BOTH directions between two people,
cancels min(each way) and moves only the difference.
Kakon owed RM30 and owing RM15 is one payment of RM15
clearing both claims; it used to take RM45 of cash and
then refuse everything, because the "no outstanding
balance" guard fired the moment the net hit zero while
both claims sat half-open.
A netted debt books like a cash settlement minus the
money: a categorised expense flagged is_non_cash, which
counts as spending everywhere EXCEPT the account balance.
Booking it nowhere was the trap — it deleted RM30 of real
household spending from both sets of books.
Also shipped: a person card shows BOTH directions with a
toggle (the smaller direction's claims were previously
unreachable — no row, no agree, no reject); the payer can
withdraw a split they made; the settlement undo window is
a week rather than the calendar day; the Transactions
summary reports what you bore rather than the ledger
gross; and settlement legs no longer inherit another
user's category id (per-user categories meant the payment
landed in a category its owner does not have).

---

## v2.2.0 — three reported bugs fixed (PR #101)

PR #101, merged and deployed 2026-08-02 (version
87d64a7e). New spec 56; 539/539 e2e green. No migration.
1. NET WORTH COUNTED OTHER PEOPLE'S MONEY. GET /api/accounts
   returns own + shared-in accounts, and both banners summed
   the whole array — so a co-member's account read straight
   into the viewer's total. Reproduced with two real users:
   RM100 of own money displayed as RM10,099 across "2
   accounts". Two call sites, two different code paths
   (AccountsPage useMemo, WalletPage loadNetWorth + its
   effect); both now sum ownAccounts. Shared cards still
   render with their real balance — only the TOTAL is
   yours alone, and the "across N accounts" caption counts
   the same set the figure was summed over.
   The underlying per-account balance arithmetic was
   verified correct and was never the bug.
2. Day headers gained the weekday ('EEE, dd MMM yyyy').
3. Categories could not be added in practice: the manager
   existed and worked, but its ONLY entry point was a
   "Manage categories…" option inside the Category filter
   dropdown, inside the collapsed filter panel. Added a
   Categories button to the Transactions toolbar; same
   modal, no new component.
Also fixed while verifying: the batched /accounts/balances
query filtered is_non_cash = 0 on three of its four arms
but not the transfer-IN leg, while /accounts/:id/balance
filters all four. Equivalent only because nothing writes a
non-cash transfer today (settlement legs are income or
expense) — the two routes are documented as needing to
agree, so the first such row would have split them.

---

## v2.1.0 — shared review flow R1–R3 (PR #95)

PR #95, merged and deployed 2026-08-02.
docs/shared-review-implementation-plan.md. 500/500 e2e under
CI settings; schema-diff clean at 28 objects.
R1 One SplitList + person-first SplitsSection replace the
   three renderers that drew the same claims three ways
   (ClaimsToReview and BalanceBreakdown are deleted).
   Lifecycle tabs over a DERIVED claim_state: the raw
   status column cannot drive them, because a claimed but
   unconfirmed split deliberately stays 'pending'
   (settlements.ts:262), so grouping on it shows a paid
   claim as untouched and invites paying it twice. Split
   notes are now captured as well as shown — the column
   and the API always had one, but no dialog ever wrote it.
   Rows deep-link to their transaction (?txn=, ringed and
   scrolled to), carrying view=all&range=all so an older
   claim does not land on an empty list.
R2 The 'approved' state (migration 0011, mirrored to
   server/migrations/0010). Agreeing empties the review
   queue and clears the nav badge WITHOUT moving a single
   figure — approval is an acknowledgement, not a gate, so
   a recipient cannot zero a creditor's books by not
   clicking. Balances gained agreed/unreviewed subtotals.
   TWELVE 'pending' literals in the settlement guards
   widened or retargeted; a thirteenth was deleted as dead.
   The trap was the debtor-side CAS probe, which wrote
   status='pending' as a supposed no-op — true only while
   pending was the sole payable state. With approved
   payable too it silently demoted an agreed claim back
   into the review queue on every payment recorded against
   it. It now assigns settled_amount to itself.
   D-1 paying implies agreeing: every post-settlement and
   rollback resting state is 'approved', which closes the
   partial-settlement bug (a part-paid claim reappeared
   looking untouched) and means undo needs no memory of the
   prior status.
R3 Bulk agree (not bulk reject — the reason is the useful
   half). POST /settlements/preview shows what an amount
   will clear, sharing ONE query and ONE allocation
   function with the commit path so the preview cannot
   drift from what actually happens. Rejected claims show
   who rejected them and why, with Re-split — the reason
   was previously collected, stored, and rendered nowhere.
Four bugs the tests caught, all recorded in the plan §5a:
the "All settled up" message became unreachable; acting on
a claim reset your tab (revision was in the React key, so
the section remounted); a cleared balance defaulted to the
wrong direction and rendered the payer's section empty; and
the note needed capturing before it could be shown.

---

## v2.0.0 — split → settlement review flow (W1–W6)

docs/split-settlement-plan.md, all six waves merged.
W1 "All" includes transactions split with you; filter-aware
   empty state.
W2 Money semantics: the payer carries the full amount until
   a split is settled, then their expense drops by the
   settled amount. The creditor's incoming leg is
   balance-only; the debtor's payment is a normal expense.
   The asymmetry is load-bearing — see §3 of the plan.
W3 The recipient can reject a claim, with a reason. Shared
   page gains a review queue; the nav gains a count badge.
W4 Two-step settlement: the debtor records a payment, the
   creditor confirms receipt into an account THEY choose.
   This removed the dead end where the creditor's leg could
   only be booked if they had shared a writable account in
   advance — nobody ever had, so half of every settlement
   was silently dropped.
W5 A balance opens into the transactions behind it, both
   directions, starting at All time.
W6 Tagging deploys: full suite -> apply D1 migrations ->
   deploy Worker -> smoke test -> publish release. The Mac
   tarball is no longer built (Mac retired as a deployment
   target); server/ stays only as the schema reference that
   scripts/schema-diff.mjs gates CI against.

---

## Phase 6 — Cloudflare Workers + D1 migration

The largest single piece of work in the project: 156 `.prepare()` sites, 2,905
server lines and 51 e2e specs ported from Express + SQLite to Hono + D1, plus
the atomicity redesign D1 forced (no interactive transactions).

found; S3 downgraded to low risk. See
docs/option-2-spike-findings.md.
Phase 1 (Scaffold) — IMPLEMENTED, IN REVIEW (2026-07-27).
PR feat/workers-scaffold: wrangler.toml (D1 + [assets] SPA
fallback + run_worker_first=/api/*), Hono app in worker/ with
request logging + {error} 404/500 handlers mirroring
server/index.ts, health route ported, worker tsconfig, CI
typecheck:worker + `wrangler deploy --dry-run` gate.
D1 database `daybook` created in APAC (id fdc50631-…) — empty;
schema lands in Phase 2.
Verified locally against `wrangler dev`: /api/health 200
{db:true}, SPA root 200, deep link /wallet/accounts falls back
to index.html, unmatched /api/* returns {"error":"not found"}
404, and the built SPA boots in-browser and reaches the Worker
on one origin. Client tsc + typecheck:worker clean.
DEPLOYED 2026-07-27 (owner-approved) to
https://daybook.moascode.workers.dev — verified live: health
200 {db:true}, SPA root, deep-link fallback, {error} 404.
⚠️ That URL is PUBLIC. It is currently an empty shell (no auth
routes, no data) and must not receive real data until the
Phase 3/4 hardening lands.
Phase 2 (Data layer) — IMPLEMENTED, IN REVIEW (2026-07-27).
PR feat/d1-migrations-and-data: all 9 migrations ported to
worker/migrations/ and applied to BOTH local and remote D1;
worker/lib.ts + worker/seed.ts ported to async; four scripts
(schema-diff, export-to-d1, verify-import, analyse-users).
Migrations are RENUMBERED — server/ has two files numbered
0003 and wrangler rejects duplicates; relative order is
preserved and the mapping is in worker/migrations/README.md.
Verified: schema-diff clean vs local AND remote D1 (27
objects); full round trip of real data into a clean local D1
— 174 rows across 18 tables, row counts match and
`PRAGMA foreign_key_check` empty; all 4 typechecks + lint
clean; e2e smoke 53/53. CI now gates on schema parity.
⚠️ FINDING: the production DB holds 277 users — 273 are
`e2e_*` accounts created 2026-05-31 when the e2e suite was
run against production. Only kakon/tumpa/user-a/user-b are
human. Owner decided (2026-07-27) to migrate ONLY the real
users; `--users kakon,tumpa` cuts the export from 5,828 rows
to 174. The e2e residue is NOT to be carried to D1.
Phase 3 (Auth + sessions) — IMPLEMENTED, IN REVIEW
(2026-07-27). PR feat/workers-auth: PBKDF2-HMAC-SHA256 via
Web Crypto at 50,000 iterations (S1's safe operating point),
D1-backed sessions with an HMAC-signed cookie (NOT JWTs —
logout must stay instant), session regeneration on login,
DAYBOOK_ALLOW_SIGNUP gate, MIN_PASSWORD 12, Hono
secureHeaders. NOT DEPLOYED — production still runs the
Phase 1 shell, so none of this auth code is live yet.
Hash format is `pbkdf2$<iters>$<salt>$<hash>` — self-
describing, so raising the iteration count later (e.g. on
Workers Paid) is a one-line change with transparent rehash
on next login, no reset and no migration.
Verified against `wrangler dev`: 13-step auth flow (401 →
signup → me → logout → 401), uniform 401 for both bad
password and unknown user, case-insensitive usernames, 15
categories + 3 settings seeded per user, a NEW sid minted
per login, cookie HttpOnly+Secure+SameSite=Lax, all 4
security headers present, signup 403 under the production
config, and a 500 (not a forgeable session) when
SESSION_SECRET is absent.
Owner decisions recorded 2026-07-27: M4 = Workers Free;
M6 = start with "Welcome@daybook28", rotate later to a 24+
char generated password. The KDF/entropy coupling was
raised and the owner accepted it knowingly — the residual
risk is the window before rotation, on a public URL.
Phase 4 (Route port) — IN PROGRESS.
• Increment 1 MERGED (PR #69): settings.ts (2 .prepare())
  + tasks.ts (6).
• Increment 2 MERGED (PR #71): groups.ts (31) + async
  port of lib/sharing.ts.
• Increment 3 MERGED (PR #72): settlements.ts (21) WITH
  its Phase 5 atomicity work.
• Increment 4 MERGED (PR #73): wallet.ts PART A
  (accounts, balances, account shares, categories, tags).
• Increment 5 IN REVIEW: PR
  feat/workers-routes-wallet-budgets — wallet.ts PART C
  (budgets, recurring transactions, goals). The recurring
  processor is the plan's "medium" atomicity site
  (wallet.ts:1313) and converts safely to ONE batch()
  because its loop performs NO reads — every write derives
  from the rule row already in hand plus advanceDate(),
  which is pure. /recurring-transactions/:id/post also
  batches insert+advance: doing one without the other
  yields a duplicate or a skipped occurrence.
wallet.ts is split three ways by concern, not line count:
  A accounts/shares/categories/tags — NO db.transaction()
  B transactions — list/export/import/CRUD/link-transfer/
    splits; 4 db.transaction() sites AND the S2 import N+1
  C budgets/recurring/goals — 1 db.transaction()
• Increment 6: wallet.ts PART B (transactions) — list,
  export, check-duplicates, import, CRUD, link-transfer,
  splits, bulk splits, splits/status.
PHASE 4 COMPLETE — all 156 .prepare() sites ported.
PHASE 5 COMPLETE with it: every db.transaction() site is
converted. CSV import, link-transfer, replace-splits, bulk
splits and recurring-process are batch(); settlements:104
got compare-and-swap + compensating rollback (PR #72).
THREE N+1 PATTERNS FIXED (S2 found the first; the other
two were found by reading the loops during the port):
  1. import: canWriteAccount/ownsAllRefs per row →
     writableAccountIds()/ownedIdSet() read once. 300 rows
     now import in ONE batch.
  2. bulk splits: coGroupUserIds() per transaction → once
     (owner-only check already proved the set is identical).
  3. bulk splits: hasSettledShare() per transaction → one
     set-based query for the whole batch.
KNOWN PRE-EXISTING BUG (not introduced by the port, NOT
fixed here): ISO date validation accepts impossible
calendar dates. `Date.parse('2026-04-31')` does not return
NaN — V8 rolls the day over — so Feb 30 / Apr 31 pass both
transactionInputError (server wallet.ts:356) and
isoDateError (:1206). Flagged for a separate fix in BOTH
backends; only an out-of-range MONTH is currently caught.
Part A note: GET /accounts/:id/balance ran FOUR separate
sum queries via a named-@id helper; now one query with
four conditional sums (same arithmetic, 1 round trip
instead of 4). Verified equal to the batched
/accounts/balances route, which is the reason that
equivalence is asserted explicitly in the test.
SETTLEMENT CONCURRENCY DESIGN (the plan's "hard" site):
POST /settlements hoists every read, computes the whole
write set in JS, then issues ONE batch() whose share
updates are compare-and-swap guarded on the exact
settled_amount that was read
(WHERE id=? AND settled_at IS NULL AND settled_amount=?).
batch() is atomic but a CAS matching 0 rows is a
SUCCESSFUL statement, so meta.changes is inspected
afterwards; if any guard lost a race the settlement,
ledger legs and split lines are removed by a compensating
batch (restoring only shares still holding OUR value) and
the caller gets 409. Verified by fault injection.
TIMEZONE FIX (worker/lib.ts): the Worker clock is always
UTC, so porting todayStr() literally would stamp
server-dated rows with YESTERDAY between 00:00-08:00 MYT.
todayStr() is now pinned to Asia/Kuala_Lumpur via Intl,
preserving B-11's stated intent. businessDateOf() converts
a stored UTC datetime('now') for comparison — this also
fixes a PRE-EXISTING Mac bug where the same-day undo check
compared a UTC date against a local date and silently
refused valid undos for the first 8 hours of each day.
Two atomicity fixes landed early in increment 2 because
the bug was created by the port itself: POST /groups and
POST /invites/:id/accept each ran two independent
statements server-side; a failure between them left a
group with no owner (unreachable AND undeletable, since
every guard is isGroupOwner) or an accepted invite with
no membership (user stranded, invite gone from inbox).
Both are now batch(). worker/lib.ts newId() exists
because batch() cannot feed one statement's RETURNING
into the next.
Verified: 26-step groups suite against `wrangler dev` —
CRUD, owner-vs-member permissions, full invite lifecycle
(send/self/dup/unknown/outsider/accept), last-owner
guard, balances, co-member visibility, and that the
literal /groups/members route is not captured by
/groups/:id. Outsiders get 404 (not 403) so group
existence is not leaked.
Protected routes hang off a dedicated `protectedApi`
sub-app with requireAuth applied to '*', rather than
relying on registration order the way server/index.ts:66
does — mounting a router one line too high would otherwise
leave it unauthenticated silently.
Verified against `wrangler dev`: 15-step CRUD pass
(unauth 401, seeded settings, upsert, task create/patch/
delete, FK cascade to children, 404 on unknown id,
sort_order ordering, templates) PLUS a 6-step cross-user
isolation check — a second user sees [], gets 404 on
PATCH of another's task, and cannot delete it; per-user
settings stay separate.
Note: DELETE returns 204 even when it matches 0 rows
(user_id scoping means another user's delete is a no-op).
Identical to the Express behaviour — preserved, not a
regression.

── Previous phase ──
CSV transfer linking — MERGED (PRs #60, #61).

---

## Phase 6 — the CI/CD unblock

The owner added CLOUDFLARE_API_TOKEN and
CLOUDFLARE_ACCOUNT_ID on 2026-07-31, so release.yml runs
end to end. v2.2.0 was the first tag-triggered deploy —
no manual steps. Note a local `wrangler … --remote` still
fails from the owner's Mac (account not authorised); only
CI holds a token, so verify remote D1 from the release
log rather than the command line.
(docs/option-2-workers-d1-plan.md). Owner chose Option 2 on
2026-07-27 over the spike doc's ambivalent §6.

---

## E2E: putting the suite on one clock

The suite failed on a SCHEDULE rather than on a change: for
the eight hours a day when the UTC date and the Malaysian
date differ, rows the Worker stamped "today" (todayStr(),
pinned to Asia/Kuala_Lumpur per B-11) landed outside the
month the client was showing. Specs were split between two
incompatible conventions — toISOString() gives the UTC
date, local date parts give the host's — so there was NO
timezone at which the whole suite was green inside that
window; fixing one convention broke the other.
playwright.config.ts now pins the browser AND the test
process to the business timezone (the TZ assignment must
precede the imports — Node caches the zone on first use),
with businessToday()/businessDatePlus() in e2e/helpers.ts.
Specs 03 and 37 were patched for this one at a time before;
this addresses the cause. Also de-bombed 32-wallet-error-
toasts, which hardcoded nextDueDate '2026-08-01' and began
failing when that day arrived.

---

## Phase 5 — CSV transfer linking (PRs #60, #61)

(CSV):          CSV transfer linking — IMPLEMENTED, IN REVIEW (2026-07-26).
Built as the planned 2-PR sequence:
• PR #60 feat/csv-transfer-import (Items 1+3): review-step
  rows can import as Transfer→destination account; edit-form
  hint on imported rows. New spec 49; also fixed
  TZ-dependent month-bound assertions in spec 03 (failed on
  UTC+ machines, pre-existing).
• PR #61 feat/transfer-linking (Items 4+2, STACKED on #60 —
  merge #60 first): migration 0008 absorbed_import_hashes,
  check-duplicates matches absorbed hashes, POST
  /transactions/:id/link-transfer merge endpoint,
  LinkTransferDialog picker (±5 days, ranked by date
  proximity), help-guide "Credit Cards & Transfers" section.
  New specs 50 + 51.
Verified per PR: tsc, typecheck:server, lint clean; affected
e2e (02, 03, 04, 42, 48, 49, 50, 51) — 114/114.

---

## Phases 4, 5b, 5c — home network, sharing, wallet UX

(history):      Phase 4 (home network backend) shipped v1.0.
Phase 5b (household sharing) shipped v1.0.1.
Phase 5b extension: transaction quick-share (PR #27) MERGED
2026-07-05 — one-click single-recipient share alongside the
split flow, plus q free-text filter plumbing and filtered
server export route.
Phase 5c (wallet UX improvements) — COMPLETE (v1.0.1).
Implementation sequenced into 5 wave PRs: see
docs/phase-5c-implementation-plan.md (approved 2026-07-05).
Backlog detail: docs/phase-5c-wallet-ux.md (statuses updated:
B1 partial, B5 done, C4 partial, C7 obsolete).
Wave 1 (B1 search input UI, B2 save-&-add-another, C4
server-side filtered export, B12 caption reword) MERGED
(PR #29, 2026-07-18).
Wave 2 (B3 modal max-height/scroll, B4 accessible
rows/cards, B6 always-visible card actions, B7 responsive
dashboard grids, B11 ≥40px touch targets, C11 sidebar
scroll region) MERGED (PR #30, 2026-07-18).
Wave 3 (C1 batched GET /api/accounts/balances + client
switch off the per-account fan-out, C2 transaction/budget/
goal input validation with 400 {error}, C12 Express error
middleware + request logging, C8 current-month-bounded
budgets load) MERGED (PR #31, 2026-07-18).
Wave 4 (B8 "Total Net Worth" label unification, B9
`positive` money-colour token aliasing the brand green,
B10 type badge + category chip on recurring rule cards,
C10 formatAxisMYR axis helper — plain ringgit <10k,
C13 role="img" aria data summaries on Dashboard/Reports
charts + explicit "+" glyph on positive Net figures)
MERGED (PR #32, 2026-07-18). No new spec file: new blocks
in 05-wallet-dashboard + 14-wallet-recurring; label/class
assertions updated in specs 03, 25-splits,
25-wallet-intuitiveness, 27 (specs 10/26/31 assert the
Accounts page and needed no change).
Verified: tsc, typecheck:server, lint clean; affected e2e
specs (03, 05, 10, 14, 25-splits, 25-intuitiveness, 26,
27, 31, 06-uat) all pass — 125/125.
Wave 5 (C5 useCrudModal + ConfirmDeleteModal adopted in
Budgets/Goals/Recurring, C3 error toasts surfacing C12's
{error} message via a fixed api.ts that now parses the
{error} body, C6 dead-code sweep in useWallet — wired
getMonthlySpending into BudgetsPage, deleted the unused
processRecurringTransactions wrapper) MERGED (PR #33,
2026-07-19). New spec e2e/32-wallet-error-toasts (4/4).
Verified: tsc, typecheck:server, lint clean; affected e2e
specs (02, 03, 13, 14, 16, 28, 29, 32) all pass — 126/126.
This was the final wave of the Phase 5c plan — all 5 waves
(PRs #29–#33) are now merged. Phase 5c is COMPLETE.

### Phase 4 summary

  - Session-based multi-user auth (bcrypt + express-session)
  - Per-user data isolation (all queries scoped by user_id)
  - REST API for all entities (tasks, accounts, transactions, settings, etc.)
  - Capistrano-style releases with versioned artifacts + rollback
  - File-based migrations (additive only, applied in order)
  - 22 merged PRs from initial Phase 4 scaffold to Phase 5b completion

### Phase 5b detail

Last completed: - CSV transfer import + twin-linking implemented (PRs #60 + #61,
  awaiting owner merge — #61 is stacked on #60).
- Phase 5b fully implemented and merged (PR #18 + follow-ups):
    • Household groups: users can create groups and invite members
      by username with optional role assignment.
    • Shared accounts: accounts visible to group members with
      optional write access per group (read-only by default).
    • Transaction splits: divide expenses across group members with
      automatic share tracking, proportional rescaling on amount edits,
      and optional notes per share.
    • Settlements: create real ledger transfers to settle balances
      between two users, with undo capability via settlement history.
    • Data isolation: non-members cannot see shared accounts or splits;
      members have visibility scoped to their group memberships only.
    • Wave 1 & 2 fixes: accessibility improvements, UI consistency,
      corner cases (over-settlement, balance precision, etc.).
    • e2e: 30 Playwright test files covering all sharing features
      (households, shared accounts, splits, settlements); all pass.
    • Migrations: 0003_sharing.sql + 0004_settlement_share_lines.sql
      applied; schema_migrations table tracks applied files.
    • Verified: client build green, typecheck:server green, 30/30 e2e pass.

### Deferred items cleared, 2026-07-25 (CD-05⁺, U-16, CD-20)

docs/deferred-items-plan.md are now DONE on branch
claude/deferred-items-cd-05-u-16-cd-20-* (one PR):
• CD-05⁺ — internal Split identifier rename. Migration
  0007_rename_transaction_shares.sql renames the tables
  transaction_shares→transaction_splits and
  settlement_share_lines→settlement_split_lines (lossless
  ALTER TABLE … RENAME TO). Routes → /transactions/:id/split,
  /:id/splits, /splits, /splits/status; field hasShares→
  hasSplits; dialogs ShareDialog→SplitDialog,
  BulkShareDialog→BulkSplitDialog (+ testids). account_shares
  intentionally untouched.
• U-16 — first-run onboarding, option (a): dismissible
  WelcomeCard on each empty module (Tasks/Wallet/Sharing),
  gated on per-user onboarding_dismissed_* settings loaded at
  boot. New spec 47-onboarding.
• CD-20 — Tasks bulk-select/bulk-delete parity: "Select" mode
  with per-node checkboxes (parent implies subtree) + bulk
  delete via undo-toast (snapshot restore). New spec
  46-task-bulk-select.
Verified: client tsc, typecheck:server, lint all clean;
affected e2e (01, 27, 33, 34, 35, 36, 39, 40, 41, 42, 43,
46, 47) all pass — 92/92.

---

## Superseded: the Phase 6 options analysis

Kept because the rejected options and *why* they were rejected is the part that
saves the next person the work. Owner chose Option 2 (Cloudflare Workers + D1)
on 2026-07-27.

Phase 6 (online access): PLANNED 2026-07-26 —
docs/phase-6-online-plan.md. Owner constraints: 2 active
users, target $0/mo, and ANY-DEVICE access required (this
last one rules out a private Tailscale tailnet, so all
surviving options are publicly reachable and the full
blocker list is mandatory under every one).
Shortlist of 3, prices verified against vendor pages:
• Opt 1 Tailscale Funnel + Caddy basic-auth — $0/mo,
  ~8-10h, no app rewrite, stays on the Mac.
• Opt 2 CF Pages+Workers+D1 — $0/mo, no domain, no Mac
  dependency, BUT ~3-5 WEEKS: measured 156 .prepare()
  sites, 2,905 server lines, 51 e2e specs — and D1 has NO
  interactive transactions, while the code uses
  db.transaction() in 11 places (6 wallet, 3 settlements),
  i.e. exactly the money paths. That is a redesign, not a
  port, and is the single biggest cost driver.
• Opt 3 CF Tunnel + domain — ~$1/mo (~$12/yr, domain is
  the only line item), ~8-10h, no app rewrite, and
  Cloudflare Access gives per-user email OTP + revocation
  and rejects floods at the edge rather than after they
  cross the home connection.
RECOMMENDED: Opt 3 (Opt 1 is the hard-$0 fallback; same
effort, ~$12/yr and a real identity gate is the
difference). Opt 2 is the right destination if Mac uptime
ever becomes the actual complaint — nothing done now is
wasted.
DROPPED: Fly.io (~$5-7/mo; Opt 2 gets independence for $0),
Render (free tier has no persistent disk), AWS (free tier
now credit-based, account CLOSES at 6 months), Azure (free
12 months only) — and both big clouds' always-free tiers
are serverless with network-attached storage, which SQLite
must not use (WAL + NFS/SMB locking = corruption risk).
Supabase+Vercel (~$25/mo, largest rewrite; Vercel cannot
host the current server at all) — recommend striking from
§14.
Chief blocker under all paths: the hardcoded
`secure: false` session cookie, which MUST ship together
with app.set('trust proxy', N) or login silently sets no
cookie at all. N=1 for Opt 3, N=2 for Opt 1 (tailscaled +
Caddy). Also found: auth.ts:50 returns 409 "username
already taken" = user-enumeration oracle, closed by
disabling signup.
Deps: helmet + express-rate-limit approved by owner (add to
§4 when PR1 lands).
Sequencing: PR1 hardening + PR2 offsite backups to
Cloudflare R2 (10GB free, zero egress; fixes backups living
on the same disk as the DB) are both path-independent and
unblocked → PR3 access path. PR2 is the highest-value item.
