/**
 * The active-scope strip: every chip currently narrowing the page.
 *
 * It hosts two different kinds of narrowing, deliberately in one place. Filter chips (category,
 * card, merchant) re-scope the whole page — KPIs, charts, insights. The review toggles
 * (uncategorized, possible duplicates) narrow only the transaction table, because they are about
 * fixing rows rather than analysing spend, and folding them into the headline numbers would make
 * "total spent" mean something different depending on a housekeeping switch. The `note` on those
 * chips says so on screen rather than leaving it to be inferred.
 */
export default function FilterBar({ chips, summary, onClearAll }) {
  if (!chips.length) return null

  return (
    <div className="flex items-center gap-2 flex-wrap px-3.5 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
      <span className="text-xs font-medium text-blue-700">Filtered by</span>

      {chips.map(chip => (
        <button
          key={chip.key}
          onClick={chip.onRemove}
          title={chip.note ? `${chip.label} — ${chip.note}` : `Remove ${chip.label}`}
          className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 bg-white border border-blue-200 rounded-full text-xs font-medium text-blue-700 hover:border-blue-400 hover:bg-blue-50 transition-colors max-w-[280px]"
        >
          <span className="truncate">{chip.label}</span>
          {chip.note && <span className="text-blue-300 font-normal shrink-0">{chip.note}</span>}
          <span className="opacity-50 shrink-0">✕</span>
        </button>
      ))}

      <span className="text-xs text-blue-500">{summary}</span>

      <button
        onClick={onClearAll}
        className="ml-auto text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
      >
        Clear all
      </button>
    </div>
  )
}
