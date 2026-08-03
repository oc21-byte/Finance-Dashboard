import { useEffect, useRef } from 'react'
import dayjs from 'dayjs'

/**
 * AI insights and their follow-up chat, in the sticky right rail.
 *
 * The insights themselves live server-side (`db.spendInsights`), because switching tabs unmounts
 * this page. `scopeKey` identifies the range and filters currently on screen; when it differs from
 * the scope the stored insights were generated under, the panel says so rather than letting stale
 * analysis pass as current — and follow-ups keep answering against the *stored* scope, since the
 * server refuses to append a reply to insights generated under different data.
 */
export default function AiInsightsPanel({
  hasAiKey, storedInsights, insights, insightsPeriod, chatMessages,
  scopeKey, scopeLabel,
  insightsError, chatError, chatInput, chatLoading, pendingQuestion,
  generating, clearing,
  onGenerate, onClear, onSendChat, onChatInput, onOpenSettings,
}) {
  const stale = insights.length > 0 && insightsPeriod !== scopeKey
  const chatRef = useRef(null)

  // Pin the transcript to the newest message. Without this the reply lands below the fold of a
  // 16rem box and reads as if nothing happened.
  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatMessages.length, pendingQuestion, chatLoading])

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-gray-900">AI Insights</h2>
          <span className="text-[10.5px] px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded font-semibold">AI</span>
        </div>
        {hasAiKey && (
          <div className="flex items-center gap-1">
            {insights.length > 0 && (
              <button
                onClick={onClear}
                disabled={clearing || generating}
                title="Discard these insights and the conversation"
                className="px-2 py-1 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md disabled:opacity-60 transition-colors"
              >
                Clear
              </button>
            )}
            <button
              onClick={onGenerate}
              disabled={generating}
              className="px-3 py-1.5 text-xs font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-60 transition-colors flex items-center gap-1.5"
            >
              {generating ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Analyzing…
                </>
              ) : insights.length > 0 ? 'Refresh' : 'Generate'}
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 leading-relaxed mb-3">
        Based on {scopeLabel}.
        {storedInsights?.generatedAt && insights.length > 0 && (
          <span className="block mt-0.5 text-gray-300">
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
              className="mt-2.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Open Settings
            </button>
          )}
        </div>
      )}

      {hasAiKey && insightsError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3">
          {insightsError}
        </div>
      )}

      {/* Placeholder cards rather than a spinner: the panel keeps its height, so the charts beside
          it don't reflow when the real cards land. */}
      {hasAiKey && generating && insights.length === 0 && (
        <div className="flex flex-col gap-2.5" aria-hidden>
          {[0, 1, 2].map(i => (
            <div key={i} className="border border-gray-100 bg-gray-50/60 rounded-lg p-3.5 animate-pulse">
              <div className="h-3 w-1/2 bg-gray-200 rounded mb-2.5" />
              <div className="h-2.5 w-full bg-gray-100 rounded mb-1.5" />
              <div className="h-2.5 w-4/5 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      )}

      {hasAiKey && insights.length === 0 && !generating && !insightsError && (
        <div className="py-4 text-center">
          <p className="text-sm text-gray-400">No insights for this scope yet.</p>
          <p className="text-xs text-gray-300 mt-1 leading-relaxed">
            Generate reads the {scopeLabel.toLowerCase().startsWith('all') ? 'whole ledger' : 'period'} and
            your active filters, then you can ask follow-ups.
          </p>
        </div>
      )}

      {insights.length > 0 && (
        <>
          {stale && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5 mb-3 leading-relaxed">
              These cover <strong className="font-semibold">{storedInsights?.periodLabel ?? 'a different scope'}</strong>,
              not what you're viewing now. Follow-ups still answer against the older scope.
              <button
                onClick={onGenerate}
                disabled={generating}
                className="block mt-1.5 font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950 disabled:opacity-60"
              >
                Re-analyze for {scopeLabel}
              </button>
            </div>
          )}

          <div className={`flex flex-col gap-2.5 transition-opacity ${generating ? 'opacity-50' : ''}`}>
            {insights.map((insight, i) => (
              <div key={i} className="border border-gray-100 bg-gray-50/60 rounded-lg p-3.5">
                <p className="text-[13px] font-semibold text-gray-900 mb-1.5">{insight.title}</p>
                <p className="text-[12.5px] text-gray-600 leading-relaxed">{insight.body}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-100 mt-4 pt-3.5">
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2.5">
              Ask a follow-up
            </p>

            {(chatMessages.length > 0 || pendingQuestion) && (
              <div ref={chatRef} className="flex flex-col gap-2.5 mb-3 max-h-64 overflow-y-auto">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-violet-600 text-white rounded-xl rounded-br-sm'
                        : 'bg-gray-100 text-gray-700 rounded-xl rounded-bl-sm'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {pendingQuestion && (
                  <div className="flex justify-end">
                    <div className="max-w-[88%] px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap bg-violet-600 text-white rounded-xl rounded-br-sm opacity-70">
                      {pendingQuestion}
                    </div>
                  </div>
                )}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 text-gray-400 px-3 py-2 rounded-xl rounded-bl-sm text-[12.5px] italic">
                      Thinking…
                    </div>
                  </div>
                )}
              </div>
            )}

            {chatError && <p className="text-xs text-red-500 mb-2">{chatError}</p>}

            <form onSubmit={onSendChat} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => onChatInput(e.target.value)}
                placeholder="Ask about your spend…"
                disabled={chatLoading}
                className="flex-1 min-w-0 text-[12.5px] border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="px-3.5 py-2 text-[12.5px] font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-60 transition-colors"
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
