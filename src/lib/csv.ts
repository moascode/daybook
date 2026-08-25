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
  type: 'income' | 'expense' | 'transfer'
  categoryId: string | null
  destinationAccountId: string | null
  importHash: string
  isDuplicate: boolean
  included: boolean
  originalRow: Record<string, string>
  /** Set only by the suggestion pass (CsvImport.tsx); never sent to the server. matchCount 0 = builtin map, not history. */
  suggestedFrom?: { canonical: string; matchCount: number }
  /** True while the pre-filled categoryId is still the suggestion, unedited — for "Clear suggestions". */
  suggestionApplied?: boolean
  /**
   * The original bank narrative this row's `merchant` was split from (only set
   * when a single narrative column was split into merchant + description —
   * see `isNarrativeColumn` below). Used to round-trip {raw, guess} pairs to
   * POST /merchants/resolve for the AI-assisted resolution ladder; never sent
   * anywhere else, and never used for `importHash` (that stays keyed on the
   * raw text captured before canonicalisation, docs/v1/flow-plan.md G11).
   */
  narrativeRaw?: string
  /** True when /merchants/resolve could not improve on the regex guess for this row (no key, rate limit, or AI failure) — the guess is kept as-is. */
  merchantUnresolved?: boolean
}

// ── Date patterns for auto-detection ────────────────

const DATE_KEYWORDS = ['date', 'transaction date', 'trans date', 'posting date', 'value date', 'txn date']
const AMOUNT_KEYWORDS = ['amount', 'sum', 'value', 'debit', 'credit', 'transaction amount']
// Identity terms must precede generic narrative terms so a CSV with both a Payee
// and a Description column doesn't pick Description as merchant. The fallback
// (no identity column at all) still uses Description, which is correct.
const MERCHANT_KEYWORDS = ['merchant', 'payee', 'vendor', 'description', 'name', 'detail', 'details', 'narrative', 'particular', 'particulars', 'reference']
const DESCRIPTION_KEYWORDS = ['description', 'memo', 'note', 'remarks', 'remark', 'detail', 'details', 'narrative', 'particular', 'particulars', 'reference']

// ── Canonicalize merchant name for display ───────────
// Strips bank-appended noise (card masks, dates, country codes, payment-rail
// prefixes, domains, entity types, trailing digits, outlet suffixes) to extract
// a clean merchant name. Used during CSV import when a single narrative column is
// split into merchant (canonical) + description (raw). Returns title-case for display.
// Pure string manipulation.

