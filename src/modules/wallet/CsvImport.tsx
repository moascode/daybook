import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Upload, FileText, AlertCircle, CheckCircle2, X, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { useWallet } from '@/hooks/useWallet'
import { useToastStore } from '@/stores/toast.store'
import { parseCSV, detectColumns, buildImportRows } from '@/lib/csv'
import { CsvReviewTable } from './CsvReviewTable'
import type { ColumnMapping, ImportRow } from '@/lib/csv'
import type { TransactionInput } from '@/hooks/useWallet'

type ImportStep = 'upload' | 'mapping' | 'review' | 'done'

declare global {
  interface Window {
    /** DEV/E2E-only hook so Playwright can drive file selection on the hidden input. */
    __testCsvFileSelect?: (file: File) => void
  }
}

export function CsvImport() {
  const navigate = useNavigate()
  const { accounts, loadAccounts, loadCategories, categories, importTransactions, setFilters } = useWallet()
  const { addToast } = useToastStore()

  const [step, setStep] = useState<ImportStep>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({ date: null, amount: null, merchant: null, description: null })
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; excluded: number } | null>(null)
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true)

  // Ref to trigger the hidden file input programmatically — avoids the
  // HTML quirk where a <button> inside a <label> blocks the file picker.
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Must be declared before the useEffect that references it in its deps array.
  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile)
    const parsed = await parseCSV(selectedFile, firstRowIsHeader)
    setHeaders(parsed.headers)
    setRawRows(parsed.rows)
    setParseErrors(parsed.errors)
    setMapping(detectColumns(parsed.headers))
    setStep('mapping')
  }, [firstRowIsHeader])

  useEffect(() => {
    loadAccounts()
    loadCategories()
  }, [loadAccounts, loadCategories])

  // Expose file handler for E2E testing (Playwright can't reliably trigger React onChange on hidden file inputs)
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__testCsvFileSelect = (file: File) => handleFileSelect(file)
      return () => { delete window.__testCsvFileSelect }
    }
  }, [handleFileSelect])

  // Default to the first account once accounts load — converging conditional
  // adjusted during render (no effect needed).
  if (accounts.length > 0 && !selectedAccountId) {
    setSelectedAccountId(accounts[0].id)
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile && (droppedFile.name.endsWith('.csv') || droppedFile.type === 'text/csv')) {
        handleFileSelect(droppedFile)
      }
    },
    [handleFileSelect],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0]
      if (selected) handleFileSelect(selected)
    },
    [handleFileSelect],
  )

  // Re-parse the current file when the header toggle changes.
  const handleToggleHeader = useCallback(async (isHeader: boolean) => {
    setFirstRowIsHeader(isHeader)
    if (file) {
      const parsed = await parseCSV(file, isHeader)
      setHeaders(parsed.headers)
      setRawRows(parsed.rows)
      setParseErrors(parsed.errors)
      setMapping(detectColumns(parsed.headers))
    }
  }, [file])

  const handleProceedToReview = useCallback(async () => {
    if (!mapping.date || !mapping.amount) return
    try {
      const rows = await buildImportRows(rawRows, mapping)
      setImportRows(rows)
      setStep('review')
    } catch {
      addToast({ message: 'Could not prepare the import — please try again.', duration: 4000 })
    }
  }, [rawRows, mapping, addToast])

  const handleImport = useCallback(async () => {
    if (!selectedAccountId) return
    setImporting(true)

    const toImport = importRows.filter((r) => r.included)
    const inputs: TransactionInput[] = toImport.map((r) => ({
      accountId: selectedAccountId,
      date: r.date,
      merchant: r.merchant,
      description: r.description,
      amount: r.amount,
      type: r.type,
      categoryId: r.categoryId,
      tags: [],
      importHash: r.importHash,
    }))

    try {
      const imported = await importTransactions(inputs)
      const skipped = importRows.filter((r) => r.isDuplicate).length
      const excluded = importRows.filter((r) => !r.included && !r.isDuplicate).length

      setResult({ imported, skipped, excluded })
      setStep('done')
    } catch {
      // Import is atomic on the server; on failure nothing was saved.
      addToast({ message: 'Import failed — no transactions were saved.', duration: 4000 })
    } finally {
      setImporting(false)
    }
  }, [importRows, selectedAccountId, importTransactions, addToast])

  const updateRow = useCallback((index: number, updates: Partial<ImportRow>) => {
    setImportRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...updates } : row)))
  }, [])

  const resetToUpload = () => {
    setStep('upload')
    setFile(null)
    setImportRows([])
    setHeaders([])
    setRawRows([])
    setResult(null)
  }

  const headerOptions = [
    { value: '', label: '— None —' },
    ...headers.map((h) => ({ value: h, label: h })),
  ]
  const includedCount = importRows.filter((r) => r.included).length
  const duplicateCount = importRows.filter((r) => r.isDuplicate).length

  return (
    <div className="max-w-3xl mx-auto">

      {/* ── Upload ───────────────────────────────────────────── */}
      {step === 'upload' && (
        <>
          <div className="mb-5">
            <h2 className="text-base font-semibold text-gray-900">Import from CSV</h2>
            <p className="text-xs text-gray-500 mt-0.5">Bank statements, transaction exports (.csv)</p>
          </div>

          {/* No-account guard */}
          {accounts.length === 0 ? (
            <div
              data-testid="csv-no-account-warning"
              className="flex flex-col items-center rounded-2xl border border-amber-200 bg-amber-50 p-12 text-center"
            >
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
                <Wallet className="h-6 w-6 text-amber-500" />
              </div>
              <p className="mb-1 text-sm font-semibold text-amber-800">No accounts yet</p>
              <p className="mb-5 text-xs text-amber-700">
                You need at least one account before importing transactions.
              </p>
              <Link to="/wallet/accounts">
                <Button size="sm">Create an Account</Button>
              </Link>
            </div>
          ) : (
            <>
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileInput}
                className="hidden"
              />

              {/* Drop zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="flex flex-col items-center rounded-2xl border-2 border-dashed border-gray-200 bg-white p-14 text-center transition-colors hover:border-brand-300 hover:bg-brand-50/30 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
                  <Upload className="h-6 w-6 text-gray-400" />
                </div>
                <p className="mb-1 text-sm font-semibold text-gray-700">Drop a CSV file here</p>
                <p className="mb-5 text-xs text-gray-400">or click anywhere in this area to browse</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                >
                  Choose File
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Column mapping ────────────────────────────────────── */}
      {step === 'mapping' && (
        <>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Map Columns</h2>
              <p className="text-xs text-gray-500 mt-0.5">Tell us which CSV column maps to which field</p>
            </div>
            <button onClick={resetToUpload} className="text-gray-400 hover:text-gray-600 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {file && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-700 font-medium">{file.name}</span>
              <span className="text-xs text-gray-400 ml-auto">{rawRows.length} rows</span>
            </div>
          )}

          {parseErrors.length > 0 && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
              <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
              <span className="text-sm text-amber-700">{parseErrors.length} parsing warning(s)</span>
            </div>
          )}

          {/* Header row toggle */}
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5">
            <input
              type="checkbox"
              id="firstRowIsHeader"
              checked={firstRowIsHeader}
              onChange={(e) => handleToggleHeader(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 cursor-pointer"
            />
            <label htmlFor="firstRowIsHeader" className="text-sm text-gray-700 cursor-pointer select-none">
              First row is a header (column names)
            </label>
            <span className="ml-auto text-xs text-gray-400">
              {firstRowIsHeader ? 'Header row excluded from import' : 'All rows included as data'}
            </span>
          </div>

          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
            <Select
              label="Date column *"
              options={headerOptions}
              value={mapping.date ?? ''}
              onChange={(e) => setMapping((m) => ({ ...m, date: e.target.value || null }))}
            />
            <Select
              label="Amount column *"
              options={headerOptions}
              value={mapping.amount ?? ''}
              onChange={(e) => setMapping((m) => ({ ...m, amount: e.target.value || null }))}
            />
            <Select
              label="Merchant / Description column"
              options={headerOptions}
              value={mapping.merchant ?? ''}
              onChange={(e) => setMapping((m) => ({ ...m, merchant: e.target.value || null }))}
            />
            <Select
              label="Additional description column (optional)"
              options={headerOptions}
              value={mapping.description ?? ''}
              onChange={(e) => setMapping((m) => ({ ...m, description: e.target.value || null }))}
            />
            <Select
              label="Import into account *"
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={resetToUpload}>Back</Button>
            <Button
              size="sm"
              onClick={handleProceedToReview}
              disabled={!mapping.date || !mapping.amount || !selectedAccountId}
            >
              Review Rows →
            </Button>
          </div>
        </>
      )}

      {/* ── Review ────────────────────────────────────────────── */}
      {step === 'review' && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Review Import</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {includedCount} to import · {duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''} skipped
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setStep('mapping')}>Back</Button>
              <Button
                size="sm"
                onClick={handleImport}
                disabled={importing || includedCount === 0}
              >
                {importing ? 'Importing…' : `Import ${includedCount} Transactions`}
              </Button>
            </div>
          </div>

          <CsvReviewTable
            rows={importRows}
            categories={categories}
            onRowChange={updateRow}
            onToggleInclude={(index) => updateRow(index, { included: !importRows[index].included })}
          />
        </>
      )}

      {/* ── Done ──────────────────────────────────────────────── */}
      {step === 'done' && (
        <div className="mx-auto max-w-sm pt-12 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Import Complete</h2>
          {result && (
            <div className="mt-3 space-y-1 text-sm text-gray-500">
              <p><span className="font-semibold text-gray-800">{result.imported}</span> transaction{result.imported !== 1 ? 's' : ''} imported</p>
              {result.skipped > 0 && <p>{result.skipped} duplicate{result.skipped !== 1 ? 's' : ''} skipped</p>}
              {result.excluded > 0 && <p>{result.excluded} excluded by you</p>}
            </div>
          )}
          <div className="mt-7 flex justify-center gap-3">
            <Button variant="secondary" size="sm" onClick={resetToUpload}>Import Another</Button>
            <Button size="sm" onClick={() => { setFilters({ dateFrom: '', dateTo: '' }); navigate('/wallet') }}>View Transactions</Button>
          </div>
        </div>
      )}
    </div>
  )
}
