import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, FileSpreadsheet, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { parseCSV, detectColumns, buildImportRows, resolveMerchants } from '@/lib/csv'
import { suggestCategories, suggestionFitsType } from '@/lib/merchantSuggestions'
import { useToastStore } from '@/stores/toast.store'
import { TEST_HOOKS_ENABLED } from '@/lib/utils'
import type { ColumnMapping, ImportRow } from '@/lib/csv'
import type { Account } from '@/types/wallet.types'

declare global {
  interface Window {
    /** DEV/E2E-only hook so Playwright can drive file selection on the hidden input. */
    __testCsvFileSelect?: (file: File) => void
  }
}

type ModalView = 'pick' | 'map' | 'processing'

interface ImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Own accounts plus writable shared-in accounts — the same set CsvImport.tsx offers today. */
  accounts: Account[]
  /**
   * Fires once rows are built and AI-assisted resolution/suggestion have run —
   * the parent (WalletPage) navigates to the review page with these in hand.
   * The modal itself closes right before this fires.
   */
  onReady: (rows: ImportRow[], selectedAccountId: string) => void
}

/**
 * Unified import entry point — currently CSV only. Photo import (P2 in
 * docs/v2/cross-cutting/ai-usage.md) is not wired: no type segment is shown
 * because there is only one working import kind today, matching the "an
 * entry point for a feature that doesn't exist yet must not appear" posture
 * CLAUDE.md §9.3 already uses elsewhere.
 *
 * Three in-place views (pick → map → processing) replace CsvImport.tsx's
 * former standalone upload/mapping steps — only the final review stays a
 * separate page, per the mockup (transactions-import.html).
 */
