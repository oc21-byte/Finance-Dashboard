import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
  ComposedChart, AreaChart, Area, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts'
import { api } from '../api/client.js'
import { FINANCE_CATEGORIES } from '../constants/categories.js'

// ── Utilities ────────────────────────────────────────────────────────────────

const FINANCE_CAT_SET = new Set(FINANCE_CATEGORIES)

function buildNetCashFlowData(transactions, periodKey) {
  let months
  if (periodKey === 'All') {
    const earliest = transactions.reduce((min, t) => {
      const m = t.date?.slice(0, 7)
      return m && (!min || m < min) ? m : min
    }, null)
    if (!earliest) return []
    const start = dayjs(earliest + '-01')
    const count = dayjs().diff(start, 'month') + 1
    months = Array.from({ length: count }, (_, i) =>
      start.add(i, 'month').format('YYYY-MM')
    )
  } else if (periodKey === 'YTD') {
    const startOfYear = dayjs().startOf('year')
    const count = dayjs().diff(startOfYear, 'month') + 1
    months = Array.from({ length: count }, (_, i) =>
      startOfYear.add(i, 'month').format('YYYY-MM')
    )
  } else {
    const monthCount = periodKey === '1Y' ? 12 : periodKey === '3M' ? 3 : 6
    months = Array.from({ length: monthCount }, (_, i) =>
      dayjs().subtract(monthCount - 1 - i, 'month').format('YYYY-MM')
    )
  }

  return months.map(month => {
    const txs = transactions.filter(t => t.date?.startsWith(month))
    const income = txs
      .filter(t => t.category === 'Income' || (t.type === 'income' && !FINANCE_CAT_SET.has(t.category)))
      .reduce((s, t) => s + Math.abs(t.amount), 0)
    const expenses = txs
      .filter(t => t.category === 'Expense' || (t.type === 'expense' && !FINANCE_CAT_SET.has(t.category)))
      .reduce((s, t) => s + Math.abs(t.amount), 0)
    const net = Math.round((income - expenses) * 100) / 100
    return { month: dayjs(month + '-01').format('MMM YY'), net }
  })
}

function fmt(n) {
  return Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtK(v) {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  return abs >= 1000 ? `${sign}$${(abs / 1000).toFixed(0)}K` : `${sign}$${abs}`
}

const PERIODS = [
  { key: '7D',  label: '7D',  days: 7 },
  { key: '1M',  label: '1M',  days: 30 },
  { key: '3M',  label: '3M',  days: 90 },
  { key: '6M',  label: '6M',  days: 180 },
  { key: '1Y',  label: '1Y',  days: 365 },
  { key: 'YTD', label: 'YTD', days: null },
  { key: 'All', label: 'All', days: null },
]

const CASH_FLOW_PERIODS = ['3M', '6M', '1Y', 'YTD', 'All']

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, valueClass = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-semibold tracking-tight ${valueClass}`}>{value}</p>
    </div>
  )
}

function GoalProgressBar({ goal }) {
  const pct = goal.targetAmount > 0
    ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100))
    : 0
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount)

  return (
    <div className="py-4 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-gray-800">{goal.name}</span>
        <span className="text-xs text-gray-400">
          ${fmt(goal.currentAmount)} / ${fmt(goal.targetAmount)}
        </span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-gray-400">{pct}% complete</span>
        <span className="text-xs text-gray-400">
          {remaining > 0
            ? `$${fmt(remaining)} to go · target ${dayjs(goal.targetDate).format('MMM YYYY')}`
            : `Reached! · target ${dayjs(goal.targetDate).format('MMM YYYY')}`}
        </span>
      </div>
    </div>
  )
}

function InsightCard({ index, text }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-start gap-3">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${text ? 'bg-blue-100' : 'bg-gray-200'}`}>
        <span className={`text-xs font-semibold ${text ? 'text-blue-600' : 'text-gray-400'}`}>{index}</span>
      </div>
      <p className={`text-sm ${text ? 'text-gray-700' : 'text-gray-400 italic'}`}>
        {text ?? 'Connect your Claude API key in Settings to enable insights.'}
      </p>
    </div>
  )
}

function NetWorthTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { netWorth, breakdown, label } = payload[0].payload
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ fontWeight: 600, marginBottom: 6, color: '#111827' }}>{label}</p>
      <p style={{ color: '#111827', marginBottom: 4 }}>Net Worth: <strong>${fmt(netWorth)}</strong></p>
      <p style={{ color: '#22c55e' }}>Cash: ${fmt(breakdown?.cash ?? 0)}</p>
      <p style={{ color: '#f59e0b' }}>Savings: ${fmt(breakdown?.savings ?? 0)}</p>
      <p style={{ color: '#3b82f6' }}>Portfolio: ${fmt(breakdown?.portfolio ?? 0)}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const queryClient = useQueryClient()
  const [netWorthPeriod, setNetWorthPeriod] = useState('6M')
  const [cashFlowPeriod, setCashFlowPeriod] = useState('6M')
  const [editingCash, setEditingCash] = useState(false)
  const [cashInput, setCashInput] = useState('')
  const [insights, setInsights] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: api.transactions.list,
  })

  const { data: goals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: api.goals.list,
  })

  const { data: holdings = [], isLoading: holdingsLoading } = useQuery({
    queryKey: ['holdings'],
    queryFn: api.holdings.list,
  })

  const tickerList = [...new Set(holdings.filter(h => h.ticker).map(h => h.ticker.toUpperCase()))]

  const { data: prices = {}, isFetching: pricesFetching } = useQuery({
    queryKey: ['prices', tickerList],
    queryFn: () => api.prices.get(tickerList),
    enabled: tickerList.length > 0,
    staleTime: 60_000,
  })

  const { data: savingsAccounts = [] } = useQuery({
    queryKey: ['savings-accounts'],
    queryFn: api.savingsAccounts.list,
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })

  const { data: netWorthHistory = [] } = useQuery({
    queryKey: ['net-worth-history'],
    queryFn: api.netWorth.history,
  })

  const cashMutation = useMutation({
    mutationFn: (value) => api.settings.update({ cashBalance: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const insightsMutation = useMutation({
    mutationFn: () => api.llm.insights({}),
    onSuccess: (data) => {
      setInsights(data.insights ?? [])
      setChatMessages([])
    },
  })

  const snapshotMutation = useMutation({ mutationFn: () => api.netWorth.snapshot() })
  const backfillMutation = useMutation({
    mutationFn: () => api.netWorth.backfill(),
    onSuccess: (data) => {
      if (data.added > 0) queryClient.invalidateQueries({ queryKey: ['net-worth-history'] })
    },
  })
  useEffect(() => {
    snapshotMutation.mutate()
    backfillMutation.mutate()
  }, [])

  async function handleDashboardChat(e) {
    e.preventDefault()
    const message = chatInput.trim()
    if (!message || chatLoading) return
    const newMessages = [...chatMessages, { role: 'user', content: message }]
    setChatMessages(newMessages)
    setChatInput('')
    setChatLoading(true)
    try {
      const result = await api.llm.dashboardChat(newMessages)
      setChatMessages(prev => [...prev, { role: 'assistant', content: result.reply }])
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }])
    } finally {
      setChatLoading(false)
    }
  }

  const historyChartData = netWorthHistory.map(e => ({
    date: e.date,
    netWorth: e.netWorth,
    cash: e.breakdown?.cash ?? 0,
    savings: e.breakdown?.savings ?? 0,
    portfolio: e.breakdown?.portfolio ?? 0,
    breakdown: e.breakdown,
  }))

  const filteredHistoryData = (() => {
    const p = PERIODS.find(p => p.key === netWorthPeriod)
    if (!p) return historyChartData
    if (p.key === 'YTD') {
      const startOfYear = dayjs().startOf('year')
      return historyChartData.filter(d => !dayjs(d.date).isBefore(startOfYear))
    }
    if (p.days === null) return historyChartData
    const cutoff = dayjs().subtract(p.days, 'day')
    return historyChartData.filter(d => dayjs(d.date).isAfter(cutoff))
  })()

  const useLongLabel = netWorthPeriod === 'All' || netWorthPeriod === '1Y' || netWorthPeriod === 'YTD'
  const netWorthChartData = filteredHistoryData.map(d => ({
    ...d,
    label: useLongLabel ? dayjs(d.date).format("MMM 'YY") : dayjs(d.date).format('MMM D'),
  }))

  const isLoading = txLoading || goalsLoading || holdingsLoading

  const cashBalance = Math.round((settings?.cashBalance ?? 0) * 100) / 100

  // Portfolio value: live price × shares, falling back to cost basis while prices load
  const portfolioValue = Math.round(
    holdings.reduce((s, h) => {
      const price = h.ticker ? (prices[h.ticker.toUpperCase()] ?? null) : null
      return s + (price !== null ? price * h.shares : h.purchasePrice * h.shares)
    }, 0) * 100
  ) / 100

  const savingsTotal = Math.round(savingsAccounts.reduce((s, a) => s + a.balance, 0) * 100) / 100

  const netWorth = Math.round((cashBalance + savingsTotal + portfolioValue) * 100) / 100

  // Current month net cash flow
  const thisMonth = dayjs().format('YYYY-MM')
  const thisMonthTxs = transactions.filter(t => t.date?.startsWith(thisMonth))
  const monthIncome = thisMonthTxs
    .filter(t => t.category === 'Income' || (t.type === 'income' && !FINANCE_CAT_SET.has(t.category)))
    .reduce((s, t) => s + Math.abs(t.amount), 0)
  const monthExpenses = thisMonthTxs
    .filter(t => t.category === 'Expense' || (t.type === 'expense' && !FINANCE_CAT_SET.has(t.category)))
    .reduce((s, t) => s + Math.abs(t.amount), 0)
  const monthNet = Math.round((monthIncome - monthExpenses) * 100) / 100

  const cashFlowData = buildNetCashFlowData(transactions, cashFlowPeriod)
  const hasTransactions = transactions.length > 0

  // Donut chart — Cash + Savings + one slice per investment account type
  const ACCOUNT_TYPE_COLORS = {
    'TFSA':            '#3b82f6',
    'RRSP':            '#8b5cf6',
    'FHSA':            '#ec4899',
    'Non-Registered':  '#06b6d4',
    'Roth IRA':        '#f97316',
    'Traditional IRA': '#84cc16',
    '401(k)':          '#14b8a6',
    'Other':           '#6b7280',
  }

  const holdingsByType = holdings.reduce((acc, h) => {
    const type = h.accountType ?? 'Non-Registered'
    const price = h.ticker ? (prices[h.ticker.toUpperCase()] ?? null) : null
    acc[type] = (acc[type] ?? 0) + (price !== null ? price * h.shares : h.purchasePrice * h.shares)
    return acc
  }, {})

  const pieData = [
    { name: 'Cash',    value: Math.max(0, cashBalance), color: '#22c55e' },
    { name: 'Savings', value: savingsTotal,             color: '#f59e0b' },
    ...Object.entries(holdingsByType).map(([type, value]) => ({
      name: type,
      value: Math.round(value * 100) / 100,
      color: ACCOUNT_TYPE_COLORS[type] ?? '#6b7280',
    })),
  ].filter(d => d.value > 0)

  if (isLoading) {
    return (
      <div className="p-6 text-center text-sm text-gray-400 pt-20">Loading…</div>
    )
  }

  return (
    <div className="p-3 sm:p-6 space-y-6">
      {/* Header */}
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Net Worth"
          value={`${netWorth >= 0 ? '+' : '−'}$${fmt(netWorth)}`}
          valueClass={netWorth >= 0 ? 'text-green-600' : 'text-red-500'}
        />
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-sm font-medium text-gray-500 mb-1">Cash Balance</p>
          {editingCash ? (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xl font-semibold text-gray-400">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={cashInput}
                onChange={e => setCashInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { cashMutation.mutate(parseFloat(cashInput) || 0); setEditingCash(false) }
                  if (e.key === 'Escape') setEditingCash(false)
                }}
                className="w-36 text-2xl font-semibold border-b border-gray-300 focus:outline-none focus:border-blue-500 bg-transparent"
                autoFocus
              />
              <button
                onClick={() => { cashMutation.mutate(parseFloat(cashInput) || 0); setEditingCash(false) }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >Save</button>
              <button
                onClick={() => setEditingCash(false)}
                className="text-sm text-gray-400 hover:text-gray-600"
              >Cancel</button>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-semibold tracking-tight text-green-600">
                ${fmt(cashBalance)}
              </p>
              <button
                onClick={() => { setCashInput(cashBalance.toString()); setEditingCash(true) }}
                className="text-gray-300 hover:text-gray-500 transition-colors text-base leading-none"
                title="Edit cash balance"
              >✎</button>
            </div>
          )}
        </div>
        <StatCard
          label="Portfolio Value"
          value={pricesFetching ? 'Fetching…' : `$${fmt(portfolioValue)}`}
          valueClass="text-blue-600"
        />
      </div>

      {/* Net Worth Over Time */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-500">Net Worth Over Time</h2>
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setNetWorthPeriod(p.key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  netWorthPeriod === p.key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {netWorthChartData.length < 2 ? (
          <div className="flex items-center justify-center h-[200px] text-sm text-gray-400 text-center px-6">
            Your net worth history will appear here as you use the app. Come back tomorrow to see your first data point.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={netWorthChartData}>
              <defs>
                <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickFormatter={fmtK}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip content={<NetWorthTooltip />} />
              <Legend
                iconType="plainline"
                iconSize={16}
                wrapperStyle={{ fontSize: 12, paddingTop: 14, color: '#6b7280' }}
                formatter={name => ({
                  netWorth: 'Net Worth',
                  cash: 'Cash',
                  savings: 'Savings',
                  portfolio: 'Portfolio',
                }[name] ?? name)}
              />
              <Area
                type="monotone"
                dataKey="netWorth"
                name="netWorth"
                stroke="#3b82f6"
                strokeWidth={2.5}
                fill="url(#netWorthGradient)"
                dot={false}
                activeDot={{ r: 4, fill: '#3b82f6' }}
              />
              <Line
                type="monotone"
                dataKey="cash"
                name="cash"
                stroke="#22c55e"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: '#22c55e' }}
              />
              <Line
                type="monotone"
                dataKey="savings"
                name="savings"
                stroke="#f59e0b"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: '#f59e0b' }}
              />
              <Line
                type="monotone"
                dataKey="portfolio"
                name="portfolio"
                stroke="#8b5cf6"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: '#8b5cf6' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Net worth breakdown donut */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-medium text-gray-500 mb-4">Net Worth Breakdown</h2>
        {pieData.length === 0 ? (
          <div className="flex items-center justify-center h-[240px] text-sm text-gray-400">
            No data yet
          </div>
        ) : (
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Donut with center label */}
            <div className="relative w-full sm:w-[220px] shrink-0" style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={68}
                    outerRadius={95}
                    dataKey="value"
                    strokeWidth={0}
                    paddingAngle={2}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={v => [`$${fmt(v)}`]}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-xl font-semibold text-gray-900">${fmt(netWorth)}</p>
                <p className="text-xs text-gray-400">Net Worth</p>
              </div>
            </div>

            {/* Legend with $ and % */}
            <div className="flex flex-col gap-4 w-full max-w-xs">
              {pieData.map(d => {
                const pct = netWorth > 0 ? Math.round((d.value / netWorth) * 100) : 0
                return (
                  <div key={d.name}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: d.color }} />
                        <span className="font-medium text-gray-700">{d.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-gray-900 font-medium">${fmt(d.value)}</span>
                        <span className="text-gray-400 text-xs ml-2">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: d.color }}
                      />
                    </div>
                  </div>
                )
              })}
              {pricesFetching && (
                <p className="text-xs text-gray-400">Fetching live prices…</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Cash flow chart */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-500">Monthly Net Cash Flow</h2>
          <div className="flex gap-1">
            {CASH_FLOW_PERIODS.map(p => (
              <button
                key={p}
                onClick={() => setCashFlowPeriod(p)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  cashFlowPeriod === p
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {!hasTransactions ? (
          <div className="flex items-center justify-center h-[200px] text-sm text-gray-400">
            No transaction data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cashFlowData} barCategoryGap="40%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: '#6b7280' }}
                tickFormatter={v => `$${v}`}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={v => [
                  `${v >= 0 ? '+' : '−'}$${fmt(v)}`,
                  'Net cash flow',
                ]}
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
              />
              <Bar dataKey="net" radius={[4, 4, 0, 0]} maxBarSize={36}>
                {cashFlowData.map(entry => (
                  <Cell key={entry.month} fill={entry.net >= 0 ? '#22c55e' : '#f87171'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {hasTransactions && (
          <p className={`text-xs mt-2 ${monthNet >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            This month: {monthNet >= 0 ? '+' : '−'}${fmt(monthNet)} net
          </p>
        )}
      </div>

      {/* Goals + Insights side by side on larger screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Goal progress */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-sm font-medium text-gray-500 mb-2">Goal Progress</h2>
          {goals.length === 0 ? (
            <div className="flex items-center justify-center h-28 text-sm text-gray-400">
              No goals yet — add one in the Goals tab
            </div>
          ) : (
            <div>
              {goals.map(goal => (
                <GoalProgressBar key={goal.id} goal={goal} />
              ))}
            </div>
          )}
        </div>

        {/* LLM insights */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-500">AI Insights</h2>
            {settings?.hasClaudeApiKey && insights && (
              <button
                onClick={() => insightsMutation.mutate()}
                disabled={insightsMutation.isPending}
                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                Refresh
              </button>
            )}
          </div>
          {!settings?.hasClaudeApiKey ? (
            <div className="space-y-3">
              <InsightCard index={1} />
              <InsightCard index={2} />
              <InsightCard index={3} />
            </div>
          ) : insightsMutation.isPending ? (
            <p className="text-sm text-gray-400 text-center py-6">Generating insights…</p>
          ) : insightsMutation.isError ? (
            <p className="text-sm text-red-400 text-center py-4">Failed to generate insights. Check your API key in Settings.</p>
          ) : insights ? (
            <>
              <div className="space-y-3">
                {insights.map((text, i) => (
                  <InsightCard key={i} index={i + 1} text={text} />
                ))}
              </div>
              {/* Chat follow-up */}
              <div className="border-t border-gray-100 mt-4 pt-4">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Ask a follow-up</p>
                {chatMessages.length > 0 && (
                  <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white rounded-br-sm'
                            : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                        }`}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-gray-100 text-gray-400 px-3 py-2 rounded-xl rounded-bl-sm text-sm italic">Thinking…</div>
                      </div>
                    )}
                  </div>
                )}
                <form onSubmit={handleDashboardChat} className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    placeholder="E.g. Where am I overspending?"
                    disabled={chatLoading}
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatInput.trim()}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
                  >
                    Send
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 gap-3">
              <p className="text-sm text-gray-400">Claude API key is configured.</p>
              <button
                onClick={() => insightsMutation.mutate()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Generate Insights
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
