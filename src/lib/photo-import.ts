import { api } from '@/lib/api'
import { computeImportHash, checkDuplicates } from '@/lib/csv'
import type { ImportRow } from '@/lib/csv'
import type { Category } from '@/types/wallet.types'

// docs/v2/wallet/feature-photo-import.md (P2, approved 2026-09-06). One
// photo per call, deliberately client-side fan-out (§3.1) — a batch of N
// photos is N independent POSTs to /transactions/import-photo run with
// Promise.allSettled, never one request carrying N images.

export type PhotoImportKind = 'receipt' | 'statement'

export interface PhotoImportRow {
  date: string
  merchant: string
  // '' for a receipt; for a statement, the line as printed on it — see
  // worker/lib/anthropic.ts's PhotoImportRow for why the two kinds differ.
  description: string
  amount: number
  type: 'income' | 'expense'
  categoryGuess: string | null
}

export interface PhotoExtractionResult {
  fileName: string
  /** A local object URL for the picked file, for the review table's Photo
   *  thumbnail column. Never sent anywhere — revoked when no longer needed. */
  photoUrl: string
  rows: PhotoImportRow[]
  failureReason?: string
  /** true when the reply was cut off before Claude finished reading the
   *  photo (worker/lib/anthropic.ts's parsePhotoImportWithAI) — the rows
   *  present are real and safe to import, but the statement may continue
   *  past where the reply stopped. */
  truncated?: boolean
}

// Cap the longest edge at 1568px — the size beyond which Claude's vision
// input stops gaining resolution (spec §3.2) — before sending. A phone photo
// straight off the camera can be 10-20MB; resizing client-side wastes no
// upload time and buys no extraction quality past this point. Re-encodes as
// JPEG uniformly (screenshots/receipts have no meaningful alpha channel),
// which is one of the three types the endpoint accepts.
const MAX_EDGE_PX = 1568
const JPEG_QUALITY = 0.85

async function resizeImageForUpload(file: File): Promise<{ base64: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image encode failed'))), 'image/jpeg', JPEG_QUALITY)
    })

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
      reader.readAsDataURL(blob)
    })
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    return { base64, mediaType: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}

interface ImportPhotoResponse {
  rows: PhotoImportRow[]
  failureReason?: string
  truncated?: boolean
}

async function extractOnePhoto(file: File, kind: PhotoImportKind): Promise<PhotoExtractionResult> {
  const photoUrl = URL.createObjectURL(file)
  const { base64, mediaType } = await resizeImageForUpload(file)
  const res = await api.post<ImportPhotoResponse>('/transactions/import-photo', {
    image: base64,
    imageType: mediaType,
    kind,
  })
  return { fileName: file.name, photoUrl, rows: res.rows, failureReason: res.failureReason, truncated: res.truncated }
}

/**
 * Batch of N photos → N independent calls to POST /transactions/import-photo,
 * run with Promise.allSettled so one photo's failure (network error, thrown
 * exception) never blocks the rest — the server itself never errors the
 * whole call (always 200 with a per-photo failureReason), but resizing can
 * still throw client-side (e.g. a corrupt file), which this also catches.
 */
export async function extractPhotoBatch(
  files: File[],
  kind: PhotoImportKind,
  onProgress?: (done: number, total: number) => void,
): Promise<PhotoExtractionResult[]> {
  let done = 0
  const settled = await Promise.allSettled(
    files.map(async (file) => {
      const result = await extractOnePhoto(file, kind)
      done += 1
      onProgress?.(done, files.length)
      return result
    }),
  )
  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { fileName: files[i].name, photoUrl: '', rows: [], failureReason: 'could not process this photo' },
  )
}

/**
 * §7 of the spec: PhotoImportRow -> ImportRow, one row per successful
 * extraction result, in one pass after every photo's call has settled.
 */
export interface TruncatedPhoto {
  fileName: string
  rowCount: number
}

export async function photoResultsToImportRows(
  results: PhotoExtractionResult[],
  categories: Category[],
): Promise<{ rows: ImportRow[]; failed: PhotoExtractionResult[]; truncated: TruncatedPhoto[] }> {
  const failed = results.filter((r) => r.rows.length === 0)
  const succeeded = results.filter((r) => r.rows.length > 0)
  // A photo can be both truncated AND have rows — that's the whole point of
  // the salvage path (worker/lib/anthropic.ts): the rows before the cutoff
  // are real and land here, not in `failed`. Only a photo that was cut off
  // before even its first row completed shows up in `failed` instead.
  const truncated = succeeded
    .filter((r) => r.truncated)
    .map((r) => ({ fileName: r.fileName, rowCount: r.rows.length }))

  const rows: ImportRow[] = []
  for (const result of succeeded) {
    for (const photoRow of result.rows) {
      const hash = await computeImportHash(photoRow.date, photoRow.amount, photoRow.merchant)
      const category = photoRow.categoryGuess
        ? categories.find((c) => c.name === photoRow.categoryGuess && (c.type === photoRow.type || c.type === 'both'))
        : undefined
      rows.push({
        date: photoRow.date,
        amount: photoRow.amount,
        merchant: photoRow.merchant,
        description: photoRow.description,
        type: photoRow.type,
        categoryId: category?.id ?? null,
        destinationAccountId: null,
        importHash: hash,
        isDuplicate: false,
        included: true,
        originalRow: {},
        photoUrl: result.photoUrl,
        photoFileName: result.fileName,
        suggestedFrom: category ? { canonical: photoRow.merchant, matchCount: 0 } : undefined,
        suggestionApplied: !!category,
      })
    }
  }

  const { duplicateHashes, possibleDuplicates } = await checkDuplicates(rows)
  rows.forEach((row) => {
    if (duplicateHashes.has(row.importHash)) {
      row.isDuplicate = true
      row.included = false
      return
    }
    const candidates = possibleDuplicates.get(row.importHash)
    if (candidates && candidates.length > 0) row.possibleDuplicateOf = candidates
  })

  return { rows, failed, truncated }
}