export function ImportModal({ open, onOpenChange, accounts, onReady }: ImportModalProps) {
  const { addToast } = useToastStore()
  const [view, setView] = useState<ModalView>('pick')
  const [dragActive, setDragActive] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({ date: null, amount: null, merchant: null, description: null })
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [procLabel, setProcLabel] = useState('')
  const [procPct, setProcPct] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Converging conditional adjusted during render (no effect needed) — same
  // pattern CsvImport.tsx used for this before the modal rework.
  if (open && accounts.length > 0 && !selectedAccountId) {
    setSelectedAccountId(accounts[0].id)
  }

  const resetAll = useCallback(() => {
    setView('pick')
    setFile(null)
    setHeaders([])
    setRawRows([])
    setMapping({ date: null, amount: null, merchant: null, description: null })
    setParseErrors([])
    setProcLabel('')
    setProcPct(0)
  }, [])

  const handleClose = useCallback(
    (next: boolean) => {
      if (!next) resetAll()
      onOpenChange(next)
    },
    [onOpenChange, resetAll],
  )

  const handleFileSelect = useCallback(
    async (selectedFile: File) => {
      setFile(selectedFile)
      const parsed = await parseCSV(selectedFile, firstRowIsHeader)
      setHeaders(parsed.headers)
      setRawRows(parsed.rows)
      setParseErrors(parsed.errors)
      setMapping(detectColumns(parsed.headers))
      setView('map')
    },
    [firstRowIsHeader],
  )

  // E2E hook — Playwright can't reliably trigger React onChange on a hidden
  // file input (same reason CsvImport.tsx exposes this today).
  useEffect(() => {
    if (TEST_HOOKS_ENABLED) {
      window.__testCsvFileSelect = (f: File) => void handleFileSelect(f)
      return () => { delete window.__testCsvFileSelect }
    }
  }, [handleFileSelect])

  const handleToggleHeader = useCallback(
    async (isHeader: boolean) => {
      setFirstRowIsHeader(isHeader)
      if (file) {
        const parsed = await parseCSV(file, isHeader)
        setHeaders(parsed.headers)
        setRawRows(parsed.rows)
        setParseErrors(parsed.errors)
        setMapping(detectColumns(parsed.headers))
      }
    },
    [file],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      const dropped = e.dataTransfer.files[0]
      if (dropped && (dropped.name.endsWith('.csv') || dropped.type === 'text/csv')) {
        void handleFileSelect(dropped)
      }
    },
    [handleFileSelect],
  )

  // Same two AI passes CLAUDE.md §6 documents for CSV import — merchant-name
  // resolution then category suggestion — shown as in-modal progress instead
  // of an instant, unexplained jump to the review page.
  const runProcessing = useCallback(async () => {
    setView('processing')
    setProcLabel('Resolving merchant names…')
    setProcPct(50)
    try {
      const rows = await buildImportRows(rawRows, mapping)

      const narrativePairs = new Map<string, string>()
      for (const row of rows) {
        if (row.narrativeRaw) narrativePairs.set(row.merchant, row.narrativeRaw)
      }
      if (narrativePairs.size > 0) {
        try {
          const { resolutions, failedGuesses, failureReason } = await resolveMerchants(
            [...narrativePairs.entries()].map(([guess, raw]) => ({ raw, guess })),
          )
          const byGuess = new Map(resolutions.map((r) => [r.guess, r.name]))
          const failedSet = new Set(failedGuesses)
          for (const row of rows) {
            if (!row.narrativeRaw) continue
            const resolvedName = byGuess.get(row.merchant)
            if (resolvedName) {
              row.merchant = resolvedName
            } else if (failedSet.has(row.merchant)) {
              row.merchantUnresolved = true
            }
          }
          if (failedGuesses.length > 0) {
            addToast({
              message: `Couldn't clean up ${failedGuesses.length} merchant name${failedGuesses.length === 1 ? '' : 's'}${failureReason ? ` — ${failureReason}` : ''}.`,
              duration: 5000,
            })
          }
        } catch {
          addToast({ message: 'Could not resolve merchant names — using the automatic guesses instead.', duration: 4000 })
        }
      }

      setProcLabel('Suggesting categories…')
      setProcPct(100)

      const merchants = [...new Set(rows.filter((r) => r.merchant).map((r) => r.merchant))]
      let suggestions: Awaited<ReturnType<typeof suggestCategories>> = []
      try {
        suggestions = await suggestCategories(merchants)
      } catch {
        addToast({ message: 'Could not load category suggestions — import rows are uncategorised.', duration: 4000 })
      }
      if (suggestions.length > 0) {
        const byRaw = new Map(suggestions.map((s) => [s.raw, s]))
        for (const row of rows) {
          if (row.categoryId !== null || row.type === 'transfer') continue
          const hit = byRaw.get(row.merchant)
          if (!hit || !suggestionFitsType(hit, row.type)) continue
          row.categoryId = hit.categoryId
          row.suggestedFrom = { canonical: hit.canonical, matchCount: hit.matchCount }
          row.suggestionApplied = true
        }
      }

      resetAll()
      onOpenChange(false)
      onReady(rows, selectedAccountId)
    } catch {
      addToast({ message: 'Could not prepare the import — please try again.', duration: 4000 })
      setView('map')
    }
  }, [rawRows, mapping, selectedAccountId, addToast, onReady, onOpenChange, resetAll])

  const headerOptions = [{ value: '', label: '— None —' }, ...headers.map((h) => ({ value: h, label: h }))]
  const canReview = !!mapping.date && !!mapping.amount && !!selectedAccountId

  return (
    <Modal open={open} onOpenChange={handleClose} title="Import transactions" className="max-w-lg">
      {view === 'pick' && (
        <>
          {accounts.length === 0 ? (
            <div
              data-testid="csv-no-account-warning"
              className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800"
            >
              <p className="mb-3">You need at least one account before importing transactions.</p>
              <Link to="/wallet/accounts" onClick={() => handleClose(false)}>
                <Button size="sm">Create an Account</Button>
              </Link>
            </div>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files?.[0]
                  if (selected) void handleFileSelect(selected)
                }}
              />
              <label
                htmlFor="import-modal-file-input"
                className={`dropzone w-full ${dragActive ? 'drop-active' : ''}`}
                onDragEnter={(e) => { e.preventDefault(); setDragActive(true) }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={(e) => { e.preventDefault(); fileInputRef.current?.click() }}
              >
                <Upload aria-hidden="true" />
                <div className="dropzone-text">
                  <b>Drag a file here</b>, or <span className="link">browse</span>
                </div>
                <div className="dropzone-hint">CSV files exported from your bank</div>
              </label>
              <input id="import-modal-file-input" type="hidden" />

              {parseErrors.length > 0 && (
                <p className="mt-2 text-xs text-amber-700">{parseErrors.length} parsing warning(s)</p>
              )}
            </>
          )}
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => handleClose(false)}>Cancel</Button>
          </div>
        </>
      )}

      {view === 'map' && (
        <>
          <div className="map-file-chip">
            <div className="frow-thumb"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" /></div>
            <div>
              <div className="map-file-chip-name">{file?.name}</div>
              <div className="map-file-chip-sub">{rawRows.length} rows detected</div>
            </div>
          </div>

          <label className="header-toggle">
            <input
              type="checkbox"
              checked={firstRowIsHeader}
              onChange={(e) => void handleToggleHeader(e.target.checked)}
              style={{ width: 15, height: 15 }}
            />
            First row is a header
          </label>

          <div className="flist">
            <div className="maprow">
              <span className="maprow-field">Date<span className="req">*</span></span>
              <Select
                aria-label="Date column"
                options={headerOptions}
                value={mapping.date ?? ''}
                onChange={(e) => setMapping((m) => ({ ...m, date: e.target.value || null }))}
              />
            </div>
            <div className="maprow">
              <span className="maprow-field">Amount<span className="req">*</span></span>
              <Select
                aria-label="Amount column"
                options={headerOptions}
                value={mapping.amount ?? ''}
                onChange={(e) => setMapping((m) => ({ ...m, amount: e.target.value || null }))}
              />
            </div>
            <div className="maprow">
              <span className="maprow-field">Merchant</span>
              <Select
                aria-label="Merchant column"
                options={headerOptions}
                value={mapping.merchant ?? ''}
                onChange={(e) => setMapping((m) => ({ ...m, merchant: e.target.value || null }))}
              />
            </div>
            <div className="maprow">
              <span className="maprow-field">Description</span>
              <Select
                aria-label="Description column"
                options={headerOptions}
                value={mapping.description ?? ''}
                onChange={(e) => setMapping((m) => ({ ...m, description: e.target.value || null }))}
              />
            </div>
            <div className="maprow">
              <span className="maprow-field">Account<span className="req">*</span></span>
              <Select
                aria-label="Import into account"
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              className="text-fg-faint hover:text-fg-muted transition-colors"
              onClick={resetAll}
              aria-label="Start over"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setView('pick')}>Back</Button>
              <Button size="sm" onClick={() => void runProcessing()} disabled={!canReview}>Review rows</Button>
            </div>
          </div>
        </>
      )}

      {view === 'processing' && (
        <div className="modal-proc">
          <p className="proc-title">Preparing your import…</p>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${procPct}%` }} /></div>
          <p className="mt-2 text-left text-xs font-semibold text-fg-subtle">{procLabel}</p>
        </div>
      )}
    </Modal>
  )
}
