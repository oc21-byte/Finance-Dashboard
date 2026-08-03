import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LabelList,
} from 'recharts'
import { api } from '../api/client.js'
import { CATEGORIES, CATEGORY_COLORS, CREDIT_KIND_LABELS } from '../constants/categories.js'
import { runImportQueue, sourceNameFromFile } from '../utils/importQueue.js'
import { annotateDuplicates, duplicateFlags } from '../utils/duplicates.js'
import { errorStatus } from '../utils/diagnostics.js'
import ErrorBanner from '../components/ErrorBanner.jsx'
import BulkImportReviewModal from '../components/BulkImportReviewModal.jsx'
import AddTransactionModal from '../components/AddTransactionModal.jsx'
import CategoryManager from '../components/CategoryManager.jsx'

const SOURCE_NAME_KEY = 'visionSource_spendAnalyzer'

const SOURCE_COLORS = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f472b6']

function periodLabel(period) {
  if (!period || period === 'all') return 'all time'
  const d = dayjs(period + '-01')
  return d.isValid() ? d.format('MMMM YYYY') : period
}

// A positive card amount is money coming back — cashback, a refund, a rebate. It is never
// spending, so every chart and category total below is built from negatives only.
const isCredit = tx => Number(tx.amount) > 0

function summarizeCredits(transactions) {
  const credits = transactions.filter(isCredit)
  const byKind = {}
  for (const tx of credits) {
    const kind = tx.creditKind || 'credit'
    byKind[kind] = (byKind[kind] || 0) + Number(tx.amount)
  }
  return {
    credits,
    total: Math.round(credits.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100,
    byKind: Object.entries(byKind)
      .map(([kind, amount]) => ({ kind, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount),
  }
}

function buildMonthlySpend(transactions) {
  const months = [...new Set(transactions.map(t => t.date?.slice(0, 7)).filter(Boolean))].sort()
  const sources = [...new Set(transactions.map(t => t.source).filter(Boolean))]
  const data = months.map(month => {
    const txs = transactions.filter(t => t.date?.startsWith(month))
    const entry = { month: dayjs(month + '-01').format('MMM YY') }
    let total = 0
    for (const src of sources) {
      const spend = txs.filter(t => t.source === src).reduce((s, t) => s + Math.abs(t.amount), 0)
      entry[src] = Math.round(spend * 100) / 100
      total += entry[src]
    }
    entry.total = Math.round(total * 100) / 100
    return entry
  })
  return { data, sources }
}

function buildMonthlyCategoryData(transactions) {
  const allMonths = [...new Set(transactions.map(t => t.date?.slice(0, 7)).filter(Boolean))].sort()
  const categories = [...new Set(transactions.map(t => t.category).filter(Boolean))]
  const data = allMonths.map(month => {
    const txs = transactions.filter(t => t.date?.startsWith(month))
    const entry = { month: dayjs(month + '-01').format('MMM YY') }
    let total = 0
    for (const cat of categories) {
      const spend = txs.filter(t => t.category === cat).reduce((s, t) => s + Math.abs(t.amount), 0)
      if (spend > 0) {
        entry[cat] = Math.round(spend * 100) / 100
        total += entry[cat]
      }
    }
    entry.total = Math.round(total * 100) / 100
    return entry
  })
  return { data, categories }
}

function buildTopMerchants(transactions, limit = 10) {
  const totals = {}
  for (const tx of transactions) {
    const key = tx.description || 'Unknown'
    totals[key] = (totals[key] || 0) + Math.abs(tx.amount)
  }
  return Object.entries(totals)
    .map(([merchant, amount]) => ({ merchant, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
}

function SortTh({ label, field, sortKey, sortDir, onSort, className = '' }) {
  const active = sortKey === field
  return (
    <th
      className={`px-4 py-3 cursor-pointer select-none hover:text-gray-600 transition-colors ${className}`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-xs leading-none ${active ? 'text-gray-500' : 'text-gray-300'}`}>
          {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </span>
    </th>
  )
}

export default function SpendAnalyzer({ onTabChange }) {
  const fileInputRef = useRef()
  const tableRef = useRef()
  const pendingUploadMetaRef = useRef(null)
  const queryClient = useQueryClient()
  const [reviewData, setReviewData] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [filterMonth, setFilterMonth] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showUncategorizedOnly, setShowUncategorizedOnly] = useState(false)
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false)
  const [importStatus, setImportStatus] = useState(null)
  const [sortKey, setSortKey] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [editingCategoryId, setEditingCategoryId] = useState(null)
  const [recategorizing, setRecategorizing] = useState(false)
  const [insightsError, setInsightsError] = useState(null)
  const [chatError, setChatError] = useState(null)
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  // The question being awaited. Held locally only so it can be shown immediately; the stored
  // conversation is the source of truth once the reply lands.
  const [pendingQuestion, setPendingQuestion] = useState(null)

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['credit_card_transactions'],
    queryFn: api.creditCardTransactions.list,
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })


  const { data: customCategories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories.list,
  })

  // Persisted server-side so insights and their chat survive a tab change (which unmounts this
  // page) and a browser reload.
  const { data: storedInsights } = useQuery({
    queryKey: ['spend-insights'],
    queryFn: api.spendInsights.get,
  })

  const insights = storedInsights?.insights ?? []
  const insightsPeriod = storedInsights?.period ?? null
  const chatMessages = storedInsights?.messages ?? []

  const allCategories = [...CATEGORIES, ...customCategories.map(c => c.name)]
  const allCategoryColors = { ...CATEGORY_COLORS, ...Object.fromEntries(customCategories.map(c => [c.name, c.color])) }

  const hasAiKey = settings?.aiProvider === 'openai' ? !!settings?.hasOpenaiApiKey : !!settings?.hasClaudeApiKey

  const historyMutation = useMutation({
    mutationFn: api.uploadHistory.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['upload-history'] }),
  })

  const batchMutation = useMutation({
    mutationFn: api.creditCardTransactions.batch,
    onSuccess: (imported) => {
      queryClient.invalidateQueries({ queryKey: ['credit_card_transactions'] })
      setReviewData(null)
      setImportStatus({ type: 'success', message: `Imported ${imported.length} transactions.` })
      setTimeout(() => setImportStatus(null), 4000)
      // Same order as the flat list we sent — slice by file so cascade-delete can reverse it.
      const metas = pendingUploadMetaRef.current ?? []
      let offset = 0
      for (const meta of metas) {
        const count = meta.transactionCount ?? 0
        const slice = imported.slice(offset, offset + count)
        offset += count
        historyMutation.mutate({
          filename: meta.filename,
          sourceName: meta.sourceName ?? '',
          transactionCount: slice.length,
          transactionIds: slice.map(t => t.id),
          ledger: 'credit_card',
        })
      }
      pendingUploadMetaRef.current = null
    },
    onError: (err) => {
      pendingUploadMetaRef.current = null
      setImportStatus(errorStatus(err, { action: 'credit card import', stage: 'batch save' }))
    },
  })

  const addMutation = useMutation({
    mutationFn: api.creditCardTransactions.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credit_card_transactions'] })
      setShowAddModal(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: api.creditCardTransactions.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['credit_card_transactions'] }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }) => api.creditCardTransactions.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['credit_card_transactions'] }),
  })

  const saveMappingMutation = useMutation({
    mutationFn: (newSources) => api.settings.update({ csvSources: newSources }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const insightsMutation = useMutation({
    mutationFn: (period) => api.llm.spendInsights(period),
    onSuccess: () => {
      setInsightsError(null)
      queryClient.invalidateQueries({ queryKey: ['spend-insights'] })
    },
    onError: (err) => setInsightsError(err.message || 'Failed to generate insights. Please try again.'),
  })

  const clearInsightsMutation = useMutation({
    mutationFn: api.spendInsights.clear,
    onSuccess: () => {
      setInsightsError(null)
      setChatError(null)
      queryClient.invalidateQueries({ queryKey: ['spend-insights'] })
    },
  })

  async function handleSendChat(e) {
    e.preventDefault()
    const message = chatInput.trim()
    if (!message || chatLoading) return
    setChatInput('')
    setChatError(null)
    setPendingQuestion(message)
    setChatLoading(true)
    try {
      await api.llm.spendChat(insightsPeriod ?? filterMonth, [...chatMessages, { role: 'user', content: message }])
      await queryClient.invalidateQueries({ queryKey: ['spend-insights'] })
    } catch (err) {
      // Kept out of the stored conversation: a failed exchange isn't history worth replaying.
      setChatError(err.message || 'Something went wrong. Please try again.')
      setChatInput(message)
    } finally {
      setPendingQuestion(null)
      setChatLoading(false)
    }
  }

  async function categorizeTxs(txs) {
    try {
      const input = txs.map((t, i) => ({ id: String(i), description: t.description }))
      const result = await api.llm.categorize(input)
      const categoryMap = Object.fromEntries((result.categories || []).map(c => [c.id, c.category]))
      return txs.map((t, i) => ({ ...t, category: categoryMap[String(i)] || t.category || 'Other' }))
    } catch {
      return txs
    }
  }

  async function handleRecategorize() {
    if (!uncategorized.length) return
    setRecategorizing(true)
    try {
      const input = uncategorized.map(t => ({ id: t.id, description: t.description }))
      const result = await api.llm.categorize(input)
      for (const { id, category } of result.categories || []) {
        await updateMutation.mutateAsync({ id, category })
      }
    } catch (err) {
      console.error('Re-categorize failed:', err)
    } finally {
      setRecategorizing(false)
    }
  }

  async function handleFileChange(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    e.target.value = ''
    setImportStatus({ type: 'loading', message: 'Reading statements…' })

    try {
      const { groups, skipped } = await runImportQueue(files, {
        statementType: 'credit_card',
        csvSources: settings?.csvSources || {},
        hasAiKey,
        onProgress: ({ index, total, fileName, stage }) => setImportStatus({
          type: 'loading',
          message: total > 1 ? `${stage} — ${fileName} (${index} of ${total})` : `${stage} — ${fileName}`,
        }),
        postProcess: async (txs, { report }) => {
          if (!hasAiKey) return txs
          report('Categorizing with AI')
          return categorizeTxs(txs)
        },
      })

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

      setImportStatus(null)
      setReviewData({ groups: annotated, skipped })
    } catch (err) {
      setImportStatus(errorStatus(err, { action: 'credit card import', stage: 'import queue' }))
    }
  }

  function handleReviewConfirm(readyGroups) {
    const existing = settings?.csvSources || {}
    const newSources = { ...existing }
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

  function handleSort(field) {
    if (sortKey === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(field)
      setSortDir('asc')
    }
  }

  const availableMonths = [
    ...new Set(transactions.map(t => t.date?.slice(0, 7)).filter(Boolean)),
  ].sort().reverse()

  // Credits are excluded: an uncategorized refund needs no merchant category, since it never
  // reaches the category charts.
  const uncategorized = transactions.filter(t => !isCredit(t) && (!t.category || t.category === 'Other'))
  const uncategorizedCount = uncategorized.length

  // Compared across the whole ledger, not the visible month, so a duplicate that straddles a
  // month boundary still surfaces.
  const { groupCount: duplicateSetCount, byId: duplicateById } = useMemo(
    () => duplicateFlags(transactions),
    [transactions],
  )

  const monthFiltered = transactions.filter(t =>
    filterMonth === 'all' || t.date?.startsWith(filterMonth)
  )

  const filtered = monthFiltered.filter(t => {
    if (showUncategorizedOnly && t.category && t.category !== 'Other') return false
    if (showDuplicatesOnly && !duplicateById.has(t.id)) return false
    if (searchQuery && !t.description?.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    let av, bv
    if (sortKey === 'amount') {
      av = Math.abs(a.amount ?? 0)
      bv = Math.abs(b.amount ?? 0)
    } else {
      av = (a[sortKey] ?? '').toString().toLowerCase()
      bv = (b[sortKey] ?? '').toString().toLowerCase()
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const monthFilteredSpend = monthFiltered.filter(t => !isCredit(t))
  const { data: monthlyData, sources: spendSources } = buildMonthlySpend(monthFilteredSpend)
  const categoryMonthlyData = buildMonthlyCategoryData(monthFilteredSpend)
  const topMerchants = buildTopMerchants(monthFilteredSpend)
  const creditSummary = summarizeCredits(monthFiltered)
  const hasData = transactions.length > 0

  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-gray-900">Spend Analyzer</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            + Add Transaction
          </button>
          <button
            onClick={() => fileInputRef.current.click()}
            disabled={batchMutation.isPending || importStatus?.type === 'loading'}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {batchMutation.isPending || importStatus?.type === 'loading' ? 'Importing…' : 'Upload Credit Card Statements'}
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

      {uncategorizedCount > 0 && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-yellow-50 border border-yellow-200 text-sm text-yellow-800 flex items-center justify-between gap-3">
          <span>
            You have <strong>{uncategorizedCount}</strong> uncategorized transaction{uncategorizedCount !== 1 ? 's' : ''}.
          </span>
          <button
            onClick={() => {
              setShowUncategorizedOnly(true)
              setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
            }}
            className="shrink-0 px-3 py-1 text-xs font-medium bg-yellow-100 hover:bg-yellow-200 border border-yellow-300 rounded-md transition-colors"
          >
            Review Now
          </button>
        </div>
      )}

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


      {!hasData && (
        <div className="py-20 text-center">
          <p className="text-gray-400 text-sm">No credit card transactions yet.</p>
          <p className="text-gray-300 text-xs mt-1">Upload a credit card statement (CSV or PDF) to see your spending habits.</p>
        </div>
      )}

      {hasData && (
        <>
          {/* Month filter for charts */}
          <div className="flex items-center gap-3 mb-5">
            <span className="text-sm font-medium text-gray-500">Period:</span>
            <select
              value={filterMonth}
              onChange={e => setFilterMonth(e.target.value)}
              className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All time</option>
              {availableMonths.map(m => (
                <option key={m} value={m}>{dayjs(m + '-01').format('MMM YYYY')}</option>
              ))}
            </select>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            {/* Monthly spend by source */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-sm font-medium text-gray-500 mb-4">Monthly Spend by Source</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyData} barCategoryGap="35%" margin={{ top: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} tickFormatter={v => `$${v}`} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v, name) => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, name]}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  {spendSources.map((src, i) => (
                    <Bar
                      key={src}
                      dataKey={src}
                      stackId="a"
                      fill={SOURCE_COLORS[i % SOURCE_COLORS.length]}
                      radius={i === spendSources.length - 1 ? [4, 4, 0, 0] : 0}
                      maxBarSize={48}
                    >
                      {i === spendSources.length - 1 && (
                        <LabelList dataKey="total" position="top" formatter={v => v > 0 ? `$${Math.round(v).toLocaleString()}` : ''} style={{ fontSize: 11, fill: '#6b7280', fontWeight: 500 }} />
                      )}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Spending by category */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-sm font-medium text-gray-500 mb-4">Spending by Category</h2>
              {categoryMonthlyData.data.length === 0 ? (
                <div className="flex items-center justify-center h-[220px] text-sm text-gray-400">
                  No data for selected period
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={categoryMonthlyData.data} barCategoryGap="35%" margin={{ top: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} tickFormatter={v => `$${v}`} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v, name) => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, name]}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                    {categoryMonthlyData.categories.map((cat, i) => (
                      <Bar
                        key={cat}
                        dataKey={cat}
                        stackId="a"
                        fill={allCategoryColors[cat] || '#94a3b8'}
                        radius={i === categoryMonthlyData.categories.length - 1 ? [4, 4, 0, 0] : 0}
                        maxBarSize={48}
                      >
                        {i === categoryMonthlyData.categories.length - 1 && (
                          <LabelList dataKey="total" position="top" formatter={v => v > 0 ? `$${Math.round(v).toLocaleString()}` : ''} style={{ fontSize: 11, fill: '#6b7280', fontWeight: 500 }} />
                        )}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Top merchants */}
          {topMerchants.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-5">
              <h2 className="text-sm font-medium text-gray-500 mb-4">Top Merchants</h2>
              <ResponsiveContainer width="100%" height={Math.max(220, topMerchants.length * 36)}>
                <BarChart data={topMerchants} layout="vertical" margin={{ left: 8, right: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                    tickFormatter={v => `$${v}`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="merchant"
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                    width={150}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={v => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 'Spent']}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                  />
                  <Bar dataKey="amount" fill="#f87171" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    <LabelList dataKey="amount" position="right" formatter={v => `$${Math.round(v).toLocaleString()}`} style={{ fontSize: 11, fill: '#6b7280', fontWeight: 500 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {creditSummary.credits.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-5">
              <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
                <h2 className="text-sm font-medium text-gray-500">Credits &amp; Refunds</h2>
                <span className="text-xs text-gray-400">
                  Excluded from all spending totals above
                </span>
              </div>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                <div>
                  <p className="text-2xl font-semibold text-green-600">
                    +${creditSummary.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {creditSummary.credits.length} credit{creditSummary.credits.length !== 1 ? 's' : ''} received
                  </p>
                </div>
                {creditSummary.byKind.map(({ kind, amount }) => (
                  <div key={kind}>
                    <p className="text-lg font-semibold text-gray-700">
                      ${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">{CREDIT_KIND_LABELS[kind] ?? kind}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-4 pt-3 border-t border-gray-100">
                Payments to the card aren't imported here — they're paid from your bank account, so
                they already show as an expense on the Finances tab.
              </p>
            </div>
          )}

          {/* AI Insights */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-medium text-gray-500">AI Insights</h2>
                <span className="text-xs px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded font-medium">AI</span>
                {storedInsights?.generatedAt && (
                  <span className="text-xs text-gray-400">
                    Saved {dayjs(storedInsights.generatedAt).format('MMM D, h:mm A')}
                  </span>
                )}
              </div>
              {settings?.hasClaudeApiKey && (
                <div className="flex items-center gap-2">
                  {insights.length > 0 && (
                    <button
                      onClick={() => clearInsightsMutation.mutate()}
                      disabled={clearInsightsMutation.isPending || insightsMutation.isPending}
                      className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg disabled:opacity-60 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={() => insightsMutation.mutate(filterMonth)}
                    disabled={insightsMutation.isPending}
                    className="px-3 py-1.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-60 transition-colors flex items-center gap-1.5"
                  >
                    {insightsMutation.isPending ? (
                      <>
                        <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Analyzing…
                      </>
                    ) : insights.length > 0 ? 'Regenerate' : 'Generate Insights'}
                  </button>
                </div>
              )}
            </div>

            {!settings?.hasClaudeApiKey && (
              <p className="text-sm text-gray-400 py-4 text-center">
                Connect your Claude API key in Settings to enable AI insights.
              </p>
            )}

            {settings?.hasClaudeApiKey && insightsError && (
              <p className="text-sm text-red-500 mb-4">{insightsError}</p>
            )}

            {settings?.hasClaudeApiKey && insights.length === 0 && !insightsMutation.isPending && !insightsError && (
              <p className="text-sm text-gray-400 py-4 text-center">
                Click "Generate Insights" to get AI analysis of your {periodLabel(filterMonth)} spending.
              </p>
            )}

            {insights.length > 0 && (
              <>
                {insightsPeriod !== filterMonth && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">
                    These insights cover {periodLabel(insightsPeriod)}, not the {periodLabel(filterMonth)} you're
                    viewing. Follow-up answers use {periodLabel(insightsPeriod)} too — click Regenerate to switch.
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                  {insights.map((insight, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                      <p className="text-sm font-semibold text-gray-800 mb-1.5">{insight.title}</p>
                      <p className="text-sm text-gray-600 leading-relaxed">{insight.body}</p>
                    </div>
                  ))}
                </div>

                {/* Chat follow-up */}
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Ask a follow-up</p>

                  {(chatMessages.length > 0 || pendingQuestion) && (
                    <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
                      {chatMessages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                            msg.role === 'user'
                              ? 'bg-violet-600 text-white rounded-br-sm'
                              : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                          }`}>
                            {msg.content}
                          </div>
                        </div>
                      ))}
                      {pendingQuestion && (
                        <div className="flex justify-end">
                          <div className="max-w-[75%] px-3 py-2 rounded-xl rounded-br-sm text-sm leading-relaxed bg-violet-600 text-white">
                            {pendingQuestion}
                          </div>
                        </div>
                      )}
                      {chatLoading && (
                        <div className="flex justify-start">
                          <div className="bg-gray-100 text-gray-400 px-3 py-2 rounded-xl rounded-bl-sm text-sm italic">
                            Thinking…
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {chatError && (
                    <p className="text-sm text-red-500 mb-3">{chatError}</p>
                  )}

                  <form onSubmit={handleSendChat} className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      placeholder="E.g. What should I cut to save more this month?"
                      disabled={chatLoading}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
                    />
                    <button
                      type="submit"
                      disabled={chatLoading || !chatInput.trim()}
                      className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-60 transition-colors"
                    >
                      Send
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <CategoryManager />

      {/* Transaction list */}
      <div ref={tableRef} className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search transactions…"
            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-56"
          />
          {showUncategorizedOnly && (
            <button
              onClick={() => setShowUncategorizedOnly(false)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-300 rounded-full hover:bg-yellow-200 transition-colors"
            >
              Uncategorized only ✕
            </button>
          )}
          {showDuplicatesOnly && (
            <button
              onClick={() => setShowDuplicatesOnly(false)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300 rounded-full hover:bg-amber-200 transition-colors"
            >
              Possible duplicates only ✕
            </button>
          )}
          {settings?.hasClaudeApiKey && uncategorizedCount > 0 && (
            <button
              onClick={handleRecategorize}
              disabled={recategorizing}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-60 transition-colors"
            >
              {recategorizing ? 'Categorizing…' : `Re-categorize uncategorized`}
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400">
            {sorted.length} transaction{sorted.length !== 1 ? 's' : ''}
          </span>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">
              {searchQuery || showUncategorizedOnly || showDuplicatesOnly
                ? 'No transactions match the current filters.'
                : 'No transactions yet.'}
            </p>
            {!searchQuery && !showUncategorizedOnly && !showDuplicatesOnly && (
              <p className="text-gray-300 text-xs mt-1">Upload a credit card statement or add one manually.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <SortTh label="Date" field="date" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Description" field="description" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Category" field="category" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Source" field="source" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="hidden sm:table-cell" />
                  <SortTh label="Amount" field="amount" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right" />
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sorted.map(tx => {
                  const dup = duplicateById.get(tx.id)
                  const credit = isCredit(tx)
                  return (
                  <tr key={tx.id} className={`transition-colors ${dup ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-gray-50'}`}>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {tx.date ? dayjs(tx.date).format('MMM D, YYYY') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-xs">
                      <div className="flex items-center gap-2">
                        <span className="truncate">
                          {tx.description || <span className="text-gray-300 italic">No description</span>}
                        </span>
                        {credit && (
                          <span className="shrink-0 text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium">
                            {CREDIT_KIND_LABELS[tx.creditKind || 'credit'] ?? 'Credit'}
                          </span>
                        )}
                      </div>
                      {dup && (
                        <div className="flex items-center gap-2 mt-1 text-xs">
                          <span className="text-amber-700">
                            Possible duplicate{dup.otherDate ? ` of ${dayjs(dup.otherDate).format('MMM D')}` : ''}
                          </span>
                          <button
                            onClick={() => updateMutation.mutate({ id: tx.id, dupDismissed: true })}
                            className="text-gray-400 hover:text-gray-700 underline"
                          >
                            Not a duplicate
                          </button>
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
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell">{tx.source || '—'}</td>
                    <td className={`px-4 py-3 text-sm font-medium text-right whitespace-nowrap ${
                      credit ? 'text-green-600' : 'text-red-500'
                    }`}>
                      {credit ? '+' : '−'}${Math.abs(tx.amount).toFixed(2)}
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
          onCancel={() => {
            pendingUploadMetaRef.current = null
            setReviewData(null)
          }}
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
