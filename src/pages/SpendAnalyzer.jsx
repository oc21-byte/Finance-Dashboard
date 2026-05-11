import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LabelList,
} from 'recharts'
import { api } from '../api/client.js'
import { CATEGORIES, CATEGORY_COLORS } from '../constants/categories.js'
import { detectSource, processCSVRows, parsePdfToTableData } from '../utils/csvHelpers.js'
import CsvMappingModal from '../components/CsvMappingModal.jsx'
import AddTransactionModal from '../components/AddTransactionModal.jsx'
import CategoryManager from '../components/CategoryManager.jsx'

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

export default function SpendAnalyzer() {
  const fileInputRef = useRef()
  const queryClient = useQueryClient()

  const [csvModalData, setCsvModalData] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [filterMonth, setFilterMonth] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [importStatus, setImportStatus] = useState(null)
  const [sortKey, setSortKey] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [editingCategoryId, setEditingCategoryId] = useState(null)
  const [recategorizing, setRecategorizing] = useState(false)

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

  const allCategories = [...CATEGORIES, ...customCategories.map(c => c.name)]
  const allCategoryColors = { ...CATEGORY_COLORS, ...Object.fromEntries(customCategories.map(c => [c.name, c.color])) }

  const batchMutation = useMutation({
    mutationFn: api.creditCardTransactions.batch,
    onSuccess: (imported) => {
      queryClient.invalidateQueries({ queryKey: ['credit_card_transactions'] })
      setCsvModalData(null)
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
          setImportStatus({ type: 'error', message: 'Could not extract a table from this PDF. It may be a scanned or image-based document.' })
          return
        }
        const { headers, rows, statementYear, statementEndYear, statementEndMonth } = result
        const detected = detectSource(headers, settings?.csvSources || {}, 'credit_card')
        if (detected) {
          let txs = processCSVRows(rows, { ...detected.mapping, sourceName: detected.name, statementYear, statementEndYear, statementEndMonth })
          if (settings?.hasClaudeApiKey) {
            setImportStatus({ type: 'loading', message: 'Categorizing with AI…' })
            txs = await categorizeTxs(txs)
          }
          batchMutation.mutate(txs)
        } else {
          setCsvModalData({ headers, rows, statementYear, statementEndYear, statementEndMonth })
        }
      } catch {
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
          setCsvModalData({ headers, rows })
        }
      },
      error: () => setImportStatus({ type: 'error', message: 'Could not parse CSV file.' }),
    })
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

  const monthFiltered = transactions.filter(t =>
    filterMonth === 'all' || t.date?.startsWith(filterMonth)
  )

  const filtered = monthFiltered.filter(t =>
    !searchQuery || t.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Spend Analyzer</h1>
        <div className="flex items-center gap-3">
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
        </>
      )}

      <CategoryManager />

      {/* Transaction list */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search transactions…"
            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
          />
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
                  <SortTh label="Source" field="source" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
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
                    <td className="px-4 py-3 text-xs text-gray-400">{tx.source || '—'}</td>
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

      {csvModalData && (
        <CsvMappingModal
          headers={csvModalData.headers}
          existingSources={settings?.csvSources || {}}
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
