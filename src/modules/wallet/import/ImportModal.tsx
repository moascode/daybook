import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, FileSpreadsheet, Image as ImageIcon, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { parseCSV, detectColumns, buildImportRows, resolveMerchants } from '@/lib/csv'
import { suggestCategories, suggestionFitsType } from '@/lib/merchantSuggestions'
import { extractPhotoBatch, photoResultsToImportRows, type PhotoExtractionResult } from '@/lib/photo-import'
import { useToastStore } from '@/stores/toast.store'
import { TEST_HOOKS_ENABLED } from '@/lib/utils'
import type { ColumnMapping, ImportRow } from '@/lib/csv'
import type { Account, Category } from '@/types/wallet.types'

declare global {
  interface Window {
    /** DEV/E2E-only hook so Playwright can drive file selection on the hidden input. */
    __testCsvFileSelect?: (file: File) => void
  }
}

type ModalView = 'pick' | 'map' | 'processing'
type ImportType = 'csv' | 'photo'
type PhotoKind = 'receipt' | 'statement'

export interface ImportReadyMeta {
  photoMode?: boolean
  failedPhotos?: { fileName: string; failureReason?: string }[]
}

interface ImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Own accounts plus writable shared-in accounts — the same set CsvImport.tsx offers today. */
  accounts: Account[]
  categories: Category[]
  /** Mirrors Composer's prop — gates the Photo tab. No key, no tab, CSV-only. */
  hasAnthropicKey: boolean
  /**
   * Fires once rows are built and AI-assisted resolution/suggestion have run —
   * the parent (WalletPage) navigates to the review page with these in hand.
   * The modal itself closes right before this fires. The destination account
   * is chosen on the review page, not here — extraction/mapping never needed
   * it, so asking for it up front only locked in a choice before the user
   * had seen anything to check it against.
   */
  onReady: (rows: ImportRow[], meta?: ImportReadyMeta) => void
}

/**
 * Unified import entry point — CSV and photo (P2 in
 * docs/v2/cross-cutting/ai-usage.md, approved 2026-09-06). Photo extraction
 * (`extractPhotoBatch` in `src/lib/photo-import.ts`) calls
 * `POST /transactions/import-photo`, one photo per call — see that route
 * and `worker/lib/anthropic.ts`'s `parsePhotoImportWithAI` for the real
 * Claude call. `hasAnthropicKey` gates the Photo tab: no key, no tab,
 * CSV-only — same posture CLAUDE.md §9.3 uses everywhere else an AI entry
 * point exists.
 *
 * Three in-place views (pick → map → processing) replace CsvImport.tsx's
 * former standalone upload/mapping steps — only the final review stays a
 * separate page, per the mockup (transactions-import.html).
 */
