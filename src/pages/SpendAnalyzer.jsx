import { useRef, useState, useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LabelList,
} from 'recharts'
import { api } from '../api/client.js'
import { CATEGORIES, CATEGORY_COLORS } from '../constants/categories.js'
import { detectSource, processCSVRows, parsePdfToTableData, parsePdfVision } from '../utils/csvHelpers.js'
import CsvMappingModal from '../components/CsvMappingModal.jsx'
import VisionReviewModal from '../components/VisionReviewModal.jsx'
import AddTransactionModal from '../components/AddTransactionModal.jsx'
import CategoryManager from '../components/CategoryManager.jsx'
import BudgetBuilderModal from '../components/BudgetBuilderModal.jsx'

const SOURCE_COLORS = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f472b6']

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
  const pendingFileRef = useRef(null)
  const queryClient = useQueryClient()

  const [csvModalData, setCsvModalData] = useState(null)
  const [pdfConfirmData, setPdfConfirmData] = useState(null)
  const [visionData, setVisionData] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [filterMonth, setFilterMonth] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showUncategorizedOnly, setShowUncategorizedOnly] = useState(false)
  const [importStatus, setImportStatus] = useState(null)
  const [sortKey, setSortKey] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [editingCategoryId, setEditingCategoryId] = useState(null)
  const [recategorizing, setRecategorizing] = useState(false)
  const [insights, setInsights] = useState([])
  const [insightsError, setInsightsError] = useState(null)
  const [insightsPeriod, setInsightsPeriod] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['credit_card_transactions'],
    queryFn: api.creditCardTransactions.list,
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: api.goals.list,
  })

  const { data: bankTransactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: api.transactions.list,
  })

  const [showGoalGuard, setShowGoalGuard] = useState(false)
  const [showBudgetBuilder, setShowBudgetBuilder] = useState(false)
  const [budgetSavedToast, setBudgetSavedToast] = useState('')
  const [editingBudget, setEditingBudget] = useState(null)

  useEffect(() => {
    if (!budgetSavedToast) return
    const t = setTimeout(() => setBudgetSavedToast(''), 4000)
    return () => clearTimeout(t)
  }, [budgetSavedToast])

  const { data: customCategories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories.list,
  })

  const allCategories = [...CATEGORIES, ...customCategories.map(c => c.name)]
  const allCategoryColors = { ...CATEGORY_COLORS, ...Object.fromEntries(customCategories.map(c => [c.name, c.color])) }

  const batchMutation = useMutation({
    mutationFn: api.creditCardTransactions.batch,
    onSuccess: (imported) => {
      queryClient.invalidateQueries({ queryKey: ['credit_card_transactions'] })
      setCsvModalData(null)
      setVisionData(null)
      setImportStatus({ type: 'success', message: `Imported ${imported.length} transactions.` })
      setTimeout(() => setImportStatus(null), 4000)
    },
    onError: () => setImportStatus({ type: 'error', message: 'Import failed. Please try again.' }),
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

  const budgetMutation = useMutation({
    mutationFn: (budgets) => api.settings.update({ categoryBudgets: budgets }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const insightsMutation = useMutation({
    mutationFn: (period) => api.llm.spendInsights(period),
    onSuccess: (data) => {
      setInsights(data.insights || [])
      setInsightsError(null)
      setInsightsPeriod(filterMonth)
      setChatMessages([])
    },
    onError: (err) => setInsightsError(err.message || 'Failed to generate insights. Please try again.'),
  })

  async function handleSendChat(e) {
    e.preventDefault()
    const message = chatInput.trim()
    if (!message || chatLoading) return
    const newMessages = [...chatMessages, { role: 'user', content: message }]
    setChatMessages(newMessages)
    setChatInput('')
    setChatLoading(true)
    try {
      const result = await api.llm.spendChat(filterMonth, newMessages)
      setChatMessages(prev => [...prev, { role: 'assistant', content: result.reply }])
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }])
    } finally {
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
    const uncategorized = transactions.filter(t => !t.category || t.category === 'Other')
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
      let normalized = transactions.map(tx => ({
        date: tx.date,
        description: tx.description,
        amount: Math.round(Number(tx.amount) * 100) / 100,
        category: Number(tx.amount) >= 0 ? 'Income' : 'Expense',
        type: Number(tx.amount) >= 0 ? 'income' : 'expense',
        source: 'Bank Statement',
      }))
      if (settings?.hasClaudeApiKey) {
        setImportStatus({ type: 'loading', message: 'Categorizing with AI…' })
        normalized = await categorizeTxs(normalized)
        setImportStatus(null)
      }
      setVisionData({ transactions: normalized })
    } catch (err) {
      setImportStatus({ type: 'error', message: err.message || 'AI analysis failed.' })
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''

    if (file.name.toLowerCase().endsWith('.pdf')) {
      setImportStatus({ type: 'loading', message: 'Parsing PDF…' })
      try {
        const result = await parsePdfToTableData(file)
        setImportStatus(null)
        if (!result) {
          triggerVision(file)
          return
        }
        const { headers, rows, statementYear, statementEndYear, statementEndMonth } = result
        pendingFileRef.current = file
        const detected = detectSource(headers, settings?.csvSources || {}, 'credit_card')
        if (detected) {
          setPdfConfirmData({ sourceName: detected.name, mapping: detected.mapping, headers, rows, statementYear, statementEndYear, statementEndMonth })
        } else {
          setCsvModalData({ headers, rows, statementYear, statementEndYear, statementEndMonth })
        }
      } catch (e) {
        console.error('PDF parse error:', e)
        setImportStatus({ type: 'error', message: 'Failed to parse PDF. Please try a different file.' })
      }
      return
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data: rows, meta }) => {
        const headers = meta.fields || []
        const csvSources = settings?.csvSources || {}
        const detected = detectSource(headers, csvSources, 'credit_card')
        if (detected) {
          let txs = processCSVRows(rows, { ...detected.mapping, sourceName: detected.name })
          if (settings?.hasClaudeApiKey) {
            setImportStatus({ type: 'loading', message: 'Categorizing with AI…' })
            txs = await categorizeTxs(txs)
          }
          batchMutation.mutate(txs)
        } else {
          pendingFileRef.current = file
          setCsvModalData({ headers, rows })
        }
      },
      error: () => setImportStatus({ type: 'error', message: 'Could not parse CSV file.' }),
    })
  }

  async function handlePdfConfirmYes() {
    const { sourceName, mapping, rows, statementYear, statementEndYear, statementEndMonth } = pdfConfirmData
    let txs = processCSVRows(rows, { ...mapping, sourceName, statementYear, statementEndYear, statementEndMonth })
    if (settings?.hasClaudeApiKey) {
      setImportStatus({ type: 'loading', message: 'Categorizing with AI…' })
      txs = await categorizeTxs(txs)
    }
    batchMutation.mutate(txs)
    setPdfConfirmData(null)
  }

  function handlePdfConfirmNo() {
    const { sourceName, headers, rows, statementYear, statementEndYear, statementEndMonth } = pdfConfirmData
    setCsvModalData({ headers, rows, statementYear, statementEndYear, statementEndMonth, initialSourceName: sourceName })
    setPdfConfirmData(null)
  }

  async function handleMappingConfirm(sourceName, mapping) {
    const newSources = { ...(settings?.csvSources || {}), [sourceName]: mapping }
    saveMappingMutation.mutate(newSources)
    let txs = processCSVRows(csvModalData.rows, { ...mapping, sourceName, statementYear: csvModalData.statementYear, statementEndYear: csvModalData.statementEndYear, statementEndMonth: csvModalData.statementEndMonth })
    if (settings?.hasClaudeApiKey) {
      setImportStatus({ type: 'loading', message: 'Categorizing with AI…' })
      txs = await categorizeTxs(txs)
    }
    batchMutation.mutate(txs)
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

  const uncategorizedCount = transactions.filter(t => !t.category || t.category === 'Other').length

  const monthFiltered = transactions.filter(t =>
    filterMonth === 'all' || t.date?.startsWith(filterMonth)
  )

  const filtered = monthFiltered.filter(t => {
    if (showUncategorizedOnly && t.category && t.category !== 'Other') return false
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

  const { data: monthlyData, sources: spendSources } = buildMonthlySpend(monthFiltered)
  const categoryMonthlyData = buildMonthlyCategoryData(monthFiltered)
  const topMerchants = buildTopMerchants(monthFiltered)
  const hasData = transactions.length > 0

  const lastTxDate = transactions.reduce((max, t) => (t.date > max ? t.date : max), '0000-00-00')
  const cutoff = dayjs(lastTxDate).subtract(30, 'day').format('YYYY-MM-DD')
  const monthSpend = {}
  for (const t of transactions) {
    if (!t.date || t.date < cutoff || !t.category) continue
    monthSpend[t.category] = (monthSpend[t.category] || 0) + Math.abs(t.amount)
  }
  const categoryBudgets = settings?.categoryBudgets || {}
  const hasBudgets = Object.keys(categoryBudgets).length > 0

  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-gray-900">Spend Analyzer</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => {
              if (goals.length === 0) {
                setShowGoalGuard(true)
              } else {
                setShowGoalGuard(false)
                setShowBudgetBuilder(true)
              }
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Sparkles size={15} />
            Budget Builder
          </button>
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
            {batchMutation.isPending || importStatus?.type === 'loading' ? 'Importing…' : 'Upload Credit Card Statement'}
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

      {budgetSavedToast && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800 flex items-center justify-between gap-3">
          <span>{budgetSavedToast}</span>
          <button
            onClick={() => setBudgetSavedToast('')}
            className="shrink-0 text-green-400 hover:text-green-600 text-lg leading-none"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {showGoalGuard && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-center justify-between gap-3">
          <span>
            Budget Builder needs at least one goal to optimize toward.{' '}
            <button
              onClick={() => onTabChange?.('goals')}
              className="underline font-medium hover:text-blue-900"
            >
              Create a goal first →
            </button>
          </span>
          <button
            onClick={() => setShowGoalGuard(false)}
            className="shrink-0 text-blue-400 hover:text-blue-600 text-lg leading-none"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {uncategorizedCount > 0 && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-yellow-50 border border-yellow-200 text-sm text-yellow-800 flex items-center justify-between gap-3">
          <span>
            You have <strong>{uncategorizedCount}</strong> uncategorized transaction{uncategorizedCount !== 1 ? 's' : ''}. Resolve before running Budget Builder.
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

      {hasBudgets && (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-gray-900">
              Budget Tracking — Last 30 Days
            </h2>
            <button
              onClick={() => setShowBudgetBuilder(true)}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Edit with Budget Builder →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Budget Cap</th>
                  <th className="px-5 py-3">Spent (Last 30 Days)</th>
                  <th className="px-5 py-3">Remaining</th>
                  <th className="px-5 py-3 w-36">Usage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Object.entries(categoryBudgets).map(([cat, cap]) => {
                  const spent = Math.round((monthSpend[cat] || 0) * 100) / 100
                  const remaining = cap - spent
                  const pct = cap > 0 ? Math.round(spent / cap * 100) : 0
                  const over = remaining < 0
                  const nearLimit = !over && pct >= 80
                  const barColor = over ? 'bg-red-400' : nearLimit ? 'bg-yellow-400' : 'bg-green-400'
                  const isEditing = editingBudget?.cat === cat

                  return (
                    <tr key={cat} className={over ? 'bg-red-50' : 'bg-white'}>
                      <td className="px-5 py-3 font-medium text-gray-800">{cat}</td>
                      <td className="px-5 py-3 text-gray-700">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            autoFocus
                            value={editingBudget.value}
                            onChange={e => setEditingBudget(prev => ({ ...prev, value: e.target.value }))}
                            onBlur={() => {
                              const val = Number(editingBudget.value)
                              if (!isNaN(val) && val >= 0) {
                                budgetMutation.mutate({ ...categoryBudgets, [cat]: val })
                              }
                              setEditingBudget(null)
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') e.target.blur()
                              if (e.key === 'Escape') setEditingBudget(null)
                            }}
                            className="w-24 border border-indigo-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        ) : (
                          <button
                            onClick={() => setEditingBudget({ cat, value: String(cap) })}
                            className="font-medium hover:text-indigo-600 hover:underline transition-colors"
                            title="Click to edit"
                          >
                            ${cap.toLocaleString()}
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-700">${spent.toLocaleString()}</td>
                      <td className={`px-5 py-3 font-medium ${over ? 'text-red-600' : 'text-green-600'}`}>
                        {over
                          ? `-$${Math.abs(remaining).toLocaleString()} over`
                          : `$${remaining.toLocaleString()} left`}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${barColor}`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">Click any budget cap to edit it inline. Only categories with a saved cap are shown.</p>
          </div>
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

          {/* AI Insights */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-gray-500">AI Insights</h2>
                <span className="text-xs px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded font-medium">AI</span>
              </div>
              {settings?.hasClaudeApiKey && (
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
                  ) : 'Generate Insights'}
                </button>
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
                Click "Generate Insights" to get AI analysis of your{' '}
                {filterMonth === 'all' ? 'all-time' : dayjs(filterMonth + '-01').format('MMMM YYYY')} spending.
              </p>
            )}

            {insights.length > 0 && (
              <>
                {insightsPeriod !== filterMonth && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">
                    These insights are for a different period. Click "Generate Insights" to refresh.
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

                  {chatMessages.length > 0 && (
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
                      {chatLoading && (
                        <div className="flex justify-start">
                          <div className="bg-gray-100 text-gray-400 px-3 py-2 rounded-xl rounded-bl-sm text-sm italic">
                            Thinking…
                          </div>
                        </div>
                      )}
                    </div>
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
          {settings?.hasClaudeApiKey && transactions.some(t => !t.category || t.category === 'Other') && (
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
              {searchQuery ? 'No transactions match your search.' : 'No transactions yet.'}
            </p>
            {!searchQuery && (
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
                {sorted.map(tx => (
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
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell">{tx.source || '—'}</td>
                    <td className="px-4 py-3 text-sm font-medium text-right whitespace-nowrap text-red-500">
                      −${Math.abs(tx.amount).toFixed(2)}
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
          onConfirm={(sourceName, txs) => batchMutation.mutate(txs)}
          onCancel={() => setVisionData(null)}
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
      {showBudgetBuilder && (
        <BudgetBuilderModal
          goals={goals}
          settings={settings}
          transactions={bankTransactions}
          onTabChange={onTabChange}
          onClose={() => setShowBudgetBuilder(false)}
          onBudgetSaved={(msg) => setBudgetSavedToast(msg || 'Budget saved. Tracking active in Spend Analyzer.')}
        />
      )}
    </div>
  )
}
