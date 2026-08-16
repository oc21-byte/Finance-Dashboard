import { quartersInRange, withQuarter } from '../../../utils/rewardsModel.js'
import { CATEGORY_COLORS } from '../../../constants/categories.js'
import { rate as fmtRate } from './format.js'

/**
 * The rotating-category rail card: what a Discover-style bonus was, quarter by quarter.
 *
 * The issuer publishes these one quarter at a time and you activate them by hand, so there is
 * nothing to look up — this record is the only thing that can tell the page what Q2 was. An
 * unrecorded quarter therefore scores at the card's BASE rate and says so, rather than being
 * guessed at from the neighbouring quarter or quietly dropped from the window.
 *
 * Only the quarters the window on screen actually touches are listed, in the order they happened.
 */
export default function RotatingQuarters({
  cards,
  wallet = {},
  range,
  currentQuarter,
  categories = [],
  demoMode = false,
  onEntryChange,
}) {
  const rotating = cards.filter(c => c.rotating)
  if (!rotating.length) return null

  const quarters = quartersInRange(range).sort((a, b) => a.key.localeCompare(b.key))
  if (!quarters.length) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <h3 className="text-[13.5px] font-semibold text-gray-900">Rotating categories</h3>
      <p className="mt-1 text-[11.5px] leading-relaxed text-gray-400">
        Only you know which category was active. A quarter left blank earns the base rate here.
      </p>

      {rotating.map(card => {
        const entry = wallet[card.sourceName]
        // A resolved card always has an entry — it is what resolved it. Guarded anyway because
        // `withQuarter` on a missing entry would write back a wallet row with no `catalogId`,
        // silently unlinking the card it was meant to annotate.
        if (!entry) return null
        const recorded = entry.quarters ?? {}
        // A category recorded in an earlier quarter stays offered even if this window's filters
        // have since removed it — otherwise editing one quarter could silently drop another.
        const options = [...new Set([...categories, ...Object.values(recorded)])].sort()

        return (
          <div key={card.sourceName} className="mt-3.5 pt-3.5 border-t border-gray-100 first:border-0 first:mt-2 first:pt-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-medium text-gray-800">{card.short}</span>
              <span className="text-[11px] text-gray-400">
                {fmtRate(card.rotating.pct)} · else {fmtRate(card.base)}
              </span>
            </div>

            <div className="mt-2 flex flex-col gap-1.5">
              {quarters.map(({ key, months }) => {
                const held = recorded[key] ?? ''
                const live = key === currentQuarter
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-[62px] shrink-0 text-[11.5px] text-gray-500">
                      {key.replace('-', ' ')}
                      {live && <span className="ml-1 text-[9.5px] uppercase tracking-wide text-violet-600">live</span>}
                    </span>
                    <select
                      value={held}
                      disabled={demoMode}
                      onChange={e => onEntryChange(card.sourceName, withQuarter(entry, key, e.target.value))}
                      aria-label={`${card.short} bonus category for ${key}`}
                      className={`flex-1 min-w-0 text-[12px] rounded-md border px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-gray-50 disabled:text-gray-400 ${
                        held ? 'border-gray-200 bg-white text-gray-800' : 'border-dashed border-gray-300 bg-white text-gray-400'
                      }`}
                    >
                      <option value="">Not recorded</option>
                      {options.map(category => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                    {held && (
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: CATEGORY_COLORS[held] ?? '#94a3b8' }}
                        title={`${months} month${months === 1 ? '' : 's'} of this window`}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
