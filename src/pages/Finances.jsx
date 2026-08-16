import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'
import { FINANCE_CATEGORIES, FINANCE_CATEGORY_COLORS } from '../constants/categories.js'
import { processCSVRows } from '../utils/csvHelpers.js'
import { runImportQueue } from '../utils/importQueue.js'
import { matchSourceName } from '../utils/sourceNaming.js'
import { annotateDuplicates, duplicateFlags } from '../utils/duplicates.js'
import { errorStatus } from '../utils/diagnostics.js'
import { resolvePeriod, explicitRange, filterByRange, describeScope, buildScopeKey } from '../utils/period.js'
import { expectedBalanceAt } from '../utils/liquidNetWorth.js'
import { accountTypeOf } from '../utils/investmentsModel.js'
import { applyFinanceFilters, buildFinanceKpis } from '../utils/financeAggregations.js'
import ErrorBanner from '../components/ErrorBanner.jsx'
import CsvMappingModal from '../components/CsvMappingModal.jsx'
import BulkImportReviewModal from '../components/BulkImportReviewModal.jsx'
import AddTransactionModal from '../components/AddTransactionModal.jsx'
import PeriodChips from '../components/shared/PeriodChips.jsx'
import FilterBar from '../components/shared/FilterBar.jsx'
import { PINNED_BAR_H } from '../components/shared/PinnedScopeBar.jsx'
import FinanceKpiRow from '../components/finance/FinanceKpiRow.jsx'
import FinanceScopeBar from '../components/finance/FinanceScopeBar.jsx'
import DuplicateBanner from '../components/finance/DuplicateBanner.jsx'
import InOutChart from '../components/finance/InOutChart.jsx'
import InflowsCard from '../components/finance/InflowsCard.jsx'
import OutflowsCard from '../components/finance/OutflowsCard.jsx'
import AllocationCard from '../components/finance/AllocationCard.jsx'
import FinanceTransactionTable from '../components/finance/FinanceTransactionTable.jsx'
import FinanceInsightsPanel from '../components/finance/FinanceInsightsPanel.jsx'

const DEMO_BANNER_H = 32

const NO_FILTERS = { accounts: [], flows: [], payees: [] }
const FILTER_LABEL = { accounts: 'Account', flows: 'Type', payees: 'Payee' }

