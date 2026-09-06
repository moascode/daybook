import { api } from '@/lib/api'
import type { ImportRow } from '@/lib/csv'
import type { Account } from '@/types/wallet.types'

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
}

export function acceptCaptures(rows: AcceptRowInput[]): Promise<{ accepted: number }> {
  return api.post<{ accepted: number }>('/captures/accept', { rows })
}

/**
 * Map a stored capture onto the shape the review table already renders.
 *
 * The card→account resolution happens here rather than on the server so the
 * ingest endpoint stays one INSERT — the shortcut is waiting on that response
 * (spec §5.2). An unmapped card falls back to `fallbackAccountId` and is
 * FLAGGED; it is never silently filed.
 */
export function captureToRow(
  capture: PendingCapture,
  cardMap: CardMap,
  writableAccounts: Account[],
  fallbackAccountId: string,
): ImportRow {
  const mapped = cardMap[capture.raw_card]
  const usable = mapped && writableAccounts.some((a) => a.id === mapped) ? mapped : ''
  const mappedDestination = cardMap[capture.raw_destination_card]
  const usableDestination =
    mappedDestination && writableAccounts.some((a) => a.id === mappedDestination)
      ? mappedDestination
      : null

  return {
    date: capture.occurred_at,
    amount: capture.amount,
    merchant: capture.raw_merchant,
    description: '',
    type: capture.type,
    categoryId: null,
    destinationAccountId: usableDestination,
    importHash: '',
    // A duplicate_key match is the same confidence layer 2 auto-excludes on,
    // so an already-banked payment arrives pre-excluded and badged rather
    // than quietly waiting to be double-counted.
    isDuplicate: Number(capture.already_in_ledger ?? 0) === 1,
    included: Number(capture.already_in_ledger ?? 0) !== 1,
    originalRow: {},
    accountId: usable || fallbackAccountId,
    accountUnmapped: !usable,
    captureId: capture.id,
    rawCard: capture.raw_card,
  }
}
