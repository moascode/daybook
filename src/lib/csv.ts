import Papa from 'papaparse'
import { getDB } from '@/db'

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

export function parseCSV(file: File): Promise<ParsedCSVResult> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim(),
      complete: (results) => {
        const errors = results.errors.map(
          (e) => `Row ${e.row ?? '?'}: ${e.message}`
        )
        resolve({
          headers: results.meta.fields ?? [],
          rows: results.data,
          errors,
        })
      },
      error: (error: Error) => {
        resolve({
          headers: [],
          rows: [],
          errors: [error.message],
        })
      },
    })
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
      (h) => (h === keyword || h.includes(keyword)) && headers[idx] !== mapping.merchant
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

export async function computeImportHash(
  date: string,
  amount: number,
  merchant: string
): Promise<string> {
  const input = `${date}|${amount}|${merchant}`
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── Check duplicates against DB ─────────────────────

export async function checkDuplicates(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set()

  const db = await getDB()
  const duplicates = new Set<string>()

  // Query in batches to avoid hitting parameter limits
  const batchSize = 50
  for (let i = 0; i < hashes.length; i += batchSize) {
    const batch = hashes.slice(i, i + batchSize)
    const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(', ')
    const result = await db.query<{ import_hash: string }>(
      `SELECT import_hash FROM transactions WHERE import_hash IN (${placeholders})`,
      batch
    )
    for (const row of result.rows) {
      duplicates.add(row.import_hash)
    }
  }

  return duplicates
}

// ── Parse date string to ISO format ─────────────────

export function parseDateToISO(dateStr: string): string {
  const trimmed = dateStr.trim()

  // Try ISO format first: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  // DD/MM/YYYY
  const ddmmyyyy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  // MM/DD/YYYY (American format — less common in MY)
  const mmddyyyy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (mmddyyyy) {
    const [, month, day, year] = mmddyyyy
    // If first number > 12, it's likely DD/MM/YYYY which we already handled
    if (parseInt(month) > 12) {
      return `${year}-${day.padStart(2, '0')}-${month.padStart(2, '0')}`
    }
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

  // Remove currency symbols and whitespace
  const cleaned = trimmed.replace(/[^\d.,-]/g, '')

  // Handle parentheses for negative: (123.45) → -123.45
  const inParens = trimmed.match(/\(([^)]+)\)/)
  if (inParens) {
    const val = parseFloat(inParens[1].replace(/[^\d.]/g, ''))
    return { amount: Math.abs(val), isNegative: true }
  }

  // Handle negative sign
  const isNegative = cleaned.startsWith('-')
  const val = parseFloat(cleaned.replace(/[,-]/g, (match) => match === ',' ? '' : match))

  if (isNaN(val)) {
    return { amount: 0, isNegative: false }
  }

  return { amount: Math.abs(val), isNegative: isNegative || val < 0 }
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
