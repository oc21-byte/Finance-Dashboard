import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'
import { resolvePeriod, buildScopeKey } from '../utils/period.js'
import {
  portfolioValueOf, savingsTotalOf, buildLiquidKpis, sparklinePoints, monthsOfSpend,
  buildChangeAttribution, accountCount, trailingRowCount, staleInsightReason,
} from '../utils/liquidNetWorth.js'
import { priceQueryToken } from '../utils/listing.js'
import { resolveDisplayCurrency } from '../utils/displayCurrency.js'
import DashboardHeader from '../components/dashboard/DashboardHeader.jsx'
import LiquidNetWorthKpis from '../components/dashboard/LiquidNetWorthKpis.jsx'
import ChangeAttributionCard from '../components/dashboard/ChangeAttributionCard.jsx'
import LiquidNetWorthTrend from '../components/dashboard/LiquidNetWorthTrend.jsx'
import CompositionDonut from '../components/dashboard/CompositionDonut.jsx'
import GoalProgressCard from '../components/dashboard/GoalProgressCard.jsx'
import DashboardInsightsPanel from '../components/dashboard/DashboardInsightsPanel.jsx'

// Layout's demo-mode banner is `sticky top-0 z-40`, so anything this page pins starts below it.
// Unlike Finances and Spend there is no PinnedScopeBar here, so the banner is the only offset.
const DEMO_BANNER_H = 32

