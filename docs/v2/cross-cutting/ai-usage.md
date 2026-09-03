# AI usage register

**Standing rule (owner, 2026-08-21):** the Claude API may be used, but

1. **Haiku only.** Every call uses `claude-haiku-4-5`. No Sonnet, anywhere —
   this overrides CLAUDE.md §9.3's Haiku+Sonnet routing. A feature that would
   need Sonnet either runs on Haiku or is not built.
2. **Warn before wiring.** No new outbound Claude call is added to the app
   without the owner's explicit per-touchpoint approval first. This file is the
   warning surface: every candidate call is listed here with a status, and
   nothing moves to "approved" without a yes in chat.
3. **Use it wisely.** Rules-first, batched, rate-limited, triggered by an
   explicit user action — never on a keystroke, never on a page load, never in a
   loop. Details in §3.

This register is the single source of truth for where money is spent on the API.
Keep it current: a call that exists in code and not here is a rule-2 violation.

---

## 1. What already exists (pre-v2, for reference)

Shipped in PR #112, `worker/lib/anthropic.ts`, already Haiku, already governed:

| Call | Trigger | Model | Batching | Rate limit |
|---|---|---|---|---|
| `suggestCategoriesAI` — categorise merchants the rule pass missed | "Ask AI" button in the bulk-edit dialog | `claude-haiku-4-5` | one call per chunk of merchants (`AI_CHUNK_SIZE`) | per-user hourly (`ai_rate_limit_*` in settings) |
| `resolveMerchantsAI` — clean bank narratives into display names | merchant canonicalisation | `claude-haiku-4-5` | chunked | same |

These are the **template**. Every v2 call below reuses this shape: plain `fetch`
(not the SDK), `omit when unsure`, raw-JSON-only prompt, chunked so a truncation
costs one batch not the whole request, key read from `settings` server-side and
never sent to the browser.

---

## 2. The register — every v2 candidate

Status legend: **APPROVED** (owner said yes), **PROPOSED** (needs a yes before
wiring), **RULES-ONLY** (deliberately no API — listed so nobody adds one).

### 2.1 APPROVED

| # | Touchpoint | Release | Model | How the call is bounded |
|---|---|---|---|---|
| A1 | **Wallet composer** — `coffee 4.20 cash` → a transaction draft | R7 | Haiku | Rules parser runs first; Claude is the **fallback only when rules don't match**. One call per **submit**, never per keystroke. ~150 output tokens. Result is a **preview the user confirms**, never a silent write. |
| A2 | **Tasks composer** — `pay rent tomorrow 9am #household !high` → a task draft | R5/R10 | Haiku | Same shape as A1. `#list !priority @assignee` are rule-parsed; only the free-text remainder can reach Claude. |
| A3 | **Day composer** — dual-target: the input becomes a task *or* a transaction | R15 | Haiku | Same shape. The extra job is classify-which-module, still one call, still preview-confirmed. Hardest prompt; ship after A1/A2 so it reuses their parser. |

**Why these need the API at all:** the composer's entire value proposition over a
form is that free text works. Rules cover the common grammar (`4.20 cash`,
`tomorrow 9am`); Claude covers the long tail (`lunch w/ Sara split 3 ways`,
`dentist sometime next week`). With no API key the composer still works — it
falls back to the structured form, so the feature degrades, never breaks.

### 2.2 PROPOSED — needs an explicit yes before building

| # | Touchpoint | Release | Model | Note |
|---|---|---|---|---|
| P1 | **CSV per-row auto-categorisation on import** (§9.3 step 6) — suggest a category for each non-duplicate imported row | R7/R8 | Haiku | Reuses `suggestCategoriesAI` exactly. Batched: **one call for the whole import**, not one per row. Recommended, because the machinery already exists and import is the highest-volume categorisation moment — but it is a new *automatic* call at import time, so it needs your yes. Alternative: leave it behind the existing manual "Ask AI" button. |

### 2.3 RULES-ONLY — deliberately no API (do not add one)

Every insight/suggestion card in the plan is a **deterministic rule engine**, not
an AI call. They read your own history and apply arithmetic. Listing them so no
future release quietly turns one into an API call without hitting rule 2:

| Card | Release | Why it stays rules-only |
|---|---|---|
| Budgets **Suggestions** (reallocate / right-size / create-missing) | R8 | pure arithmetic over budget-vs-actual; deterministic and testable |
| Tasks **Worth knowing** (morning vs evening completion, moved-N-times) | R11 | counts and ratios over task history |
| Recurring **Worth a look** (price rise, dormant sub, same-day collision) | R9 | diffs over `recurring_transactions` |
| Reports **What changed** (vs 12-month average) | R9 | arithmetic |
| Day **Against your usual** | R16 | same-weekday averages |
| Trips **findings** (estimate accuracy, spend-before-start) | R12+ | variance over `trip_items` vs actuals |

These are more valuable *because* they are deterministic: the number is always
right, always the same, always free, and always explainable. An LLM would make
them slower, occasionally wrong, and impossible to unit-test.

### 2.4 OUT OF SCOPE — §9.3 features not in the v2 plan

Daily briefing, "ask about your finances/tasks" chat, financial insights. CLAUDE.md
§9.3 routes these to **Sonnet**, which rule 1 forbids. They are not in R1–R17. If
ever revisited they run on Haiku and come back through this register for approval.

---

## 3. "Use it wisely" — the guardrails, concretely

Every approved call must satisfy all of these, or it is not wired:

1. **Rules first.** The API is a fallback, not the front door. Measure the
   rules' hit rate; if rules catch 90% of composer inputs, 90% of submits cost
   nothing.
2. **Explicit trigger only.** A call fires on submit or on a button, never on
   keystroke, focus, page load, or a poll.
3. **Batch.** CSV categorisation is one call for the import, not one per row —
   the existing `AI_CHUNK_SIZE` chunking is the model.
4. **Rate-limited.** The per-user hourly cap (`ai_rate_limit_*`) already gates
   every key-spending route; new routes join it. One unit per request.
5. **Bounded output.** `max_tokens` sized to the job (composer ~150, batch
   categorise ~2000), and the prompt says *omit when unsure* so a wrong answer
   is never forced.
6. **Preview, never silent write.** Composer output is a draft the user confirms.
   A natural-language field that silently commits a wrong parse is worse than a
   form — the failure this whole approach has to avoid.
7. **Works with no key.** Every AI entry point degrades to its non-AI path when
   no `anthropic_api_key` is set. The app is fully usable with the API switched
   off — CLAUDE.md §9.3's founding constraint.
8. **Testable offline.** e2e cannot intercept a Worker→Anthropic fetch (CLAUDE.md
   §16 trap 6). Reuse the `DAYBOOK_TEST` + `settings`-row canned-response pattern
   from `worker/lib/anthropic.ts`; production never sets `DAYBOOK_TEST`.

---

## 4. Approval log

| Date | Item | Ruling |
|---|---|---|
| 2026-08-21 | D-11 composer parsing | Claude approved, **Haiku only**, rules-first, warn-before-wiring |
| 2026-08-21 | A1 / A2 / A3 composer calls | approved in principle as part of D-11; each still confirmed here before its release wires it |
| 2026-09-02 | A1 wired | confirmed in chat at R7-composer kickoff — proceed exactly as scoped above |
| — | P1 CSV auto-categorise | **pending owner yes** |
