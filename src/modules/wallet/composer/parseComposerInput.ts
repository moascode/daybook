import { todayISO } from '@/lib/utils'

export interface ComposerDraft {
  merchant: string
  amount: number
  type: 'income' | 'expense' | 'transfer'
  accountId: string
  destinationAccountId: string | null
  categoryId: null
  date: string
}

export interface ComposerAccount {
  id: string
  name: string
  type: string
}

// Global so every candidate amount in the text can be inspected, not just the
// first — a merchant that itself starts with a digit ("7-Eleven 4.20 cash")
// would otherwise grab "7" instead of the actual money. Comma thousands
// separators are supported ("1,200 rent"); decimals capped at 2dp, matching
// how currency is ever actually typed.
// The comma-group branch requires at least ONE ",ddd" group — otherwise
// `\d{1,3}` alone would greedily claim just the first 1-3 digits of a plain
// ungrouped number like "3000" ("300") and leave the rest ("0") to match as
// a second, bogus token. Only a genuinely comma-grouped number ("1,200")
// takes that branch; every other number falls to the plain `\d+` branch.
const NUMBER_TOKEN_RE = /(?:RM|rm|\$)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g
const INCOME_KEYWORD_RE = /\b(income|received|salary|refund)\b/i
// "to <text>" only counts as a transfer when <text> actually names another
// account — otherwise ordinary phrases like "grab food to go" would misfire.
const TRANSFER_CLAUSE_RE = /\bto\s+([\s\S]+)$/i
const CASH_WORD_RE = /\bcash\b/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The best amount candidate in the text, preferring a decimal-bearing token
 * (unambiguously money-shaped) over a bare integer, and the LAST such token
 * over the first — "7-Eleven 4.20 cash" has two number-like tokens ("7" and
 * "4.20"); the decimal one is the real amount regardless of which comes
 * first. Falls back to the last bare integer only when no decimal token
 * exists at all.
 */
function extractAmount(text: string): { amount: number; matchedText: string } | null {
  const matches = [...text.matchAll(NUMBER_TOKEN_RE)]
  if (matches.length === 0) return null

  const decimalMatches = matches.filter((m) => m[1].includes('.'))
  const candidates = decimalMatches.length > 0 ? decimalMatches : matches
  const best = candidates[candidates.length - 1]

  const amount = parseFloat(best[1].replace(/,/g, ''))
  if (!(amount > 0)) return null
  return { amount, matchedText: best[0] }
}

/**
 * The best account-name match in the text: word-bounded (so "Cash" doesn't
 * match "cashew" and "Bank" doesn't match "bankrupt"), preferring the
 * LONGEST matching name when several account names all appear (so "Bank
 * Savings" wins over the shorter "Bank" when both are present as accounts
 * and the text says "bank savings"), earliest position as the final
 * tiebreak for two equal-length names.
 */
function findBestAccountMatch(
  text: string,
  accounts: ComposerAccount[],
): { account: ComposerAccount; matchedText: string; index: number } | null {
  let best: { account: ComposerAccount; matchedText: string; index: number } | null = null
  for (const account of accounts) {
    if (!account.name) continue
    const match = new RegExp(`\\b${escapeRegExp(account.name)}\\b`, 'i').exec(text)
    if (!match) continue
    const better =
      !best ||
      match[0].length > best.matchedText.length ||
      (match[0].length === best.matchedText.length && match.index < best.index)
    if (better) best = { account, matchedText: match[0], index: match.index }
  }
  return best
}

export function parseComposerInput(
  text: string,
  accounts: ComposerAccount[],
  activeAccountId: string | null,
): ComposerDraft | null {
  const amountResult = extractAmount(text)
  if (!amountResult) return null
  const { amount, matchedText: matchedAmountText } = amountResult

  // An income keyword embedded inside an account's OWN name (e.g. "Salary
  // Account") must not turn every transaction naming that account into
  // income — only count it when the keyword isn't part of a whole account
  // name actually present in the text.
  const incomeMatch = INCOME_KEYWORD_RE.exec(text)
  const incomeMatchIsPartOfAnAccountName =
    incomeMatch &&
    accounts.some(
      (a) =>
        a.name &&
        a.name.toLowerCase().includes(incomeMatch[0].toLowerCase()) &&
        new RegExp(`\\b${escapeRegExp(a.name)}\\b`, 'i').test(text),
    )

  let type: 'income' | 'expense' | 'transfer' = 'expense'
  let destinationAccountId: string | null = null
  let matchedTypeText: string | null = null
  let transferClauseStart = -1

  if (incomeMatch && !incomeMatchIsPartOfAnAccountName) {
    type = 'income'
    matchedTypeText = incomeMatch[0]
  } else {
    const transferMatch = TRANSFER_CLAUSE_RE.exec(text)
    if (transferMatch) {
      const destinationMatch = findBestAccountMatch(transferMatch[1], accounts)
      if (destinationMatch) {
        type = 'transfer'
        destinationAccountId = destinationMatch.account.id
        matchedTypeText = transferMatch[0]
        transferClauseStart = transferMatch.index
      }
    }
  }

  // Source-account matching is restricted to the text before a matched " to
  // <account>" clause, so the destination account's name is never mistaken
  // for the source account (e.g. "transfer 500 to Savings" must not resolve
  // its source to Savings just because that's the only account name present).
  const searchText = transferClauseStart >= 0 ? text.slice(0, transferClauseStart) : text

  const accountMatch = findBestAccountMatch(searchText, accounts)
  let accountId: string | null = accountMatch?.account.id ?? null
  let matchedAccountText: string | null = accountMatch?.matchedText ?? null

  if (!accountId) {
    const cashMatch = CASH_WORD_RE.exec(searchText)
    if (cashMatch) {
      const cashAccount = accounts.find((a) => a.type === 'cash')
      if (cashAccount) {
        accountId = cashAccount.id
        matchedAccountText = cashMatch[0]
      }
    }
  }

  if (!accountId) {
    // Never resolve the source to the SAME account already picked as the
    // transfer destination — that would produce a preview `Confirm` can
    // never save (the server rejects a transfer to itself).
    const fallbackCandidates =
      destinationAccountId !== null ? accounts.filter((a) => a.id !== destinationAccountId) : accounts
    if (activeAccountId && fallbackCandidates.some((a) => a.id === activeAccountId)) {
      accountId = activeAccountId
    } else {
      accountId = fallbackCandidates[0]?.id ?? null
    }
  }

  if (!accountId) return null
  if (destinationAccountId !== null && accountId === destinationAccountId) return null

  let residual = text
  if (matchedAmountText) residual = residual.replace(matchedAmountText, '')
  if (matchedTypeText) residual = residual.replace(matchedTypeText, '')
  if (matchedAccountText) residual = residual.replace(matchedAccountText, '')
  const merchant = residual.replace(/\s+/g, ' ').trim()

  return {
    merchant,
    amount,
    type,
    accountId,
    destinationAccountId,
    categoryId: null,
    date: todayISO(),
  }
}
