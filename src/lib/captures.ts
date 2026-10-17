import { api } from '@/lib/api'
import { extractLast4 } from '@/lib/cardMatch'
import type { ImportRow } from '@/lib/csv'
import type { Account } from '@/types/wallet.types'

export { extractLast4 }

/** A row as the server stores it — raw, unenriched. */
export interface PendingCapture {
  id: string
  source: string
  raw_merchant: string
  raw_card: string
  raw_destination_card: string
  amount: number
  type: 'income' | 'expense' | 'transfer'
  occurred_at: string
  duplicate_key: string
  status: string
  created_at: string
  /** 1 when a transaction with this capture's duplicate_key already exists —
   *  the same payment reached the ledger another way (usually a bank CSV
   *  imported after the capture arrived). R18 gap 1, reverse direction. */
  already_in_ledger?: number
}

/** settings key holding the card→account map. A plain JSON object so it can be
 *  edited by hand if it ever needs to be. */
export const CARD_MAP_KEY = 'capture_card_map'

export type CardMap = Record<string, string>

export function parseCardMap(raw: string | undefined | null): CardMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => [k, v as string]),
    )
  } catch {
    // A corrupt map must not take the whole inbox down with it — every row
    // just falls back to "unmapped" and says so.
    return {}
  }
}

export function listCaptures(): Promise<PendingCapture[]> {
  return api.get<PendingCapture[]>('/captures')
}

export function dismissCaptures(ids: string[]): Promise<{ dismissed: number }> {
  return api.post<{ dismissed: number }>('/captures/dismiss', { ids })
}

export interface AcceptRowInput {
  id: string
  accountId: string
  destinationAccountId: string | null
  date: string
  merchant: string
  description: string
  amount: number
  type: string
  categoryId: string | null
  /** Rule-driven tags (FEAT: account last4 + transaction rules). Omitted/[] keeps the existing no-tags behaviour. */
  tag?: string[]
}

export interface AcceptCapturesResult {
  accepted: number
  /** The created transaction rows, in the same order as `rows` — used to attach a rule-driven split per accepted row. */
  transactions: Record<string, unknown>[]
}

export function acceptCaptures(rows: AcceptRowInput[]): Promise<AcceptCapturesResult> {
  return api.post<AcceptCapturesResult>('/captures/accept', { rows })
}

/**
 * Map a stored capture onto the shape the review table already renders.
 *
 * The card→account resolution happens here rather than on the server so the
 * ingest endpoint stays one INSERT — the shortcut is waiting on that response
 * (spec §5.2). An unmapped card falls back to `fallbackAccountId` and is
 * FLAGGED; it is never silently filed.
 */
export interface CardResolution {
  accountId: string
  /** The matched last4 digits, set only when the match came from a last4 lookup whose only hit was a shared-in (not own) account. */
  sharedLast4: string | null
}

/**
 * Resolves a raw card string to an account id: an exact card-map entry first,
 * then (new) the account whose own `last4` equals the 4 digits at the end of
 * the raw string — e.g. a capture's "Visa 9876" lands on the account whose
 * last4 is "9876" even before anyone has mapped that exact card string by
 * hand. Own accounts are preferred over shared-in ones when both match
 * (which the server already prevents happening within one user's own
 * accounts, but a last4 is never unique ACROSS users); a shared-in-only match
 * is still returned (pre-selected) but flagged via `sharedLast4`. `''`
 * accountId when nothing resolves.
 */
export function resolveCard(raw: string, cardMap: CardMap, writableAccounts: Account[]): CardResolution {
  const mapped = cardMap[raw]
  if (mapped && writableAccounts.some((a) => a.id === mapped)) return { accountId: mapped, sharedLast4: null }

  const digits = extractLast4(raw)
  if (digits) {
    const matches = writableAccounts.filter((a) => a.last4 && a.last4 === digits)
    const own = matches.find((a) => !a.isShared)
    if (own) return { accountId: own.id, sharedLast4: null }
    if (matches.length > 0) return { accountId: matches[0].id, sharedLast4: digits }
  }
  return { accountId: '', sharedLast4: null }
}

export function captureToRow(
  capture: PendingCapture,
  cardMap: CardMap,
  writableAccounts: Account[],
  fallbackAccountId: string,
): ImportRow {
  const resolved = resolveCard(capture.raw_card, cardMap, writableAccounts)
  const resolvedDestination = resolveCard(capture.raw_destination_card, cardMap, writableAccounts)

  return {
    date: capture.occurred_at,
    amount: capture.amount,
    merchant: capture.raw_merchant,
    description: '',
    type: capture.type,
    categoryId: null,
    destinationAccountId: resolvedDestination.accountId || null,
    importHash: '',
    // A duplicate_key match is the same confidence layer 2 auto-excludes on,
    // so an already-banked payment arrives pre-excluded and badged rather
    // than quietly waiting to be double-counted.
    isDuplicate: Number(capture.already_in_ledger ?? 0) === 1,
    included: Number(capture.already_in_ledger ?? 0) !== 1,
    originalRow: {},
    accountId: resolved.accountId || fallbackAccountId,
    // A shared-only last4 match is still pre-selected but gets the SAME
    // visual flag as "no match" — it isn't the owner's own account, so it's
    // still worth a second look — just with a different title (CsvReviewTable).
    accountUnmapped: !resolved.accountId || !!resolved.sharedLast4,
    last4SharedMatch: resolved.sharedLast4 ?? undefined,
    captureId: capture.id,
    rawCard: capture.raw_card,
  }
}
