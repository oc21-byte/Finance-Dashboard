import { Sparkles } from 'lucide-react'

const TIMELINES = ['aggressive', 'balanced', 'comfortable']

/**
 * Title, data window, and the AI budget-builder controls.
 *
 * The timeline pills and Generate button sit up here rather than inside the spending-caps card
 * header, because what they produce is a whole plan — caps AND a savings target — and burying
 * them in one of the two cards they rewrite implied they only touched that one.
 */
export default function BudgetHeader({
  windowLabel, timeline, onTimelineChange,
  canGenerate, generating, onGenerate, demoMode,
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Budget</h1>
        <p className="mt-1 text-sm text-gray-400">
          Monthly cash flow{windowLabel ? ` · averages from ${windowLabel}` : ''}
        </p>
      </div>

      {canGenerate && (
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Budget timeline"
            className="flex gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5"
          >
            {TIMELINES.map(option => (
              <button
                key={option}
                onClick={() => onTimelineChange(option)}
                disabled={demoMode || generating}
                aria-pressed={timeline === option}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors disabled:opacity-60 ${
                  timeline === option
                    ? 'bg-violet-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            onClick={onGenerate}
            disabled={generating || demoMode}
            title={demoMode ? 'Unavailable in Demo Mode' : undefined}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
          >
            {generating ? (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Sparkles size={14} />
            )}
            {generating ? 'Generating…' : 'Generate with AI'}
          </button>
        </div>
      )}
    </div>
  )
}
