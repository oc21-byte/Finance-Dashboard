import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'

const EXCLUDE_CATS = new Set(['Income', 'Transfer'])
const SAVINGS_CATS = new Set(['Savings', 'Investments', 'Retirement', 'Emergency Fund'])

function SummaryCard({ label, value, color = 'text-gray-900', description, subtext, subtextColor }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {description && <p className="text-xs text-gray-400 mt-1 leading-snug">{description}</p>}
      {subtext && <p className={`text-xs mt-0.5 font-medium ${subtextColor || 'text-gray-400'}`}>{subtext}</p>}
    </div>
  )
}

export default function Budget({ onTabChange }) {
  const queryClient = useQueryClient()

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })
  const { data: goals = [] } = useQuery({ queryKey: ['goals'], queryFn: api.goals.list })
  const { data: fin } = useQuery({ queryKey: ['monthly_financials'], queryFn: api.monthlyFinancials.get })

  const [editingIncome, setEditingIncome] = useState(false)
  const [incomeValue, setIncomeValue] = useState('')
  const [editingSavingsTarget, setEditingSavingsTarget] = useState(false)
  const [savingsTargetValue, setSavingsTargetValue] = useState('')
  const [editingBudget, setEditingBudget] = useState(null)
  const [editingGoal, setEditingGoal] = useState(null)
  const [pendingBudgets, setPendingBudgets] = useState(null)
  const [pendingSavingsTarget, setPendingSavingsTarget] = useState(null)
  const [timeline, setTimeline] = useState('balanced')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(null)
  const [toast, setToast] = useState('')

  const confirmedIncome = settings?.confirmedMonthlyIncome
  const hasConfirmedIncome = confirmedIncome != null && confirmedIncome !== ''
  const displayIncome = hasConfirmedIncome ? Number(confirmedIncome) : (fin?.income ?? 0)

  const categoryBudgets = settings?.categoryBudgets || {}
  const budgetSavingsTarget = Number(settings?.budgetSavingsTarget) || 0

  const activeGoals = goals.filter(g => Number(g.currentAmount) < Number(g.targetAmount))
  const goalNames = new Set(activeGoals.map(g => g.name))
  const totalGoalSavings = activeGoals.reduce((s, g) => s + (Number(g.monthlySavings) || 0), 0)
  const effectiveBudgets = pendingBudgets ?? categoryBudgets
  const totalSpendingCaps = Object.entries(effectiveBudgets)
    .filter(([cat]) => !SAVINGS_CATS.has(cat) && !goalNames.has(cat))
    .reduce((s, [, v]) => s + v, 0)
  const totalSavingsCaps = Object.entries(effectiveBudgets)
    .filter(([cat]) => SAVINGS_CATS.has(cat))
    .reduce((s, [, v]) => s + v, 0)
  const effectiveSavingsTarget = pendingSavingsTarget ?? budgetSavingsTarget
  const totalSavingsPlanned = totalGoalSavings + effectiveSavingsTarget + totalSavingsCaps
  const unallocated = displayIncome - totalSpendingCaps - totalSavingsPlanned

  const cardBreakdownMap = {}
  for (const c of (fin?.cardBreakdown || [])) {
    if (!EXCLUDE_CATS.has(c.category)) cardBreakdownMap[c.category] = c.monthly
  }

  const totalAvgSpend = Object.entries(cardBreakdownMap)
    .filter(([cat]) => !SAVINGS_CATS.has(cat))
    .reduce((s, [, v]) => s + v, 0)
  const budgetedLeft = displayIncome - totalSpendingCaps - totalSavingsPlanned
  const avgLeft = displayIncome - totalAvgSpend - totalSavingsPlanned
  const spread = avgLeft - budgetedLeft
  const allCategories = [...new Set([
    ...Object.keys(cardBreakdownMap),
    ...Object.keys(categoryBudgets).filter(k => !EXCLUDE_CATS.has(k)),
  ])].sort((a, b) => (cardBreakdownMap[b] || 0) - (cardBreakdownMap[a] || 0))

  const settingsMutation = useMutation({
    mutationFn: (data) => api.settings.update(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const goalsMutation = useMutation({
    mutationFn: ({ id, data }) => api.goals.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goals'] }),
  })

  function saveGoalSavings(goalId, val) {
    const num = Number(val)
    if (!isNaN(num) && num >= 0 && val !== '') {
      goalsMutation.mutate({ id: goalId, data: { monthlySavings: num } })
    }
    setEditingGoal(null)
  }

  function saveIncome() {
    const val = Number(incomeValue)
    if (!isNaN(val)) settingsMutation.mutate({ confirmedMonthlyIncome: val })
    setEditingIncome(false)
  }

  function saveBudgetCap(cat, val) {
    const num = Number(val)
    if (!isNaN(num) && num >= 0 && val !== '') {
      const updated = { ...effectiveBudgets, [cat]: num }
      if (pendingBudgets) {
        setPendingBudgets(updated)
      } else {
        settingsMutation.mutate({ categoryBudgets: updated })
      }
    }
    setEditingBudget(null)
  }

  function saveSavingsTarget() {
    const val = Number(savingsTargetValue)
    if (!isNaN(val) && val >= 0) {
      if (pendingSavingsTarget !== null) {
        setPendingSavingsTarget(val)
      } else {
        settingsMutation.mutate({ budgetSavingsTarget: val })
      }
    }
    setEditingSavingsTarget(false)
  }

  async function generateAIBudget() {
    setAiLoading(true)
    setAiError(null)
    try {
      const result = await api.llm.budgetBuilder({ income: displayIncome, timelinePreference: timeline })
      if (result.budgets) setPendingBudgets(result.budgets)
      if (result.suggestedSavingsTarget != null) setPendingSavingsTarget(result.suggestedSavingsTarget)
    } catch (err) {
      setAiError(err.message)
    } finally {
      setAiLoading(false)
    }
  }

  function saveAIBudget() {
    const toSave = {}
    if (pendingBudgets) toSave.categoryBudgets = pendingBudgets
    if (pendingSavingsTarget != null) toSave.budgetSavingsTarget = pendingSavingsTarget
    settingsMutation.mutate(toSave, {
      onSuccess: () => {
        setPendingBudgets(null)
        setPendingSavingsTarget(null)
        setToast('Budget saved.')
        setTimeout(() => setToast(''), 3000)
      },
    })
  }

  function discardAI() {
    setPendingBudgets(null)
    setPendingSavingsTarget(null)
    setAiError(null)
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Budget</h1>
        <p className="text-sm text-gray-500 mt-1">Monthly cash flow — income, spending caps, and savings targets.</p>
      </div>

      {toast && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800 flex items-center justify-between gap-3">
          <span>{toast}</span>
          <button onClick={() => setToast('')} className="text-green-400 hover:text-green-600 text-lg leading-none">✕</button>
        </div>
      )}

      {/* Summary bar */}
      <div className="mb-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          label="Monthly Income"
          value={`$${Math.round(displayIncome).toLocaleString()}`}
          description={hasConfirmedIncome ? 'Your confirmed take-home pay.' : `6-month bank average. Edit to set manually.`}
        />
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Spending Caps</p>
          <div className="flex items-end gap-3">
            <div>
              <p className="text-[10px] text-gray-400 mb-0.5">Budgeted</p>
              <p className="text-xl font-bold text-gray-900">${Math.round(totalSpendingCaps).toLocaleString()}</p>
            </div>
            <span className="text-gray-300 pb-0.5">vs</span>
            <div>
              <p className="text-[10px] text-gray-400 mb-0.5">Avg actual</p>
              <p className="text-xl font-bold text-gray-700">${Math.round(totalAvgSpend).toLocaleString()}</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1.5 leading-snug">
            {totalSpendingCaps === 0 ? 'No caps set yet — add them in the table below.' : 'Caps set vs avg monthly card spend.'}
          </p>
        </div>
        <SummaryCard
          label="Savings Planned"
          value={`$${Math.round(totalSavingsPlanned).toLocaleString()}`}
          color="text-teal-600"
          description={[
            `Goal payments: $${Math.round(totalGoalSavings).toLocaleString()}`,
            `General target: $${Math.round(effectiveSavingsTarget).toLocaleString()}`,
            ...(totalSavingsCaps > 0 ? [`Savings caps: $${Math.round(totalSavingsCaps).toLocaleString()}`] : []),
          ].join(' · ')}
        />
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Left to Allocate</p>
          <div className="flex items-end gap-3">
            <div>
              <p className="text-[10px] text-gray-400 mb-0.5">Budgeted</p>
              <p className={`text-xl font-bold ${budgetedLeft >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {budgetedLeft >= 0 ? '+' : '−'}${Math.abs(Math.round(budgetedLeft)).toLocaleString()}
              </p>
            </div>
            <span className="text-gray-300 pb-0.5">vs</span>
            <div>
              <p className="text-[10px] text-gray-400 mb-0.5">Avg actual</p>
              <p className={`text-xl font-bold ${avgLeft >= 0 ? 'text-gray-700' : 'text-red-600'}`}>
                {avgLeft >= 0 ? '+' : '−'}${Math.abs(Math.round(avgLeft)).toLocaleString()}
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1.5 leading-snug">Income − spending caps − savings planned.</p>
          {totalSpendingCaps > 0 && totalAvgSpend > 0 && (
            <p className={`text-xs mt-0.5 font-medium ${spread >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              You are spending ${Math.abs(Math.round(spread)).toLocaleString()} {spread >= 0 ? 'under' : 'over'} budget on average
            </p>
          )}
        </div>
      </div>

      {/* Flow bar */}
      {displayIncome > 0 && (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 px-4 py-3">
          <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
            {(() => {
              const spendPct = Math.min(100, Math.max(0, totalSpendingCaps / displayIncome * 100))
              const savePct = Math.min(100 - spendPct, Math.max(0, totalSavingsPlanned / displayIncome * 100))
              const freePct = Math.max(0, 100 - spendPct - savePct)
              const overBudget = unallocated < 0
              return (
                <>
                  {spendPct > 0 && <div className="h-full bg-blue-300 transition-all" style={{ width: `${spendPct}%` }} />}
                  {savePct > 0 && <div className="h-full bg-teal-400 transition-all" style={{ width: `${savePct}%` }} />}
                  {freePct > 0 && <div className={`h-full transition-all ${overBudget ? 'bg-red-400' : 'bg-green-300'}`} style={{ width: `${freePct}%` }} />}
                  {overBudget && <div className="h-full bg-red-500 w-1 shrink-0" title="Over budget" />}
                </>
              )
            })()}
          </div>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-300" />
              Spending caps ({Math.round(totalSpendingCaps / displayIncome * 100)}%)
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-teal-400" />
              Savings planned ({Math.round(totalSavingsPlanned / displayIncome * 100)}%)
            </span>
            <span className={`flex items-center gap-1.5 text-xs ${unallocated < 0 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${unallocated < 0 ? 'bg-red-400' : 'bg-green-300'}`} />
              {unallocated < 0 ? 'Over budget' : 'Unallocated'} ({Math.round(Math.abs(unallocated) / displayIncome * 100)}%)
            </span>
          </div>
        </div>
      )}

      {/* AI pending banner */}
      {(pendingBudgets || pendingSavingsTarget != null) && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-indigo-50 border border-indigo-200 text-sm text-indigo-800 flex items-center justify-between gap-3 flex-wrap">
          <span className="flex items-center gap-2">
            <Sparkles size={15} />
            AI budget suggestions loaded — review below, then save or discard.
          </span>
          <div className="flex gap-2">
            <button
              onClick={saveAIBudget}
              disabled={settingsMutation.isPending}
              className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-60"
            >
              Save AI Budget
            </button>
            <button
              onClick={discardAI}
              className="px-3 py-1.5 text-xs font-semibold bg-white border border-indigo-300 text-indigo-700 rounded-md hover:bg-indigo-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Income */}
      <div className="mb-4 bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Monthly Take-Home Income</p>
            {editingIncome ? (
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-gray-500">$</span>
                <input
                  type="number"
                  autoFocus
                  value={incomeValue}
                  onChange={e => setIncomeValue(e.target.value)}
                  onBlur={saveIncome}
                  onKeyDown={e => { if (e.key === 'Enter') saveIncome(); if (e.key === 'Escape') setEditingIncome(false) }}
                  className="w-32 border border-indigo-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xl font-bold text-gray-900">${displayIncome.toLocaleString()}</span>
                {!hasConfirmedIncome && fin?.windowLabel && (
                  <span className="text-xs text-gray-400">avg from {fin.windowLabel}</span>
                )}
              </div>
            )}
          </div>
          {!editingIncome && (
            <button
              onClick={() => { setIncomeValue(String(displayIncome)); setEditingIncome(true) }}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium shrink-0"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Spending caps */}
      <div className="mb-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Spending Caps</h2>
            {fin?.windowLabel && (
              <p className="text-xs text-gray-400 mt-0.5">Avg monthly from {fin.windowLabel}</p>
            )}
          </div>
          {settings?.hasClaudeApiKey && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                {['aggressive', 'balanced', 'comfortable'].map(t => (
                  <button
                    key={t}
                    onClick={() => setTimeline(t)}
                    className={`px-3 py-1.5 capitalize transition-colors ${
                      timeline === t ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <button
                onClick={generateAIBudget}
                disabled={aiLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                <Sparkles size={12} />
                {aiLoading ? 'Generating…' : 'Generate with AI'}
              </button>
            </div>
          )}
        </div>

        {aiError && (
          <div className="px-5 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">{aiError}</div>
        )}

        {allCategories.length === 0 ? (
          <div className="px-5 py-8 text-sm text-gray-400 text-center">
            No spending data yet. Import credit card transactions on the Spend Analyzer tab.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-5 py-3">Category</th>
                    <th className="px-5 py-3">Budget Cap</th>
                    <th className="px-5 py-3">Avg Monthly</th>
                    <th className="px-5 py-3 w-36">Cap vs Avg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {/* Spending categories */}
                  {allCategories.filter(cat => !SAVINGS_CATS.has(cat) && !goalNames.has(cat)).map(cat => {
                    const cap = effectiveBudgets[cat]
                    const avgMonthly = Math.round((cardBreakdownMap[cat] || 0) * 100) / 100
                    const pct = cap > 0 ? Math.round(avgMonthly / cap * 100) : 0
                    const over = cap > 0 && avgMonthly > cap
                    const near = cap > 0 && !over && pct >= 80
                    const barColor = over ? 'bg-red-400' : near ? 'bg-yellow-400' : 'bg-green-400'
                    const isEditing = editingBudget?.cat === cat
                    const isPending = pendingBudgets && cat in pendingBudgets
                    return (
                      <tr key={cat} className={over ? 'bg-red-50' : 'bg-white'}>
                        <td className="px-5 py-3 font-medium text-gray-800">{cat}</td>
                        <td className="px-5 py-3 text-gray-700">
                          {isEditing ? (
                            <input type="number" min="0" autoFocus value={editingBudget.value}
                              onChange={e => setEditingBudget(prev => ({ ...prev, value: e.target.value }))}
                              onBlur={() => saveBudgetCap(cat, editingBudget.value)}
                              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingBudget(null) }}
                              className="w-24 border border-indigo-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          ) : cap != null ? (
                            <button onClick={() => setEditingBudget({ cat, value: String(cap) })}
                              className={`font-medium hover:text-indigo-600 hover:underline transition-colors ${isPending ? 'text-indigo-700' : ''}`}
                              title="Click to edit">
                              ${cap.toLocaleString()}
                              {isPending && <span className="ml-1 text-xs text-indigo-400">AI</span>}
                            </button>
                          ) : (
                            <button onClick={() => setEditingBudget({ cat, value: '' })}
                              className="text-gray-400 hover:text-indigo-600 text-xs transition-colors">
                              Set cap
                            </button>
                          )}
                        </td>
                        <td className="px-5 py-3 text-gray-500">{avgMonthly > 0 ? `$${avgMonthly.toLocaleString()}` : '—'}</td>
                        <td className="px-5 py-3">
                          {cap > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                              </div>
                              <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
                            </div>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                      </tr>
                    )
                  })}

                  {/* Savings & Goals section divider */}
                  <tr className="bg-gray-50">
                    <td colSpan={4} className="px-5 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                      Savings &amp; Goals — counted in Savings Planned
                    </td>
                  </tr>

                  {/* Savings categories from card transactions / categoryBudgets */}
                  {allCategories.filter(cat => SAVINGS_CATS.has(cat)).map(cat => {
                    const cap = effectiveBudgets[cat]
                    const avgMonthly = Math.round((cardBreakdownMap[cat] || 0) * 100) / 100
                    const isEditing = editingBudget?.cat === cat
                    const isPending = pendingBudgets && cat in pendingBudgets
                    return (
                      <tr key={cat} className="bg-teal-50">
                        <td className="px-5 py-3 font-medium text-gray-800">
                          <div className="flex items-center gap-2">
                            {cat}
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 uppercase tracking-wide">Savings</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {isEditing ? (
                            <input type="number" min="0" autoFocus value={editingBudget.value}
                              onChange={e => setEditingBudget(prev => ({ ...prev, value: e.target.value }))}
                              onBlur={() => saveBudgetCap(cat, editingBudget.value)}
                              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingBudget(null) }}
                              className="w-24 border border-teal-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          ) : cap != null ? (
                            <button onClick={() => setEditingBudget({ cat, value: String(cap) })}
                              className={`font-medium text-teal-600 hover:text-teal-800 hover:underline transition-colors ${isPending ? 'text-indigo-700' : ''}`}
                              title="Click to edit">
                              ${cap.toLocaleString()}
                              {isPending && <span className="ml-1 text-xs text-indigo-400">AI</span>}
                            </button>
                          ) : (
                            <button onClick={() => setEditingBudget({ cat, value: '' })}
                              className="text-gray-400 hover:text-teal-600 text-xs transition-colors">
                              Set amount
                            </button>
                          )}
                        </td>
                        <td className="px-5 py-3 text-gray-500">{avgMonthly > 0 ? `$${avgMonthly.toLocaleString()}` : '—'}</td>
                        <td className="px-5 py-3"><span className="text-xs text-gray-300">—</span></td>
                      </tr>
                    )
                  })}

                  {/* Active goal rows */}
                  {activeGoals.map(goal => {
                    const monthlySavings = Number(goal.monthlySavings) || 0
                    const isEditing = editingGoal?.goalId === goal.id
                    return (
                      <tr key={goal.id} className="bg-teal-50">
                        <td className="px-5 py-3 font-medium text-gray-800">
                          <div className="flex items-center gap-2">
                            <button onClick={() => onTabChange?.('goals')} className="hover:text-indigo-600 transition-colors">{goal.name}</button>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 uppercase tracking-wide">Goal</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {isEditing ? (
                            <input type="number" min="0" autoFocus value={editingGoal.value}
                              onChange={e => setEditingGoal(prev => ({ ...prev, value: e.target.value }))}
                              onBlur={() => saveGoalSavings(goal.id, editingGoal.value)}
                              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingGoal(null) }}
                              className="w-24 border border-teal-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          ) : (
                            <button onClick={() => setEditingGoal({ goalId: goal.id, value: String(monthlySavings) })}
                              className="font-medium text-teal-600 hover:text-teal-800 hover:underline transition-colors"
                              title="Click to edit">
                              ${monthlySavings.toLocaleString()}
                            </button>
                          )}
                        </td>
                        <td className="px-5 py-3 text-gray-400 text-xs">goal payment</td>
                        <td className="px-5 py-3"><span className="text-xs text-gray-300">—</span></td>
                      </tr>
                    )
                  })}

                  {/* General savings target row */}
                  {(() => {
                    const isEditing = editingSavingsTarget
                    return (
                      <tr className="bg-teal-50">
                        <td className="px-5 py-3 font-medium text-gray-800">
                          <div className="flex items-center gap-2">
                            General Savings Target
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 uppercase tracking-wide">Savings</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {isEditing ? (
                            <input type="number" min="0" autoFocus value={savingsTargetValue}
                              onChange={e => setSavingsTargetValue(e.target.value)}
                              onBlur={saveSavingsTarget}
                              onKeyDown={e => { if (e.key === 'Enter') saveSavingsTarget(); if (e.key === 'Escape') setEditingSavingsTarget(false) }}
                              className="w-24 border border-teal-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          ) : (
                            <button
                              onClick={() => { setSavingsTargetValue(String(effectiveSavingsTarget)); setEditingSavingsTarget(true) }}
                              className={`font-medium hover:underline transition-colors ${pendingSavingsTarget != null ? 'text-indigo-700' : 'text-teal-600 hover:text-teal-800'}`}
                              title="Click to edit">
                              ${effectiveSavingsTarget.toLocaleString()}
                              {pendingSavingsTarget != null && <span className="ml-1 text-xs text-indigo-400">AI</span>}
                            </button>
                          )}
                        </td>
                        <td className="px-5 py-3 text-gray-400 text-xs">general savings</td>
                        <td className="px-5 py-3"><span className="text-xs text-gray-300">—</span></td>
                      </tr>
                    )
                  })()}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                Click any cap to edit. Bar shows avg monthly spend vs your cap — over budget is red.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Savings */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Savings Allocation</h2>
          <p className="text-xs text-gray-400 mt-0.5">Monthly amounts set aside toward goals and savings.</p>
        </div>

        <div className="divide-y divide-gray-100">
          {activeGoals.length === 0 ? (
            <div className="px-5 py-4 flex items-center justify-between">
              <span className="text-sm text-gray-400">No active goals.</span>
              <button
                onClick={() => onTabChange?.('goals')}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Add a goal →
              </button>
            </div>
          ) : (
            activeGoals.map(goal => (
              <div key={goal.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <button
                  onClick={() => onTabChange?.('goals')}
                  className="text-sm font-medium text-gray-800 hover:text-indigo-600 transition-colors text-left"
                >
                  {goal.name}
                </button>
                <span className="text-sm text-teal-600 font-medium shrink-0">
                  ${(Number(goal.monthlySavings) || 0).toLocaleString()}/mo
                </span>
              </div>
            ))
          )}

          {/* General savings target — display only, edited in table above */}
          <div className="px-5 py-3 flex items-center justify-between gap-3">
            <span className="text-sm text-gray-700">General savings target</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-sm font-medium ${pendingSavingsTarget != null ? 'text-indigo-700' : 'text-teal-600'}`}>
                ${effectiveSavingsTarget.toLocaleString()}/mo
                {pendingSavingsTarget != null && <span className="ml-1 text-xs text-indigo-400">AI</span>}
              </span>
            </div>
          </div>

          {/* Detected from bank */}
          {((fin?.savingsContrib ?? 0) > 0 || (fin?.investContrib ?? 0) > 0) && (
            <div className="px-5 py-3 bg-gray-50">
              <p className="text-xs text-gray-400 mb-2 font-semibold uppercase tracking-wide">Detected from bank data</p>
              <div className="space-y-1">
                {(fin?.savingsContrib ?? 0) > 0 && (
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Savings contributions</span>
                    <span>${Math.round(fin.savingsContrib).toLocaleString()}/mo avg</span>
                  </div>
                )}
                {(fin?.investContrib ?? 0) > 0 && (
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Investment contributions</span>
                    <span>${Math.round(fin.investContrib).toLocaleString()}/mo avg</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-gray-400">Edit amounts in the Spending Caps table above.</p>
          <span className="text-xs text-gray-500">
            Total saving:{' '}
            <span className="font-semibold text-teal-600">
              ${Math.round(totalSavingsPlanned).toLocaleString()}/mo
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
