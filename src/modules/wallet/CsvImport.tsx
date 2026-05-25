import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, FileText, AlertCircle, CheckCircle2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { WalletTabNav } from '@/modules/wallet/WalletTabNav'
import { useWallet } from '@/hooks/useWallet'
import { parseCSV, detectColumns, buildImportRows } from '@/lib/csv'
import { CsvReviewTable } from './CsvReviewTable'
import type { ColumnMapping, ImportRow } from '@/lib/csv'
import type { TransactionInput } from '@/hooks/useWallet'

type ImportStep = 'upload' | 'mapping' | 'review' | 'done'

export function CsvImport() {
  const navigate = useNavigate()
  const { accounts, loadAccounts, loadCategories, categories, importTransactions } = useWallet()
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

  useEffect(() => {
    loadAccounts()
    loadCategories()
  }, [loadAccounts, loadCategories])

  useEffect(() => {
    if (accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id)
    }
  }, [accounts, selectedAccountId])

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile)
    const parsed = await parseCSV(selectedFile)
    setHeaders(parsed.headers)
    setRawRows(parsed.rows)
    setParseErrors(parsed.errors)

    const detectedMapping = detectColumns(parsed.headers)
    setMapping(detectedMapping)
    setStep('mapping')
  }, [])

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

  const handleProceedToReview = useCallback(async () => {
    if (!mapping.date || !mapping.amount) return
    const rows = await buildImportRows(rawRows, mapping)
    setImportRows(rows)
    setStep('review')
  }, [rawRows, mapping])

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
      tag: '',
      importHash: r.importHash,
    }))

    const imported = await importTransactions(inputs)
    const skipped = importRows.filter((r) => r.isDuplicate).length
    const excluded = importRows.filter((r) => !r.included && !r.isDuplicate).length

    setResult({ imported, skipped, excluded })
    setStep('done')
    setImporting(false)
  }, [importRows, selectedAccountId, importTransactions])

  const updateRow = useCallback((index: number, updates: Partial<ImportRow>) => {
    setImportRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...updates } : row)),
    )
  }, [])

  const headerOptions = [
    { value: '', label: '— None —' },
    ...headers.map((h) => ({ value: h, label: h })),
  ]
  const includedCount = importRows.filter((r) => r.included).length
  const duplicateCount = importRows.filter((r) => r.isDuplicate).length

  return (
    <div className="p-6">
      {/* Section header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">Wallet</h1>
      </div>

      {/* Tab navigation */}
      <WalletTabNav />

      {/* ── Upload step ──────────────────────────────── */}
      {step === 'upload' && (
        <div className="mx-auto max-w-xl pt-4">
          <h2 className="mb-6 text-base font-semibold text-gray-900">Import Transactions from CSV</h2>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="flex flex-col items-center rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 text-center transition-colors hover:border-brand-400"
          >
            <Upload className="mb-4 h-10 w-10 text-gray-300" />
            <p className="mb-2 text-sm font-medium text-gray-700">
              Drop a CSV file here, or click to browse
            </p>
            <p className="mb-4 text-xs text-gray-400">
              Supported: bank statements, transaction exports (.csv)
            </p>
            <label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileInput}
                className="hidden"
              />
              <Button variant="secondary" size="sm" className="cursor-pointer" onClick={() => {}}>
                Choose File
              </Button>
            </label>
          </div>
        </div>
      )}

      {/* ── Column mapping step ──────────────────────── */}
      {step === 'mapping' && (
        <div className="mx-auto max-w-xl pt-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Map Columns</h2>
            <button onClick={() => setStep('upload')} className="text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          {file && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
              <FileText className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-600">{file.name}</span>
              <span className="text-xs text-gray-400">({rawRows.length} rows)</span>
            </div>
          )}

          {parseErrors.length > 0 && (
            <div className="mb-4 rounded-lg bg-amber-50 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                <AlertCircle className="h-4 w-4" />
                {parseErrors.length} parsing warning(s)
              </div>
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
            <Select
              label="Date column"
              options={headerOptions}
              value={mapping.date ?? ''}
              onChange={(e) => setMapping((m) => ({ ...m, date: e.target.value || null }))}
            />
            <Select
              label="Amount column"
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
              label="Import into account"
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep('upload')}>
              Back
            </Button>
            <Button
              onClick={handleProceedToReview}
              disabled={!mapping.date || !mapping.amount || !selectedAccountId}
            >
              Review Rows
            </Button>
          </div>
        </div>
      )}

      {/* ── Review step ────────────────────────────────*/}
      {step === 'review' && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Review Import</h2>
              <p className="text-sm text-gray-500">
                {includedCount} to import, {duplicateCount} duplicate(s) skipped
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setStep('mapping')}>
                Back
              </Button>
              <Button size="sm" onClick={handleImport} disabled={importing || includedCount === 0}>
                {importing ? 'Importing...' : `Import ${includedCount} Transactions`}
              </Button>
            </div>
          </div>

          <CsvReviewTable
            rows={importRows}
            categories={categories}
            onRowChange={updateRow}
            onToggleInclude={(index) =>
              updateRow(index, { included: !importRows[index].included })
            }
          />
        </div>
      )}

      {/* ── Done step ──────────────────────────────────*/}
      {step === 'done' && (
        <div className="mx-auto max-w-md pt-12 text-center">
          <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
          <h2 className="text-lg font-semibold text-gray-900">Import Complete</h2>
          {result && (
            <div className="mt-3 space-y-1 text-sm text-gray-600">
              <p>{result.imported} transaction(s) imported</p>
              {result.skipped > 0 && <p>{result.skipped} duplicate(s) skipped</p>}
              {result.excluded > 0 && <p>{result.excluded} excluded by you</p>}
            </div>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Button variant="secondary" onClick={() => { setStep('upload'); setFile(null); setImportRows([]) }}>
              Import Another
            </Button>
            <Button onClick={() => navigate('/wallet')}>
              View Transactions
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
