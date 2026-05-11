import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { api } from '../api/client.js'

const DEFAULT_FORM = {
  name: '',
  targetAmount: '',
  targetDate: dayjs().add(1, 'year').format('YYYY-MM-DD'),
  monthlySavings: '',
}

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

function fmt(n) {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function progressColor(pct) {
  if (pct >= 80) return 'bg-green-500'
  if (pct >= 40) return 'bg-yellow-400'
  return 'bg-gray-300'
}

function timelineText(goal) {
  const remaining = goal.targetAmount - goal.currentAmount
  if (remaining <= 0 || !goal.monthlySavings) return null
  const months = Math.ceil(remaining / goal.monthlySavings)
  const reachDate = dayjs().add(months, 'month').format('MMM YYYY')
  return `At $${fmt(goal.monthlySavings)}/mo — ~${months} month${months === 1 ? '' : 's'} to go (est. ${reachDate})`
}

export default function Goals() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [addFunds, setAddFunds] = useState({})
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [goalAnalysis, setGoalAnalysis] = useState({})
  const [goalAnalysisLoading, setGoalAnalysisLoading] = useState({})

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: api.goals.list,
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })

  const createGoal = useMutation({
    mutationFn: (data) => api.goals.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      setForm(DEFAULT_FORM)
      setShowForm(false)
    },
  })

  const updateGoal = useMutation({
    mutationFn: ({ id, data }) => api.goals.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goals'] }),
  })

  const deleteGoal = useMutation({
    mutationFn: (id) => api.goals.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goals'] }),
  })

  function handleCreate(e) {
    e.preventDefault()
    if (!form.name || !form.targetAmount || !form.targetDate) return
    createGoal.mutate({
      name: form.name,
      targetAmount: parseFloat(form.targetAmount),
      targetDate: form.targetDate,
      currentAmount: 0,
      monthlySavings: form.monthlySavings ? parseFloat(form.monthlySavings) : 0,
    })
  }

  function startEditing(goal) {
    setEditingId(goal.id)
    setEditForm({
      name: goal.name,
      targetAmount: goal.targetAmount,
      targetDate: goal.targetDate,
      monthlySavings: goal.monthlySavings || '',
    })
  }

  function handleEdit(e) {
    e.preventDefault()
    if (!editForm.name || !editForm.targetAmount || !editForm.targetDate) return
    updateGoal.mutate(
      {
        id: editingId,
        data: {
          name: editForm.name,
          targetAmount: parseFloat(editForm.targetAmount),
          targetDate: editForm.targetDate,
          monthlySavings: editForm.monthlySavings ? parseFloat(editForm.monthlySavings) : 0,
        },
      },
      { onSuccess: () => setEditingId(null) }
    )
  }

  function handleAddFunds(goal) {
    const amount = parseFloat(addFunds[goal.id] || 0)
    if (!amount || amount <= 0) return
    updateGoal.mutate({
      id: goal.id,
      data: { currentAmount: goal.currentAmount + amount },
    })
    setAddFunds((prev) => ({ ...prev, [goal.id]: '' }))
  }

  async function handleGoalAnalysis(goal) {
    setGoalAnalysisLoading((prev) => ({ ...prev, [goal.id]: true }))
    try {
      const result = await api.llm.goalAnalysis({ goalId: goal.id })
      setGoalAnalysis((prev) => ({ ...prev, [goal.id]: result.analysis }))
    } catch {
      setGoalAnalysis((prev) => ({ ...prev, [goal.id]: 'Failed to generate analysis. Check your API key in Settings.' }))
    } finally {
      setGoalAnalysisLoading((prev) => ({ ...prev, [goal.id]: false }))
    }
  }

  const hasApiKey = settings?.hasClaudeApiKey

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-800">Goals</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showForm ? 'Cancel' : 'New Goal'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Create a New Goal</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Goal name</label>
              <input
                className={inputClass}
                placeholder="e.g. Emergency Fund"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Target amount ($)</label>
              <input
                className={inputClass}
                type="number"
                min="0"
                step="0.01"
                placeholder="10000"
                value={form.targetAmount}
                onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Target date</label>
              <input
                className={inputClass}
                type="date"
                value={form.targetDate}
                onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Monthly savings (optional)</label>
              <input
                className={inputClass}
                type="number"
                min="0"
                step="0.01"
                placeholder="500"
                value={form.monthlySavings}
                onChange={(e) => setForm((f) => ({ ...f, monthlySavings: e.target.value }))}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={createGoal.isPending}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {createGoal.isPending ? 'Creating…' : 'Create Goal'}
            </button>
          </div>
        </form>
      )}

      {/* Loading */}
      {isLoading && (
        <p className="text-sm text-gray-400">Loading goals…</p>
      )}

      {/* Empty state */}
      {!isLoading && goals.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg font-medium">No goals yet.</p>
          <p className="text-sm mt-1">Create your first goal to start tracking.</p>
        </div>
      )}

      {/* Goal cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {goals.map((goal) => {
          const pct = Math.min(100, goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0)
          const reached = goal.currentAmount >= goal.targetAmount
          const timeline = timelineText(goal)
          const analysis = goalAnalysis[goal.id]
          const analysisLoading = goalAnalysisLoading[goal.id]

          const isEditing = editingId === goal.id

          return (
            <div key={goal.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
              {/* Card header / edit form */}
              {isEditing ? (
                <form onSubmit={handleEdit} className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Goal name</label>
                      <input
                        className={inputClass}
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        required
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Target amount ($)</label>
                      <input
                        className={inputClass}
                        type="number"
                        min="0"
                        step="0.01"
                        value={editForm.targetAmount}
                        onChange={(e) => setEditForm((f) => ({ ...f, targetAmount: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Target date</label>
                      <input
                        className={inputClass}
                        type="date"
                        value={editForm.targetDate}
                        onChange={(e) => setEditForm((f) => ({ ...f, targetDate: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Monthly savings (optional)</label>
                      <input
                        className={inputClass}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={editForm.monthlySavings}
                        onChange={(e) => setEditForm((f) => ({ ...f, monthlySavings: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={updateGoal.isPending}
                      className="px-4 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {updateGoal.isPending ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-gray-800">{goal.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Target: {dayjs(goal.targetDate).format('MMM D, YYYY')}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    <button
                      onClick={() => startEditing(goal)}
                      className="text-gray-300 hover:text-blue-500 transition-colors text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteGoal.mutate(goal.id)}
                      disabled={deleteGoal.isPending}
                      className="text-gray-300 hover:text-red-400 transition-colors text-xs"
                      title="Delete goal"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}

              {/* Rest of card — hidden while editing */}
              {!isEditing && (
                <>
                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>${fmt(goal.currentAmount)}</span>
                      <span>{pct.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                      <div
                        className={`h-2.5 rounded-full transition-all ${progressColor(pct)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">of ${fmt(goal.targetAmount)}</p>
                  </div>

                  {/* Monthly savings */}
                  {goal.monthlySavings > 0 && (
                    <p className="text-xs text-gray-500">Saving ${fmt(goal.monthlySavings)} / mo</p>
                  )}

                  {/* Timeline estimate */}
                  {!reached && timeline && (
                    <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">{timeline}</p>
                  )}
                  {reached && (
                    <p className="text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2 font-medium">Goal reached!</p>
                  )}

                  {/* Add funds */}
                  {!reached && (
                    <div className="flex gap-2 items-center">
                      <input
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Add amount…"
                        value={addFunds[goal.id] || ''}
                        onChange={(e) => setAddFunds((prev) => ({ ...prev, [goal.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddFunds(goal)}
                      />
                      <button
                        onClick={() => handleAddFunds(goal)}
                        disabled={updateGoal.isPending}
                        className="px-3 py-1.5 bg-gray-800 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        Add Funds
                      </button>
                    </div>
                  )}

                  {/* AI goal analysis */}
                  {!hasApiKey ? (
                    <div className="border border-dashed border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-400 text-center">
                      Connect your Claude API key in Settings to unlock AI goal analysis
                    </div>
                  ) : analysisLoading ? (
                    <p className="text-xs text-gray-400 text-center py-2">Analyzing…</p>
                  ) : analysis ? (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                      <p className="text-xs text-indigo-700">{analysis}</p>
                      <button
                        onClick={() => handleGoalAnalysis(goal)}
                        className="text-xs text-indigo-400 hover:text-indigo-600 mt-1"
                      >
                        Refresh
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleGoalAnalysis(goal)}
                      className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 hover:border-gray-300 transition-colors text-center"
                    >
                      Get AI Analysis
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
