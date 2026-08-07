import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'
import { buildScopeKey } from '../utils/period.js'
import { buildBudgetPlan, staleBudgetInsightReason, SAVINGS_CATS } from '../utils/budgetModel.js'
import BudgetHeader from '../components/budget/BudgetHeader.jsx'
import BudgetKpiRow from '../components/budget/BudgetKpiRow.jsx'
import AllocationBar from '../components/budget/AllocationBar.jsx'
import PendingAiBanner from '../components/budget/PendingAiBanner.jsx'
import SpendingCapsTable from '../components/budget/SpendingCapsTable.jsx'
import SavingsGoalsCard from '../components/budget/SavingsGoalsCard.jsx'
import DetectedFromBankCard from '../components/budget/DetectedFromBankCard.jsx'
import BudgetInsightsPanel from '../components/budget/BudgetInsightsPanel.jsx'

// Layout's demo-mode banner is `sticky top-0 z-40`, so anything this page pins starts below it.
// Like the Dashboard and unlike Finances and Spend, Budget has no PinnedScopeBar — its window is
// fixed at the last <=6 full bank months and there is nothing to condense — so the banner is the
// only offset.
const DEMO_BANNER_H = 32

/**
 * The plan: what income is, where it is committed, and what is left.
 *
 * This page orchestrates queries, mutations, and the AI staging flow. Every figure it renders
 * comes from `buildBudgetPlan` in `src/utils/budgetModel.js` — no arithmetic lives here — and each
 * card owns one kind of commitment: caps on spending, amounts set aside, and what the bank ledger
 * already shows happening.
 */
