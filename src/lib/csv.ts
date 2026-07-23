import Papa from 'papaparse'
import { api } from '@/lib/api'

// ── Types ───────────────────────────────────────────

export interface ParsedCSVResult {
  headers: string[]
  rows: Record<string, string>[]
  errors: string[]
}

export interface ColumnMapping {
  date: string | null
  amount: string | null
  merchant: string | null
  description: string | null
}

export interface ImportRow {
  date: string
  amount: number
  merchant: string
  description: string
  type: 'income' | 'expense'
  categoryId: string | null
  importHash: string
  isDuplicate: boolean
  included: boolean
  originalRow: Record<string, string>
}

// ── Date patterns for auto-detection ────────────────

const DATE_KEYWORDS = ['date', 'transaction date', 'trans date', 'posting date', 'value date', 'txn date']
const AMOUNT_KEYWORDS = ['amount', 'sum', 'value', 'debit', 'credit', 'transaction amount']
const MERCHANT_KEYWORDS = ['merchant', 'description', 'payee', 'vendor', 'name', 'detail', 'details', 'narrative', 'particular', 'particulars', 'reference']
const DESCRIPTION_KEYWORDS = ['description', 'memo', 'note', 'remarks', 'remark', 'detail', 'details']

// ── Parse CSV file ──────────────────────────────────

