import { useEffect, useRef } from 'react'
import dayjs from 'dayjs'
import ExploreChoices from './ExploreChoices.jsx'
import FinancialPaceCard from './FinancialPaceCard.jsx'
import SpendStyleProfile from './SpendStyleProfile.jsx'

/**
 * Version-two records show a deterministic Spend Style and Financial Pace. Version-one records
 * keep their original three-card presentation so a stored result remains readable after upgrade.
 */
export default function AiInsightsPanel({
  hasAiKey, storedInsights, insights, insightsPeriod, chatMessages,
  scopeKey, scopeLabel,
  insightsError, chatError, chatInput, chatLoading, pendingQuestion,
  generating, clearing,
  onGenerate, onClear, onSendChat, onExplore, onChatInput, onOpenSettings,
}) {
  const isProfileRecord = Number(storedInsights?.analysisVersion) >= 2 && !!storedInsights?.profile
  const hasResult = isProfileRecord || insights.length > 0
  const stale = hasResult && insightsPeriod !== scopeKey
  const chatRef = useRef(null)

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatMessages.length, pendingQuestion, chatLoading])

  function chooseExploreOption(option) {
    // Buttons and typed 1/2/3 deliberately enter the same server path.
    onExplore(option)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-gray-900">
            {isProfileRecord ? 'Spend Style' : 'AI Insights'}
          </h2>
          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-700">AI</span>
        </div>
        {hasAiKey && (
          <div className="flex items-center gap-1">
            {hasResult && (
              <button
                onClick={onClear}
                disabled={clearing || generating}
                title="Discard this analysis and the conversation"
                className="rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60"
              >
                Clear
              </button>
            )}
            <button
              onClick={onGenerate}
              disabled={generating}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
            >
              {generating ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Analyzing…
                </>
              ) : hasResult ? 'Refresh' : 'Generate'}
            </button>
          </div>
        )}
      </div>

      <p className="mb-3 text-xs leading-relaxed text-gray-400">
        {isProfileRecord ? 'Built from your available spending and financial history.' : `Based on ${scopeLabel}.`}
        {storedInsights?.generatedAt && hasResult && (
          <span className="mt-0.5 block text-gray-300">
            Saved {dayjs(storedInsights.generatedAt).format('MMM D, h:mm A')}
          </span>
        )}
      </p>

      {!hasAiKey && (
        <div className="py-4 text-center">
          <p className="text-sm text-gray-400">Insights need an AI API key.</p>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="mt-2.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              Open Settings
            </button>
          )}
        </div>
      )}

      {hasAiKey && insightsError && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {insightsError}
        </div>
      )}

      {hasAiKey && generating && !hasResult && (
        <div className="flex flex-col gap-2.5" aria-hidden>
          <div className="animate-pulse rounded-xl border border-violet-100 bg-violet-50/50 p-4">
            <div className="mb-2.5 h-2.5 w-2/5 rounded bg-violet-100" />
            <div className="mb-2 h-4 w-3/4 rounded bg-violet-200" />
            <div className="h-2.5 w-full rounded bg-violet-100" />
          </div>
          <div className="animate-pulse rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <div className="mb-2.5 h-3 w-1/2 rounded bg-gray-200" />
            <div className="grid grid-cols-2 gap-1.5">
              {[0, 1, 2, 3].map(item => <div key={item} className="h-10 rounded bg-gray-100" />)}
            </div>
          </div>
        </div>
      )}

      {hasAiKey && !hasResult && !generating && !insightsError && (
        <div className="py-5 text-center">
          <p className="text-sm text-gray-500">Discover your Spend Style.</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-300">
            Generate creates a profile from your recent card activity and checks your financial pace against income and your savings target.
          </p>
        </div>
      )}

      {hasResult && (
        <>
          {stale && (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
              {isProfileRecord ? (
                <>
                  Exploration and follow-ups cover <strong className="font-semibold">{storedInsights?.periodLabel ?? 'a different scope'}</strong>,
                  not what you are viewing now. Spend Style and Financial Pace keep their own analysis periods.
                </>
              ) : (
                <>
                  These cover <strong className="font-semibold">{storedInsights?.periodLabel ?? 'a different scope'}</strong>,
                  not what you are viewing now. Follow-ups still answer against the older scope.
                </>
              )}
              <button
                onClick={onGenerate}
                disabled={generating}
                className="mt-1.5 block font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950 disabled:opacity-60"
              >
                Re-analyze for {scopeLabel}
              </button>
            </div>
          )}

          <div className={`flex flex-col gap-3 transition-opacity ${generating ? 'opacity-50' : ''}`}>
            {isProfileRecord ? (
              <>
                <SpendStyleProfile profile={storedInsights.profile} scope={storedInsights.profileScope} />
                <FinancialPaceCard pace={storedInsights.financialPace} scope={storedInsights.financialScope} />
                <ExploreChoices
                  prompt={storedInsights.explorePrompt}
                  options={storedInsights.exploreOptions}
                  disabled={!hasAiKey || chatLoading || generating}
                  onChoose={chooseExploreOption}
                />
              </>
            ) : (
              <div className="flex flex-col gap-2.5">
                {insights.map((insight, index) => (
                  <div key={index} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3.5">
                    <p className="mb-1.5 text-[13px] font-semibold text-gray-900">{insight.title}</p>
                    <p className="text-[12.5px] leading-relaxed text-gray-600">{insight.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-gray-100 pt-3.5">
            <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-gray-400">
              Ask a follow-up
            </p>

            {(chatMessages.length > 0 || pendingQuestion) && (
              <div ref={chatRef} className="mb-3 flex max-h-64 flex-col gap-2.5 overflow-y-auto">
                {chatMessages.map((message, index) => (
                  <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] whitespace-pre-wrap px-3 py-2 text-[12.5px] leading-relaxed ${
                      message.role === 'user'
                        ? 'rounded-xl rounded-br-sm bg-violet-600 text-white'
                        : 'rounded-xl rounded-bl-sm bg-gray-100 text-gray-700'
                    }`}>
                      {message.content}
                    </div>
                  </div>
                ))}
                {pendingQuestion && (
                  <div className="flex justify-end">
                    <div className="max-w-[88%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-violet-600 px-3 py-2 text-[12.5px] leading-relaxed text-white opacity-70">
                      {pendingQuestion}
                    </div>
                  </div>
                )}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-xl rounded-bl-sm bg-gray-100 px-3 py-2 text-[12.5px] italic text-gray-400">
                      Thinking…
                    </div>
                  </div>
                )}
              </div>
            )}

            {chatError && <p className="mb-2 text-xs text-red-500">{chatError}</p>}

            <form onSubmit={onSendChat} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={event => onChatInput(event.target.value)}
                maxLength={2000}
                placeholder="Ask about your spending…"
                disabled={!hasAiKey || chatLoading}
                aria-label="Ask a follow-up about your spending"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-[12.5px] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!hasAiKey || chatLoading || !chatInput.trim()}
                className="rounded-lg bg-violet-600 px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
              >
                Send
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
