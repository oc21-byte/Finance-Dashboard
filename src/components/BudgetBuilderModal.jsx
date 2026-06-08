import { useState, useEffect } from 'react'
import dayjs from 'dayjs'
import { api } from '../api/client.js'

const TIMELINE_OPTIONS = [
  { value: 'aggressive', label: 'Aggressive 🔥' },
  { value: 'balanced', label: 'Balanced ⚖️' },
  { value: 'comfortable', label: 'Comfortable 😌' },
]

function fmt(n) {
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function calcAvgMonthlyIncome(transactions) {
  const cutoff = dayjs().subtract(3, 'month').startOf('month')
  const byMonth = {}
  for (const tx of transactions) {
    if (!tx.date || Number(tx.amount) <= 0) continue
    const m = tx.date.slice(0, 7)
    if (dayjs(m + '-01').isBefore(cutoff)) continue
    byMonth[m] = (byMonth[m] || 0) + Number(tx.amount)
  }
  const months = Object.values(byMonth)
  if (months.length === 0) return ''
  return String(Math.round(months.reduce((s, v) => s + v, 0) / months.length))
}

export default function BudgetBuilderModal({ goals, settings, transactions, onTabChange, onClose, onBudgetSaved }) {
  const [view, setView] = useState('form')
  const [income, setIncome] = useState('')
  const [timeline, setTimeline] = useState('balanced')
  const [excludeNote, setExcludeNote] = useState('')
  const [result, setResult] = useState(null)
  const [editedBudgets, setEditedBudgets] = useState({})
  const [isGenerating, setIsGenerating] = useState(false)
  const [genError, setGenError] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  useEffect(() => {
    if (settings?.confirmedMonthlyIncome != null && settings.confirmedMonthlyIncome !== '') {
      setIncome(String(settings.confirmedMonthlyIncome))
    } else {
      const avg = calcAvgMonthlyIncome(transactions)
      setIncome(avg)
    }
  }, [settings, transactions])

  const fundedGoals = goals.filter(g => Number(g.currentAmount) >= Number(g.targetAmount))
  const activeGoals = goals.filter(g => Number(g.currentAmount) < Number(g.targetAmount))
  const missingMonthlySavings = activeGoals.some(g => !g.monthlySavings)
  const allFunded = activeGoals.length === 0

  const incomeNum = parseFloat(income)
  const generateDisabled = !income || isNaN(incomeNum) || incomeNum === 0

  async function handleGenerate() {
    setIsGenerating(true)
    setGenError(null)
    try {
      const data = await api.llm.budgetBuilder({
        income: parseFloat(income),
        timelinePreference: timeline,
        excludeNote,
      })
      if (data.allGoalsComplete) {
        onBudgetSaved('All your goals are already funded. Add a new goal to use Budget Builder.')
        onClose()
        return
      }
      setResult(data)
      setEditedBudgets({ ...data.budgets })
      setView('results')
    } catch (err) {
      setGenError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleSave() {
    setIsSaving(true)
    setSaveError(null)
    try {
      await api.settings.update({ categoryBudgets: editedBudgets })
      onBudgetSaved('Budget saved. Tracking active in Spend Analyzer.')
      onClose()
    } catch (err) {
      setSaveError('Failed to save budget. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  function handleStartOver() {
    setView('form')
    setResult(null)
    setEditedBudgets({})
    setSaveError(null)
  }

  const fastestGoalEntry = result
    ? Object.entries(result.monthsToGoal).sort((a, b) => a[1] - b[1])[0]
    : null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Budget Builder</h2>
            <p className="text-sm text-gray-500 mt-0.5">Optimize your monthly budget toward your goals</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Section 1 — Goals Summary */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Your Goals</h3>
            <ul className="space-y-2">
              {goals.map(g => {
                const funded = Number(g.currentAmount) >= Number(g.targetAmount)
                const pct = g.targetAmount > 0
                  ? Math.min(100, Math.round(Number(g.currentAmount) / Number(g.targetAmount) * 100))
                  : 0
                return (
                  <li
                    key={g.id}
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm gap-3 ${funded ? 'border-gray-100 bg-gray-50 opacity-50' : 'border-gray-200 bg-white'}`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{g.name}</div>
                      <div className="text-gray-500 text-xs mt-0.5">
                        {fmt(g.targetAmount)} · due {dayjs(g.targetDate).format('MMM D, YYYY')} · {pct}% funded
                      </div>
                    </div>
                    {funded && (
                      <span className="shrink-0 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">✓ Funded</span>
                    )}
                  </li>
                )
              })}
            </ul>

            {allFunded && (
              <div className="mt-4 text-sm text-gray-600 bg-gray-50 rounded-lg p-4">
                All your goals are already funded. Add a new goal to use Budget Builder.{' '}
                <button onClick={() => { onClose(); onTabChange?.('goals') }} className="underline font-medium text-gray-800 hover:text-gray-900">
                  Go to Goals →
                </button>
              </div>
            )}
          </section>

          {/* Section 2 — Income & Timeline (hidden if all funded) */}
          {!allFunded && view === 'form' && (
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Income &amp; Timeline</h3>

              {/* Monthly income */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Monthly Take-Home Income
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    value={income}
                    onChange={e => setIncome(e.target.value)}
                    placeholder="0"
                    className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Timeline preference */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Timeline Preference</label>
                <div className="flex gap-2 flex-wrap">
                  {TIMELINE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setTimeline(opt.value)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                        timeline === opt.value
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Soft tip */}
              {missingMonthlySavings && (
                <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
                  Adding a monthly savings rate to your goals helps Claude calculate timelines more accurately.
                </div>
              )}

              {/* One-time expenses */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  One-time expenses to exclude <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={excludeNote}
                  onChange={e => setExcludeNote(e.target.value)}
                  placeholder="e.g. car repair $1,400 in March"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </section>
          )}

          {/* Loading state */}
          {isGenerating && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-500">
              <svg className="animate-spin h-7 w-7 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              <p className="text-sm">Claude is analyzing your finances…</p>
            </div>
          )}

          {/* Generation error */}
          {genError && !isGenerating && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-center justify-between gap-3 text-sm text-red-700">
              <span>{genError}</span>
              <button
                onClick={handleGenerate}
                className="shrink-0 font-medium underline hover:text-red-900"
              >
                Retry
              </button>
            </div>
          )}

          {/* Results panel */}
          {view === 'results' && result && (
            <section className="space-y-4">
              {/* Summary bar */}
              <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-4 py-3 flex flex-wrap gap-4 text-sm">
                <span className="font-medium text-indigo-900">
                  Projected monthly surplus: <strong>{fmt(result.projectedMonthlySurplus)}</strong>
                </span>
                {fastestGoalEntry && (
                  <span className="text-indigo-700">
                    Fastest goal: <strong>{fastestGoalEntry[0]}</strong> in ~{fastestGoalEntry[1]} months
                  </span>
                )}
              </div>

              {/* Budget table */}
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Your Avg Spend</th>
                      <th className="px-4 py-3">Suggested Cap</th>
                      <th className="px-4 py-3">Difference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(result.budgets).map(([cat, suggested]) => {
                      const cap = editedBudgets[cat] ?? suggested
                      return (
                        <tr key={cat} className="bg-white">
                          <td className="px-4 py-3 font-medium text-gray-800">{cat}</td>
                          <td className="px-4 py-3 text-gray-500">—</td>
                          <td className="px-4 py-3">
                            <div className="relative w-28">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                              <input
                                type="number"
                                min="0"
                                value={cap}
                                onChange={e => setEditedBudgets(prev => ({ ...prev, [cat]: Number(e.target.value) }))}
                                className="w-full border border-gray-200 rounded-md pl-5 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-400">—</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Rationale */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Rationale</h4>
                <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-4 leading-relaxed">{result.rationale}</p>
              </div>

              {saveError && (
                <p className="text-sm text-red-600">{saveError}</p>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100">
          {view === 'form' && !allFunded && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex gap-3 items-center">
                <button
                  onClick={onClose}
                  disabled={isGenerating}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={generateDisabled || isGenerating}
                  className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isGenerating ? 'Generating…' : 'Generate My Budget'}
                </button>
              </div>
              {generateDisabled && !isGenerating && (
                <p className="text-xs text-gray-400">Set your income above to continue.</p>
              )}
              <p className="text-xs text-gray-400">Powered by Claude · Takes 5–10 seconds</p>
            </div>
          )}

          {view === 'results' && (
            <div className="flex justify-between items-center gap-3">
              <button
                onClick={handleStartOver}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50"
              >
                Start Over
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? 'Saving…' : 'Accept & Save Budget'}
              </button>
            </div>
          )}

          {allFunded && (
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
