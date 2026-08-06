import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'
import { buildInvestmentsModel, filterByAccount, sortHoldings } from '../utils/investmentsModel.js'
import InvestmentsHeader from '../components/investments/InvestmentsHeader.jsx'
import InvestmentKpiRow from '../components/investments/InvestmentKpiRow.jsx'
import AccountChips from '../components/investments/AccountChips.jsx'
import AllocationDonut from '../components/investments/AllocationDonut.jsx'
import HoldingsTable from '../components/investments/HoldingsTable.jsx'
import SavingsTable from '../components/investments/SavingsTable.jsx'
import HoldingForm, { DEFAULT_HOLDING_FORM } from '../components/investments/HoldingForm.jsx'
import SavingsForm, { DEFAULT_SAVINGS_FORM } from '../components/investments/SavingsForm.jsx'
import StatementImportModal from '../components/investments/StatementImportModal.jsx'

export default function Investments({ demoMode }) {
  const queryClient = useQueryClient()

  // Demo mode runs against a shared database, so every write on this page is off — not just the
  // ones that cost money. This page previously gated nothing at all.
  const readOnly = !!demoMode

  const [showHoldingForm, setShowHoldingForm] = useState(false)
  const [holdingForm, setHoldingForm] = useState(DEFAULT_HOLDING_FORM)
  const [showSavingsForm, setShowSavingsForm] = useState(false)
  const [savingsForm, setSavingsForm] = useState(DEFAULT_SAVINGS_FORM)
  const [priceErrorDismissed, setPriceErrorDismissed] = useState(false)
  const [accountFilter, setAccountFilter] = useState('All')
  const [sortKey, setSortKey] = useState('value')
  const [sortDir, setSortDir] = useState('desc')
  const [expandedId, setExpandedId] = useState(null)
  const [editingAccountId, setEditingAccountId] = useState(null)
  const [editAccountForm, setEditAccountForm] = useState({})
  const [showImport, setShowImport] = useState(false)
  const [importStatus, setImportStatus] = useState(null)
  const [importError, setImportError] = useState(null)

  const { data: holdings = [], isLoading: holdingsLoading } = useQuery({
    queryKey: ['holdings'],
    queryFn: api.holdings.list,
  })

  const { data: savingsAccounts = [] } = useQuery({
    queryKey: ['savings-accounts'],
    queryFn: api.savingsAccounts.list,
  })

  const tickerList = useMemo(
    () => [...new Set(holdings.map(h => String(h.ticker || '').toUpperCase()))].filter(Boolean),
    [holdings],
  )

  const {
    data: prices = {},
    isFetching: pricesFetching,
    error: pricesQueryError,
    dataUpdatedAt: pricesUpdatedAt,
    refetch: refetchPrices,
  } = useQuery({
    queryKey: ['prices', tickerList],
    queryFn: () => api.prices.get(tickerList),
    enabled: tickerList.length > 0,
    staleTime: 60_000,
  })

  const priceError = pricesQueryError?.message ?? null
  const showPriceError = priceError && !priceErrorDismissed

  const model = useMemo(
    () => buildInvestmentsModel({ holdings, prices, savingsAccounts }),
    [holdings, prices, savingsAccounts],
  )

  const visibleRows = useMemo(
    () => sortHoldings(filterByAccount(model.rows, accountFilter), sortKey, sortDir),
    [model.rows, accountFilter, sortKey, sortDir],
  )

  const addHoldingMutation = useMutation({
    mutationFn: api.holdings.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holdings'] })
      setHoldingForm(DEFAULT_HOLDING_FORM)
      setShowHoldingForm(false)
    },
  })

  const deleteHoldingMutation = useMutation({
    mutationFn: api.holdings.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['holdings'] }),
  })

  const deletePurchaseMutation = useMutation({
    mutationFn: ({ holdingId, purchaseId }) => api.holdings.removePurchase(holdingId, purchaseId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['holdings'] }),
  })

  const addSavingsMutation = useMutation({
    mutationFn: api.savingsAccounts.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savings-accounts'] })
      setSavingsForm(DEFAULT_SAVINGS_FORM)
      setShowSavingsForm(false)
    },
  })

  const updateSavingsMutation = useMutation({
    mutationFn: ({ id, ...data }) => api.savingsAccounts.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savings-accounts'] })
      setEditingAccountId(null)
      setEditAccountForm({})
    },
  })

  const deleteSavingsMutation = useMutation({
    mutationFn: api.savingsAccounts.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['savings-accounts'] }),
  })

  const historyMutation = useMutation({
    mutationFn: api.uploadHistory.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['upload-history'] }),
  })

  /**
   * Commit a reviewed statement.
   *
   * One reconcile call, never a loop of creates: the routes read-modify-write the flat db, and a
   * dozen parallel writes lose whichever landed first.
   */
  const importMutation = useMutation({
    mutationFn: async (payload) => {
      if (payload.target === 'savings') {
        const result = await api.savingsAccounts.reconcile({ accounts: payload.accounts })
        // Only accounts this import CREATED are recorded. Deleting the history entry must not
        // remove an account that existed before and merely had its balance refreshed.
        return { ...payload, counts: result.counts, recordIds: result.createdIds }
      }
      const result = await api.holdings.reconcile({
        accountType: payload.accountName,
        statementDate: payload.statementDate,
        positions: payload.positions,
        removeTickers: payload.removeTickers,
      })
      return { ...payload, counts: result.counts, recordIds: result.purchaseIds }
    },
    onSuccess: async ({ target, fileName, accountName, counts, recordIds }) => {
      const changed = counts.added + counts.updated + (counts.removed ?? 0)
      historyMutation.mutate({
        filename: fileName || 'statement.pdf',
        sourceName: target === 'savings' ? 'Savings accounts' : accountName,
        transactionCount: changed,
        ledger: 'investment',
        target,
        recordIds,
      })

      queryClient.invalidateQueries({ queryKey: ['holdings'] })
      queryClient.invalidateQueries({ queryKey: ['savings-accounts'] })
      // The portfolio just moved, so today's stored liquid-net-worth point is stale. Awaited before
      // its query is invalidated — the snapshot writes the same flat file the reconcile just did.
      await api.netWorth.snapshot().catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['net-worth-history'] })

      setShowImport(false)
      setImportError(null)
      const parts = [
        counts.added ? `${counts.added} added` : null,
        counts.updated ? `${counts.updated} updated` : null,
        counts.removed ? `${counts.removed} removed` : null,
      ].filter(Boolean)
      setImportStatus(parts.length
        ? `Statement imported — ${parts.join(', ')}.`
        : 'Statement matched what was already stored; nothing changed.')
      setTimeout(() => setImportStatus(null), 5000)
    },
    onError: (err) => setImportError(err.message || 'Could not import this statement.'),
  })

  function toggleSort(field) {
    if (sortKey === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(field)
      // Value and gain are interesting from the top; names read from the top alphabetically.
      setSortDir(field === 'ticker' || field === 'accountType' ? 'asc' : 'desc')
    }
  }

  function handleHoldingSubmit(e) {
    e.preventDefault()
    if (readOnly) return
    const { ticker, shares, purchasePrice, purchaseDate, accountType } = holdingForm
    // The account is free text now, so it has to be checked rather than assumed non-empty. It is
    // also the key holdings are grouped and reconciled by, so stray padding would split a position
    // across two accounts that look identical on screen.
    if (!ticker || !shares || !purchasePrice || !purchaseDate || !accountType.trim()) return
    addHoldingMutation.mutate({
      ticker: ticker.toUpperCase(),
      shares: parseFloat(shares),
      purchasePrice: parseFloat(purchasePrice),
      purchaseDate,
      accountType: accountType.trim(),
    })
  }

  function handleSavingsSubmit(e) {
    e.preventDefault()
    if (readOnly) return
    const { name, accountType, balance, apy } = savingsForm
    if (!name || balance === '' || apy === '') return
    addSavingsMutation.mutate({
      name,
      accountType,
      balance: parseFloat(balance),
      apy: parseFloat(apy),
    })
  }

  function startEditAccount(account) {
    if (readOnly) return
    setEditingAccountId(account.id)
    setEditAccountForm({
      name: account.name,
      accountType: account.accountType,
      balance: String(account.balance),
      apy: String(account.apy),
    })
  }

  function handleSaveAccount(id) {
    const { name, accountType, balance, apy } = editAccountForm
    if (!name || balance === '' || apy === '') return
    updateSavingsMutation.mutate({
      id,
      name,
      accountType,
      balance: parseFloat(balance),
      apy: parseFloat(apy),
    })
  }

  return (
    <div className="space-y-6 p-3 sm:p-6">
      <InvestmentsHeader
        holdingCount={holdings.length}
        savingsCount={savingsAccounts.length}
        pricesUpdatedAt={tickerList.length ? pricesUpdatedAt : null}
        pricesFetching={pricesFetching}
        unpricedCount={model.unpricedCount}
        onRefreshPrices={() => refetchPrices()}
        onUpload={() => { setImportError(null); setShowImport(true) }}
        onAddHolding={() => setShowHoldingForm(v => !v)}
        addingHolding={showHoldingForm}
        readOnly={readOnly}
      />

      {showHoldingForm && !readOnly && (
        <HoldingForm
          form={holdingForm}
          onChange={(key, value) => setHoldingForm(f => ({ ...f, [key]: value }))}
          onSubmit={handleHoldingSubmit}
          saving={addHoldingMutation.isPending}
          accountTypes={model.accountTypes}
        />
      )}

      {importStatus && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {importStatus}
        </div>
      )}

      {showPriceError && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not fetch live prices: {priceError}
          <button onClick={() => setPriceErrorDismissed(true)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <InvestmentKpiRow model={model} pricesFetching={pricesFetching} />

      <AccountChips
        accountTypes={model.accountTypes}
        value={accountFilter}
        onChange={setAccountFilter}
      />

      <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <HoldingsTable
            rows={visibleRows}
            totalCount={model.rows.length}
            accountFilter={accountFilter}
            // The same condition that governs the chips: with one account type the column repeats
            // one word down the whole table and costs the ticker its width.
            showAccount={model.accountTypes.length > 1}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            pricesFetching={pricesFetching}
            loading={holdingsLoading}
            expandedId={expandedId}
            onToggleExpanded={id => setExpandedId(current => (current === id ? null : id))}
            onDeleteHolding={id => deleteHoldingMutation.mutate(id)}
            onDeletePurchase={(holdingId, purchaseId) => deletePurchaseMutation.mutate({ holdingId, purchaseId })}
            deletingHolding={deleteHoldingMutation.isPending}
            deletingPurchase={deletePurchaseMutation.isPending}
            readOnly={readOnly}
          />
        </div>
        <div className="min-w-0">
          <AllocationDonut rollup={model.rollup} totalValue={model.totalValue} rows={model.rows} />
        </div>
      </div>

      {showSavingsForm && !readOnly && (
        <SavingsForm
          form={savingsForm}
          onChange={(key, value) => setSavingsForm(f => ({ ...f, [key]: value }))}
          onSubmit={handleSavingsSubmit}
          saving={addSavingsMutation.isPending}
        />
      )}

      <SavingsTable
        accounts={savingsAccounts}
        editingId={editingAccountId}
        editForm={editAccountForm}
        onEditField={(key, value) => setEditAccountForm(f => ({ ...f, [key]: value }))}
        onStartEdit={startEditAccount}
        onCancelEdit={() => { setEditingAccountId(null); setEditAccountForm({}) }}
        onSave={handleSaveAccount}
        onDelete={id => deleteSavingsMutation.mutate(id)}
        saving={updateSavingsMutation.isPending}
        deleting={deleteSavingsMutation.isPending}
        onAdd={() => setShowSavingsForm(v => !v)}
        addingAccount={showSavingsForm}
        readOnly={readOnly}
      />

      {showImport && !readOnly && (
        <StatementImportModal
          holdings={holdings}
          savingsAccounts={savingsAccounts}
          accountTypes={model.accountTypes}
          onClose={() => { setShowImport(false); setImportError(null) }}
          onConfirm={payload => importMutation.mutate(payload)}
          committing={importMutation.isPending}
          commitError={importError}
        />
      )}
    </div>
  )
}
