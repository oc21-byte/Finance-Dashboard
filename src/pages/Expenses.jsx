import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from 'recharts'
import { api } from '../api/client.js'
import { CATEGORIES, CATEGORY_COLORS } from '../constants/categories.js'
import CsvMappingModal from '../components/CsvMappingModal.jsx'
import AddTransactionModal from '../components/AddTransactionModal.jsx'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// ── Utilities ────────────────────────────────────────────────────────────────

function parseAmount(str) {
  if (str === null || str === undefined || str === '') return 0
  const trimmed = String(str).trim()
  const isCR = /\bCR$/i.test(trimmed)  // "200.95 CR" → credit; return negative so invertAmounts flips to income
  const s = trimmed.replace(/[$,\s]/g, '').replace(/CR$/i, '')
  if (s.startsWith('(') && s.endsWith(')')) return -(parseFloat(s.slice(1, -1)) || 0)
  const n = parseFloat(s) || 0
  return isCR ? -n : n
}

function detectSource(headers, csvSources) {
  for (const [name, mapping] of Object.entries(csvSources)) {
    const required = mapping.splitDebitCredit
      ? [mapping.date, mapping.description, mapping.debit, mapping.credit]
      : [mapping.date, mapping.description, mapping.amount]
    if (required.filter(Boolean).every(col => headers.includes(col))) {
      return { name, mapping }
    }
  }
  return null
}

function processCSVRows(rows, mapping) {
  return rows
    .map(row => {
      let amount
      if (mapping.splitDebitCredit) {
        const debit = Math.abs(parseAmount(row[mapping.debit]))
        const credit = Math.abs(parseAmount(row[mapping.credit]))
        amount = credit > 0 ? credit : -debit
      } else {
        const raw = parseAmount(row[mapping.amount])
        if (row._section === 'deposit') {
          amount = Math.abs(raw)
        } else if (row._section === 'payment') {
          amount = -Math.abs(raw)
        } else {
          amount = mapping.invertAmounts ? -raw : raw
        }
      }
      amount = Math.round(amount * 100) / 100

      let category = 'Other'
      if (mapping.category && row[mapping.category]) {
        const csv = row[mapping.category].trim()
        category = CATEGORIES.find(c => c.toLowerCase() === csv.toLowerCase()) || 'Other'
      }

      const rawDate = (row[mapping.date] || '').trim()
      const parsed = dayjs(rawDate)
      const date = parsed.isValid() ? parsed.format('YYYY-MM-DD') : rawDate

      return {
        date,
        description: (row[mapping.description] || '').trim(),
        amount,
        category,
        source: mapping.sourceName,
        type: amount >= 0 ? 'income' : 'expense',
      }
    })
    .filter(tx => tx.description || tx.amount !== 0)
    .filter(tx => mapping.statementType === 'credit_card' ? tx.type === 'expense' : true)
}

function buildMonthlyData(transactions) {
  const months = Array.from({ length: 6 }, (_, i) =>
    dayjs().subtract(5 - i, 'month').format('YYYY-MM')
  )
  return months.map(month => {
    const txs = transactions.filter(t => t.date?.startsWith(month))
    const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    const expenses = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0)
    return {
      month: dayjs(month + '-01').format('MMM YY'),
      Income: Math.round(income * 100) / 100,
      Expenses: Math.round(expenses * 100) / 100,
    }
  })
}

function buildCategoryData(transactions) {
  const totals = {}
  for (const tx of transactions.filter(t => t.type === 'expense')) {
    totals[tx.category] = (totals[tx.category] || 0) + Math.abs(tx.amount)
  }
  return Object.entries(totals)
    .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
}

