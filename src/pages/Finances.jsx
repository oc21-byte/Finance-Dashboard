import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import { api } from '../api/client.js'
import { FINANCE_CATEGORIES, FINANCE_CATEGORY_COLORS } from '../constants/categories.js'
import { detectSource, processCSVRows, parsePdfVision, isCitizensBankCsv, parseCitizensBankCsv } from '../utils/csvHelpers.js'
import CsvMappingModal from '../components/CsvMappingModal.jsx'
import VisionReviewModal from '../components/VisionReviewModal.jsx'
import AddTransactionModal from '../components/AddTransactionModal.jsx'

const FINANCE_CAT_SET = new Set(FINANCE_CATEGORIES)

function buildMonthlyData(transactions) {
  const months = Array.from({ length: 6 }, (_, i) =>
    dayjs().subtract(5 - i, 'month').format('YYYY-MM')
  )
  return months.map(month => {
    const txs = transactions.filter(t => t.date?.startsWith(month))
    // Use category tag; fall back to type for legacy transactions with non-finance categories
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
      month: dayjs(month + '-01').format('MMM YY'),
      Income: Math.round(income * 100) / 100,
      Savings: Math.round(savings * 100) / 100,
      Expenses: Math.round(expenses * 100) / 100,
      Investments: Math.round(investments * 100) / 100,
    }
  })
}


