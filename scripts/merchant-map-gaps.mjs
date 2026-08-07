#!/usr/bin/env node
// docs/auto-categorisation-plan.md §3.4 "Growing the map". The builtin merchant
// map (worker/lib/merchant-map.ts) is a starting point, not a fixed asset — this
// is the repeatable way to find what it is missing, using a CSV exported from
// the app (Wallet → Export → the existing GET /transactions/export route).
//
//   npx tsx scripts/merchant-map-gaps.mjs export.csv
//
// Run via tsx (not plain node) because it imports canonicalMerchant() and
// builtinCategory() directly from worker/lib/ — the plan is explicit that gaps
// must be found with the SAME canonicaliser the Worker runs, not a
// reimplementation that can drift from it.
//
// Prints canonical names that (a) appear >= 3 times, (b) are consistently
// categorised (same category on every appearance), and (c) are NOT already
// covered by builtinCategory() — alongside the category the user picked. That
// is the same evidence the map should have been built from in the first place.

import { readFileSync } from 'node:fs'
import Papa from 'papaparse'
import { canonicalMerchant } from '../worker/lib/merchant.ts'
import { builtinCategory } from '../worker/lib/merchant-map.ts'

const path = process.argv[2]
if (!path) {
  console.error('usage: npx tsx scripts/merchant-map-gaps.mjs export.csv')
  process.exit(1)
}

const MIN_OCCURRENCES = 3

const csv = readFileSync(path, 'utf8')
const { data, errors } = Papa.parse(csv, { header: true, skipEmptyLines: true })
if (errors.length > 0) {
  console.error(`${errors.length} CSV parse warning(s); continuing with the rows that did parse.`)
}

// canonical -> { count, categories: Map<categoryName, count> }
const buckets = new Map()

for (const row of data) {
  const key = canonicalMerchant(row.merchant ?? '')
  if (!key) continue
  const category = (row.category ?? '').trim()
  if (!category) continue // uncategorised rows carry no evidence either way

  const bucket = buckets.get(key) ?? { count: 0, categories: new Map() }
  bucket.count += 1
  bucket.categories.set(category, (bucket.categories.get(category) ?? 0) + 1)
  buckets.set(key, bucket)
}

const gaps = []
for (const [canonical, bucket] of buckets) {
  if (bucket.count < MIN_OCCURRENCES) continue
  if (builtinCategory(canonical)) continue // already covered
  if (bucket.categories.size !== 1) continue // not consistently categorised — a mixed-use merchant, not a map candidate
  const [category] = bucket.categories.keys()
  gaps.push({ canonical, category, count: bucket.count })
}

gaps.sort((a, b) => b.count - a.count)

if (gaps.length === 0) {
  console.log('No gaps found — every merchant appearing >= 3 times and consistently categorised is already in the map.')
} else {
  console.log(`${gaps.length} candidate(s) for MERCHANT_MAP (worker/lib/merchant-map.ts):\n`)
  for (const { canonical, category, count } of gaps) {
    console.log(`  ${canonical.padEnd(28)} -> ${category.padEnd(20)} (seen ${count}x)`)
  }
  console.log('\nAppend the worthwhile ones to MERCHANT_MAP — one-line diff, no migration.')
  console.log('Remember: only the ten seed EXPENSE categories are valid targets (§3.4, G5).')
}
