import type { Env } from '../types.ts'

// docs/ai-bulk-categorize-feature.md §4. First outbound third-party call from
// the Worker — plain fetch rather than @anthropic-ai/sdk, which targets Node
// and has never been proven to bundle for the Workers runtime.

export interface CategorySuggestion {
  merchant: string
  category: string
}

export interface MerchantResolution {
  guess: string
  name: string
}

export interface ComposerParseResult {
  merchant?: string
  amount?: number
  type?: 'income' | 'expense' | 'transfer'
  account?: string // exact account name from the list given, or omitted if unsure
  category?: string // exact category name from the list given, or omitted if unsure
  date?: string // YYYY-MM-DD, only if the text implies a specific date — omit for "today"/unspecified
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
// Classification, not reasoning — cheapest current model (§5 of the doc).
const MODEL = 'claude-haiku-4-5'
// ~20 output tokens per answer, so 2000 covers a batch comfortably. Raising it
// is the wrong lever: one call is all-or-nothing, and a truncated response
// loses EVERY answer in it, not just the ones past the limit. The caller
// chunks instead (AI_CHUNK_SIZE in worker/routes/wallet.ts) so a truncation
// costs one batch rather than the whole request.
const MAX_TOKENS = 2000
// The composer parses ONE free-text line into ONE small object — not a batch
// like MAX_TOKENS above, whose size exists to cover many merchants in one
// call. 150 comfortably covers {merchant, amount, type, account, category,
// date} with no risk of the truncation trap MAX_TOKENS's comment describes.
const COMPOSER_MAX_TOKENS = 150

const SYSTEM_PROMPT = `You categorise bank transactions for a personal finance app used in Malaysia.
For each merchant string, choose exactly one category from the list provided.
Return JSON: {"suggestions":[{"merchant":"<verbatim input>","category":"<exact name from the list>"}]}
Omit any merchant you are not reasonably confident about — omission is correct and expected; a wrong category is worse than none.
Use only the category names given. Do not invent categories.
Reply with the raw JSON object and nothing else — no markdown code fence, no commentary before or after it.`

function buildUserMessage(categoryNames: string[], merchants: string[]): string {
  return `Categories: ${categoryNames.join(', ')}\nMerchants:\n${merchants.map((m) => `- ${m}`).join('\n')}`
}

const MERCHANT_SYSTEM_PROMPT = `You clean up bank transaction narratives for a personal finance app used in Malaysia.
For each raw bank narrative, return the merchant's clean display name in Title Case (e.g. 'Grab Food', not 'GRABFOOD' or 'grab food').
Strip card/account numbers, reference codes, dates, country/city codes, and payment-rail prefixes (POS, DUITNOW, IBG, FPX, etc).
If the raw text gives no better signal than the guess already provided, return the guess unchanged.
Return JSON: {"resolutions":[{"guess":"<verbatim guess input>","name":"<clean title-case name>"}]}
Reply with raw JSON only — no markdown fence, no commentary.`

function buildMerchantUserMessage(items: Array<{ raw: string; guess: string }>): string {
  return `Items:\n${items.map((item) => `- guess: "${item.guess}" | raw: "${item.raw}"`).join('\n')}`
}

const COMPOSER_SYSTEM_PROMPT = `You parse free-text transaction entries for a personal finance app used in Malaysia.
Given one line of free text describing a transaction, extract as much of the following as you are reasonably confident about:
- merchant: who the money went to/came from
- amount: the numeric amount (no currency symbol)
- type: one of "income", "expense", "transfer" — default to "expense" if the text gives no signal either way
- account: the account name, chosen ONLY from the exact account names given below — never invent one
- category: the category name, chosen ONLY from the exact category names given below — never invent one
- date: a YYYY-MM-DD date, ONLY if the text implies a specific date (e.g. "yesterday", "last friday") — omit this field entirely for "today" or when unspecified
Return JSON: {"merchant":"...","amount":0,"type":"expense","account":"...","category":"...","date":"YYYY-MM-DD"}
Omit any field you are not reasonably confident about — omission is correct and expected; a wrong guess is worse than none.
Reply with the raw JSON object and nothing else — no markdown code fence, no commentary before or after it.`

function buildComposerUserMessage(text: string, accountNames: string[], categoryNames: string[]): string {
  return `Text: "${text}"\nAccounts: ${accountNames.join(', ')}\nCategories: ${categoryNames.join(', ')}`
}

async function fetchClaudeText(apiKey: string, categoryNames: string[], merchants: string[]): Promise<string> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(categoryNames, merchants) }],
    }),
  })
  if (!res.ok) {
    // Anthropic's own message is the only thing that distinguishes an invalid
    // key from an exhausted credit balance from a bad model id — all of which
    // are the user's to fix and none of which the caller can guess. The body
    // is `{error: {type, message}}`; it never echoes the API key back.
    const detail = await res
      .text()
      .then((body) => {
        const parsed: unknown = JSON.parse(body)
        const message =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as { error?: { message?: unknown } }).error?.message
            : undefined
        return typeof message === 'string' ? message : body.slice(0, 200)
      })
      .catch(() => '')
    throw new Error(`Anthropic API responded ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = data.content?.find((block) => block.type === 'text')?.text
  if (!text) throw new Error('no text content in Anthropic response')
  return text
}

async function fetchClaudeMerchantText(apiKey: string, items: Array<{ raw: string; guess: string }>): Promise<string> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: MERCHANT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildMerchantUserMessage(items) }],
    }),
  })
  if (!res.ok) {
    // Same rationale as fetchClaudeText: distinguishing an invalid key from an
    // exhausted balance from a bad model id is on Anthropic's error body, and
    // the caller can't guess which one it is otherwise.
    const detail = await res
      .text()
      .then((body) => {
        const parsed: unknown = JSON.parse(body)
        const message =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as { error?: { message?: unknown } }).error?.message
            : undefined
        return typeof message === 'string' ? message : body.slice(0, 200)
      })
      .catch(() => '')
    throw new Error(`Anthropic API responded ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = data.content?.find((block) => block.type === 'text')?.text
  if (!text) throw new Error('no text content in Anthropic response')
  return text
}