export default function Finances({ demoMode, onTabChange, handoff }) {
  const fileInputRef = useRef()
  const pendingUploadMetaRef = useRef(null)
  const tableRef = useRef()
  const queryClient = useQueryClient()

  const [csvModalData, setCsvModalData] = useState(null)
  const [reviewData, setReviewData] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [period, setPeriod] = useState('6M')
  // An exact window handed over from another tab, which overrides the chips until dismissed. The
  // Dashboard's waterfall sends the stretch between two cash reconciliations, and no chip can
  // express that — chips are all anchored to the latest transaction.
  const [focus, setFocus] = useState(handoff?.range ?? null)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [filterType, setFilterType] = useState('all')
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false)
  const [tableSearch, setTableSearch] = useState('')
  const [importStatus, setImportStatus] = useState(null)
  const [insightsError, setInsightsError] = useState(null)
  const [chatError, setChatError] = useState(null)
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  // The question being awaited. Held locally only so it can be shown immediately; the stored
  // conversation is the source of truth once the reply lands.
  const [pendingQuestion, setPendingQuestion] = useState(null)

  // Track the handoff rather than only seeding from it: arriving from the Dashboard remounts this
  // page, but navigating here from the nav bar does not, and a stale focus window would then
  // outlive the request that opened it.
  useEffect(() => { setFocus(handoff?.range ?? null) }, [handoff])

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

  // Investment transfers link to a holding *account type*, not to a holding — there is no account
  // entity to point at, and the server already treats `accountType` as a link target. The menu is
  // built from the types that actually exist rather than a fixed list, so it can't offer a
  // destination the portfolio doesn't have.
  const { data: holdings = [] } = useQuery({
    queryKey: ['holdings'],
    queryFn: api.holdings.list,
  })

  const holdingAccountTypes = useMemo(
    () => [...new Set(holdings.map(accountTypeOf))].sort(),
    [holdings],
  )

  // Card credits are read-only here. They live only in the card ledger — copying them into
  // db.transactions would leave two rows for one event and no way to keep them in step.
  const { data: cardTransactions = [] } = useQuery({
    queryKey: ['credit_card_transactions'],
    queryFn: api.creditCardTransactions.list,
  })

  // Persisted server-side so the analysis and its chat survive a tab change (which unmounts this
  // page) and a browser reload. Separate record from the Spend Analyzer's — one per tab.
  // Only for the import check: it needs the opening anchor the balances hang off.
  const { data: cashStatus = null } = useQuery({
    queryKey: ['cash-status'],
    queryFn: api.cashStatus,
  })

  const { data: financeInsights } = useQuery({
    queryKey: ['finance-insights'],
    queryFn: api.financeInsights.get,
  })

  const insightsPeriod = financeInsights?.period ?? null
  const chatMessages = financeInsights?.messages ?? []

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
      // Batch returns txs in the same order as the flat list we sent, so we can slice by
      // each file's count and attach those IDs to the history row for cascade-delete later.
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
          ledger: 'bank',
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
    // A statement balance moves cash, so every derived view of it has to refetch — not just
    // settings. Harmless for the other patches this mutation carries.
    onSuccess: () => {
      for (const key of [['settings'], ['cash-status'], ['net-worth-history']]) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  const insightsMutation = useMutation({
    mutationFn: (scope) => api.llm.financeInsights(scope),
    onSuccess: () => {
      setInsightsError(null)
      queryClient.invalidateQueries({ queryKey: ['finance-insights'] })
    },
    onError: (err) => setInsightsError(err.message || 'Failed to generate insights. Please try again.'),
  })

  const clearInsightsMutation = useMutation({
    mutationFn: api.financeInsights.clear,
    onSuccess: () => {
      setInsightsError(null)
      setChatError(null)
      queryClient.invalidateQueries({ queryKey: ['finance-insights'] })
    },
  })

  // A plain async function rather than a mutation: the reply is written into the stored record
  // server-side, so there is nothing to hold in mutation state, and the pending question has to
  // appear before the request resolves.
  async function sendChatMessage(rawMessage) {
    const message = String(rawMessage ?? '').trim()
    if (!message || chatLoading) return
    setChatInput('')
    setChatError(null)
    setPendingQuestion(message)
    setChatLoading(true)
    try {
      // Sent against the STORED scope, not the one on screen: the answer has to describe the same
      // data the cards above it describe, or the server refuses to record the exchange.
      await api.llm.financeChat(
        insightsPeriod ? { ...scopePayload, period: insightsPeriod } : scopePayload,
        [...chatMessages, { role: 'user', content: message }],
      )
      await queryClient.invalidateQueries({ queryKey: ['finance-insights'] })
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

      // The source name is never inherited from a previous import. Reusing the last card name
      // imported is what silently relabelled a whole statement: the field looked answered, the
      // name was plausible, and nothing on screen said where it came from. A name now comes from
      // the file itself or from nobody — the review modal already refuses to confirm without one.
      const existing = [...new Set(transactions.map(t => t.source).filter(Boolean))]
      const named = groups.map(g => ({
        ...g,
        sourceName: g.sourceName || matchSourceName(g.account, existing) || '',
      }))
      const { groups: annotated } = annotateDuplicates(named, transactions)
      setReviewData({ groups: annotated, skipped })
    } catch (err) {
      setImportStatus(errorStatus(err, { action: 'bank statement import', stage: 'import queue' }))
    }
  }

  // Handed to the review modal so it can check an import before it lands. The page owns this
  // because the answer needs the stored anchors and the existing ledger, neither of which the
  // modal has — and recomputing them there would be a second derivation of the same figure.
  function expectedClosingAt(date, incomingRows) {
    return expectedBalanceAt({
      opening: cashStatus?.opening ?? null,
      statementBalances: settings?.statementBalances ?? [],
      bankRows: transactions,
      incomingRows,
    }, date)
  }

  function handleReviewConfirm(readyGroups, statementClosings = []) {
    const newSources = { ...(settings?.csvSources || {}) }
    let changed = false
    for (const g of readyGroups) {
      if (g.mapping) {
        newSources[g.sourceName] = g.mapping
        changed = true
      }
    }
    if (changed) saveMappingMutation.mutate(newSources)
    pendingUploadMetaRef.current = readyGroups.map(g => ({
      filename: g.fileName,
      sourceName: g.sourceName,
      transactionCount: g.transactions.length,
    }))
    // Recorded alongside the rows, so a statement that was checked at import keeps its anchor and
    // never has to be entered a second time in Settings.
    if (statementClosings.length) {
      const merged = [
        ...(settings?.statementBalances ?? []).filter(b => !statementClosings.some(c => c.date === b.date)),
        ...statementClosings,
      ].sort((a, b) => a.date.localeCompare(b.date))
      settingsMutation.mutate({ statementBalances: merged })
    }
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
    // Tab wins over whatever the modal (or a reused source name) had stored.
    const locked = { ...mapping, statementType: 'bank' }
    const newSources = { ...(settings?.csvSources || {}), [sourceName]: locked }
    saveMappingMutation.mutate(newSources)
    const txs = processCSVRows(csvModalData.rows, { ...locked, sourceName })
    pendingUploadMetaRef.current = [{
      filename: csvModalData.fileName ?? 'unknown',
      sourceName,
      transactionCount: txs.length,
    }]
    batchMutation.mutate(txs)
  }

  // --- The derivation chain -------------------------------------------------------------------
  //
  //   transactions → periodRows → scopedRows → KPIs + chart
  //     (useQuery)   (date range)  (+ filters)
  //
  // One period control drives the whole page. The table narrows further with its own review
  // toggles, but it can no longer sit on a different month than the numbers above it — which is
  // what the old separate `filterMonth` select allowed.
  // A focus window from another tab wins over the chips. It is clamped to the ledger's own bounds
  // for the same reason `resolvePeriod` clamps: a range that claims dates the ledger does not
  // cover reports "0 transactions" as if the money were missing rather than never imported.
  const range = useMemo(() => {
    const chip = resolvePeriod(period, transactions)
    if (!focus?.from || !focus?.to) return chip
    const ledger = resolvePeriod('All', transactions)
    if (!ledger.from) return chip
    const from = focus.from < ledger.from ? ledger.from : focus.from
    const to = focus.to > ledger.to ? ledger.to : focus.to
    return explicitRange(from, to) ?? chip
  }, [period, transactions, focus])
  // Touching a chip is how you leave a focus window — there is no state where both apply.
  function selectPeriod(key) {
    setFocus(null)
    setPeriod(key)
  }

  const periodRows = useMemo(() => filterByRange(transactions, range), [transactions, range])
  const scopedRows = useMemo(() => applyFinanceFilters(periodRows, filters), [periodRows, filters])
  const periodCredits = useMemo(() => filterByRange(cardCredits, range), [cardCredits, range])

  const kpis = useMemo(
    () => buildFinanceKpis(scopedRows, range, periodCredits, countCreditsAsIncome),
    [scopedRows, range, periodCredits, countCreditsAsIncome],
  )

  const monthsAvailable = useMemo(
    () => new Set(transactions.map(t => t.date?.slice(0, 7)).filter(Boolean)).size,
    [transactions],
  )

  // Compared across the WHOLE ledger, never periodRows, so a duplicate straddling a period
  // boundary still surfaces instead of hiding until the range happens to cover both copies.
  const { groupCount: duplicateSetCount, byId: duplicateById, dollarExposure } = useMemo(
    () => duplicateFlags(transactions),
    [transactions],
  )

  // The table reads the same `scopedRows` the charts do, so clicking a payee narrows the list too
  // — one scope for the whole page.
  const bankRows = scopedRows
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
  // editable here and are left out of the duplicate view, which only spans bank rows. They appear
  // under Income only when the setting actually counts them as income — otherwise the list would
  // claim an income row the KPIs deliberately exclude.
  const showCredits = !showDuplicatesOnly
    && (filterType === 'all' || (filterType === 'income' && countCreditsAsIncome))
  const creditRows = showCredits ? periodCredits.map(t => ({ ...t, _cardCredit: true })) : []

  const tableSearchTerm = tableSearch.trim().toLowerCase()
  const filtered = [...bankRows, ...creditRows]
    .filter(t => !tableSearchTerm || [t.description, t.category, t.source].some(
      field => String(field ?? '').toLowerCase().includes(tableSearchTerm),
    ))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  // What the table would show with no type filter, no search and no review toggle — the denominator
  // in "N of M in scope".
  const tableScopeCount = scopedRows.length + periodCredits.length

  const { credits: totalCredits } = kpis
  const hasChartData = transactions.length > 0

  // What the AI is being asked about: the range plus the filter chips, as one opaque key the server
  // stores and compares by string equality. The table's own search and review toggles are excluded —
  // they narrow the list on screen but not the financial context.
  const scopeKey = buildScopeKey(range, filters)
  const scopeLabel = describeScope(range, filters)
  const scopePayload = {
    period: scopeKey,
    from: range.from,
    to: range.to,
    filters,
    periodLabel: scopeLabel,
  }

  // Everything that has to clear the pinned bar measures from here. A constant, not a measurement:
  // the rail only ever sticks once the bar is already showing, so this is correct in every state
  // and costs no re-render mid-scroll.
  const pinnedTop = demoMode ? DEMO_BANNER_H : 0
  const railTop = pinnedTop + PINNED_BAR_H + 16

  function toggleFilter(kind, value) {
    setFilters(f => ({
      ...f,
      [kind]: f[kind].includes(value) ? f[kind].filter(v => v !== value) : [...f[kind], value],
    }))
  }

  const filterChips = Object.entries(filters).flatMap(([kind, values]) =>
    values.map(value => ({
      key: `${kind}:${value}`,
      // Flow values are the lowercase strings rows are matched on (`income`/`expense`); a chip is
      // read by a person, so it gets the capitalized form.
      label: `${FILTER_LABEL[kind]}: ${kind === 'flows' ? value[0].toUpperCase() + value.slice(1) : value}`,
      onRemove: () => toggleFilter(kind, value),
    })),
  )
  const hasFilters = filterChips.length > 0

  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Finances</h1>
          <p className="mt-1 text-sm text-gray-400">
            {range.monthCount > 0
              ? `${range.label} · ${periodRows.length} bank transaction${periodRows.length === 1 ? '' : 's'} · ${kpis.accountCount} source${kpis.accountCount === 1 ? '' : 's'}`
              : 'No bank transactions yet'}
          </p>
        </div>
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

      {focus && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5">
          <span className="text-[13px] text-blue-900">
            Inspecting <strong className="font-semibold">{range.label}</strong>
            {focus.reason ? ` — ${focus.reason}` : ''}
          </span>
          <button
            onClick={() => setFocus(null)}
            className="text-[12px] font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
          >
            Clear
          </button>
        </div>
      )}

      {hasChartData && (
        <div className="mb-5 space-y-3">
          <PeriodChips
            // No chip is active while a focus window is on: showing 6M lit up beside a range that
            // reads "Jun 7 – Jun 29" would be a straightforward contradiction.
            value={focus ? null : period}
            onChange={selectPeriod}
            range={range}
            txCount={periodRows.length}
            monthsAvailable={monthsAvailable}
          />
          <FilterBar
            chips={filterChips}
            summary={describeScope(range, filters)}
            onClearAll={() => setFilters(NO_FILTERS)}
          />
        </div>
      )}

      <DuplicateBanner
        setCount={duplicateSetCount}
        dollarExposure={dollarExposure}
        onReview={() => {
          setShowDuplicatesOnly(true)
          // Duplicates are found across the whole ledger, so the range has to open up to All or
          // the review list would silently hide the pairs outside the current period. Every other
          // narrowing goes with it, for the same reason — a review that hides matches is worse
          // than no review.
          selectPeriod('All')
          setFilterType('all')
          setFilters(NO_FILTERS)
          setTableSearch('')
          setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
        }}
      />

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
        <>
          <div className="mb-5">
            <FinanceKpiRow kpis={kpis} countCreditsAsIncome={countCreditsAsIncome} />
          </div>

          {/* Sits directly after the KPI row so the range and the headline numbers stay reachable
              while you scroll the charts — the same bar the Spend Analyzer pins. */}
          <FinanceScopeBar
            period={focus ? null : period}
            onPeriodChange={selectPeriod}
            range={range}
            txCount={periodRows.length}
            monthsAvailable={monthsAvailable}
            kpis={kpis}
            chips={filterChips}
            onClearAll={() => setFilters(NO_FILTERS)}
            offsetTop={pinnedTop}
          />
        </>
      )}

      {/* Main column + sticky Financial Pace rail, starting level with the In/Out chart. The rail
          drops below the content under xl, where 320px of it would leave the chart too narrow to
          read a month at a time. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
      <div className="min-w-0">

      {hasChartData && (
        <div className="space-y-5 mb-6">
          <InOutChart
            bankRows={scopedRows}
            cardCredits={periodCredits}
            countCredits={countCreditsAsIncome}
            range={range}
            subtitle={hasFilters ? 'Filtered to the current scope.' : ''}
            filters={filters}
            onFilter={toggleFilter}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <InflowsCard
              rows={scopedRows}
              cardCredits={totalCredits}
              countCredits={countCreditsAsIncome}
              creditsDisabled={demoMode || settingsMutation.isPending}
              onToggleCredits={checked => settingsMutation.mutate({ countCardCreditsAsIncome: checked })}
              filters={filters}
              onFilter={toggleFilter}
            />
            <OutflowsCard rows={scopedRows} filters={filters} onFilter={toggleFilter} />
          </div>

          <AllocationCard
            rows={scopedRows}
            months={range.monthCount}
            savingsAccounts={savingsAccounts}
            income={kpis.countedIncome}
            hasHoldings={holdingAccountTypes.length > 0}
            onLinkAccounts={() => onTabChange?.('investments')}
          />
        </div>
      )}
      <FinanceTransactionTable
        rows={filtered}
        scopeCount={tableScopeCount}
        isLoading={isLoading}
        rangeLabel={range.label}
        duplicateById={duplicateById}
        categories={allCategories}
        categoryColors={allCategoryColors}
        searchQuery={tableSearch}
        onSearchChange={setTableSearch}
        typeFilter={filterType}
        onTypeFilterChange={setFilterType}
        showDuplicatesOnly={showDuplicatesOnly}
        onClearDuplicates={() => setShowDuplicatesOnly(false)}
        savingsAccounts={savingsAccounts}
        holdingAccountTypes={holdingAccountTypes}
        onUpdate={patch => updateMutation.mutate(patch)}
        onDelete={id => deleteMutation.mutate(id)}
        deleting={deleteMutation.isPending}
        readOnly={demoMode}
        containerRef={tableRef}
        resetKey={`${period}|${filterType}|${showDuplicatesOnly}|${tableSearch}|${filterChips.length}`}
      />

      </div>

      {/* Capped to the viewport and scrollable *only* where it's sticky: the pace card, three
          observations, exploration choices and conversation run taller than the screen, and a sticky
          element taller than its viewport leaves its own bottom permanently out of reach. Below xl
          it's in normal flow, where a cap would be wrong. */}
      {hasChartData && (
        <aside
          className="xl:sticky xl:overflow-y-auto xl:max-h-[var(--rail-max-h)] min-w-0"
          style={{ top: railTop, '--rail-max-h': `calc(100vh - ${railTop + 16}px)` }}
        >
          <FinanceInsightsPanel
            hasAiKey={hasAiKey}
            record={financeInsights}
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
            onExplore={option => sendChatMessage(option.id)}
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
          knownSources={[...new Set(transactions.map(t => t.source).filter(Boolean))].sort()}
          busy={batchMutation.isPending}
          onConfirm={handleReviewConfirm}
          onExpectedBalance={expectedClosingAt}
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
          statementType="bank"
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
