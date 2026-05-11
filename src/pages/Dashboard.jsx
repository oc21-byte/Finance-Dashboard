import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts'
import { api } from '../api/client.js'
import { FINANCE_CATEGORIES } from '../constants/categories.js'

// ── Utilities ────────────────────────────────────────────────────────────────

const FINANCE_CAT_SET = new Set(FINANCE_CATEGORIES)

function buildNetCashFlowData(transactions) {
  const months = Array.from({ length: 6 }, (_, i) =>
    dayjs().subtract(5 - i, 'month').format('YYYY-MM')
  )
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

// ── Main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const queryClient = useQueryClient()
  const [editingCash, setEditingCash] = useState(false)
  const [cashInput, setCashInput] = useState('')
  const [insights, setInsights] = useState(null)

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

  const cashMutation = useMutation({
    mutationFn: (value) => api.settings.update({ cashBalance: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const insightsMutation = useMutation({
    mutationFn: () => api.llm.insights({}),
    onSuccess: (data) => setInsights(data.insights ?? []),
  })

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

  const cashFlowData = buildNetCashFlowData(transactions)
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
    <div className="p-6 space-y-6">
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
            <div className="relative shrink-0" style={{ width: 220, height: 220 }}>
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
        <h2 className="text-sm font-medium text-gray-500 mb-4">Monthly Net Cash Flow (last 6 months)</h2>
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
            <div className="space-y-3">
              {insights.map((text, i) => (
                <InsightCard key={i} index={i + 1} text={text} />
              ))}
            </div>
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