async function fetchClaudeComposerText(
  apiKey: string,
  text: string,
  accountNames: string[],
  categoryNames: string[],
): Promise<string> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: COMPOSER_MAX_TOKENS,
      temperature: 0,
      system: COMPOSER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildComposerUserMessage(text, accountNames, categoryNames) }],
    }),
  })
  if (!res.ok) {
    // Same rationale as fetchClaudeText: distinguishing an invalid key from an
    // exhausted balance from a bad model id is on Anthropic's error body, and
    // the caller can't guess which one it is otherwise.
    const detail = await res
      .text()
      .then((body) => {
        const parsed: unknown = JSON.parse(body)
        const message =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as { error?: { message?: unknown } }).error?.message
            : undefined
        return typeof message === 'string' ? message : body.slice(0, 200)
      })
      .catch(() => '')
    throw new Error(`Anthropic API responded ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const resultText = data.content?.find((block) => block.type === 'text')?.text
  if (!resultText) throw new Error('no text content in Anthropic response')
  return resultText
}

// Default mock-response key, used by suggestCategoriesWithAI. Keep in sync
// with worker/routes/test.ts's default.
const TEST_MOCK_KEY = '_test_ai_mock_response'
// Separate key for resolveMerchantsWithAI so a spec that needs to mock both
// AI features in the same test run (e.g. category suggestion AND merchant
// resolution) doesn't have one clobber the other. In practice each e2e spec
// only ever exercises one AI feature, so this separation is precautionary.
const TEST_MOCK_KEY_MERCHANTS = '_test_ai_mock_response_merchants'
// Separate key again for parseComposerWithAI, same rationale as
// TEST_MOCK_KEY_MERCHANTS above.
const TEST_MOCK_KEY_COMPOSER = '_test_ai_mock_response_composer'

// e2e cannot intercept a Worker-to-Anthropic fetch the way Playwright
// intercepts browser requests — `wrangler dev` makes that call from a
// separate process with no route the test can see. DAYBOOK_TEST gates a
// same-shaped substitute: a canned response body stashed in `settings` by
// POST /test/mock-ai-response (worker/routes/test.ts), read here instead of
// calling the network. Production never sets DAYBOOK_TEST, so this branch is
// unreachable there.
async function fetchTestText(env: Env, userId: string, key: string = TEST_MOCK_KEY): Promise<string> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE user_id = ? AND key = ?`)
    .bind(userId, key)
    .first<{ value: string }>()
  if (!row?.value) throw new Error('no AI mock configured for this test user')
  return row.value
}

/**
 * Pull the JSON object out of a reply that may not be bare JSON.
 *
 * THIS IS THE BUG THAT BROKE EVERY REAL CALL. Claude answers this prompt
 * correctly but likes to wrap the answer in a ```json fence, and JSON.parse
 * rejects the leading backtick outright — so a perfectly good set of
 * suggestions was thrown away on every chunk. The system prompt now asks for
 * bare JSON, but a prompt is a request, not a guarantee: a model is free to
 * add a fence or a sentence of preamble on any call, and this must not be one
 * bad day away from breaking again.
 *
 * Order matters — bare JSON is tried first so a well-formed reply never goes
 * near the salvage paths.
 */
function jsonCandidates(raw: string): string[] {
  const trimmed = raw.trim()
  const candidates = [trimmed]

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  if (fenced) candidates.push(fenced[1].trim())

  // Last resort for prose either side of the object ("Here are the results: {…}").
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1))

  return candidates
}

function parseSuggestions(text: string): CategorySuggestion[] {
  let parsed: unknown
  let lastError: unknown
  for (const candidate of jsonCandidates(text)) {
    try {
      parsed = JSON.parse(candidate)
      lastError = undefined
      break
    } catch (err) {
      lastError = err
    }
  }
  if (lastError !== undefined) throw lastError
  const suggestions =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { suggestions?: unknown }).suggestions
      : undefined
  if (!Array.isArray(suggestions)) throw new Error('malformed suggestions shape')

  const result: CategorySuggestion[] = []
  for (const item of suggestions) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { merchant?: unknown }).merchant === 'string' &&
      typeof (item as { category?: unknown }).category === 'string'
    ) {
      const { merchant, category } = item as CategorySuggestion
      result.push({ merchant, category })
    }
  }
  return result
}

