import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'
import { CATEGORIES, CATEGORY_COLORS, CREDIT_KIND_LABELS } from '../constants/categories.js'
import { runImportQueue, sourceNameFromFile } from '../utils/importQueue.js'
import { annotateDuplicates, duplicateFlags } from '../utils/duplicates.js'
import { processCSVRows } from '../utils/csvHelpers.js'
import { errorStatus } from '../utils/diagnostics.js'
import {
  resolvePeriod, priorRange, earliestDate, filterByRange, buildScopeKey, describeScope, isCredit,
} from '../utils/period.js'
import { applyFilters, buildKpis } from '../utils/spendAggregations.js'
import { detectRecurring } from '../utils/recurring.js'
import ErrorBanner from '../components/ErrorBanner.jsx'
import BulkImportReviewModal from '../components/BulkImportReviewModal.jsx'
import CsvMappingModal from '../components/CsvMappingModal.jsx'
import AddTransactionModal from '../components/AddTransactionModal.jsx'
import CategoryManager from '../components/CategoryManager.jsx'
import AiInsightsPanel from '../components/spend/AiInsightsPanel.jsx'
import ScopeHeader, { PINNED_BAR_H } from '../components/spend/ScopeHeader.jsx'
import RecurringPanel from '../components/spend/RecurringPanel.jsx'
import SpendOverTime from '../components/spend/SpendOverTime.jsx'
import CategoryBreakdown from '../components/spend/CategoryBreakdown.jsx'
import TopMerchants from '../components/spend/TopMerchants.jsx'
import CardsBar from '../components/spend/CardsBar.jsx'
import TransactionTable from '../components/spend/TransactionTable.jsx'
import { buildCardColors } from '../components/spend/palette.js'
import ViewToggle from '../components/shared/ViewToggle.jsx'
import RewardsView from '../components/spend/rewards/RewardsView.jsx'
import { walletEntryFor } from '../components/spend/rewards/CardPicker.jsx'

const SOURCE_NAME_KEY = 'visionSource_spendAnalyzer'

const VIEWS = [
  { value: 'spend', label: 'Spend' },
  { value: 'rewards', label: 'Rewards' },
]

const FILTER_KINDS = ['categories', 'cards', 'merchants']
const FILTER_LABEL = { categories: 'Category', cards: 'Card', merchants: 'Merchant' }
const NO_FILTERS = { categories: [], cards: [], merchants: [] }

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

// Layout's demo-mode banner is `sticky top-0 z-40`, so anything this page pins has to start below
// it: text-sm (20px) + py-1.5 (12px).
const DEMO_BANNER_H = 32

