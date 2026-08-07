import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { api } from '../api/client.js'
import { emergencyFund } from '../utils/goalsModel.js'
import DeleteGoalModal from '../components/goals/DeleteGoalModal.jsx'
import EmergencyFundBanner from '../components/goals/EmergencyFundBanner.jsx'
import GoalAiPanel from '../components/goals/GoalAiPanel.jsx'
import GoalCard, { NewGoalTile } from '../components/goals/GoalCard.jsx'
import GoalDetail from '../components/goals/GoalDetail.jsx'
import GoalForm, { blankGoal } from '../components/goals/GoalForm.jsx'
import LinkedAllocationCard from '../components/goals/LinkedAllocationCard.jsx'

const READ_ONLY_TITLE = 'Unavailable in Demo Mode'

/**
 * The Goals tab: a grid of goals, and one detail panel for whichever is selected.
 *
 * `selectedId` drives the whole page and is one of three things — `null` (grid only), a goal id
 * (that goal's detail), or the string `'new'` (the create form in the detail slot). Editing is a
 * flag on top of a selected goal rather than a fourth state, so cancelling an edit lands you back
 * on the goal you were editing instead of on an empty page.
 *
 * Everything derived lives in `src/utils/goalsModel.js`; the components below are presentational
 * and every query, mutation and piece of chat state is owned here.
 */