/**
 * Ask Claude to categorise ONE batch of merchant strings against the caller's
 * own category names.
 *
 * THROWS on any failure — network, non-2xx, malformed JSON, unexpected shape.
 * That is deliberate and is the opposite of the original contract: the caller
 * batches, and it needs to tell a failed batch apart from a batch Claude
 * simply had no confident answer for, so it can report "suggested 340 of 400"
 * instead of leaving the user looking at a button that did nothing.
 */
export async function suggestCategoriesWithAI(
  env: Env,
  userId: string,
  apiKey: string,
  categoryNames: string[],
  merchants: string[],
): Promise<CategorySuggestion[]> {
  const text =
    env.DAYBOOK_TEST === '1'
      ? await fetchTestText(env, userId)
      : await fetchClaudeText(apiKey, categoryNames, merchants)
  return parseSuggestions(text)
}

function parseMerchantResolutions(text: string): MerchantResolution[] {
  let parsed: unknown
  let lastError: unknown
  for (const candidate of jsonCandidates(text)) {
    try {
      parsed = JSON.parse(candidate)
      lastError = undefined
      break
    } catch (err) {
      lastError = err
    }
  }
  if (lastError !== undefined) throw lastError
  const resolutions =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { resolutions?: unknown }).resolutions
      : undefined
  if (!Array.isArray(resolutions)) throw new Error('malformed resolutions shape')

  const result: MerchantResolution[] = []
  for (const item of resolutions) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { guess?: unknown }).guess === 'string' &&
      typeof (item as { name?: unknown }).name === 'string'
    ) {
      const { guess, name } = item as MerchantResolution
      result.push({ guess, name })
    }
  }
  return result
}

/**
 * Ask Claude to clean up ONE batch of raw bank narratives into display-ready
 * merchant names, keyed back to the caller's rule-based `guess` for each.
 *
 * THROWS on any failure — network, non-2xx, malformed JSON, unexpected shape.
 * Same contract as suggestCategoriesWithAI: the caller is responsible for
 * catching per-batch failures (e.g. via Promise.allSettled) and reporting
 * partial results rather than this function swallowing anything.
 */
export async function resolveMerchantsWithAI(
  env: Env,
  userId: string,
  apiKey: string,
  items: Array<{ raw: string; guess: string }>,
): Promise<MerchantResolution[]> {
  const text =
    env.DAYBOOK_TEST === '1'
      ? await fetchTestText(env, userId, TEST_MOCK_KEY_MERCHANTS)
      : await fetchClaudeMerchantText(apiKey, items)
  return parseMerchantResolutions(text)
}

/**
 * Salvage a ComposerParseResult from Claude's reply text.
 *
 * THROWS only when the JSON itself can't be recovered by any jsonCandidates()
 * candidate (same contract as parseSuggestions/parseMerchantResolutions). A
 * field that is missing or wrong-typed is dropped rather than treated as an
 * error — Claude omitting a field it isn't confident about is the expected,
 * correct case per the system prompt, not a failure.
 */
function parseComposerResult(text: string): ComposerParseResult {
  let parsed: unknown
  let lastError: unknown
  for (const candidate of jsonCandidates(text)) {
    try {
      parsed = JSON.parse(candidate)
      lastError = undefined
      break
    } catch (err) {
      lastError = err
    }
  }
  if (lastError !== undefined) throw lastError

  const obj = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const result: ComposerParseResult = {}

  if (typeof obj.merchant === 'string') result.merchant = obj.merchant
  if (typeof obj.amount === 'number' && Number.isFinite(obj.amount)) result.amount = obj.amount
  if (obj.type === 'income' || obj.type === 'expense' || obj.type === 'transfer') result.type = obj.type
  if (typeof obj.account === 'string') result.account = obj.account
  if (typeof obj.category === 'string') result.category = obj.category
  if (typeof obj.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.date)) result.date = obj.date

  return result
}

/**
 * Ask Claude to parse ONE free-text composer entry into a partial transaction
 * draft, choosing account/category only from the caller's own names.
 *
 * THROWS on any failure — network, non-2xx, malformed JSON. Same contract as
 * suggestCategoriesWithAI/resolveMerchantsWithAI: the caller (the
 * parse-composer-ai route) is responsible for turning a throw into a real
 * error response, never a silent empty draft (CLAUDE.md rule 13).
 */
export async function parseComposerWithAI(
  env: Env,
  userId: string,
  apiKey: string,
  text: string,
  accountNames: string[],
  categoryNames: string[],
): Promise<ComposerParseResult> {
  const resultText =
    env.DAYBOOK_TEST === '1'
      ? await fetchTestText(env, userId, TEST_MOCK_KEY_COMPOSER)
      : await fetchClaudeComposerText(apiKey, text, accountNames, categoryNames)
  return parseComposerResult(resultText)
}
