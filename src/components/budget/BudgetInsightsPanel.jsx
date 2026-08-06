import { useEffect, useRef } from 'react'
import dayjs from 'dayjs'
import ExploreChoices from '../shared/ExploreChoices.jsx'
import PlannedRateCard from './PlannedRateCard.jsx'

const STATUS_TINT = {
  watch: 'border-rose-100 bg-rose-50/40',
  steady: 'border-gray-100 bg-gray-50/60',
  good: 'border-emerald-100 bg-emerald-50/40',
}

const STALE_COPY = {
  scope: 'a different data window',
  plan: 'an earlier version of your plan',
}

/**
 * The Budget tab's docked rail.
 *
 * Presentational, like the other three tabs' panels — every figure arrives already computed and
 * chat state lives in the page. The deterministic plan-health block sits above the generated copy
 * on purpose: it is true whether or not anything has been generated, and it is what the AI half is
 * writing about.
 */
export default function BudgetInsightsPanel({
  plan, hasAiKey, record, chatMessages, staleReason,
  insightsError, chatError, chatInput, chatLoading, pendingQuestion,
  generating, clearing,
  onGenerate, onClear, onSendChat, onExplore, onChatInput, onOpenSettings,
}) {
  const hasResult = !!record?.observations?.length
  const chatRef = useRef(null)

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatMessages.length, pendingQuestion, chatLoading])

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-gray-900">Plan health</h2>
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
        {plan.income.windowLabel
          ? `Your plan against ${plan.income.windowLabel} averages.`
          : 'Your plan against your recorded activity.'}
        {record?.generatedAt && hasResult && (
          <span className="mt-0.5 block text-gray-300">
            Saved {dayjs(record.generatedAt).format('MMM D, h:mm A')}
          </span>
        )}
      </p>

      {/* Deterministic and always shown — this block never depends on a generation. */}
      <PlannedRateCard plan={plan} />

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
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {insightsError}
        </div>
      )}

      {hasAiKey && generating && !hasResult && (
        <div className="mt-3 flex flex-col gap-2.5" aria-hidden>
          {[0, 1].map(item => (
            <div key={item} className="animate-pulse rounded-lg border border-gray-100 bg-gray-50/60 p-3.5">
              <div className="mb-2 h-3 w-3/5 rounded bg-gray-200" />
              <div className="h-2.5 w-full rounded bg-gray-100" />
            </div>
          ))}
        </div>
      )}

      {hasAiKey && !hasResult && !generating && !insightsError && (
        <p className="mt-3 text-xs leading-relaxed text-gray-400">
          Generate reads your caps, savings commitments and goals against what the ledgers actually
          show, and explains where the plan strains.
        </p>
      )}

      {hasResult && (
        <>
          {staleReason && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
              These cover <strong className="font-semibold">{STALE_COPY[staleReason]}</strong>, not the
              plan as it stands now. Follow-ups still answer against the older version.
              <button
                onClick={onGenerate}
                disabled={generating}
                className="mt-1.5 block font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950 disabled:opacity-60"
              >
                Re-analyze the current plan
              </button>
            </div>
          )}

          <div className={`mt-3 flex flex-col gap-2.5 transition-opacity ${generating ? 'opacity-50' : ''}`}>
            {record.headline && (
              <p className="text-[13px] font-medium leading-relaxed text-gray-900">{record.headline}</p>
            )}
            {record.observations.map(item => (
              <div key={item.key} className={`rounded-lg border p-3.5 ${STATUS_TINT[item.status] ?? STATUS_TINT.steady}`}>
                <p className="mb-1.5 text-[13px] font-semibold text-gray-900">{item.title}</p>
                <p className="text-[12.5px] leading-relaxed text-gray-600">{item.body}</p>
              </div>
            ))}
            <ExploreChoices
              prompt={record.explorePrompt}
              options={record.exploreOptions}
              disabled={!hasAiKey || chatLoading || generating}
              onChoose={onExplore}
            />
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
                placeholder="Ask about your budget…"
                disabled={!hasAiKey || chatLoading}
                aria-label="Ask a follow-up about your budget"
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

      <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
        This is what the plan <span className="font-medium text-gray-500">intends</span> to set aside.
        The Spend Analyzer&rsquo;s Financial Pace shows what the ledger says you{' '}
        <span className="font-medium text-gray-500">actually</span> saved.
      </p>
    </div>
  )
}