export default function SpendAnalyzer({ onTabChange, demoMode }) {
  const fileInputRef = useRef()
  const tableRef = useRef()
  const pendingUploadMetaRef = useRef(null)
  const queryClient = useQueryClient()
  const [reviewData, setReviewData] = useState(null)
  const [csvModalData, setCsvModalData] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [period, setPeriod] = useState('6M')
  // Which view of the scoped data is showing. Deliberately NOT part of the scope: the period and
  // filter chips sit above the toggle and apply to both views equally.
  const [view, setView] = useState('spend')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [showRecurring, setShowRecurring] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showUncategorizedOnly, setShowUncategorizedOnly] = useState(false)
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false)
  const [importStatus, setImportStatus] = useState(null)
  const [sortKey, setSortKey] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
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

  // Memoised because identity matters here, not just value: these feed the `useMemo` deps of every
  // chart, so rebuilding them each render would recompute all four charts on any state change.
  const allCategories = useMemo(
    () => [...CATEGORIES, ...customCategories.map(c => c.name)],
    [customCategories],
  )
  const allCategoryColors = useMemo(
    () => ({ ...CATEGORY_COLORS, ...Object.fromEntries(customCategories.map(c => [c.name, c.color])) }),
    [customCategories],
  )

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

  // `cardRewards` is sent whole. `PUT /api/settings` merges only at the top level, so posting a
  // partial object here would drop the sibling keys — the overrides and the region alongside it.
  const cardRewardsMutation = useMutation({
    mutationFn: (cardRewards) => api.settings.update({ cardRewards }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  function handleLinkCard(sourceName, entry) {
    const current = settings?.cardRewards ?? {}
    const wallet = { ...(current.wallet ?? {}) }
    // A null entry is "not linked yet", which is the absence of a key rather than a stored value —
    // otherwise clearing a link would leave a row the setup screen could never ask about again.
    if (entry) wallet[sourceName] = entry
    else delete wallet[sourceName]
    cardRewardsMutation.mutate({ ...current, wallet })
  }

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

  async function sendChatMessage(rawMessage) {
    const message = String(rawMessage ?? '').trim()
    if (!message || chatLoading) return
    setChatInput('')
    setChatError(null)
    setPendingQuestion(message)
    setChatLoading(true)
    try {
      // Sent against the stored scope, not the one on screen: the answer has to describe the same
      // data the insights above it describe, or the server refuses to record the exchange.
      await api.llm.spendChat(
        insightsPeriod ? { ...scopePayload, period: insightsPeriod } : scopePayload,
        [...chatMessages, { role: 'user', content: message }],
      )
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

  function handleSendChat(e) {
    e.preventDefault()
    sendChatMessage(chatInput)
  }

  function handleExplore(option) {
    sendChatMessage(option.id)
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
    setCsvModalData(null)
    setImportStatus({ type: 'loading', message: 'Reading statements…' })

    try {
      const { groups, skipped, needsMapping } = await runImportQueue(files, {
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

      // A lone file whose columns couldn't be worked out falls back to mapping by hand. Without
      // this the card path dead-ends on "nothing could be imported" for any statement the AI can't
      // read — the same file on the Finances tab would have offered the mapping modal.
      if (needsMapping) {
        setImportStatus(null)
        setCsvModalData({
          headers: needsMapping.headers,
          rows: needsMapping.rows,
          fileName: needsMapping.file.name,
        })
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

      setImportStatus(null)
      setReviewData({ groups: annotated, skipped })
    } catch (err) {
      setImportStatus(errorStatus(err, { action: 'credit card import', stage: 'import queue' }))
    }
  }

  // Hand-mapped rows join the normal flow rather than going straight to the server: they still
  // need duplicate flagging and a look before saving, exactly like auto-detected ones.
  function handleMappingConfirm(sourceName, mapping) {
    // Tab wins over whatever the modal (or a reused source name) had stored.
    const locked = { ...mapping, statementType: 'credit_card' }
    const rows = processCSVRows(csvModalData.rows, { ...locked, sourceName })
    if (!rows.length) {
      setCsvModalData(null)
      setImportStatus({ type: 'error', message: 'That mapping produced no transactions. Check the column choices and try again.' })
      return
    }
    const group = {
      id: `map${Date.now()}`,
      fileName: csvModalData.fileName,
      transactions: rows,
      mapping: locked,
      sourceName,
      note: 'Mapped by hand',
      headers: csvModalData.headers,
      rows: csvModalData.rows,
    }
    const { groups: annotated } = annotateDuplicates([group], transactions)
    setCsvModalData(null)
    setReviewData({ groups: annotated, skipped: [] })
  }

  // `balances` is bank-only and ignored here; `cardLinks` maps a confirmed source name to the
  // rewards card picked in the review modal.
  function handleReviewConfirm(readyGroups, balances, cardLinks = {}) {
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

    const linkEntries = Object.entries(cardLinks)
    if (linkEntries.length) {
      const current = settings?.cardRewards ?? {}
      const wallet = { ...(current.wallet ?? {}) }
      for (const [sourceName, value] of linkEntries) {
        wallet[sourceName] = walletEntryFor(value, wallet[sourceName] ?? {})
      }
      cardRewardsMutation.mutate({ ...current, wallet })
    }
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

  // Credits are excluded: an uncategorized refund needs no merchant category, since it never
  // reaches the category charts.
  const uncategorized = transactions.filter(t => !isCredit(t) && (!t.category || t.category === 'Other'))
  const uncategorizedCount = uncategorized.length

  // Compared across the whole ledger, not the visible period, so a duplicate that straddles a
  // period boundary still surfaces.
  const { groupCount: duplicateSetCount, byId: duplicateById } = useMemo(
    () => duplicateFlags(transactions),
    [transactions],
  )

  // --- The derivation chain. Every number on the page hangs off these five steps, which is what
  // lets a filter chip re-scope the whole page instead of just the table.
  const ledgerStart = useMemo(() => earliestDate(transactions), [transactions])
  const range = useMemo(() => resolvePeriod(period, transactions), [period, transactions])
  const periodRows = useMemo(() => filterByRange(transactions, range), [transactions, range])
  const scopedRows = useMemo(() => applyFilters(periodRows, filters), [periodRows, filters])
  const scopedSpend = useMemo(() => scopedRows.filter(t => !isCredit(t)), [scopedRows])

  // Same-length preceding window, for the "vs prior" delta. Null when the ledger doesn't cover it.
  const priorSpend = useMemo(() => {
    const prior = priorRange(range, ledgerStart)
    if (!prior) return []
    return applyFilters(filterByRange(transactions, prior), filters).filter(t => !isCredit(t))
  }, [transactions, range, filters, ledgerStart])

  const kpis = useMemo(() => buildKpis(scopedSpend, range, priorSpend), [scopedSpend, range, priorSpend])

  // Detected across the *whole* ledger, not the visible range — cadence can only be read from
  // history. Filters still apply, since they narrow which merchants are in scope, not which dates.
  const recurring = useMemo(
    () => detectRecurring(applyFilters(transactions, filters), { activeTo: range.to }),
    [transactions, filters, range.to],
  )

  const monthsAvailable = useMemo(
    () => new Set(transactions.map(t => t.date?.slice(0, 7)).filter(Boolean)).size,
    [transactions],
  )

  // Keyed off the whole ledger, never the scoped set — a card has to keep its colour when a filter
  // chip removes some of the others, or the legend you just read stops matching the chart.
  // `|| 'Unknown'` matches `cardOf` in spendAggregations — a sourceless row has to key the same way
  // here as it does in the totals, or it draws uncoloured.
  const cardColors = useMemo(
    () => buildCardColors(transactions.map(t => t.source || 'Unknown')),
    [transactions],
  )

  // Every card name the ledger holds, not just the ones in scope — the wallet setup has to be able
  // to ask about a card whose spending the current period happens to exclude.
  const allSources = useMemo(
    () => [...new Set(transactions.map(t => t.source || 'Unknown'))].sort(),
    [transactions],
  )

  // The table narrows further: search plus the two review toggles, which deliberately do not feed
  // the KPIs or charts (see FilterBar). Memoised alongside the sort below because together they
  // walk the whole ledger, and this page re-renders on every hover inside a chart.
  const filtered = useMemo(() => scopedRows.filter(t => {
    if (showUncategorizedOnly && t.category && t.category !== 'Other') return false
    if (showDuplicatesOnly && !duplicateById.has(t.id)) return false
    if (searchQuery && !t.description?.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  }), [scopedRows, showUncategorizedOnly, showDuplicatesOnly, searchQuery, duplicateById])

  function toggleFilter(kind, value) {
    setFilters(f => ({
      ...f,
      [kind]: f[kind].includes(value) ? f[kind].filter(v => v !== value) : [...f[kind], value],
    }))
  }

  const filterChips = [
    ...FILTER_KINDS.flatMap(kind =>
      filters[kind].map(value => ({
        key: `${kind}:${value}`,
        label: `${FILTER_LABEL[kind]}: ${value}`,
        onRemove: () => toggleFilter(kind, value),
      }))
    ),
    ...(showUncategorizedOnly ? [{
      key: 'uncategorized',
      label: 'Uncategorized only',
      note: 'table only',
      onRemove: () => setShowUncategorizedOnly(false),
    }] : []),
    ...(showDuplicatesOnly ? [{
      key: 'duplicates',
      label: 'Possible duplicates only',
      note: 'table only',
      onRemove: () => setShowDuplicatesOnly(false),
    }] : []),
  ]

  const hasScopeFilters = FILTER_KINDS.some(k => filters[k].length > 0)

  function clearAllFilters() {
    setFilters(NO_FILTERS)
    setShowUncategorizedOnly(false)
    setShowDuplicatesOnly(false)
  }

  // What the AI is being asked about: the range plus the filter chips, as one opaque key the
  // server stores and compares. Review toggles are excluded — they don't change the spend context.
  const scopeKey = buildScopeKey(range, filters)
  const scopeLabel = describeScope(range, filters)
  const scopePayload = {
    period: scopeKey,
    from: range.from,
    to: range.to,
    filters,
    periodLabel: scopeLabel,
  }

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
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
  }), [filtered, sortKey, sortDir])

  // Anything that changes what row 1 *is* sends the table back to page 1 — otherwise narrowing a
  // 40-row list to 12 while sitting on page 3 lands you on a page that no longer means anything.
  const tableResetKey = [
    scopeKey, searchQuery, sortKey, sortDir, showUncategorizedOnly, showDuplicatesOnly,
  ].join('|')

  const creditSummary = summarizeCredits(scopedRows)
  const hasData = transactions.length > 0

  // Everything that has to clear the pinned bar measures from here.
  const pinnedTop = demoMode ? DEMO_BANNER_H : 0
  const clearsPinned = pinnedTop + PINNED_BAR_H + 16

  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Spend Analyzer</h1>
          {hasData && (
            <p className="mt-1.5 text-[13px] text-gray-500">
              {range.monthCount > 0
                ? `${range.label} · ${scopedRows.length} transaction${scopedRows.length === 1 ? '' : 's'} across ${kpis.cardCount} card${kpis.cardCount === 1 ? '' : 's'}`
                : 'No transactions in the selected period'}
            </p>
          )}
        </div>
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
            {batchMutation.isPending || importStatus?.type === 'loading' ? 'Importing…' : (
              <>
                Upload<span className="hidden sm:inline"> Credit Card</span> Statements
              </>
            )}
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
              // The banner counts the whole ledger, so the table has to show the whole ledger too
              // or the count and the list disagree.
              setPeriod('All')
              setFilters(NO_FILTERS)
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
              // Duplicates are flagged across the whole ledger, so widen the period to match —
              // otherwise "Review Now" can land on an empty table.
              setPeriod('All')
              setFilters(NO_FILTERS)
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


      {/* Loading and empty are different answers to "where are my charts?" — showing "no
          transactions yet" during the first fetch tells a returning user their data is gone. */}
      {!hasData && isLoading && (
        <div className="py-20 text-center">
          <span className="inline-block w-5 h-5 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
          <p className="text-gray-400 text-sm mt-3">Loading your transactions…</p>
        </div>
      )}

      {!hasData && !isLoading && (
        <div className="py-20 text-center">
          <p className="text-gray-400 text-sm">No credit card transactions yet.</p>
          <p className="text-gray-300 text-xs mt-1 mb-5">
            Upload a statement (CSV, Excel or PDF) to see where your money goes.
          </p>
          <button
            onClick={() => fileInputRef.current.click()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Upload a statement
          </button>
        </div>
      )}

      {/* The scope header spans the full width rather than sharing it with the rail: at 1280px a
          five-tile KPI grid squeezed beside a 320px column truncates its own values. It pins to the
          top so the range and the headline numbers stay readable while you scroll the charts. */}
      {hasData && (
        <ScopeHeader
          period={period}
          onPeriodChange={setPeriod}
          range={range}
          txCount={periodRows.length}
          monthsAvailable={monthsAvailable}
          chips={filterChips}
          filterSummary={hasScopeFilters ? `→ ${scopedRows.length} of ${periodRows.length} in period` : ''}
          onClearAll={clearAllFilters}
          kpis={kpis}
          recurring={recurring}
          recurringOpen={showRecurring}
          onRecurringClick={() => setShowRecurring(v => !v)}
          offsetTop={pinnedTop}
        />
      )}

      {/* Deliberately outside the pinned block — a scrollable list of twenty subscriptions has no
          business holding the top of the viewport. */}
      {hasData && showRecurring && recurring.count > 0 && (
        <div className="mb-5">
          <RecurringPanel
            recurring={recurring}
            onClose={() => setShowRecurring(false)}
            onSelectMerchant={merchant => {
              toggleFilter('merchants', merchant)
              setShowRecurring(false)
            }}
          />
        </div>
      )}

      {/* Below the scope block, so the period and filter chips visibly govern both views. */}
      {hasData && (
        <div className="mb-5">
          <ViewToggle value={view} onChange={setView} options={VIEWS} />
        </div>
      )}

      {hasData && view === 'rewards' && (
        <RewardsView
          spendTxs={scopedSpend}
          allSources={allSources}
          range={range}
          settings={settings}
          categoryColors={allCategoryColors}
          demoMode={demoMode}
          onLink={handleLinkCard}
          saving={cardRewardsMutation.isPending}
          clearsPinned={clearsPinned}
        />
      )}

      {/* Main column + sticky insights rail, starting level with "Spend over time". The rail drops
          below the content under xl, where 320px of it would leave the charts too narrow to read.

          Hidden rather than unmounted on the Rewards view: the table's page, its sort and the chart
          hover state are all local, and losing them on every toggle would make switching back feel
          like a reload. The charts are memoised on the scoped rows, so nothing recomputes. */}
      <div className={view === 'rewards' ? 'hidden' : 'grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start'}>
      <div className="min-w-0">

      {hasData && (
        <>
          <div className="flex flex-col gap-5 mb-5">
            <SpendOverTime
              spendTxs={scopedSpend}
              range={range}
              categoryColors={allCategoryColors}
              cardColors={cardColors}
              filters={filters}
              onFilter={toggleFilter}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <CategoryBreakdown
                spendTxs={scopedSpend}
                categoryColors={allCategoryColors}
                filters={filters}
                onFilter={toggleFilter}
              />
              <TopMerchants
                spendTxs={scopedSpend}
                filters={filters}
                onFilter={toggleFilter}
              />
            </div>

            <CardsBar
              spendTxs={scopedSpend}
              cardColors={cardColors}
              filters={filters}
              onFilter={toggleFilter}
            />
          </div>


          {/* Money back, not spending — so it sits below the charts rather than in them, and says
              plainly that none of the figures above include it. */}
          {creditSummary.credits.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-5">
              <h2 className="text-[15px] font-semibold text-gray-900">Credits &amp; Refunds</h2>
              <p className="mt-1 mb-4 text-[12.5px] text-gray-400">
                Money back on the card · excluded from every spending figure above
              </p>

              <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                <div>
                  <p className="text-[27px] leading-tight font-semibold tracking-tight text-green-600">
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

              <p className="text-[12.5px] text-gray-400 mt-4 pt-3.5 border-t border-gray-100 leading-relaxed">
                Payments to the card aren't imported here — they're paid from your bank account, so
                they already show as an expense on the Finances tab.
              </p>
            </div>
          )}

        </>
      )}

      {/* scroll-margin keeps the "Review Now" jump from parking the table's header under the
          pinned scope block. */}
      <TransactionTable
        rows={sorted}
        scopeCount={scopedRows.length}
        isLoading={isLoading}
        duplicateById={duplicateById}
        categories={allCategories}
        categoryColors={allCategoryColors}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showUncategorizedOnly={showUncategorizedOnly}
        showDuplicatesOnly={showDuplicatesOnly}
        onClearUncategorized={() => setShowUncategorizedOnly(false)}
        onClearDuplicates={() => setShowDuplicatesOnly(false)}
        hasAiKey={hasAiKey}
        uncategorizedCount={uncategorizedCount}
        recategorizing={recategorizing}
        onRecategorize={handleRecategorize}
        onUpdate={patch => updateMutation.mutate(patch)}
        onDelete={id => deleteMutation.mutate(id)}
        deleting={deleteMutation.isPending}
        containerRef={tableRef}
        scrollMarginTop={clearsPinned}
        resetKey={tableResetKey}
      />

      <div className="mt-5">
        <CategoryManager />
      </div>


      </div>

      {/* Offset by the pinned bar's fixed height. A constant, not a measurement: the rail only ever
          pins after the bar is already showing, so this is correct in every state and costs no
          re-render mid-scroll.

          Capped to the viewport and scrollable *only* where it's sticky: the profile, Financial
          Pace, exploration choices and conversation run taller than the screen, and a sticky
          element taller than its viewport leaves its own bottom permanently out of reach. Below
          xl it's in normal flow, where a cap would be wrong. */}
      {hasData && (
        <aside
          className="xl:sticky xl:overflow-y-auto xl:max-h-[var(--rail-max-h)] min-w-0"
          style={{ top: clearsPinned, '--rail-max-h': `calc(100vh - ${clearsPinned + 16}px)` }}
        >
          <AiInsightsPanel
            hasAiKey={hasAiKey}
            storedInsights={storedInsights}
            insights={insights}
            insightsPeriod={insightsPeriod}
            chatMessages={chatMessages}
            scopeKey={scopeKey}
            scopeLabel={scopeLabel}
            insightsError={insightsError}
            chatError={chatError}
            chatInput={chatInput}
            chatLoading={chatLoading}
            pendingQuestion={pendingQuestion}
            generating={insightsMutation.isPending}
            clearing={clearInsightsMutation.isPending}
            onGenerate={() => insightsMutation.mutate(scopePayload)}
            onClear={() => clearInsightsMutation.mutate()}
            onSendChat={handleSendChat}
            onExplore={handleExplore}
            onChatInput={setChatInput}
            onOpenSettings={onTabChange ? () => onTabChange('settings') : undefined}
          />
        </aside>
      )}

      </div>

      {reviewData && (
        <BulkImportReviewModal
          groups={reviewData.groups}
          skipped={reviewData.skipped}
          busy={batchMutation.isPending}
          wallet={settings?.cardRewards?.wallet ?? {}}
          onConfirm={handleReviewConfirm}
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
          initialSourceName={sourceNameFromFile(csvModalData.fileName)}
          statementType="credit_card"
          onConfirm={handleMappingConfirm}
          onCancel={() => setCsvModalData(null)}
        />
      )}
      {showAddModal && (
        <AddTransactionModal
          categories={allCategories}
          sources={allSources}
          onConfirm={data => addMutation.mutate(data)}
          onCancel={() => setShowAddModal(false)}
        />
      )}
    </div>
  )
}
