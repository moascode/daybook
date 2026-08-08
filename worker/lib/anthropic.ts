import type { Env } from '../types.ts'

// docs/ai-bulk-categorize-feature.md §4. First outbound third-party call from
// the Worker — plain fetch rather than @anthropic-ai/sdk, which targets Node
// and has never been proven to bundle for the Workers runtime.

export interface CategorySuggestion {
  merchant: string
  category: string
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

const SYSTEM_PROMPT = `You categorise bank transactions for a personal finance app used in Malaysia.
For each merchant string, choose exactly one category from the list provided.
Return JSON: {"suggestions":[{"merchant":"<verbatim input>","category":"<exact name from the list>"}]}
Omit any merchant you are not reasonably confident about — omission is correct and expected; a wrong category is worse than none.
Use only the category names given. Do not invent categories.`

function buildUserMessage(categoryNames: string[], merchants: string[]): string {
  return `Categories: ${categoryNames.join(', ')}\nMerchants:\n${merchants.map((m) => `- ${m}`).join('\n')}`
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
  if (!res.ok) throw new Error(`Anthropic API responded ${res.status}`)
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = data.content?.find((block) => block.type === 'text')?.text
  if (!text) throw new Error('no text content in Anthropic response')
  return text
}

// e2e cannot intercept a Worker-to-Anthropic fetch the way Playwright
// intercepts browser requests — `wrangler dev` makes that call from a
// separate process with no route the test can see. DAYBOOK_TEST gates a
// same-shaped substitute: a canned response body stashed in `settings` by
// POST /test/mock-ai-response (worker/routes/test.ts), read here instead of
// calling the network. Production never sets DAYBOOK_TEST, so this branch is
// unreachable there.
async function fetchTestText(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT value FROM settings WHERE user_id = ? AND key = '_test_ai_mock_response'`,
  )
    .bind(userId)
    .first<{ value: string }>()
  if (!row?.value) throw new Error('no AI mock configured for this test user')
  return row.value
}

function parseSuggestions(text: string): CategorySuggestion[] {
  const parsed: unknown = JSON.parse(text)
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