export default function Goals({ demoMode }) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [addFundsValue, setAddFundsValue] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [goalAnalysis, setGoalAnalysis] = useState({})
  const [goalAnalysisLoading, setGoalAnalysisLoading] = useState({})
  const [goalChatMessages, setGoalChatMessages] = useState({})
  const [goalChatInput, setGoalChatInput] = useState({})
  const [goalChatLoading, setGoalChatLoading] = useState({})
  const [efMonths, setEfMonths] = useState(6)

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: api.goals.list,
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })

  const { data: fin } = useQuery({
    queryKey: ['monthly-financials'],
    queryFn: api.monthlyFinancials.get,
  })

  const selectedGoal = goals.find(g => g.id === selectedId) ?? null
  const isCreating = selectedId === 'new'
  const formOpen = isCreating || (!!selectedGoal && editing)

  // Both hit live prices server-side, so neither runs for a page with nothing selected. Sources
  // are needed by the allocation card, which is in the detail panel for every goal.
  const { data: sources = [] } = useQuery({
    queryKey: ['goal-sources'],
    queryFn: api.goals.sources,
    enabled: selectedId !== null,
  })
  const { data: contribRate } = useQuery({
    queryKey: ['contribution-rate'],
    queryFn: api.goals.contributionRate,
    enabled: formOpen,
  })

  const invalidateGoals = () => {
    queryClient.invalidateQueries({ queryKey: ['goals'] })
    queryClient.invalidateQueries({ queryKey: ['goal-sources'] })
  }

  const createGoal = useMutation({
    mutationFn: (data) => api.goals.create(data),
    // Select what was just created: the mockup opens the new goal's detail, and landing back on an
    // empty page after filling in a form reads as though nothing happened.
    onSuccess: (created) => {
      invalidateGoals()
      setSelectedId(created?.id ?? null)
      setEditing(false)
    },
  })

  const updateGoal = useMutation({
    mutationFn: ({ id, data }) => api.goals.update(id, data),
    onSuccess: invalidateGoals,
  })

  const deleteGoal = useMutation({
    mutationFn: (id) => api.goals.remove(id),
    onSuccess: (removed) => {
      invalidateGoals()
      setPendingDelete(null)
      if (removed?.id === selectedId) setSelectedId(null)
    },
  })

  function openCreate() {
    setSelectedId('new')
    setEditing(false)
    createGoal.reset()
  }

  function selectGoal(goal) {
    // Clicking the open card closes it, so the grid can be collapsed without hunting for ✕.
    setSelectedId(prev => (prev === goal.id ? null : goal.id))
    setEditing(false)
    setAddFundsValue('')
  }

  function closeDetail() {
    setSelectedId(null)
    setEditing(false)
  }

  function startEdit() {
    setEditing(true)
    updateGoal.reset()
  }

  function submitEdit(values) {
    updateGoal.mutate({ id: selectedGoal.id, data: values }, { onSuccess: () => setEditing(false) })
  }

  // Links save on their own rather than waiting for a form submit — see LinkedAllocationCard.
  function saveLinks(links) {
    updateGoal.mutate({ id: selectedGoal.id, data: { links } })
  }

  function createEmergencyFund() {
    createGoal.mutate({
      name: 'Emergency Fund',
      targetAmount: ef.target,
      targetDate: dayjs().add(efMonths * 2, 'month').format('YYYY-MM-DD'),
      // Seeded from cash so a fund you already hold does not start the day reading zero.
      currentAmount: settings?.cashBalance ?? 0,
      monthlySavings: 0,
      links: [],
    })
  }

  function handleAddFunds() {
    const amount = parseFloat(addFundsValue)
    if (!amount || amount <= 0 || !selectedGoal) return
    updateGoal.mutate({ id: selectedGoal.id, data: { currentAmount: selectedGoal.currentAmount + amount } })
    setAddFundsValue('')
  }

  async function handleGoalAnalysis(goal) {
    setGoalAnalysisLoading(prev => ({ ...prev, [goal.id]: true }))
    setGoalChatMessages(prev => ({ ...prev, [goal.id]: [] }))
    try {
      const result = await api.llm.goalAnalysis({ goalId: goal.id })
      setGoalAnalysis(prev => ({ ...prev, [goal.id]: result.analysis }))
    } catch {
      setGoalAnalysis(prev => ({ ...prev, [goal.id]: 'Failed to generate analysis. Check your API key in Settings.' }))
    } finally {
      setGoalAnalysisLoading(prev => ({ ...prev, [goal.id]: false }))
    }
  }

  async function handleGoalChat(goalId, e) {
    e.preventDefault()
    const message = (goalChatInput[goalId] || '').trim()
    if (!message || goalChatLoading[goalId]) return
    const prev = goalChatMessages[goalId] || []
    const newMessages = [...prev, { role: 'user', content: message }]
    setGoalChatMessages(m => ({ ...m, [goalId]: newMessages }))
    setGoalChatInput(i => ({ ...i, [goalId]: '' }))
    setGoalChatLoading(l => ({ ...l, [goalId]: true }))
    try {
      const result = await api.llm.goalChat(goalId, newMessages)
      setGoalChatMessages(m => ({ ...m, [goalId]: [...newMessages, { role: 'assistant', content: result.reply }] }))
    } catch {
      setGoalChatMessages(m => ({ ...m, [goalId]: [...newMessages, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }] }))
    } finally {
      setGoalChatLoading(l => ({ ...l, [goalId]: false }))
    }
  }

  // Either provider's key unlocks goal analysis — `/api/llm/goal-analysis` and `/api/llm/goal-chat`
  // both accept whichever is configured, so gating on the Claude key alone made the panel read
  // "connect your Claude API key" to anyone using ChatGPT with a working OpenAI key.
  const hasApiKey = settings?.aiProvider === 'openai' ? settings?.hasOpenaiApiKey : settings?.hasClaudeApiKey
  const readOnly = !!demoMode
  const ef = emergencyFund({ goals, fin, cashBalance: settings?.cashBalance ?? 0, months: efMonths })

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-800">Goals</h1>
        <button
          onClick={openCreate}
          disabled={readOnly}
          title={readOnly ? READ_ONLY_TITLE : undefined}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600"
        >
          + New Goal
        </button>
      </div>

      <EmergencyFundBanner
        ef={ef}
        months={efMonths}
        onMonthsChange={setEfMonths}
        cashBalance={settings?.cashBalance ?? 0}
        onSync={() => updateGoal.mutate({ id: ef.efGoal.id, data: { targetAmount: ef.target } })}
        onCreate={createEmergencyFund}
        pending={createGoal.isPending || updateGoal.isPending}
        readOnly={readOnly}
        readOnlyTitle={READ_ONLY_TITLE}
      />

      {isLoading ? (
        <p className="text-sm text-gray-400">Loading goals…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map(goal => (
            <GoalCard key={goal.id} goal={goal} selected={goal.id === selectedId} onSelect={() => selectGoal(goal)} />
          ))}
          <NewGoalTile onClick={openCreate} disabled={readOnly} title={readOnly ? READ_ONLY_TITLE : undefined} />
        </div>
      )}

      {isCreating && (
        <div className="mt-6 border-t border-dashed border-gray-200 pt-5">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">New goal</p>
          <GoalForm
            initial={blankGoal()}
            submitLabel="Create Goal"
            pending={createGoal.isPending}
            error={createGoal.error?.serverMessage}
            onSubmit={(values) => createGoal.mutate({ ...values, currentAmount: 0, links: [] })}
            onCancel={closeDetail}
            contribRate={contribRate}
          />
        </div>
      )}

      {selectedGoal && editing && (
        <div className="mt-6 border-t border-dashed border-gray-200 pt-5">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">
            Edit {selectedGoal.name}
          </p>
          <GoalForm
            // Reseed the fields when the selection changes rather than syncing them in an effect.
            key={selectedGoal.id}
            initial={{
              name: selectedGoal.name,
              targetAmount: selectedGoal.targetAmount,
              targetDate: selectedGoal.targetDate,
              monthlySavings: selectedGoal.monthlySavings || '',
            }}
            submitLabel="Save"
            pending={updateGoal.isPending}
            error={updateGoal.error?.serverMessage}
            onSubmit={submitEdit}
            onCancel={() => setEditing(false)}
            contribRate={contribRate}
          />
        </div>
      )}

      {selectedGoal && !editing && (
        <GoalDetail
          goal={selectedGoal}
          onEdit={startEdit}
          onDelete={() => { deleteGoal.reset(); setPendingDelete(selectedGoal) }}
          onClose={closeDetail}
          addFunds={addFundsValue}
          onAddFundsChange={(e) => setAddFundsValue(e.target.value)}
          onAddFunds={handleAddFunds}
          addFundsPending={updateGoal.isPending}
          readOnly={readOnly}
          readOnlyTitle={READ_ONLY_TITLE}
          linksSlot={
            <LinkedAllocationCard
              goal={selectedGoal}
              sources={sources}
              onSave={saveLinks}
              saving={updateGoal.isPending}
              error={updateGoal.error?.serverMessage}
              readOnly={readOnly}
              readOnlyTitle={READ_ONLY_TITLE}
            />
          }
          aiPanel={
            <GoalAiPanel
              hasApiKey={hasApiKey}
              analysis={goalAnalysis[selectedGoal.id]}
              analysisLoading={goalAnalysisLoading[selectedGoal.id]}
              onAnalyze={() => handleGoalAnalysis(selectedGoal)}
              messages={goalChatMessages[selectedGoal.id] || []}
              chatLoading={goalChatLoading[selectedGoal.id]}
              input={goalChatInput[selectedGoal.id] || ''}
              onInputChange={(e) => setGoalChatInput(i => ({ ...i, [selectedGoal.id]: e.target.value }))}
              onSend={(e) => handleGoalChat(selectedGoal.id, e)}
            />
          }
        />
      )}

      <DeleteGoalModal
        goal={pendingDelete}
        onCancel={() => { setPendingDelete(null); deleteGoal.reset() }}
        onConfirm={() => deleteGoal.mutate(pendingDelete.id)}
        pending={deleteGoal.isPending}
        error={deleteGoal.error?.serverMessage}
      />
    </div>
  )
}