export default function Finances() {
  const fileInputRef = useRef()
  const pendingFileRef = useRef(null)
  const queryClient = useQueryClient()

  const [csvModalData, setCsvModalData] = useState(null)
  const [pdfConfirmData, setPdfConfirmData] = useState(null)
  const [visionData, setVisionData] = useState(null)
  const [autoDetectData, setAutoDetectData] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterType, setFilterType] = useState('all')
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

  const allCategories = FINANCE_CATEGORIES
  const allCategoryColors = FINANCE_CATEGORY_COLORS

  const batchMutation = useMutation({
    mutationFn: api.transactions.batch,
    onSuccess: (imported) => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      setCsvModalData(null)
      setVisionData(null)
      setAutoDetectData(null)
      setImportStatus({ type: 'success', message: `Imported ${imported.length} transactions.` })
      setTimeout(() => setImportStatus(null), 4000)
    },
    onError: () => setImportStatus({ type: 'error', message: 'Import failed. Please try again.' }),
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

  const PAYMENT_RE = /\b(payment\s*(-\s*)?(thank\s*you|received|applied|posted)|autopay|auto\s*pay|directpay|online\s*payment|electronic\s*payment|ach\s*payment|mobile\s*payment)\b/i

  async function triggerVision(file) {
    setCsvModalData(null)
    setImportStatus({ type: 'loading', message: 'Scanned PDF detected — analyzing with AI…' })
    try {
      const { transactions } = await parsePdfVision(file)
      setImportStatus(null)
      if (!transactions?.length) {
        setImportStatus({ type: 'error', message: 'AI could not find any transactions in this PDF.' })
        return
      }
      const normalized = transactions
        .map(tx => ({
          date: tx.date,
          description: tx.description,
          amount: Math.round(Number(tx.amount) * 100) / 100,
          category: Number(tx.amount) >= 0 ? 'Income' : 'Expense',
          type: Number(tx.amount) >= 0 ? 'income' : 'expense',
          source: 'Bank Statement',
        }))
        .filter(tx => !PAYMENT_RE.test(tx.description))
      setVisionData({ transactions: normalized })
    } catch (err) {
      setImportStatus({ type: 'error', message: err.message || 'AI analysis failed. Download the CSV Template instead.' })
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''

    if (file.name.toLowerCase().endsWith('.pdf')) {
      triggerVision(file)
      return
    }

    const text = await file.text()

    if (isCitizensBankCsv(text)) {
      Papa.parse(text, {
        header: false,
        skipEmptyLines: false,
        complete: ({ data: rawRows }) => {
          const txs = parseCitizensBankCsv(rawRows)
          if (txs.length === 0) {
            setImportStatus({ type: 'error', message: 'No transactions found in this Citizens Bank statement.' })
          } else {
            batchMutation.mutate(txs)
          }
        },
      })
      return
    }

    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data: rows, meta }) => {
        const headers = meta.fields || []
        const csvSources = settings?.csvSources || {}
        const detected = detectSource(headers, csvSources, 'bank')
        if (detected) {
          setPdfConfirmData({ sourceName: detected.name, mapping: detected.mapping, headers, rows })
        } else {
          await runAutoDetect(headers, rows, {})
        }
      },
      error: () => setImportStatus({ type: 'error', message: 'Could not parse CSV file.' }),
    })
  }

  function handlePdfConfirmYes() {
    const { sourceName, mapping, rows, statementYear, statementEndYear, statementEndMonth } = pdfConfirmData
    const txs = processCSVRows(rows, { ...mapping, sourceName, statementYear, statementEndYear, statementEndMonth })
    batchMutation.mutate(txs)
    setPdfConfirmData(null)
  }

  function handlePdfConfirmNo() {
    const { sourceName, headers, rows, statementYear, statementEndYear, statementEndMonth } = pdfConfirmData
    setCsvModalData({ headers, rows, statementYear, statementEndYear, statementEndMonth, initialSourceName: sourceName })
    setPdfConfirmData(null)
  }

  function handleMappingConfirm(sourceName, mapping) {
    const newSources = { ...(settings?.csvSources || {}), [sourceName]: mapping }
    saveMappingMutation.mutate(newSources)
    const txs = processCSVRows(csvModalData.rows, { ...mapping, sourceName, statementYear: csvModalData.statementYear, statementEndYear: csvModalData.statementEndYear, statementEndMonth: csvModalData.statementEndMonth })
    batchMutation.mutate(txs)
  }

  async function runAutoDetect(headers, rows, { statementYear, statementEndYear, statementEndMonth } = {}) {
    if (settings?.hasClaudeApiKey) {
      setImportStatus({ type: 'loading', message: 'Auto-detecting columns…' })
      try {
        const { mapping } = await api.llm.detectColumns(headers, rows.slice(0, 3))
        setImportStatus(null)
        const txs = processCSVRows(rows, { ...mapping, statementYear, statementEndYear, statementEndMonth })
        setAutoDetectData({ transactions: txs, mapping, suggestedSourceName: mapping.suggestedSourceName || '' })
      } catch {
        setImportStatus(null)
        setCsvModalData({ headers, rows, statementYear, statementEndYear, statementEndMonth })
      }
    } else {
      setCsvModalData({ headers, rows, statementYear, statementEndYear, statementEndMonth })
    }
  }

  function handleAutoDetectConfirm(sourceName, txs) {
    if (autoDetectData?.mapping) {
      const newSources = { ...(settings?.csvSources || {}), [sourceName]: autoDetectData.mapping }
      saveMappingMutation.mutate(newSources)
    }
    batchMutation.mutate(txs)
    setAutoDetectData(null)
  }

  const availableMonths = [
    ...new Set(transactions.map(t => t.date?.slice(0, 7)).filter(Boolean)),
  ].sort().reverse()

  const filtered = transactions
    .filter(t => filterMonth === 'all' || t.date?.startsWith(filterMonth))
    .filter(t => filterType === 'all' || t.type === filterType)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const monthlyData = buildMonthlyData(transactions)
  const totalIncome = Math.round(monthlyData.reduce((s, m) => s + m.Income, 0) * 100) / 100
  const totalSavings = Math.round(monthlyData.reduce((s, m) => s + m.Savings, 0) * 100) / 100
  const totalExpenses = Math.round(monthlyData.reduce((s, m) => s + m.Expenses, 0) * 100) / 100
  const totalInvestments = Math.round(monthlyData.reduce((s, m) => s + m.Investments, 0) * 100) / 100
  const net = Math.round((totalIncome + totalSavings + totalInvestments - totalExpenses) * 100) / 100
  const netCash = Math.round((totalIncome - totalExpenses) * 100) / 100
  const barMax = Math.max(totalIncome, totalSavings, totalInvestments, totalExpenses, 1)
  const hasChartData = transactions.length > 0

  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-gray-900">Finances</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
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
            onClick={() => fileInputRef.current.click()}
            disabled={batchMutation.isPending || importStatus?.type === 'loading'}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {batchMutation.isPending || importStatus?.type === 'loading' ? 'Importing…' : 'Upload Bank Statement'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.pdf"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {importStatus && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm flex items-center justify-between ${
            importStatus.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : importStatus.type === 'loading'
              ? 'bg-blue-50 text-blue-800 border border-blue-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {importStatus.message}
          {importStatus.type !== 'loading' && (
            <button onClick={() => setImportStatus(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          )}
        </div>
      )}

      {pdfConfirmData && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-sm flex items-center justify-between gap-4 flex-wrap">
          <div>
            <span className="font-medium text-blue-900">Recognized format: {pdfConfirmData.sourceName}</span>
            <span className="text-blue-700 ml-2">— use saved column mapping?</span>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={handlePdfConfirmNo} className="px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-100 text-sm">
              No, remap
            </button>
            <button onClick={handlePdfConfirmYes} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm">
              Yes, use it
            </button>
          </div>
        </div>
      )}

      {hasChartData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-medium text-gray-500 mb-4">Monthly Income vs Expenses</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
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
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col justify-between">
            <h2 className="text-sm font-medium text-gray-500 mb-5">Total Income, Savings &amp; Expenses — Last 6 Months</h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
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
              <div>
                <p className={`text-xl font-semibold ${net >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-gray-400 mt-1">Net</p>
              </div>
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

              <div className="pt-3 border-t border-gray-100 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Net Cash</span>
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
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
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
          </select>
          <span className="ml-auto text-sm text-gray-400">
            {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">No transactions yet.</p>
            <p className="text-gray-300 text-xs mt-1">Upload a bank statement or add one manually.</p>
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
                {filtered.map(tx => (
                  <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {tx.date ? dayjs(tx.date).format('MMM D, YYYY') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate">
                      {tx.description || <span className="text-gray-300 italic">No description</span>}
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
                          onClick={() => setEditingCategoryId(tx.id)}
                          title="Click to edit category"
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
                              onClick={() => setLinkingTxId(tx.id)}
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
                        onClick={() => deleteMutation.mutate(tx.id)}
                        disabled={deleteMutation.isPending}
                        className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                        title="Delete"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {visionData && (
        <VisionReviewModal
          transactions={visionData.transactions}
          initialSourceName={localStorage.getItem('visionSource_finances') || 'Bank Statement'}
          onConfirm={(sourceName, txs) => {
            localStorage.setItem('visionSource_finances', sourceName)
            batchMutation.mutate(txs)
          }}
          onCancel={() => setVisionData(null)}
        />
      )}
      {autoDetectData && (
        <VisionReviewModal
          transactions={autoDetectData.transactions}
          initialSourceName={autoDetectData.suggestedSourceName}
          onConfirm={handleAutoDetectConfirm}
          onCancel={() => setAutoDetectData(null)}
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
          onUseVision={pendingFileRef.current ? () => triggerVision(pendingFileRef.current) : null}
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