export function ImportModal({ open, onOpenChange, accounts, categories, hasAnthropicKey, onReady }: ImportModalProps) {
  const { addToast } = useToastStore()
  const [view, setView] = useState<ModalView>('pick')
  // Photo is the default once a key is set — it's the richer, less-typing
  // path. Falls back to CSV-only when there's no key to spend, same as the
  // segment itself being hidden entirely in that case (no key, no tab).
  const [importType, setImportType] = useState<ImportType>(() => (hasAnthropicKey ? 'photo' : 'csv'))
  const [photoKind, setPhotoKind] = useState<PhotoKind>('receipt')
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({ date: null, amount: null, merchant: null, description: null })
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [procLabel, setProcLabel] = useState('')
  const [procPct, setProcPct] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetAll = useCallback(() => {
    setView('pick')
    setImportType(hasAnthropicKey ? 'photo' : 'csv')
    setPhotoKind('receipt')
    setPhotoFiles([])
    setFile(null)
    setHeaders([])
    setRawRows([])
    setMapping({ date: null, amount: null, merchant: null, description: null })
    setParseErrors([])
    setProcLabel('')
    setProcPct(0)
  }, [hasAnthropicKey])

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
      onReady(rows)
    } catch {
      addToast({ message: 'Could not prepare the import — please try again.', duration: 4000 })
      setView('map')
    }
  }, [rawRows, mapping, addToast, onReady, onOpenChange, resetAll])

  // Client-side fan-out (spec §3.1): N photos is N independent calls to
  // POST /transactions/import-photo via Promise.allSettled inside
  // extractPhotoBatch, not one request carrying N images.
  const runPhotoProcessing = useCallback(async () => {
    setView('processing')
    setProcLabel(`0 of ${photoFiles.length} photos processed`)
    setProcPct(0)
    try {
      const results: PhotoExtractionResult[] = await extractPhotoBatch(photoFiles, photoKind, (done, total) => {
        setProcLabel(`${done} of ${total} photos processed`)
        setProcPct(Math.round((done / total) * 100))
      })
      const { rows, failed } = await photoResultsToImportRows(results, categories)
      resetAll()
      onOpenChange(false)
      onReady(rows, {
        photoMode: true,
        failedPhotos: failed.map((f) => ({ fileName: f.fileName, failureReason: f.failureReason })),
      })
    } catch {
      addToast({ message: 'Could not process the photos — please try again.', duration: 4000 })
      setView('pick')
    }
  }, [photoFiles, photoKind, categories, addToast, onReady, onOpenChange, resetAll])

  const headerOptions = [{ value: '', label: '— None —' }, ...headers.map((h) => ({ value: h, label: h }))]
  const canReview = !!mapping.date && !!mapping.amount
  const canExtractPhotos = photoFiles.length > 0

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
              {hasAnthropicKey && (
                <div className="segment type-segment mb-4" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={importType === 'photo'}
                    onClick={() => setImportType('photo')}
                  >
                    Photo
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={importType === 'csv'}
                    onClick={() => setImportType('csv')}
                  >
                    CSV
                  </button>
                </div>
              )}

              {importType === 'photo' && (
                <div className="mb-4">
                  <p className="field-label">What are these photos?</p>
                  <div className="segment" role="tablist">
                    <button type="button" role="tab" aria-selected={photoKind === 'receipt'} onClick={() => setPhotoKind('receipt')}>
                      Receipt
                    </button>
                    <button type="button" role="tab" aria-selected={photoKind === 'statement'} onClick={() => setPhotoKind('statement')}>
                      Bank statement
                    </button>
                  </div>
                </div>
              )}

              {importType === 'csv' ? (
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
              ) : (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const selected = Array.from(e.target.files ?? [])
                      if (selected.length > 0) setPhotoFiles(selected)
                    }}
                  />
                  <label
                    htmlFor="import-modal-photo-input"
                    className={`dropzone w-full ${dragActive ? 'drop-active' : ''}`}
                    onDragEnter={(e) => { e.preventDefault(); setDragActive(true) }}
                    onDragOver={(e) => e.preventDefault()}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragActive(false)
                      const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
                      if (dropped.length > 0) setPhotoFiles(dropped)
                    }}
                    onClick={(e) => { e.preventDefault(); fileInputRef.current?.click() }}
                  >
                    <ImageIcon aria-hidden="true" />
                    <div className="dropzone-text">
                      <b>Drag files here</b>, or <span className="link">browse</span>
                    </div>
                    <div className="dropzone-hint">JPG, PNG or WEBP · up to 10 photos</div>
                  </label>
                  <input id="import-modal-photo-input" type="hidden" />

                  {photoFiles.length > 0 && (
                    <div className="flist modal-flist mt-3">
                      {photoFiles.map((f, i) => (
                        <div className="frow" key={`${f.name}-${i}`}>
                          <div className="frow-thumb"><ImageIcon className="h-3.5 w-3.5" aria-hidden="true" /></div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="frow-name">{f.name}</div>
                            <div className="frow-size">{(f.size / 1024 / 1024).toFixed(1)} MB</div>
                          </div>
                          <div className="frow-trail">
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label="Remove"
                              onClick={() => setPhotoFiles((prev) => prev.filter((_, j) => j !== i))}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => handleClose(false)}>Cancel</Button>
            {importType === 'photo' && accounts.length > 0 && (
              <Button size="sm" onClick={() => void runPhotoProcessing()} disabled={!canExtractPhotos}>
                Extract transactions
              </Button>
            )}
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
          <p className="proc-title">{importType === 'photo' ? 'Reading your photos…' : 'Preparing your import…'}</p>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${procPct}%` }} /></div>
          <p className="mt-2 text-left text-xs font-semibold text-fg-subtle">{procLabel}</p>
        </div>
      )}
    </Modal>
  )
}