export function parseCSV(file: File, headerRow = true): Promise<ParsedCSVResult> {
  return new Promise((resolve) => {
    if (headerRow) {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim(),
        complete: (results) => {
          const errors = results.errors.map((e) => `Row ${e.row ?? '?'}: ${e.message}`)
          resolve({ headers: results.meta.fields ?? [], rows: results.data, errors })
        },
        error: (error: Error) => resolve({ headers: [], rows: [], errors: [error.message] }),
      })
    } else {
      // No header row — treat every row as data and auto-generate column names.
      Papa.parse<string[]>(file, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          const errors = results.errors.map((e) => `Row ${e.row ?? '?'}: ${e.message}`)
          const allRows = results.data as string[][]
          if (allRows.length === 0) {
            resolve({ headers: [], rows: [], errors })
            return
          }
          const maxCols = Math.max(...allRows.map((r) => r.length))
          const headers = Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`)
          const rows = allRows.map((row) =>
            Object.fromEntries(headers.map((h, i) => [h, (row[i] ?? '').trim()]))
          )
          resolve({ headers, rows, errors })
        },
        error: (error: Error) => resolve({ headers: [], rows: [], errors: [error.message] }),
      })
    }
  })
}

// ── Auto-detect column mapping ──────────────────────

export function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    date: null,
    amount: null,
    merchant: null,
    description: null,
  }

  const lowerHeaders = headers.map((h) => h.toLowerCase().trim())

  // Find date column
  for (const keyword of DATE_KEYWORDS) {
    const idx = lowerHeaders.findIndex((h) => h === keyword || h.includes(keyword))
    if (idx !== -1) {
      mapping.date = headers[idx]
      break
    }
  }

  // Find amount column
  for (const keyword of AMOUNT_KEYWORDS) {
    const idx = lowerHeaders.findIndex((h) => h === keyword || h.includes(keyword))
    if (idx !== -1) {
      mapping.amount = headers[idx]
      break
    }
  }

  // Find merchant column — prefer exact match, then partial
  for (const keyword of MERCHANT_KEYWORDS) {
    const idx = lowerHeaders.findIndex((h) => h === keyword)
    if (idx !== -1) {
      mapping.merchant = headers[idx]
      break
    }
  }
  if (!mapping.merchant) {
    for (const keyword of MERCHANT_KEYWORDS) {
      const idx = lowerHeaders.findIndex((h) => h.includes(keyword))
      if (idx !== -1) {
        mapping.merchant = headers[idx]
        break
      }
    }
  }

  // Find description column — skip if same as merchant
  for (const keyword of DESCRIPTION_KEYWORDS) {
    const idx = lowerHeaders.findIndex(
      (h, i) => (h === keyword || h.includes(keyword)) && headers[i] !== mapping.merchant
    )
    if (idx !== -1) {
      mapping.description = headers[idx]
      break
    }
  }

  // Fallback: if no merchant found, use description column
  if (!mapping.merchant && mapping.description) {
    mapping.merchant = mapping.description
    mapping.description = null
  }

  return mapping
}

// ── Compute import hash ─────────────────────────────

// crypto.subtle only exists in secure contexts (HTTPS or http://localhost).
// When the app is served over plain HTTP on the LAN (e.g. from a phone), it is
// undefined — so we fall back to a pure-JS SHA-256. Both paths produce the same
// digest, keeping duplicate detection consistent across access methods.
export async function computeImportHash(
  date: string,
  amount: number,
  merchant: string
): Promise<string> {
  const input = `${date}|${amount}|${merchant}`
  const data = new TextEncoder().encode(input)
  if (crypto?.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  // Build a latin1 binary string from the UTF-8 bytes so the fallback digests
  // the exact same bytes as crypto.subtle (parity for non-ASCII merchants).
  let bin = ''
  for (const byte of data) bin += String.fromCharCode(byte)
  return sha256(bin)
}

// Minimal pure-JS SHA-256 (hex digest). Operates on a binary string (one byte
// per char). Used only as a fallback when the Web Crypto SubtleCrypto API is
// unavailable (non-secure browsing contexts).
function sha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount))
  }

  const mathPow = Math.pow
  const maxWord = mathPow(2, 32)
  let result = ''

  const words: number[] = []
  const asciiBitLength = ascii.length * 8

  const hash: number[] = []
  const k: number[] = []
  let primeCounter = 0

  const isComposite: Record<number, number> = {}
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0
    }
  }

  ascii += '\x80'
  while ((ascii.length % 64) - 56) ascii += '\x00'
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i)
    if (j >> 8) return '' // ASCII only; inputs here are date|amount|merchant
    words[i >> 2] |= j << (((3 - i) % 4) * 8)
  }
  words[words.length] = (asciiBitLength / maxWord) | 0
  words[words.length] = asciiBitLength

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16))
    const oldHash = hash.slice(0)

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15]
      const w2 = w[i - 2]

      const a = hash[0]
      const e = hash[4]
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0)

      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))

      hash.unshift((temp1 + temp2) | 0)
      hash[4] = (hash[4] + temp1) | 0
    }

    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255
      result += (b < 16 ? 0 : '') + b.toString(16)
    }
  }
  return result
}

// ── Check duplicates against DB ─────────────────────

export async function checkDuplicates(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set()

  const existing = await api.post<string[]>('/transactions/check-duplicates', { hashes })
  return new Set(existing)
}

// ── Parse date string to ISO format ─────────────────

export function parseDateToISO(dateStr: string): string {
  const trimmed = dateStr.trim()

  // Try ISO format first: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  // DD/MM/YYYY or MM/DD/YYYY — disambiguate per row (B-13). A component > 12 can
  // only be the day; when both are ≤ 12 the format is ambiguous, so default to
  // DD/MM (the Malaysian convention). This also stops 12/31/2025 from producing
  // an invalid "2025-31-12" that fails the whole atomic import.
  const dmy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (dmy) {
    const [, a, b, year] = dmy
    const first = parseInt(a, 10)
    const second = parseInt(b, 10)
    let day = a
    let month = b
    if (first <= 12 && second > 12) {
      // second component must be the day → MM/DD
      day = b
      month = a
    }
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  // YYYY/MM/DD
  const yyyymmdd = trimmed.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/)
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  // Try Date.parse as a last resort
  const parsed = new Date(trimmed)
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear()
    const m = String(parsed.getMonth() + 1).padStart(2, '0')
    const d = String(parsed.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  // Return original if unparseable
  return trimmed
}

// ── Parse amount string to number ───────────────────

export function parseAmount(amountStr: string): { amount: number; isNegative: boolean } {
  const trimmed = amountStr.trim()

  // Sign can be leading (-12), trailing (12- — common in bank exports, B-14), or
  // parenthesised ((12)). Detect all three before stripping non-numeric chars.
  const inParens = /\(([^)]+)\)/.test(trimmed)
  const leadingMinus = /^\s*-/.test(trimmed)
  const trailingMinus = /-\s*$/.test(trimmed)
  const isNegative = inParens || leadingMinus || trailingMinus

  // Keep only digits and separators, then figure out which separator is the
  // decimal point (B-14). A trailing "[.,]dd" (1–2 digits) is the decimal; every
  // other separator is a thousands group. This makes both "1,234.56" and the
  // European "1.234,56" parse to 1234.56 instead of 1.23456.
  let s = trimmed.replace(/[^\d.,]/g, '')
  const decimal = s.match(/[.,](\d{1,2})$/)
  if (decimal) {
    const sepIdx = s.length - decimal[0].length
    const intPart = s.slice(0, sepIdx).replace(/[.,]/g, '')
    s = `${intPart}.${decimal[1]}`
  } else {
    s = s.replace(/[.,]/g, '')
  }

  const val = parseFloat(s)
  if (isNaN(val)) {
    return { amount: 0, isNegative: false }
  }
  return { amount: Math.abs(val), isNegative }
}

// ── Build import rows from parsed CSV ───────────────

export async function buildImportRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping
): Promise<ImportRow[]> {
  if (!mapping.date || !mapping.amount) {
    return []
  }

  const importRows: ImportRow[] = []
  const hashes: string[] = []

  // First pass: build rows and compute hashes
  for (const row of rows) {
    const dateRaw = row[mapping.date] ?? ''
    const amountRaw = row[mapping.amount] ?? ''
    const merchantRaw = mapping.merchant ? (row[mapping.merchant] ?? '') : ''
    const descriptionRaw = mapping.description ? (row[mapping.description] ?? '') : ''

    if (!dateRaw || !amountRaw) continue

    const date = parseDateToISO(dateRaw)
    const { amount, isNegative } = parseAmount(amountRaw)

    if (amount === 0) continue

    const merchant = merchantRaw.trim()
    const description = descriptionRaw.trim()
    const type = isNegative ? 'expense' : 'income'

    const hash = await computeImportHash(date, amount, merchant)
    hashes.push(hash)

    importRows.push({
      date,
      amount,
      merchant,
      description,
      type: type as 'income' | 'expense',
      categoryId: null,
      importHash: hash,
      isDuplicate: false,
      included: true,
      originalRow: row,
    })
  }

  // Second pass: check duplicates
  const duplicateSet = await checkDuplicates(hashes)
  for (const importRow of importRows) {
    if (duplicateSet.has(importRow.importHash)) {
      importRow.isDuplicate = true
      importRow.included = false
    }
  }

  return importRows
}
