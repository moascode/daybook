import { computeImportHash, checkDuplicates } from '@/lib/csv'
import type { ImportRow } from '@/lib/csv'
import type { Category } from '@/types/wallet.types'

// ── PROTOTYPE ONLY — no real Anthropic call ─────────────────────────────
//
// docs/v2/wallet/feature-photo-import.md describes `POST
// /transactions/import-photo` (worker/lib/anthropic.ts's
// parsePhotoImportWithAI, a new ai_rate_limit_photo_import bucket). None of
// that is wired here — P2 in docs/v2/cross-cutting/ai-usage.md is still
// "pending owner yes", and CLAUDE.md rule 2 ("warn before wiring") forbids
// adding an outbound Claude call without that yes in chat first. This module
// exists only so the review-table/UI wiring downstream of "we have N rows
// from photos" can be built and looked at now — every extraction here is a
// canned, client-side mock, never a network call to Anthropic or even to
// this app's own Worker.

export interface PhotoImportRow {
  date: string
  merchant: string
  amount: number
  type: 'income' | 'expense'
  categoryGuess: string | null
}

export interface PhotoExtractionResult {
  fileName: string
  /** A local object URL for the picked file — stands in for what a real
   *  upload would eventually let the review table thumbnail. Never sent
   *  anywhere; revoked when the review page unmounts. */
  photoUrl: string
  rows: PhotoImportRow[]
  failureReason?: string
}

const MOCK_RECEIPT_MERCHANTS = [
  { merchant: 'Village Grocer', amount: 42.6, categoryGuess: 'Food & Drink' },
  { merchant: 'Petronas', amount: 80, categoryGuess: 'Transport' },
  { merchant: 'Guardian Pharmacy', amount: 23.9, categoryGuess: 'Health' },
]

/**
 * Mocks one photo's extraction. Deliberately deterministic (cycles a small
 * canned list) and deliberately fails the LAST photo in a batch of 2+ — so a
 * batch of one always succeeds (nothing to demo a partial failure against)
 * and a batch of 2+ always shows the partial-failure notice the review page
 * needs to render.
 */
async function mockExtractOnePhoto(
  file: File,
  index: number,
  totalInBatch: number,
  kind: 'receipt' | 'statement',
): Promise<PhotoExtractionResult> {
  await new Promise((resolve) => setTimeout(resolve, 400 + index * 150))

  const photoUrl = URL.createObjectURL(file)

  if (totalInBatch > 1 && index === totalInBatch - 1) {
    return { fileName: file.name, photoUrl, rows: [], failureReason: 'too blurry for Claude to read reliably' }
  }

  if (kind === 'receipt') {
    const pick = MOCK_RECEIPT_MERCHANTS[index % MOCK_RECEIPT_MERCHANTS.length]
    return {
      fileName: file.name,
      photoUrl,
      rows: [{ date: new Date().toISOString().slice(0, 10), merchant: pick.merchant, amount: pick.amount, type: 'expense', categoryGuess: pick.categoryGuess }],
    }
  }

  // Statement: a short mixed-direction line-item list, same shape §4 of the
  // spec describes for the statement prompt.
  return {
    fileName: file.name,
    photoUrl,
    rows: [
      { date: new Date().toISOString().slice(0, 10), merchant: 'Netflix', amount: 54.9, type: 'expense', categoryGuess: 'Entertainment' },
      { date: new Date().toISOString().slice(0, 10), merchant: 'Salary', amount: 4200, type: 'income', categoryGuess: null },
    ],
  }
}

/**
 * Batch of N photos → N independent mock "calls", exactly the client-side
 * fan-out shape §3.1 of the spec describes for the real endpoint
 * (Promise.allSettled, one photo's failure never blocking the rest).
 */
export async function mockExtractPhotoBatch(
  files: File[],
  kind: 'receipt' | 'statement',
  onProgress?: (done: number, total: number) => void,
): Promise<PhotoExtractionResult[]> {
  let done = 0
  const settled = await Promise.allSettled(
    files.map(async (file, i) => {
      const result = await mockExtractOnePhoto(file, i, files.length, kind)
      done += 1
      onProgress?.(done, files.length)
      return result
    }),
  )
  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { fileName: files[i].name, photoUrl: '', rows: [], failureReason: 'network error' },
  )
}

/**
 * §7 of the spec: PhotoImportRow -> ImportRow, one row per successful
 * extraction result, in one pass after every photo's mock call has settled.
 */
export async function photoResultsToImportRows(
  results: PhotoExtractionResult[],
  categories: Category[],
): Promise<{ rows: ImportRow[]; failed: PhotoExtractionResult[] }> {
  const failed = results.filter((r) => r.rows.length === 0)
  const succeeded = results.filter((r) => r.rows.length > 0)

  const rows: ImportRow[] = []
  const hashes: string[] = []
  for (const result of succeeded) {
    for (const photoRow of result.rows) {
      const hash = await computeImportHash(photoRow.date, photoRow.amount, photoRow.merchant)
      const category = photoRow.categoryGuess
        ? categories.find((c) => c.name === photoRow.categoryGuess && (c.type === photoRow.type || c.type === 'both'))
        : undefined
      hashes.push(hash)
      rows.push({
        date: photoRow.date,
        amount: photoRow.amount,
        merchant: photoRow.merchant,
        description: '',
        type: photoRow.type,
        categoryId: category?.id ?? null,
        destinationAccountId: null,
        importHash: hash,
        isDuplicate: false,
        included: true,
        originalRow: {},
        photoUrl: result.photoUrl,
        suggestedFrom: category ? { canonical: photoRow.merchant, matchCount: 0 } : undefined,
        suggestionApplied: !!category,
      })
    }
  }

  const duplicateSet = await checkDuplicates(hashes)
  rows.forEach((row) => {
    if (duplicateSet.has(row.importHash)) {
      row.isDuplicate = true
      row.included = false
    }
  })

  return { rows, failed }
}
