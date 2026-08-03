import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import { api } from '../api/client.js'
import { CREDIT_KIND_LABELS, FINANCE_CATEGORIES, FINANCE_CATEGORY_COLORS } from '../constants/categories.js'
import { processCSVRows } from '../utils/csvHelpers.js'
import { runImportQueue, sourceNameFromFile } from '../utils/importQueue.js'
import { annotateDuplicates, duplicateFlags } from '../utils/duplicates.js'
import { errorStatus } from '../utils/diagnostics.js'
import ErrorBanner from '../components/ErrorBanner.jsx'
import CsvMappingModal from '../components/CsvMappingModal.jsx'
import BulkImportReviewModal from '../components/BulkImportReviewModal.jsx'
import AddTransactionModal from '../components/AddTransactionModal.jsx'

const FINANCE_CAT_SET = new Set(FINANCE_CATEGORIES)
const SOURCE_NAME_KEY = 'visionSource_finances'

const SUMMARY_PERIODS = [
  { key: '7D',  label: '7D' },
  { key: '1M',  label: '1M' },
  { key: '3M',  label: '3M' },
  { key: '6M',  label: '6M' },
  { key: '1Y',  label: '1Y' },
  { key: 'YTD', label: 'YTD' },
  { key: 'All', label: 'All' },
]

function buildPeriodData(transactions, cardCredits, period) {
  function sumBucket(txs, credits) {
    const income = txs
      .filter(t => t.category === 'Income' || (t.type === 'income' && !FINANCE_CAT_SET.has(t.category)))
      .reduce((s, t) => s + Math.abs(t.amount), 0)
    const savings = txs
      .filter(t => t.category === 'Savings')
      .reduce((s, t) => s + Math.abs(t.amount), 0)
    const expenses = txs
      .filter(t => t.category === 'Expense' || (t.type === 'expense' && !FINANCE_CAT_SET.has(t.category)))
      .reduce((s, t) => s + Math.abs(t.amount), 0)
    const investments = txs
      .filter(t => t.category === 'Investments')
      .reduce((s, t) => s + Math.abs(t.amount), 0)
    return {
      Income: Math.round(income * 100) / 100,
      Savings: Math.round(savings * 100) / 100,
      Expenses: Math.round(expenses * 100) / 100,
      Investments: Math.round(investments * 100) / 100,
      Credits: Math.round(credits.reduce((s, t) => s + Math.abs(t.amount), 0) * 100) / 100,
    }
  }

  const today = dayjs()

  if (period === '7D') {
    return Array.from({ length: 7 }, (_, i) => {
      const date = today.subtract(6 - i, 'day').format('YYYY-MM-DD')
      const match = t => t.date === date
      return {
        period: dayjs(date).format('MMM D'),
        ...sumBucket(transactions.filter(match), cardCredits.filter(match)),
      }
    })
  }

  if (period === '1M') {
    return Array.from({ length: 4 }, (_, i) => {
      const weekEnd = today.subtract((3 - i) * 7, 'day')
      const weekStart = weekEnd.subtract(6, 'day')
      const match = t => {
        const d = dayjs(t.date)
        return d.isAfter(weekStart.subtract(1, 'day')) && d.isBefore(weekEnd.add(1, 'day'))
      }
      return {
        period: weekStart.format('MMM D'),
        ...sumBucket(transactions.filter(match), cardCredits.filter(match)),
      }
    })
  }

  let months
  if (period === '3M') {
    months = Array.from({ length: 3 }, (_, i) => today.subtract(2 - i, 'month').format('YYYY-MM'))
  } else if (period === '6M') {
    months = Array.from({ length: 6 }, (_, i) => today.subtract(5 - i, 'month').format('YYYY-MM'))
  } else if (period === '1Y') {
    months = Array.from({ length: 12 }, (_, i) => today.subtract(11 - i, 'month').format('YYYY-MM'))
  } else if (period === 'YTD') {
    const startMonth = today.startOf('year')
    const count = today.diff(startMonth, 'month') + 1
    months = Array.from({ length: count }, (_, i) => startMonth.add(i, 'month').format('YYYY-MM'))
  } else {
    // Card credits can fall in a month with no bank activity; without the union they'd vanish.
    months = [...new Set(
      [...transactions, ...cardCredits].map(t => t.date?.slice(0, 7)).filter(Boolean),
    )].sort()
  }

  return months.map(month => {
    const match = t => t.date?.startsWith(month)
    return {
      period: dayjs(month + '-01').format('MMM YY'),
      ...sumBucket(transactions.filter(match), cardCredits.filter(match)),
    }
  })
}


