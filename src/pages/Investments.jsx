import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { api } from '../api/client.js'

const HOLDING_ACCOUNT_TYPES = ['TFSA', 'RRSP', 'FHSA', 'Non-Registered', 'Roth IRA', 'Traditional IRA', '401(k)', 'Other']
const SAVINGS_ACCOUNT_TYPES = ['HYSA', 'Regular Savings', 'Money Market', 'CD / GIC', 'Other']

const DEFAULT_HOLDING_FORM = {
  ticker: '',
  shares: '',
  purchasePrice: '',
  purchaseDate: dayjs().format('YYYY-MM-DD'),
  accountType: 'Non-Registered',
}

const DEFAULT_SAVINGS_FORM = { name: '', accountType: 'HYSA', balance: '', apy: '' }

function fmt(n, digits = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

function SortIcon({ active, dir }) {
  if (!active) return <span className="ml-1 text-gray-300">↕</span>
  return <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>
}

export default function Investments() {
  const queryClient = useQueryClient()

  // ── Holdings state ────────────────────────────────────────────────────────
  const [showHoldingForm, setShowHoldingForm] = useState(false)
  const [holdingForm, setHoldingForm] = useState(DEFAULT_HOLDING_FORM)
  const [priceErrorDismissed, setPriceErrorDismissed] = useState(false)
  const [filterAccountType, setFilterAccountType] = useState('All')
  const [sortField, setSortField] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const { data: holdings = [], isLoading: holdingsLoading } = useQuery({
    queryKey: ['holdings'],
    queryFn: api.holdings.list,
  })

  const tickerList = [...new Set(holdings.map(h => h.ticker.toUpperCase()))]

  const { data: prices = {}, isFetching: pricesFetching, error: pricesQueryError } = useQuery({
    queryKey: ['prices', tickerList],
    queryFn: () => api.prices.get(tickerList),
    enabled: tickerList.length > 0,
    staleTime: 60_000,
  })

  const priceError = pricesQueryError?.message ?? null
  const showPriceError = priceError && !priceErrorDismissed

  const [expandedHistoryId, setExpandedHistoryId] = useState(null)

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

  function holdingField(key) {
    return {
      value: holdingForm[key],
      onChange: e => setHoldingForm(f => ({ ...f, [key]: e.target.value })),
    }
  }

  function handleHoldingSubmit(e) {
    e.preventDefault()
    if (!holdingForm.ticker || !holdingForm.shares || !holdingForm.purchasePrice || !holdingForm.purchaseDate) return
    addHoldingMutation.mutate({
      ticker: holdingForm.ticker.toUpperCase(),
      shares: parseFloat(holdingForm.shares),
      purchasePrice: parseFloat(holdingForm.purchasePrice),
      purchaseDate: holdingForm.purchaseDate,
      accountType: holdingForm.accountType,
    })
  }

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const rows = holdings.map(h => {
    const ticker = h.ticker.toUpperCase()
    const accountType = h.accountType ?? 'Non-Registered'
    const currentPrice = prices[ticker] ?? null
    const costBasis = h.purchasePrice * h.shares
    const currentValue = currentPrice !== null ? currentPrice * h.shares : null
    const gainDollar = currentValue !== null ? currentValue - costBasis : null
    const gainPct = gainDollar !== null ? (gainDollar / costBasis) * 100 : null
    return { ...h, ticker, accountType, currentPrice, costBasis, currentValue, gainDollar, gainPct }
  })

  const availableTypes = ['All', ...new Set(rows.map(r => r.accountType))]

  let displayRows = filterAccountType === 'All'
    ? rows
    : rows.filter(r => r.accountType === filterAccountType)

  if (sortField) {
    displayRows = [...displayRows].sort((a, b) => {
      let av, bv
      if (sortField === 'ticker') { av = a.ticker; bv = b.ticker }
      else if (sortField === 'accountType') { av = a.accountType; bv = b.accountType }
      else if (sortField === 'gainPct') { av = a.gainPct ?? -Infinity; bv = b.gainPct ?? -Infinity }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }

  const totalCost = rows.reduce((s, r) => s + r.costBasis, 0)
  const totalValue = rows.reduce((s, r) => s + (r.currentValue ?? r.costBasis), 0)
  const totalGain = totalValue - totalCost
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0

  // ── Savings state ─────────────────────────────────────────────────────────
  const [showSavingsForm, setShowSavingsForm] = useState(false)
  const [savingsForm, setSavingsForm] = useState(DEFAULT_SAVINGS_FORM)
  const [editingAccountId, setEditingAccountId] = useState(null)
  const [editAccountForm, setEditAccountForm] = useState({})

  const { data: savingsAccounts = [] } = useQuery({
    queryKey: ['savings-accounts'],
    queryFn: api.savingsAccounts.list,
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

  function startEditAccount(a) {
    setEditingAccountId(a.id)
    setEditAccountForm({ name: a.name, accountType: a.accountType, balance: String(a.balance), apy: String(a.apy) })
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

  function savingsField(key) {
    return {
      value: savingsForm[key],
      onChange: e => setSavingsForm(f => ({ ...f, [key]: e.target.value })),
    }
  }

  function handleSavingsSubmit(e) {
    e.preventDefault()
    if (!savingsForm.name || !savingsForm.balance || !savingsForm.apy) return
    addSavingsMutation.mutate({
      name: savingsForm.name,
      accountType: savingsForm.accountType,
      balance: parseFloat(savingsForm.balance),
      apy: parseFloat(savingsForm.apy),
    })
  }

  const totalSavings = savingsAccounts.reduce((s, a) => s + a.balance, 0)
  const totalAnnualInterest = savingsAccounts.reduce((s, a) => s + a.balance * (a.apy / 100), 0)

  return (
    <div className="p-3 sm:p-6 space-y-6">
      {/* ── Holdings section ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Investments</h1>
        <button
          onClick={() => setShowHoldingForm(v => !v)}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showHoldingForm ? 'Cancel' : '+ Add Holding'}
        </button>
      </div>

      {showHoldingForm && (
        <form
          onSubmit={handleHoldingSubmit}
          className="bg-white rounded-xl border border-gray-200 shadow-sm p-5"
        >
          <h2 className="text-sm font-medium text-gray-700 mb-4">New Holding</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ticker</label>
              <input {...holdingField('ticker')} placeholder="AAPL" className={inputClass} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Shares</label>
              <input {...holdingField('shares')} type="number" min="0.000001" step="any" placeholder="10" className={inputClass} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Purchase Price ($)</label>
              <input {...holdingField('purchasePrice')} type="number" min="0.01" step="0.01" placeholder="150.00" className={inputClass} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Purchase Date</label>
              <input {...holdingField('purchaseDate')} type="date" className={inputClass} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Account Type</label>
              <select {...holdingField('accountType')} className={inputClass}>
                {HOLDING_ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={addHoldingMutation.isPending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {addHoldingMutation.isPending ? 'Saving…' : 'Add Holding'}
            </button>
          </div>
        </form>
      )}

      {showPriceError && (
        <div className="px-4 py-3 rounded-lg text-sm flex items-center justify-between bg-red-50 text-red-800 border border-red-200">
          Could not fetch live prices: {priceError}
          <button onClick={() => setPriceErrorDismissed(true)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {holdings.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-xs text-gray-400 mb-1">Portfolio Value</p>
            <p className="text-2xl font-semibold text-gray-900">
              {pricesFetching ? <span className="text-gray-300 text-lg">Fetching…</span> : `$${fmt(totalValue)}`}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-xs text-gray-400 mb-1">Total Cost Basis</p>
            <p className="text-2xl font-semibold text-gray-900">${fmt(totalCost)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-xs text-gray-400 mb-1">Total Gain / Loss</p>
            {pricesFetching ? (
              <p className="text-2xl font-semibold text-gray-300 text-lg">Fetching…</p>
            ) : (
              <p className={`text-2xl font-semibold ${totalGain >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {totalGain >= 0 ? '+' : '−'}${fmt(Math.abs(totalGain))}{' '}
                <span className="text-base">({totalGain >= 0 ? '+' : ''}{fmt(totalGainPct)}%)</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Filter bar */}
      {holdings.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 shrink-0">Filter by account:</label>
          <select
            value={filterAccountType}
            onChange={e => setFilterAccountType(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {availableTypes.map(t => (
              <option key={t} value={t}>{t === 'All' ? 'All Accounts' : t}</option>
            ))}
          </select>
          {filterAccountType !== 'All' && (
            <button
              onClick={() => setFilterAccountType('All')}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {holdingsLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
        ) : holdings.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">No holdings yet.</p>
            <p className="text-gray-300 text-xs mt-1">Add a holding to get started.</p>
          </div>
        ) : displayRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            No holdings in "{filterAccountType}".
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th
                    className="px-4 py-3 cursor-pointer select-none hover:text-gray-600"
                    onClick={() => toggleSort('ticker')}
                  >
                    Ticker <SortIcon active={sortField === 'ticker'} dir={sortDir} />
                  </th>
                  <th
                    className="px-4 py-3 cursor-pointer select-none hover:text-gray-600"
                    onClick={() => toggleSort('accountType')}
                  >
                    Account <SortIcon active={sortField === 'accountType'} dir={sortDir} />
                  </th>
                  <th className="px-4 py-3 text-right">Shares</th>
                  <th className="px-4 py-3 text-right hidden sm:table-cell">Purchase Price</th>
                  <th className="px-4 py-3 text-right">Current Price</th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer select-none hover:text-gray-600"
                    onClick={() => toggleSort('gainPct')}
                  >
                    Gain / Loss <SortIcon active={sortField === 'gainPct'} dir={sortDir} />
                  </th>
                  <th className="px-4 py-3 text-right">Total Value</th>
                  <th className="px-4 py-3 text-right hidden sm:table-cell">Purchase Date</th>
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayRows.map(r => {
                  const purchaseCount = r.purchases?.length ?? 1
                  const isExpanded = expandedHistoryId === r.id
                  return (
                    <React.Fragment key={r.id}>
                      <tr className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900">{r.ticker}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{r.accountType}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 text-right">{r.shares}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 text-right hidden sm:table-cell">
                          ${fmt(r.purchasePrice)}
                          {purchaseCount > 1 && (
                            <span className="ml-1 text-xs text-gray-400">avg</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right">
                          {pricesFetching
                            ? <span className="text-gray-300 text-xs">Fetching…</span>
                            : r.currentPrice !== null
                              ? <span className="text-gray-900">${fmt(r.currentPrice)}</span>
                              : <span className="text-gray-300">—</span>
                          }
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium text-right whitespace-nowrap ${
                          r.gainDollar === null || pricesFetching ? 'text-gray-300' : r.gainDollar >= 0 ? 'text-green-600' : 'text-red-500'
                        }`}>
                          {r.gainDollar === null || pricesFetching
                            ? '—'
                            : <>{r.gainDollar >= 0 ? '+' : '−'}${fmt(Math.abs(r.gainDollar))} <span className="text-xs">({r.gainDollar >= 0 ? '+' : ''}{fmt(r.gainPct)}%)</span></>
                          }
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900">
                          {r.currentValue !== null && !pricesFetching
                            ? `$${fmt(r.currentValue)}`
                            : `$${fmt(r.costBasis)}`}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400 text-right whitespace-nowrap hidden sm:table-cell">
                          {r.purchaseDate ? dayjs(r.purchaseDate).format('MMM D, YYYY') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => setExpandedHistoryId(id => id === r.id ? null : r.id)}
                              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                                isExpanded
                                  ? 'border-blue-300 text-blue-600 bg-blue-50'
                                  : 'border-gray-200 text-gray-400 hover:text-blue-500 hover:border-blue-200'
                              }`}
                              title="View purchase history"
                            >
                              {purchaseCount} {purchaseCount === 1 ? 'buy' : 'buys'}
                            </button>
                            <button
                              onClick={() => deleteHoldingMutation.mutate(r.id)}
                              disabled={deleteHoldingMutation.isPending}
                              className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                              title="Delete all"
                            >
                              ×
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50">
                          <td colSpan={9} className="px-6 py-3">
                            <p className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">
                              Purchase history — {r.ticker} ({r.accountType})
                            </p>
                            {(() => {
                              const purchases = r.purchases && r.purchases.length > 0
                                ? r.purchases
                                : [{ id: r.id + '-legacy', shares: r.shares, purchasePrice: r.purchasePrice, purchaseDate: r.purchaseDate }]
                              const isLegacy = !r.purchases || r.purchases.length === 0
                              return (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-gray-400">
                                      <th className="text-left py-1 pr-4 font-medium">Date</th>
                                      <th className="text-right py-1 pr-4 font-medium">Shares</th>
                                      <th className="text-right py-1 pr-4 font-medium">Price</th>
                                      <th className="text-right py-1 pr-4 font-medium">Cost</th>
                                      <th className="py-1 w-6"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {purchases.map(p => (
                                      <tr key={p.id} className="border-t border-gray-100">
                                        <td className="py-1.5 pr-4 text-gray-600">{p.purchaseDate ? dayjs(p.purchaseDate).format('MMM D, YYYY') : '—'}</td>
                                        <td className="py-1.5 pr-4 text-right text-gray-600">{p.shares}</td>
                                        <td className="py-1.5 pr-4 text-right text-gray-600">${fmt(p.purchasePrice)}</td>
                                        <td className="py-1.5 pr-4 text-right text-gray-600">${fmt(p.shares * p.purchasePrice)}</td>
                                        <td className="py-1.5">
                                          <button
                                            onClick={() => deletePurchaseMutation.mutate({ holdingId: r.id, purchaseId: p.id })}
                                            disabled={deletePurchaseMutation.isPending || isLegacy}
                                            className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none disabled:cursor-not-allowed"
                                            title={isLegacy ? 'Save a new buy first to enable per-purchase deletion' : 'Delete purchase'}
                                          >
                                            ×
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )
                            })()}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Savings Accounts section ───────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2">
        <h2 className="text-xl font-semibold text-gray-900">Savings Accounts</h2>
        <button
          onClick={() => setShowSavingsForm(v => !v)}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showSavingsForm ? 'Cancel' : '+ Add Account'}
        </button>
      </div>

      {showSavingsForm && (
        <form
          onSubmit={handleSavingsSubmit}
          className="bg-white rounded-xl border border-gray-200 shadow-sm p-5"
        >
          <h2 className="text-sm font-medium text-gray-700 mb-4">New Savings Account</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Account Name</label>
              <input {...savingsField('name')} placeholder="Marcus HYSA" className={inputClass} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Account Type</label>
              <select {...savingsField('accountType')} className={inputClass}>
                {SAVINGS_ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Balance ($)</label>
              <input {...savingsField('balance')} type="number" min="0" step="0.01" placeholder="10000.00" className={inputClass} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">APY (%)</label>
              <input {...savingsField('apy')} type="number" min="0" step="0.01" placeholder="4.50" className={inputClass} required />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={addSavingsMutation.isPending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {addSavingsMutation.isPending ? 'Saving…' : 'Add Account'}
            </button>
          </div>
        </form>
      )}

      {savingsAccounts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-xs text-gray-400 mb-1">Total Savings</p>
            <p className="text-2xl font-semibold text-gray-900">${fmt(totalSavings)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-xs text-gray-400 mb-1">Projected Annual Interest</p>
            <p className="text-2xl font-semibold text-amber-600">${fmt(totalAnnualInterest)}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {savingsAccounts.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">No savings accounts yet.</p>
            <p className="text-gray-300 text-xs mt-1">Add an account to track your HYSA and other savings.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Type</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">APY</th>
                  <th className="px-4 py-3 text-right">Monthly Interest</th>
                  <th className="px-4 py-3 text-right">Annual Interest</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {savingsAccounts.map(a => {
                  const isEditing = editingAccountId === a.id
                  const monthly = isEditing
                    ? ((parseFloat(editAccountForm.balance) || 0) * (parseFloat(editAccountForm.apy) || 0) / 100) / 12
                    : (a.balance * (a.apy / 100)) / 12
                  const annual = isEditing
                    ? (parseFloat(editAccountForm.balance) || 0) * (parseFloat(editAccountForm.apy) || 0) / 100
                    : a.balance * (a.apy / 100)
                  return (
                    <tr key={a.id} className={`transition-colors ${isEditing ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            value={editAccountForm.name}
                            onChange={e => setEditAccountForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <span className="text-sm font-semibold text-gray-900">{a.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {isEditing ? (
                          <select
                            value={editAccountForm.accountType}
                            onChange={e => setEditAccountForm(f => ({ ...f, accountType: e.target.value }))}
                            className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {SAVINGS_ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        ) : (
                          <span className="text-sm text-gray-500">{a.accountType}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editAccountForm.balance}
                            onChange={e => setEditAccountForm(f => ({ ...f, balance: e.target.value }))}
                            className="w-28 border border-gray-300 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <span className="text-sm text-gray-900">${fmt(a.balance)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editAccountForm.apy}
                            onChange={e => setEditAccountForm(f => ({ ...f, apy: e.target.value }))}
                            className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <span className="text-sm text-gray-600">{fmt(a.apy)}%</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-amber-600 font-medium text-right">${fmt(monthly)}</td>
                      <td className="px-4 py-3 text-sm text-amber-600 font-medium text-right">${fmt(annual)}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => handleSaveAccount(a.id)}
                              disabled={updateSavingsMutation.isPending}
                              className="text-xs px-2 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingAccountId(null)}
                              className="text-xs px-2 py-1 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => startEditAccount(a)}
                              className="text-gray-400 hover:text-blue-500 transition-colors text-sm"
                              title="Edit"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => deleteSavingsMutation.mutate(a.id)}
                              disabled={deleteSavingsMutation.isPending}
                              className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                              title="Delete"
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
