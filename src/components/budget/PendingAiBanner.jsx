/**
 * Staged AI suggestions, unsaved.
 *
 * Nothing the budget builder returns touches `settings` until Save is pressed — the caps and
 * target below are an overlay, and every AI-set figure carries an "AI" marker so a user scanning
 * the plan can tell what they chose from what was proposed.
 *
 * The rationale is shown because the model already writes it. `/api/llm/budget-builder` has always
 * returned one and the page has always thrown it away, which meant paying for a sentence
 * explaining the numbers and then asking the user to accept them unexplained.
 */
export default function PendingAiBanner({
  timeline, rationale, saving, onSave, onDiscard,
}) {
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-700">AI</span>
        <span className="text-sm text-violet-900">
          Suggestions loaded for the <span className="font-semibold capitalize">{timeline}</span> timeline —
          review below, then save or discard.
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={onDiscard}
            disabled={saving}
            className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-50 disabled:opacity-60"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save AI budget'}
          </button>
        </div>
      </div>
      {rationale && (
        <p className="mt-2.5 border-t border-violet-200 pt-2.5 text-[12.5px] leading-relaxed text-violet-800">
          {rationale}
        </p>
      )}
    </div>
  )
}