export default function Budget({ onTabChange, demoMode }) {
  const queryClient = useQueryClient()

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })
  const { data: goals = [] } = useQuery({ queryKey: ['goals'], queryFn: api.goals.list })
  const { data: fin } = useQuery({ queryKey: ['monthly-financials'], queryFn: api.monthlyFinancials.get })
  const { data: budgetInsights } = useQuery({ queryKey: ['budget-insights'], queryFn: api.budgetInsights.get })

  const [editingIncome, setEditingIncome] = useState(false)
  const [incomeValue, setIncomeValue] = useState('')
  const [editingSavingsTarget, setEditingSavingsTarget] = useState(false)
  const [savingsTargetValue, setSavingsTargetValue] = useState('')
  const [editingBudget, setEditingBudget] = useState(null)
  const [editingGoal, setEditingGoal] = useState(null)
  const [pendingBudgets, setPendingBudgets] = useState(null)
  const [pendingSavingsTarget, setPendingSavingsTarget] = useState(null)
  const [pendingRationale, setPendingRationale] = useState(null)
  const [timeline, setTimeline] = useState('balanced')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(null)
  const [toast, setToast] = useState('')
  // Chat state lives here, not in the panel — the panel is presentational, like the other three.
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState(null)
  const [insightsError, setInsightsError] = useState(null)
  const [chatError, setChatError] = useState(null)

  // The whole derivation chain lives in `src/utils/budgetModel.js` — pure, tested, and shared
  // with the server analysis so an insight and this page cannot quote different figures.
  const plan = useMemo(
    () => buildBudgetPlan({ settings, goals, fin, pendingBudgets, pendingSavingsTarget }),
    [settings, goals, fin, pendingBudgets, pendingSavingsTarget],
  )

  const hasAiKey = settings?.aiProvider === 'openai' ? !!settings?.hasOpenaiApiKey : !!settings?.hasClaudeApiKey
  // Where the rail freezes. A constant, not a measurement — the demo banner is the only fixed
  // chrome above this page.
  const railTop = (demoMode ? DEMO_BANNER_H : 0) + 16

  // What the AI is being asked about. Budget has no filter chips and no period chips — its window
  // is whatever `buildMonthlyFinancials` averaged over — so this is that window and nothing else,
  // which keeps the APPEND-ONLY `FILTER_ORDER` contract in period.js untouched while still
  // producing a key distinct from the other three tabs'.
  const scopeKey = buildScopeKey({ key: 'Budget', from: fin?.windowFrom, to: fin?.windowTo }, {})
  const scopePayload = {
    period: scopeKey,
    from: fin?.windowFrom,
    to: fin?.windowTo,
    periodLabel: plan.income.windowLabel,
  }
  const insightsPeriod = budgetInsights?.period ?? null
  const chatMessages = budgetInsights?.messages ?? []

  // Checked against the live plan, not just the window: unlike the other three tabs nothing here
  // is scoped by a chip, so a stale generation is one the user has since edited out from under.
  const staleReason = staleBudgetInsightReason({ record: budgetInsights, scopeKey, plan })
  // Demo mode serves a shared read-only database. It used to gate only the AI button here, leaving
  // every inline editor live — a visitor could rewrite the caps everyone else was looking at.
  const readOnly = !!demoMode

  const settingsMutation = useMutation({
    mutationFn: (data) => api.settings.update(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const goalsMutation = useMutation({
    mutationFn: ({ id, data }) => api.goals.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goals'] }),
  })

  const insightsMutation = useMutation({
    mutationFn: (scope) => api.llm.budgetInsights(scope),
    onSuccess: () => {
      setInsightsError(null)
      queryClient.invalidateQueries({ queryKey: ['budget-insights'] })
    },
    onError: (err) => setInsightsError(err.message || 'Failed to generate insights. Please try again.'),
  })

  const clearInsightsMutation = useMutation({
    mutationFn: api.budgetInsights.clear,
    onSuccess: () => {
      setInsightsError(null)
      setChatError(null)
      queryClient.invalidateQueries({ queryKey: ['budget-insights'] })
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
      // Sent against the STORED period, not the window on screen: the answer has to describe the
      // same plan the observations describe, or the server refuses to record the exchange.
      await api.llm.budgetChat(
        insightsPeriod ? { ...scopePayload, period: insightsPeriod } : scopePayload,
        [...chatMessages, { role: 'user', content: message }],
      )
      await queryClient.invalidateQueries({ queryKey: ['budget-insights'] })
    } catch (err) {
      // Kept out of the stored conversation: a failed exchange isn't history worth replaying.
      setChatError(err.message || 'Something went wrong. Please try again.')
      setChatInput(message)
    } finally {
      setPendingQuestion(null)
      setChatLoading(false)
    }
  }

  function handleSendChat(event) {
    event.preventDefault()
    sendChatMessage(chatInput)
  }

  function showToast(message) {
    setToast(message)
    setTimeout(() => setToast(''), 3000)
  }

  function saveIncome() {
    const value = Number(incomeValue)
    if (!readOnly && Number.isFinite(value)) settingsMutation.mutate({ confirmedMonthlyIncome: value })
    setEditingIncome(false)
  }

  // One handler for both cap tables: spending caps and savings-category caps are the same
  // `settings.categoryBudgets` map, split only by which card renders them.
  function saveBudgetCap() {
    const edit = editingBudget
    if (edit && !readOnly) {
      const value = Number(edit.value)
      if (Number.isFinite(value) && value >= 0 && edit.value !== '') {
        const updated = { ...plan.effectiveBudgets, [edit.cat]: value }
        // While AI suggestions are staged, an edit revises the staging rather than persisting —
        // otherwise saving the plan later would overwrite the correction the user just made.
        if (pendingBudgets) setPendingBudgets(updated)
        else settingsMutation.mutate({ categoryBudgets: updated })
      }
    }
    setEditingBudget(null)
  }

  function saveGoalSavings() {
    const edit = editingGoal
    if (edit && !readOnly) {
      const value = Number(edit.value)
      if (Number.isFinite(value) && value >= 0 && edit.value !== '') {
        goalsMutation.mutate({ id: edit.goalId, data: { monthlySavings: value } })
      }
    }
    setEditingGoal(null)
  }

  function saveSavingsTarget() {
    const trimmed = savingsTargetValue.trim()
    if (!readOnly) {
      if (trimmed === '') {
        // Blank clears the override back to the rate-based default. `null` is the unset sentinel;
        // 0 is a real target of zero.
        if (pendingSavingsTarget !== null) setPendingSavingsTarget(null)
        else settingsMutation.mutate({ budgetSavingsTarget: null })
      } else {
        const value = Number(trimmed)
        if (Number.isFinite(value) && value >= 0) {
          if (pendingSavingsTarget !== null) setPendingSavingsTarget(value)
          else settingsMutation.mutate({ budgetSavingsTarget: value })
        }
      }
    }
    setEditingSavingsTarget(false)
  }

  async function generateAIBudget() {
    setAiLoading(true)
    setAiError(null)
    try {
      const result = await api.llm.budgetBuilder({
        income: plan.income.display,
        timelinePreference: timeline,
      })
      if (result.budgets) {
        // Savings categories are overwritten with what the bank actually shows: the model is
        // proposing spending caps, and a suggested "savings cap" that contradicts an existing
        // automated transfer would stage a number the ledger immediately disagrees with.
        const adjusted = { ...result.budgets }
        for (const cat of Object.keys(adjusted)) {
          if (SAVINGS_CATS.has(cat) && plan.bankBreakdownMap[cat]) {
            adjusted[cat] = plan.bankBreakdownMap[cat]
          }
        }
        setPendingBudgets(adjusted)
      }
      if (result.suggestedSavingsTarget != null) setPendingSavingsTarget(result.suggestedSavingsTarget)
      setPendingRationale(result.rationale ?? null)
    } catch (err) {
      setAiError(err.message)
    } finally {
      setAiLoading(false)
    }
  }

  function saveAIBudget() {
    const payload = {}
    if (pendingBudgets) payload.categoryBudgets = pendingBudgets
    if (pendingSavingsTarget != null) payload.budgetSavingsTarget = pendingSavingsTarget
    settingsMutation.mutate(payload, {
      onSuccess: () => {
        discardAI()
        showToast('Budget saved.')
      },
    })
  }

  function discardAI() {
    setPendingBudgets(null)
    setPendingSavingsTarget(null)
    setPendingRationale(null)
    setAiError(null)
  }

  return (
    <div className="space-y-6 p-3 sm:p-6">
      <BudgetHeader
        windowLabel={plan.income.windowLabel}
        timeline={timeline}
        onTimelineChange={setTimeline}
        canGenerate={hasAiKey || demoMode}
        generating={aiLoading}
        onGenerate={generateAIBudget}
        demoMode={demoMode}
      />

      {toast && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <span>{toast}</span>
          <button onClick={() => setToast('')} aria-label="Dismiss" className="text-lg leading-none text-green-400 hover:text-green-600">
            ✕
          </button>
        </div>
      )}

      <BudgetKpiRow
        plan={plan}
        readOnly={readOnly}
        editingIncome={editingIncome}
        incomeValue={incomeValue}
        onIncomeChange={setIncomeValue}
        onStartEditIncome={() => { setIncomeValue(String(Math.round(plan.income.display))); setEditingIncome(true) }}
        onCommitIncome={saveIncome}
        onCancelIncome={() => setEditingIncome(false)}
      />

      <AllocationBar plan={plan} />

      {/* Main column + docked rail, starting below the allocation bar — the header, KPI strip and
          bar stay full width, the same way the other three tabs keep their title and KPI row full
          width. The rail drops below the content under xl, where 320px of it would leave the caps
          table too narrow to read. */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {plan.hasPending && (
            <PendingAiBanner
              timeline={timeline}
              rationale={pendingRationale}
              saving={settingsMutation.isPending}
              onSave={saveAIBudget}
              onDiscard={discardAI}
            />
          )}

          {/* Caps beside savings, with the bank's own view spanning beneath them: the two cards
              are the plan, and the card below is the check on it. */}
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <SpendingCapsTable
              rows={plan.spendingCategories}
              income={plan.income.display}
              windowLabel={plan.income.windowLabel}
              readOnly={readOnly}
              error={aiError}
              editing={editingBudget?.cat ?? null}
              editValue={editingBudget?.value ?? ''}
              onStartEdit={(name, cap) => setEditingBudget({ cat: name, value: cap == null ? '' : String(cap) })}
              onEditValue={value => setEditingBudget(prev => ({ ...prev, value }))}
              onCommit={saveBudgetCap}
              onCancel={() => setEditingBudget(null)}
            />

            <SavingsGoalsCard
              plan={plan}
              readOnly={readOnly}
              onOpenGoals={() => onTabChange?.('goals')}
              editingCap={editingBudget?.cat ?? null}
              editingCapValue={editingBudget?.value ?? ''}
              onStartEditCap={(name, cap) => setEditingBudget({ cat: name, value: cap == null ? '' : String(cap) })}
              onEditCapValue={value => setEditingBudget(prev => ({ ...prev, value }))}
              onCommitCap={saveBudgetCap}
              onCancelCap={() => setEditingBudget(null)}
              editingGoalId={editingGoal?.goalId ?? null}
              editingGoalValue={editingGoal?.value ?? ''}
              onStartEditGoal={(goalId, manual) => setEditingGoal({ goalId, value: manual ? String(manual) : '' })}
              onEditGoalValue={value => setEditingGoal(prev => ({ ...prev, value }))}
              onCommitGoal={saveGoalSavings}
              onCancelGoal={() => setEditingGoal(null)}
              editingTarget={editingSavingsTarget}
              targetValue={savingsTargetValue}
              onStartEditTarget={() => {
                setSavingsTargetValue(settings?.budgetSavingsTarget != null ? String(settings.budgetSavingsTarget) : '')
                setEditingSavingsTarget(true)
              }}
              onEditTargetValue={setSavingsTargetValue}
              onCommitTarget={saveSavingsTarget}
              onCancelTarget={() => setEditingSavingsTarget(false)}
            />
          </div>

          <DetectedFromBankCard plan={plan} />
        </div>

        {/* Capped to the viewport and scrollable only where it's sticky: once the follow-up
            conversation lands here in phase four this will run taller than the screen, and a
            sticky element taller than its viewport strands its own bottom permanently. Below xl
            it is in normal flow, where a cap would be wrong. */}
        <aside
          className="min-w-0 xl:sticky xl:max-h-[var(--rail-max-h)] xl:overflow-y-auto"
          style={{ top: railTop, '--rail-max-h': `calc(100vh - ${railTop + 16}px)` }}
        >
          <BudgetInsightsPanel
            plan={plan}
            hasAiKey={hasAiKey}
            record={budgetInsights}
            chatMessages={chatMessages}
            staleReason={staleReason}
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
            onExplore={option => sendChatMessage(option.prompt)}
            onChatInput={setChatInput}
            onOpenSettings={() => onTabChange?.('settings')}
          />
        </aside>
      </div>
    </div>
  )
}