export default function Finances({ demoMode }) {
  const fileInputRef = useRef()
  const pendingUploadMetaRef = useRef(null)
  const tableRef = useRef()
  const queryClient = useQueryClient()

  const [csvModalData, setCsvModalData] = useState(null)
  const [reviewData, setReviewData] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [summaryPeriod, setSummaryPeriod] = useState('6M')
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false)
  const [importStatus, setImportStatus] = useState(null)
  const [editingCategoryId, setEditingCategoryId] = useState(null)
  const [linkingTxId, setLinkingTxId] = useState(null)

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: api.transactions.list,
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })

  const { data: savingsAccounts = [] } = useQuery({
    queryKey: ['savings-accounts'],
    queryFn: api.savingsAccounts.list,
  })

  // Card credits are read-only here. They live only in the card ledger — copying them into
  // db.transactions would leave two rows for one event and no way to keep them in step.
  const { data: cardTransactions = [] } = useQuery({
    queryKey: ['credit_card_transactions'],
    queryFn: api.creditCardTransactions.list,
  })

  const cardCredits = useMemo(
    () => cardTransactions.filter(t => Number(t.amount) > 0),
    [cardTransactions],
  )
  const countCreditsAsIncome = !!settings?.countCardCreditsAsIncome

  const allCategories = FINANCE_CATEGORIES
  const allCategoryColors = FINANCE_CATEGORY_COLORS

  const hasAiKey = settings?.aiProvider === 'openai' ? !!settings?.hasOpenaiApiKey : !!settings?.hasClaudeApiKey

  const historyMutation = useMutation({
    mutationFn: api.uploadHistory.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['upload-history'] }),
  })

  const batchMutation = useMutation({
    mutationFn: api.transactions.batch,
    onSuccess: (imported) => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      setCsvModalData(null)
      setReviewData(null)
      setImportStatus({ type: 'success', message: `Imported ${imported.length} transactions.` })
      setTimeout(() => setImportStatus(null), 4000)
      // One history entry per uploaded file, not per batch.
      for (const meta of pendingUploadMetaRef.current ?? []) {
        historyMutation.mutate({
          filename: meta.filename,
          sourceName: meta.sourceName ?? '',
          transactionCount: meta.transactionCount ?? 0,
        })
      }
      pendingUploadMetaRef.current = null
    },
    onError: (err) => {
      pendingUploadMetaRef.current = null
      setImportStatus(errorStatus(err, { action: 'bank statement import', stage: 'batch save' }))
    },
  })

  const addMutation = useMutation({
    mutationFn: api.transactions.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      setShowAddModal(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: api.transactions.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions'] }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }) => api.transactions.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions'] }),
  })

  const saveMappingMutation = useMutation({
    mutationFn: (newSources) => api.settings.update({ csvSources: newSources }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const settingsMutation = useMutation({
    mutationFn: (patch) => api.settings.update(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  function downloadCsvTemplate() {
    const rows = [
      ['Date', 'Description', 'Amount'],
      ['2026-01-15', 'Direct Deposit - Employer', '2500.00'],
      ['2026-01-18', 'Grocery Store', '-67.42'],
      ['2026-01-20', 'Electric Bill', '-110.00'],
      ['2026-01-22', 'Transfer to Savings', '-500.00'],
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'bank-statement-template.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function handleFileChange(e) {
    if (demoMode) return
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    e.target.value = ''
    setCsvModalData(null)
    setImportStatus({ type: 'loading', message: 'Reading statements…' })

    try {
      const { groups, skipped, needsMapping } = await runImportQueue(files, {
        statementType: 'bank',
        csvSources: settings?.csvSources || {},
        hasAiKey,
        onProgress: ({ index, total, fileName, stage }) => setImportStatus({
          type: 'loading',
          message: total > 1 ? `${stage} — ${fileName} (${index} of ${total})` : `${stage} — ${fileName}`,
        }),
      })

      setImportStatus(null)

      // A lone file whose columns couldn't be worked out falls back to mapping by hand.
      if (needsMapping) {
        setCsvModalData({ headers: needsMapping.headers, rows: needsMapping.rows, fileName: needsMapping.file.name })
        return
      }

      if (!groups.length) {
        const first = skipped[0]
        setImportStatus({
          type: 'error',
          message: files.length === 1
            ? (first?.reason ?? 'Nothing could be imported from this file.')
            : `None of the ${files.length} files could be read. First problem: ${first?.reason ?? 'unknown'}`,
          report: first?.report,
        })
        return
      }

      const savedName = localStorage.getItem(SOURCE_NAME_KEY) || ''
      const named = groups.map(g => ({
        ...g,
        sourceName: g.sourceName || savedName || sourceNameFromFile(g.fileName),
      }))
      const { groups: annotated } = annotateDuplicates(named, transactions)
      setReviewData({ groups: annotated, skipped })
    } catch (err) {
      setImportStatus(errorStatus(err, { action: 'bank statement import', stage: 'import queue' }))
    }
  }

  function handleReviewConfirm(readyGroups) {
    const newSources = { ...(settings?.csvSources || {}) }
    let changed = false
    for (const g of readyGroups) {
      if (g.mapping) {
        newSources[g.sourceName] = g.mapping
        changed = true
      }
    }
    if (changed) saveMappingMutation.mutate(newSources)
    localStorage.setItem(SOURCE_NAME_KEY, readyGroups[0].sourceName)
    pendingUploadMetaRef.current = readyGroups.map(g => ({
      filename: g.fileName,
      sourceName: g.sourceName,
      transactionCount: g.transactions.length,
    }))
    batchMutation.mutate(readyGroups.flatMap(g => g.transactions))
  }

  // Opens the manual column mapper for one group already sitting in the review modal.
  function handleRemap(group) {
    setReviewData(prev => ({ ...prev, groups: prev.groups.filter(g => g.id !== group.id) }))
    setCsvModalData({
      headers: group.headers,
      rows: group.rows,
      fileName: group.fileName,
      initialSourceName: group.sourceName,
    })
  }

  function handleMappingConfirm(sourceName, mapping) {
    const newSources = { ...(settings?.csvSources || {}), [sourceName]: mapping }
    saveMappingMutation.mutate(newSources)
    const txs = processCSVRows(csvModalData.rows, { ...mapping, sourceName })
    pendingUploadMetaRef.current = [{
      filename: csvModalData.fileName ?? 'unknown',
      sourceName,
      transactionCount: txs.length,
    }]
    batchMutation.mutate(txs)
  }

  const availableMonths = [
    ...new Set(transactions.map(t => t.date?.slice(0, 7)).filter(Boolean)),
  ].sort().reverse()

  // Compared across the whole ledger, not the visible month, so a duplicate that straddles a
  // month boundary still surfaces.
  const { groupCount: duplicateSetCount, byId: duplicateById } = useMemo(
    () => duplicateFlags(transactions),
    [transactions],
  )

  const inFilterMonth = t => filterMonth === 'all' || t.date?.startsWith(filterMonth)

  const bankRows = transactions
    .filter(inFilterMonth)
    .filter(t => !showDuplicatesOnly || duplicateById.has(t.id))
    .filter(t => {
      if (filterType === 'all') return true
      if (filterType === 'savings') return t.category === 'Savings'
      if (filterType === 'investments') return t.category === 'Investments'
      if (filterType === 'income') return t.type === 'income'
      if (filterType === 'expense') return t.type === 'expense' && t.category !== 'Savings' && t.category !== 'Investments'
      return t.type === filterType
    })

  // Card credits are shown inline for context but belong to the card ledger, so they are not
  // editable here and are left out of the duplicate view, which only spans bank rows.
  const creditRows = (showDuplicatesOnly || (filterType !== 'all' && filterType !== 'income'))
    ? []
    : cardCredits.filter(inFilterMonth).map(t => ({ ...t, _cardCredit: true }))

  const filtered = [...bankRows, ...creditRows]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const periodData = buildPeriodData(transactions, cardCredits, summaryPeriod)
  const sumOf = key => Math.round(periodData.reduce((s, m) => s + m[key], 0) * 100) / 100
  const totalIncome = sumOf('Income')
  const totalSavings = sumOf('Savings')
  const totalExpenses = sumOf('Expenses')
  const totalInvestments = sumOf('Investments')
  const totalCredits = sumOf('Credits')
  // A statement credit shrinks the card bill, and that bill is already an expense here, so the
  // saving is baked into the expense total. Adding credits to income too would count it twice —
  // hence off by default.
  const netCash = Math.round(
    (totalIncome - totalExpenses + (countCreditsAsIncome ? totalCredits : 0)) * 100,
  ) / 100
  const barMax = Math.max(totalIncome, totalSavings, totalInvestments, totalExpenses, 1)
  const hasChartData = transactions.length > 0
  const periodLabel = summaryPeriod === 'YTD' ? 'YTD' : summaryPeriod === 'All' ? 'All Time' : `Last ${summaryPeriod}`

  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-gray-900">Finances</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => !demoMode && setShowAddModal(true)}
            disabled={demoMode}
            title={demoMode ? 'Unavailable in Demo Mode' : undefined}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            + Add Transaction
          </button>
          <button
            onClick={downloadCsvTemplate}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            CSV Template
          </button>
          <button
            onClick={() => !demoMode && fileInputRef.current.click()}
            disabled={batchMutation.isPending || importStatus?.type === 'loading' || demoMode}
            title={demoMode ? 'Unavailable in Demo Mode' : undefined}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {batchMutation.isPending || importStatus?.type === 'loading' ? 'Importing…' : 'Upload Bank Statements'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,.xlsb,.xls,.pdf"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {duplicateSetCount > 0 && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-center justify-between gap-3">
          <span>
            You have <strong>{duplicateSetCount}</strong> set{duplicateSetCount !== 1 ? 's' : ''} of possible duplicate
            transaction{duplicateSetCount !== 1 ? 's' : ''}. Delete the extra copy, or mark it as not a duplicate.
          </span>
          <button
            onClick={() => {
              setShowDuplicatesOnly(true)
              setFilterMonth('all')
              setFilterType('all')
              setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
            }}
            className="shrink-0 px-3 py-1 text-xs font-medium bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md transition-colors"
          >
            Review Now
          </button>
        </div>
      )}

      {importStatus?.type === 'error' ? (
        <ErrorBanner
          className="mb-4"
          message={importStatus.message}
          report={importStatus.report}
          onDismiss={() => setImportStatus(null)}
        />
      ) : importStatus && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm flex items-center justify-between ${
            importStatus.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-blue-50 text-blue-800 border border-blue-200'
          }`}
        >
          {importStatus.message}
          {importStatus.type !== 'loading' && (
            <button onClick={() => setImportStatus(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          )}
        </div>
      )}

      {hasChartData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-medium text-gray-500 mb-4">Income vs Expenses — {periodLabel}</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={periodData} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} tickFormatter={v => `$${v}`} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v, name) => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, name]}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Income" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="Savings" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="Investments" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="Expenses" fill="#f87171" radius={[4, 4, 0, 0]} maxBarSize={24} />
                {totalCredits > 0 && (
                  <Bar dataKey="Credits" name="Card Credits" fill="#a3e635" radius={[4, 4, 0, 0]} maxBarSize={24} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-medium text-gray-500">Total Income, Savings &amp; Expenses</h2>
              <div className="flex gap-1">
                {SUMMARY_PERIODS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setSummaryPeriod(p.key)}
                    className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                      summaryPeriod === p.key
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={`grid grid-cols-2 gap-3 mb-6 ${totalCredits > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
              <div>
                <p className="text-xl font-semibold text-green-600">
                  ${totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-gray-400 mt-1">Income</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-teal-500">
                  ${totalSavings.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-gray-400 mt-1">Savings</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-indigo-500">
                  ${totalInvestments.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-gray-400 mt-1">Investments</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-red-500">
                  ${totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-gray-400 mt-1">Expenses</p>
              </div>
              {totalCredits > 0 && (
                <div>
                  <p className="text-xl font-semibold text-lime-600">
                    ${totalCredits.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Card Credits</p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Income</span>
                  <span className="text-green-600 font-medium">${totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-400 rounded-full transition-all duration-500"
                    style={{ width: `${(totalIncome / barMax) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Savings</span>
                  <span className="text-teal-500 font-medium">${totalSavings.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-400 rounded-full transition-all duration-500"
                    style={{ width: `${(totalSavings / barMax) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Investments</span>
                  <span className="text-indigo-500 font-medium">${totalInvestments.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-400 rounded-full transition-all duration-500"
                    style={{ width: `${(totalInvestments / barMax) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Expenses</span>
                  <span className="text-red-500 font-medium">${totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-400 rounded-full transition-all duration-500"
                    style={{ width: `${(totalExpenses / barMax) * 100}%` }}
                  />
                </div>
              </div>

              {totalCredits > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Card Credits</span>
                    <span className="text-lime-600 font-medium">${totalCredits.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-lime-400 rounded-full transition-all duration-500"
                      style={{ width: `${(totalCredits / barMax) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-gray-100 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    Net Cash{' '}
                    <span className="text-gray-300">
                      (Income − Expenses{countCreditsAsIncome && totalCredits > 0 ? ' + Card Credits' : ''})
                    </span>
                  </span>
                  <span className={`text-sm font-semibold ${netCash >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {netCash >= 0 ? '+' : '−'}${Math.abs(netCash).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Savings</span>
                  <span className="text-sm font-semibold text-teal-500">
                    +${totalSavings.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {totalCredits > 0 && (
                <label className="flex items-start gap-2 pt-3 border-t border-gray-100 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={countCreditsAsIncome}
                    disabled={demoMode || settingsMutation.isPending}
                    onChange={e => settingsMutation.mutate({ countCardCreditsAsIncome: e.target.checked })}
                    className="mt-0.5 rounded border-gray-300 text-lime-600 focus:ring-lime-500 disabled:opacity-50"
                  />
                  <span className="text-xs text-gray-400 leading-relaxed">
                    Count card credits toward income and Net Cash. Off by default: a statement credit
                    makes your card bill smaller, and that bill is already counted as an expense here,
                    so adding it to income as well counts the same money twice.
                  </span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      <div ref={tableRef} className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-gray-500">Filter:</span>
          <select
            value={filterMonth}
            onChange={e => setFilterMonth(e.target.value)}
            className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All months</option>
            {availableMonths.map(m => (
              <option key={m} value={m}>{dayjs(m + '-01').format('MMM YYYY')}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expenses</option>
            <option value="savings">Savings</option>
            <option value="investments">Investments</option>
          </select>
          {showDuplicatesOnly && (
            <button
              onClick={() => setShowDuplicatesOnly(false)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300 rounded-full hover:bg-amber-200 transition-colors"
            >
              Possible duplicates only ✕
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400">
            {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            {showDuplicatesOnly ? (
              <p className="text-gray-400 text-sm">No possible duplicates left.</p>
            ) : (
              <>
                <p className="text-gray-400 text-sm">No transactions yet.</p>
                <p className="text-gray-300 text-xs mt-1">Upload a bank statement or add one manually.</p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Source</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(tx => {
                  if (tx._cardCredit) {
                    return (
                      <tr key={`cc-${tx.id}`} className="bg-lime-50/40 hover:bg-lime-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {tx.date ? dayjs(tx.date).format('MMM D, YYYY') : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 max-w-xs">
                          <div className="truncate">{tx.description}</div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            Card credit — edit on the Spend Analyzer
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-lime-100 text-lime-700">
                            {CREDIT_KIND_LABELS[tx.creditKind || 'credit'] ?? 'Credit'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell">{tx.source || '—'}</td>
                        <td className="px-4 py-3 text-sm font-medium text-right whitespace-nowrap text-lime-600">
                          +${Math.abs(tx.amount).toFixed(2)}
                        </td>
                        <td className="px-4 py-3"></td>
                      </tr>
                    )
                  }
                  const dup = duplicateById.get(tx.id)
                  return (
                  <tr key={tx.id} className={`transition-colors ${dup ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-gray-50'}`}>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {tx.date ? dayjs(tx.date).format('MMM D, YYYY') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-xs">
                      <div className="truncate">
                        {tx.description || <span className="text-gray-300 italic">No description</span>}
                      </div>
                      {dup && (
                        <div className="flex items-center gap-2 mt-1 text-xs">
                          <span className="text-amber-700">
                            Possible duplicate{dup.otherDate ? ` of ${dayjs(dup.otherDate).format('MMM D')}` : ''}
                          </span>
                          {!demoMode && (
                            <button
                              onClick={() => updateMutation.mutate({ id: tx.id, dupDismissed: true })}
                              className="text-gray-400 hover:text-gray-700 underline"
                            >
                              Not a duplicate
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingCategoryId === tx.id ? (
                        <select
                          autoFocus
                          defaultValue={tx.category || 'Other'}
                          onChange={e => {
                            updateMutation.mutate({ id: tx.id, category: e.target.value })
                            setEditingCategoryId(null)
                          }}
                          onBlur={() => setEditingCategoryId(null)}
                          className="text-xs border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {allCategories.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      ) : (
                        <span
                          onClick={() => !demoMode && setEditingCategoryId(tx.id)}
                          title={demoMode ? undefined : 'Click to edit category'}
                          className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-75 transition-opacity"
                          style={{
                            backgroundColor: (allCategoryColors[tx.category] || '#94a3b8') + '1a',
                            color: allCategoryColors[tx.category] || '#94a3b8',
                          }}
                        >
                          {tx.category || 'Other'}
                        </span>
                      )}
                      {tx.category === 'Savings' && savingsAccounts.length > 0 && (
                        <div className="mt-1">
                          {linkingTxId === tx.id ? (
                            <select
                              autoFocus
                              defaultValue={tx.linkedSavingsAccountId || ''}
                              onChange={e => {
                                updateMutation.mutate({ id: tx.id, linkedSavingsAccountId: e.target.value || null })
                                setLinkingTxId(null)
                              }}
                              onBlur={() => setLinkingTxId(null)}
                              className="text-xs border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-teal-500"
                            >
                              <option value="">— No account —</option>
                              {savingsAccounts.map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span
                              onClick={() => !demoMode && setLinkingTxId(tx.id)}
                              className="text-xs text-teal-600 cursor-pointer hover:underline"
                              title="Click to link savings account"
                            >
                              {tx.linkedSavingsAccountId
                                ? (savingsAccounts.find(a => a.id === tx.linkedSavingsAccountId)?.name ?? 'Unknown account')
                                : '+ Link account'}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell">{tx.source || '—'}</td>
                    <td className={`px-4 py-3 text-sm font-medium text-right whitespace-nowrap ${
                      tx.type === 'income' ? 'text-green-600' : 'text-red-500'
                    }`}>
                      {tx.type === 'income' ? '+' : '−'}${Math.abs(tx.amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => !demoMode && deleteMutation.mutate(tx.id)}
                        disabled={deleteMutation.isPending || demoMode}
                        className="text-gray-300 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-lg leading-none"
                        title={demoMode ? 'Unavailable in Demo Mode' : 'Delete'}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reviewData && (
        <BulkImportReviewModal
          groups={reviewData.groups}
          skipped={reviewData.skipped}
          busy={batchMutation.isPending}
          onConfirm={handleReviewConfirm}
          onRemap={handleRemap}
          onCancel={() => {
            pendingUploadMetaRef.current = null
            setReviewData(null)
          }}
        />
      )}

      {csvModalData && (
        <CsvMappingModal
          key={csvModalData.headers.join('\0')}
          headers={csvModalData.headers}
          existingSources={settings?.csvSources || {}}
          initialSourceName={csvModalData.initialSourceName || ''}
          onConfirm={handleMappingConfirm}
          onCancel={() => setCsvModalData(null)}
        />
      )}
      {showAddModal && (
        <AddTransactionModal
          categories={allCategories}
          onConfirm={data => addMutation.mutate(data)}
          onCancel={() => setShowAddModal(false)}
        />
      )}
    </div>
  )
}