function canonicalizeMerchantForCsv(raw: string): string | null {
  // Masked card/account tokens: digits mixed with a run of 4+ X's (e.g.
  // "4123XXXXXXXX8891"). Bounded by whitespace/string edges (lookaround, not
  // \b) because a digit run butts directly against the X run with no word
  // boundary between them — \b alone would never fire there.
  const MASKED_TOKEN = /(?<=^|\s)[\dXx]*[Xx]{4,}[\dXx]*(?=\s|$)/g
  const BULLET_MASK = /(?<=^|\s)[\d•*·]*[•*·]{3,}[\d•*·]*(?=\s|$)/g
  // Unmasked reference/card/account numbers — most Malaysian bank narratives
  // print the PAN or txn ref in full rather than masking it. A standalone
  // 6+ digit token is never part of a real merchant name.
  const DIGIT_TOKEN = /\b\d{6,}\b/g
  const DATE_TAIL = /\s\d{1,2}[/-]\d{1,2}[/-]\d{2,4}.*$/
  const COUNTRY = /\s+(?:MY|SG|US|CA|GB|AU|TH|ID|JP|HK|CN|IN|NL|DE|IE)\s*$/
  // Payment rail prefixes that appear at the start of bank narratives
  const RAIL_PREFIX = /^(?:POS\s+DEBIT|POS\s+PURCHASE|PURCHASE|DUITNOW|TRANSFER\s+(?:DEBIT|CREDIT)|MEPS|IBG|FPX)\s+/i
  const DOMAIN_TAIL = /\.(?:COM\.MY|COM|NET|CO|MY)\b.*$/i
  // Use multiple spaces or explicit separators, not single spaces (which appear
  // inside merchant names like "FAMILY MART" or "GIANT SUPERMARKET").
  const SEPARATOR = /\s{2,}|[-*/|]/
  const SEPARATOR_ALL = /\s{2,}|[-*/|]/g
  const ENTITY_TAIL = /\s+(?:SDN\s+BHD|SDN|BHD|PLT|ENTERPRISE|TRADING|HOLDINGS|GROUP)\s*$/i
  const DIGIT_TAIL = /\s*\d{3,}\s*$/
  // Reference/transaction indicators appended by the bank (stripped after
  // digit tokens are removed, so "REF 029385" becomes "REF  " → "REF")
  const REF_TAIL = /\s+(?:REF|TRANSACTION\s+REF|MY\s+REF)\s*$/i
  // Location/outlet indicators appended by the bank (descriptor + optional city code)
  // Matches "STATION KL", "PLAZA", "MALL PJ", etc.; stops at a common outlet descriptor
  const LOCATION_TAIL = /\s+(?:STATION|PLAZA|MALL|PAVILION)(?:\s+[A-Z]{2,})?\s*$/i

  function trimTails(s: string): string | null {
    const out = s
      .replace(REF_TAIL, '')
      .replace(LOCATION_TAIL, '')
      .replace(ENTITY_TAIL, '')
      .replace(DIGIT_TAIL, '')
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
      .trim()
    if (out.length < 2) return null
    return out
  }

  function titleCase(s: string): string {
    return s
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  let s = raw.replace(/\s+/g, ' ').trim()
  if (!s) return null
  s = s.replace(RAIL_PREFIX, '')
  s = s.replace(DATE_TAIL, '').replace(COUNTRY, '')
  // Strip masked and unmasked card/reference number tokens before splitting,
  // so a middle-of-string PAN never survives into the merchant head.
  s = s.replace(MASKED_TOKEN, ' ').replace(BULLET_MASK, ' ').replace(DIGIT_TOKEN, ' ')
  s = s.replace(DOMAIN_TAIL, '').replace(/[.']/g, '')
  s = s.replace(/\s+/g, ' ').trim()

  // Split on separators: the head is the merchant, the tail is the outlet/location.
  const head = trimTails(s.split(SEPARATOR)[0])
  if (head) return titleCase(head)

  // If the head is unusable, the separator was internal (e.g. "7-ELEVEN" splits to "7").
  // Fall back to the whole string with separators normalised to spaces.
  const fallback = trimTails(s.replace(SEPARATOR_ALL, ' ').replace(/\s+/g, ' ').trim())
  return fallback ? titleCase(fallback) : null
}

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

// ── AI-assisted merchant name resolution ────────────
// docs/v1/flow-plan.md. Only rows whose merchant was split out of a narrative
// column (narrativeRaw set) participate — a real merchant column is left
// untouched (spec 61's contract).

export interface MerchantResolution {
  guess: string
  name: string
  source: 'correction' | 'history' | 'ai'
}

export interface MerchantResolveResult {
  resolutions: MerchantResolution[]
  failedGuesses: string[]
  failureReason?: string
}

export async function resolveMerchants(
  items: Array<{ raw: string; guess: string }>,
): Promise<MerchantResolveResult> {
  if (items.length === 0) return { resolutions: [], failedGuesses: [] }
  return api.post<MerchantResolveResult>('/merchants/resolve', { items })
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

  // Check if merchant column is a narrative-only column (e.g. "Description", "Narrative").
  // If description is null and merchant came from a narrative keyword, we'll split it:
  // canonicalize goes to merchant, raw text goes to description.
  const isNarrativeColumn =
    mapping.merchant &&
    mapping.description === null &&
    DESCRIPTION_KEYWORDS.some((kw) => mapping.merchant?.toLowerCase().includes(kw))

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

    let merchant = merchantRaw.trim()
    let description = descriptionRaw.trim()

    // Hash is computed on the raw merchant text before canonicalization, so that
    // duplicate detection works correctly across re-imports (bank statements always
    // export the same raw narrative, not the cleaned version).
    const type = isNegative ? 'expense' : 'income'
    const hash = await computeImportHash(date, amount, merchant)

    // If merchant came from a narrative column, split it: canonicalize for merchant,
    // preserve raw text in description.
    let narrativeRaw: string | undefined
    if (isNarrativeColumn && merchant) {
      const canonical = canonicalizeMerchantForCsv(merchant)
      if (canonical) {
        narrativeRaw = merchant // keep the raw text for the AI resolution ladder
        description = merchant // raw text → description
        merchant = canonical   // canonical → merchant
      }
    }
    hashes.push(hash)

    importRows.push({
      date,
      amount,
      merchant,
      description,
      type: type as 'income' | 'expense',
      categoryId: null,
      destinationAccountId: null,
      importHash: hash,
      isDuplicate: false,
      included: true,
      originalRow: row,
      narrativeRaw,
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
