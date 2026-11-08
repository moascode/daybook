import { format, parseISO } from 'date-fns'
import type { Account, ImportBatch } from '@/types/wallet.types'

export function mapImportBatch(r: Record<string, unknown>): ImportBatch {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    accountName: String(r.account_name ?? 'Deleted account'),
    accountColor: String(r.account_color ?? ''),
    accountLast4: String(r.account_last4 ?? ''),
    sourceName: String(r.source_name ?? ''),
    kind: r.kind === 'photo' ? 'photo' : 'csv',
    movedAt: (r.moved_at as string | null) ?? null,
    createdAt: String(r.created_at),
    rowCount: Number(r.row_count ?? 0),
    net: Number(r.net ?? 0),
    dateFrom: (r.date_from as string | null) ?? null,
    dateTo: (r.date_to as string | null) ?? null,
  }
}

export function batchTitle(b: ImportBatch): string {
  return b.sourceName || (b.kind === 'photo' ? 'Statement photos' : 'CSV import')
}

export function batchWhen(b: ImportBatch): string {
  return format(new Date(`${b.createdAt.replace(' ', 'T')}Z`), 'd MMM yyyy, HH:mm')
}

/** Statement span, e.g. "30 Oct – 31 Oct 2026". */
export function dateSpan(from: string, to: string): string {
  const end = format(parseISO(to), 'd MMM yyyy')
  return from === to ? end : `${format(parseISO(from), 'd MMM')} – ${end}`
}

export function accountLabel(name: string, last4: string): string {
  return last4 ? `${name} ··${last4}` : name
}

/**
 * The account a file name points at, if exactly one does — by its last 4
 * digits, else by a word of its name (e.g. "MAYBANK_NOV.csv" → Maybank Savings).
 */
export function accountMatchingName(sourceName: string, accounts: Account[]): Account | null {
  const name = sourceName.toLowerCase()
  if (!name) return null
  const byLast4 = accounts.filter((a) => a.last4 && name.includes(a.last4))
  if (byLast4.length === 1) return byLast4[0]
  const byWord = accounts.filter((a) =>
    a.name.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 3 && name.includes(w)),
  )
  return byWord.length === 1 ? byWord[0] : null
}