export default function Dashboard({ onTabChange, demoMode }) {
  const queryClient = useQueryClient()
  const [changePeriod, setChangePeriod] = useState('6M')
  // Which bucket the trend and the donut are both focused on, or null for all three. Lifted here
  // because it is shared BETWEEN the two cards — clicking a slice has to light a band next door.
  const [bucketFilter, setBucketFilter] = useState(null)
  const [insightsError, setInsightsError] = useState(null)
  const [chatError, setChatError] = useState(null)
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState(null)

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

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })
  const displayCurrency = resolveDisplayCurrency(settings?.displayCurrency)

  const priceTokens = [...new Set(holdings.map(h => priceQueryToken(h, displayCurrency)).filter(Boolean))]

  const { data: pricePayload = { prices: {}, fx: {} }, isFetching: pricesFetching, dataUpdatedAt: pricesUpdatedAt } = useQuery({
    queryKey: ['prices', priceTokens],
    queryFn: () => api.prices.get(priceTokens),
    enabled: priceTokens.length > 0,
    staleTime: 60_000,
  })
  const prices = pricePayload.prices ?? pricePayload
  const usdCad = pricePayload.fx?.USDCAD ?? null

  const { data: savingsAccounts = [] } = useQuery({
    queryKey: ['savings-accounts'],
    queryFn: api.savingsAccounts.list,
  })

  const { data: netWorthHistory = [] } = useQuery({
    queryKey: ['net-worth-history'],
    queryFn: api.netWorth.history,
  })

  // Cash is derived from lagging statements, so the strip has to say how fresh it is rather than
  // implying it knows today's balance.
  const { data: cashStatus = null } = useQuery({
    queryKey: ['cash-status'],
    queryFn: api.cashStatus,
  })

  const { data: dashboardInsights } = useQuery({
    queryKey: ['dashboard-insights'],
    queryFn: api.dashboardInsights.get,
  })

  const insightsPeriod = dashboardInsights?.period ?? null
  const chatMessages = dashboardInsights?.messages ?? []

  const insightsMutation = useMutation({
    mutationFn: (scope) => api.llm.dashboardInsights(scope),
    onSuccess: () => {
      setInsightsError(null)
      queryClient.invalidateQueries({ queryKey: ['dashboard-insights'] })
    },
    onError: (err) => setInsightsError(err.message || 'Failed to generate insights. Please try again.'),
  })

  const clearInsightsMutation = useMutation({
    mutationFn: api.dashboardInsights.clear,
    onSuccess: () => {
      setInsightsError(null)
      setChatError(null)
      queryClient.invalidateQueries({ queryKey: ['dashboard-insights'] })
    },
  })

  // Bring the stored history up to date on mount, in this order and strictly sequentially.
  //
  // All three routes read-modify-write the same flat db.json, and `rebuild` replaces the whole
  // array — firing them in parallel (as this used to) loses whichever write lands first. The
  // window is wide now that they await Yahoo. `rebuild` no-ops unless the stored shape is stale,
  // so the steady-state cost is one cheap round trip.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await api.netWorth.rebuild()
        await api.netWorth.snapshot()
        await api.netWorth.backfill()
      } catch {
        // History is a convenience layered on top of live balances. If Yahoo or the disk is
        // having a bad day the KPIs still render, so this must not surface as a page error.
      }
      if (!cancelled) queryClient.invalidateQueries({ queryKey: ['net-worth-history'] })
    })()
    return () => { cancelled = true }
  }, [])

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
      // Sent against the STORED period, not the chip on screen: the answer has to describe the same
      // data the cards above it describe, or the server refuses to record the exchange.
      await api.llm.dashboardChat(
        insightsPeriod ? { ...scopePayload, period: insightsPeriod } : scopePayload,
        [...chatMessages, { role: 'user', content: message }],
      )
      await queryClient.invalidateQueries({ queryKey: ['dashboard-insights'] })
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

  const isLoading = txLoading || goalsLoading || holdingsLoading
  const hasAiKey = settings?.aiProvider === 'openai' ? !!settings?.hasOpenaiApiKey : !!settings?.hasClaudeApiKey

  const cashBalance = cashStatus?.balance ?? Math.round((settings?.cashBalance ?? 0) * 100) / 100
  const portfolioValue = portfolioValueOf(holdings, prices, { displayCurrency, usdCad })
  const savingsTotal = savingsTotalOf(savingsAccounts)

  const kpis = buildLiquidKpis({
    history: netWorthHistory,
    cash: cashBalance,
    savings: savingsTotal,
    portfolio: portfolioValue,
  })

  // The waterfall is anchored to the latest TRANSACTION, not to today: money in and money out are
  // flows, and a today-anchored window would end mid-statement and report a collapse in both. The
  // trend below deliberately uses calendar time instead, because it plots balances.
  const changeRange = useMemo(() => resolvePeriod(changePeriod, transactions), [changePeriod, transactions])
  // The checks come from the server rather than being recomputed here: `statementChecks` needs the
  // opening balance and the full statement series, and deriving them twice is how two figures for
  // one thing start disagreeing.
  const attribution = useMemo(
    () => buildChangeAttribution(netWorthHistory, transactions, changeRange, cashStatus?.checks ?? []),
    [netWorthHistory, transactions, changeRange, cashStatus?.checks],
  )
  const trailingRows = useMemo(
    () => trailingRowCount(transactions, attribution, changeRange),
    [transactions, attribution, changeRange],
  )

  // What the AI is being asked about. The Dashboard has no filter chips — it scopes one card, by
  // date — so this is the range and nothing else, which keeps the APPEND-ONLY `FILTER_ORDER`
  // contract in period.js untouched while still producing a key distinct from the other two tabs'.
  const scopeKey = buildScopeKey(changeRange, {})
  const scopeLabel = changeRange.label
  const scopePayload = {
    period: scopeKey,
    from: changeRange.from,
    to: changeRange.to,
    periodLabel: scopeLabel,
  }

  // Where the insights rail freezes. A constant, not a measurement: the demo banner is the only
  // fixed chrome above this page — the top nav scrolls away and there is no pinned scope bar here.
  const railTop = (demoMode ? DEMO_BANNER_H : 0) + 16

  // Checked against the live cards, not just against the chip: a stored generation also goes stale
  // when the data under it moves, and staying quiet about that lets the panel contradict the
  // numbers directly above it.
  const staleReason = staleInsightReason({
    record: dashboardInsights, scopeKey, kpis, attribution,
  })

  if (isLoading) {
    return (
      <div className="p-6 text-center text-sm text-gray-400 pt-20">Loading…</div>
    )
  }

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <DashboardHeader
        asOf={cashStatus?.asOf ?? netWorthHistory[netWorthHistory.length - 1]?.date}
        accountCount={accountCount({ cash: cashBalance, savingsAccounts, holdings })}
        pricesUpdatedAt={pricesUpdatedAt}
      />

      <LiquidNetWorthKpis
        kpis={kpis}
        sparkline={sparklinePoints(netWorthHistory, kpis.days)}
        monthsOfSpend={monthsOfSpend(transactions, cashBalance)}
        cashStatus={cashStatus}
        pricesFetching={pricesFetching}
        onOpenSettings={() => onTabChange?.('settings')}
      />

      {/* Main column + sticky insights rail, starting level with the change waterfall — the header
          and KPI strip stay full width above it, the same way Finances and Spend keep their title
          and KPI row full width. The rail drops below the content under xl, where 320px of it would
          leave the trend too narrow to read. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div className="min-w-0 space-y-6">
          <ChangeAttributionCard
            attribution={attribution}
            period={changePeriod}
            onPeriodChange={setChangePeriod}
            range={changeRange}
            trailingRows={trailingRows}
            onInspectWindow={win => onTabChange?.('finances', { range: win, reason: win.reason })}
            onOpenFinances={() => onTabChange?.('finances')}
            onOpenSpend={() => onTabChange?.('spend-analyzer')}
          />

          {/* The trend and today's split, side by side: one shows how the balance got here, the
              other what it is right now. Clicking a donut slice lights its band in the trend. */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_348px]">
            <LiquidNetWorthTrend
              history={netWorthHistory}
              highlight={bucketFilter}
              onHighlight={setBucketFilter}
            />
            <CompositionDonut
              cash={cashBalance}
              savings={savingsTotal}
              holdings={holdings}
              prices={prices}
              displayCurrency={displayCurrency}
              usdCad={usdCad}
              pricesFetching={pricesFetching}
              highlight={bucketFilter}
              onHighlight={setBucketFilter}
            />
          </div>

          <GoalProgressCard
            goals={goals}
            transactions={transactions}
            onOpenGoals={() => onTabChange?.('goals')}
          />

          <p className="text-[11px] leading-relaxed text-gray-400">
            Liquid net worth counts cash, savings, and investment accounts. It does not include
            property, vehicles, private or corporate shares, or debts.
          </p>
        </div>

        {/* Capped to the viewport and scrollable *only* where it's sticky: the observations,
            exploration choices and conversation run taller than the screen, and a sticky element
            taller than its viewport leaves its own bottom permanently out of reach. Below xl it's
            in normal flow, where a cap would be wrong. */}
        <aside
          className="xl:sticky xl:overflow-y-auto xl:max-h-[var(--rail-max-h)] min-w-0"
          style={{ top: railTop, '--rail-max-h': `calc(100vh - ${railTop + 16}px)` }}
        >
          <DashboardInsightsPanel
            hasAiKey={hasAiKey}
            record={dashboardInsights}
            chatMessages={chatMessages}
            staleReason={staleReason}
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
            onExplore={option => sendChatMessage(option.prompt)}
            onChatInput={setChatInput}
          />
        </aside>
      </div>
    </div>
  )
}