async function parsePdfToTableData(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise

  // Collect all pages' rows as buckets (each bucket = one horizontal line)
  const allBuckets = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const { items } = await page.getTextContent()

    const textItems = items
      .filter(item => item.str && item.str.trim())
      .map(item => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))

    const buckets = []
    for (const item of textItems) {
      const bucket = buckets.find(b => Math.abs(b.y - item.y) < 5)
      if (bucket) bucket.items.push(item)
      else buckets.push({ y: item.y, items: [item] })
    }

    buckets.sort((a, b) => b.y - a.y) // top → bottom (PDF y is from bottom of page)
    for (const b of buckets) b.items.sort((a, b) => a.x - b.x)
    allBuckets.push(...buckets)
  }

  // Extract statement year (e.g. 2026) from any text in the document.
  // TD Visa uses MM/DD/YY dates ("04/21/01") which JS parses as year 2001;
  // we need the real year to fix that later.
  let statementYear = null
  outer: for (const bucket of allBuckets) {
    for (const item of bucket.items) {
      const m = item.text.match(/\b(20[2-9][0-9])\b/)
      if (m) { statementYear = parseInt(m[1]); break outer }
    }
  }

  // Find ALL table header rows (rows with \bdescription\b AND \b(date|amount|debit|credit)\b).
  // Bank statements repeat this header for each section (Deposits, Payments).
  // We detect the section type by looking back at the rows above each header.
  const headerOccurrences = []
  for (let i = 0; i < allBuckets.length; i++) {
    const joined = allBuckets[i].items.map(it => it.text).join(' ')
    if (/\bdescription\b/i.test(joined) && /\b(date|amount|debit|credit)\b/i.test(joined)) {
      let sectionType = 'unknown'
      for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        const prev = allBuckets[j].items.map(it => it.text).join(' ')
        if (/\bdeposit/i.test(prev)) { sectionType = 'deposit'; break }
        if (/\bpayment|\bcheck/i.test(prev)) { sectionType = 'payment'; break }
      }
      headerOccurrences.push({ idx: i, sectionType })
    }
  }

  if (headerOccurrences.length === 0) return null

  // Use first header for column structure (all sections share the same columns)
  const rawHeaderItems = allBuckets[headerOccurrences[0].idx].items
  const seen = {}
  const headerCols = rawHeaderItems.map(it => {
    seen[it.text] = (seen[it.text] || 0) + 1
    return { name: seen[it.text] > 1 ? `${it.text} ${seen[it.text]}` : it.text, x: it.x }
  })
  const headers = headerCols.map(c => c.name)

  // LEFT_TOLERANCE lets merchant name text that starts slightly left of the Description
  // header still land in Description instead of Reference Number.
  // The Amount column (last) keeps a strict left-boundary so state abbreviations
  // ("FL", "OR", "CA") near its left edge don't contaminate amounts.
  function buildRow(bucketItems) {
    const obj = {}
    const lastColIdx = headerCols.length - 1
    const LEFT_TOLERANCE = 15
    for (const item of bucketItems) {
      let colIdx = 0
      for (let i = 1; i <= lastColIdx; i++) {
        if (item.x + LEFT_TOLERANCE >= headerCols[i].x) colIdx = i
      }
      // Amount column: if item starts left of the header, keep it there only if it
      // looks like a currency value. Right-aligned large amounts ("1,594.83") start
      // further left than short ones but are valid. Non-numeric text ("FL", "OR", "CA")
      // gets demoted to Description.
      if (colIdx === lastColIdx && item.x < headerCols[lastColIdx].x) {
        const t = item.text.trim()
        const isCurrencyValue = !/^\d{7,}$/.test(t)
          && (/^[\d,]+(\.\d+)?(\s*(CR|DR))?$/i.test(t) || /^\(\d[\d,]*(\.\d+)?\)$/i.test(t))
        if (!isCurrencyValue) colIdx = lastColIdx - 1
      }
      const col = headers[colIdx]
      obj[col] = obj[col] ? obj[col] + ' ' + item.text : item.text
    }
    return obj
  }

  const datePattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}\/\d{1,2}|\d{4}-\d{2})/i
  const descKey = headers.find(h => /\b(description|desc|detail|memo)\b/i.test(h))
  const amountKey = headers.at(-1)

  const rows = []
  for (let s = 0; s < headerOccurrences.length; s++) {
    const { idx: hIdx, sectionType } = headerOccurrences[s]
    const nextHdrIdx = s + 1 < headerOccurrences.length
      ? headerOccurrences[s + 1].idx
      : allBuckets.length

    for (let i = hIdx + 1; i < nextHdrIdx; i++) {
      const rawText = allBuckets[i].items.map(it => it.text).join(' ')
      if (/^(fees|interest charged|total fees|total interest|\d{4} totals|subtotal:|daily balance summary)/i.test(rawText)) break

      const rowObj = buildRow(allBuckets[i].items)
      const firstVal = rowObj[headers[0]] || ''

      if (datePattern.test(firstVal)) {
        rowObj._section = sectionType
        rows.push(rowObj)
      } else if (rows.length > 0) {
        // Skip page headers and document boilerplate (e.g. "How to Balance" page)
        if (/^(page:\s*\d|call \d{3}|bank deposits|how to balance|begin by adjusting|for consumer|interest notice|finance charges)/i.test(rawText)) continue
        const lastRow = rows[rows.length - 1]
        if (descKey && rowObj[descKey] && (lastRow[descKey] || '').length < 150) {
          lastRow[descKey] = (lastRow[descKey] || '') + ' ' + rowObj[descKey]
        }
        if (amountKey && rowObj[amountKey] && !lastRow[amountKey]) {
          lastRow[amountKey] = rowObj[amountKey]
        }
      }
    }
  }

  // Fix dates: TD Visa uses MM/DD/YY so "04/21/01" parses as 2001.
  // Replace with the real statement year wherever the parsed year differs.
  if (statementYear) {
    const dateKey = headers[0]
    for (const row of rows) {
      if (!row[dateKey]) continue
      const d = dayjs(row[dateKey])
      if (d.isValid() && d.year() !== statementYear) {
        row[dateKey] = d.year(statementYear).format('YYYY-MM-DD')
      } else if (!d.isValid()) {
        const d2 = dayjs(`${row[dateKey]} ${statementYear}`)
        if (d2.isValid()) row[dateKey] = d2.format('YYYY-MM-DD')
      }
    }
  }

  return { headers, rows }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Expenses() {
  const fileInputRef = useRef()
  const queryClient = useQueryClient()

  const [csvModalData, setCsvModalData] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [importStatus, setImportStatus] = useState(null) // { type: 'success'|'error', message }

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: api.transactions.list,
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })

  const batchMutation = useMutation({
    mutationFn: api.transactions.batch,
    onSuccess: (imported) => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      setCsvModalData(null)
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

  const saveMappingMutation = useMutation({
    mutationFn: (newSources) => api.settings.update({ csvSources: newSources }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

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
        const { headers, rows } = result
        const detected = detectSource(headers, settings?.csvSources || {})
        if (detected) {
          const txs = processCSVRows(rows, { ...detected.mapping, sourceName: detected.name })
          batchMutation.mutate(txs)
        } else {
          setCsvModalData({ headers, rows })
        }
      } catch {
        setImportStatus({ type: 'error', message: 'Failed to parse PDF. Please try a different file.' })
      }
      return
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data: rows, meta }) => {
        const headers = meta.fields || []
        const csvSources = settings?.csvSources || {}
        const detected = detectSource(headers, csvSources)
        if (detected) {
          const txs = processCSVRows(rows, { ...detected.mapping, sourceName: detected.name })
          batchMutation.mutate(txs)
        } else {
          setCsvModalData({ headers, rows })
        }
      },
      error: () => setImportStatus({ type: 'error', message: 'Could not parse CSV file.' }),
    })
  }

  function handleMappingConfirm(sourceName, mapping) {
    const newSources = { ...(settings?.csvSources || {}), [sourceName]: mapping }
    saveMappingMutation.mutate(newSources)
    const txs = processCSVRows(csvModalData.rows, { ...mapping, sourceName })
    batchMutation.mutate(txs)
  }

  // Derived data
  const availableMonths = [
    ...new Set(transactions.map(t => t.date?.slice(0, 7)).filter(Boolean)),
  ].sort().reverse()

  const filtered = transactions
    .filter(t => filterMonth === 'all' || t.date?.startsWith(filterMonth))
    .filter(t => filterType === 'all' || t.type === filterType)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const monthlyData = buildMonthlyData(transactions)
  const categoryData = buildCategoryData(transactions)
  const hasChartData = transactions.length > 0

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Expenses</h1>
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
            {batchMutation.isPending || importStatus?.type === 'loading' ? 'Importing…' : 'Upload CSV / PDF'}
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

      {/* Status banner */}
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

      {/* Charts */}
      {hasChartData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
          {/* Monthly income vs expenses */}
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
                <Bar dataKey="Income" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="Expenses" fill="#f87171" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Spending by category */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-medium text-gray-500 mb-4">Spending by Category</h2>
            {categoryData.length === 0 ? (
              <div className="flex items-center justify-center h-[220px] text-sm text-gray-400">
                No expense data yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(220, categoryData.length * 36)}>
                <BarChart data={categoryData} layout="vertical" margin={{ left: 8, right: 16 }}>
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
                    dataKey="category"
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                    width={110}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={v => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 'Spent']}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                  />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {categoryData.map(entry => (
                      <Cell key={entry.category} fill={CATEGORY_COLORS[entry.category] || '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Transaction list */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {/* Filter bar */}
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
            <p className="text-gray-300 text-xs mt-1">Upload a CSV or add one manually.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Source</th>
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
                      <span
                        className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: (CATEGORY_COLORS[tx.category] || '#94a3b8') + '1a',
                          color: CATEGORY_COLORS[tx.category] || '#94a3b8',
                        }}
                      >
                        {tx.category || 'Other'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{tx.source || '—'}</td>
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

      {/* Modals */}
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
          onConfirm={data => addMutation.mutate(data)}
          onCancel={() => setShowAddModal(false)}
        />
      )}
    </div>
  )
}
