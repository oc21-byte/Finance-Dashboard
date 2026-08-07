/**
 * The detail panel's right column: one AI read on the selected goal, then a chat thread about it.
 *
 * Presentational only — analysis text, chat messages, the input value and every loading flag are
 * owned by `Goals.jsx`, keyed by goal id so switching cards does not throw away a thread. Same
 * arrangement as the four insight panels.
 */
export default function GoalAiPanel({
  hasApiKey, analysis, analysisLoading, onAnalyze,
  messages = [], chatLoading, input, onInputChange, onSend,
}) {
  return (
    // `min-h-0` is what lets the thread below scroll instead of stretching this card past the
    // column it sits in.
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50/60 shadow-sm">
      <div className="flex flex-none items-center gap-2 border-b border-dashed border-gray-200 px-4 py-3">
        <h3 className="text-[13px] font-semibold text-gray-700">AI Analysis</h3>
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-violet-700">AI</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-4">
        {!hasApiKey ? (
          <p className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-center text-xs text-gray-400">
            Connect an AI API key in Settings to unlock goal analysis
          </p>
        ) : analysisLoading ? (
          <p className="py-2 text-center text-xs text-gray-400">Analyzing…</p>
        ) : !analysis ? (
          <button
            onClick={onAnalyze}
            className="rounded-lg border border-gray-200 px-3 py-2 text-center text-xs text-gray-500 transition-colors hover:border-gray-300 hover:bg-white"
          >
            Get AI Analysis
          </button>
        ) : (
          <>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[11.5px] leading-relaxed text-gray-600">{analysis}</p>
            </div>
            <button onClick={onAnalyze} className="w-fit text-[11px] font-medium text-gray-400 transition-colors hover:text-gray-600">
              Refresh
            </button>

            <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-dashed border-gray-200 pt-3">
              <p className="text-[9.5px] font-medium uppercase tracking-wide text-gray-400">Ask a follow-up</p>

              {(messages.length > 0 || chatLoading) && (
                <div className="min-h-0 max-h-64 flex-1 space-y-2 overflow-y-auto">
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[88%] rounded-xl px-2.5 py-1.5 text-[11px] leading-relaxed ${
                        msg.role === 'user' ? 'rounded-br-sm bg-violet-600 text-white' : 'rounded-bl-sm bg-gray-100 text-gray-700'
                      }`}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="rounded-xl rounded-bl-sm bg-gray-100 px-2.5 py-1.5 text-[11px] italic text-gray-400">Thinking…</div>
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={onSend} className="flex flex-none gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={onInputChange}
                  placeholder="E.g. How can I reach this faster?"
                  disabled={chatLoading}
                  className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={chatLoading || !input.trim()}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
                >
                  Send
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
