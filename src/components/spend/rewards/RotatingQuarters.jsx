import {
  quartersInRange, withQuarter, rotatingQuarterFor, calendarRangeOf, cardById, rotatingUsage,
} from '../../../utils/rewardsModel.js'
import { CATEGORY_COLORS } from '../../../constants/categories.js'
import { money, dollars, rate as fmtRate } from './format.js'

/**
 * The rotating-category rail card: what a Discover-style bonus covered, quarter by quarter.
 *
 * The calendar is PUBLISHED data — announced a quarter ahead and identical for every holder — so it
 * ships in the catalog and this card just reports it. Asking a user to retype a fact we already
 * have was the original mistake here.
 *
 * Three states, and they are different things:
 *
 *   published    From the catalog. Read-only, and shows every category the quarter covers.
 *   unannounced  Later than anything the calendar holds: the issuer has not said yet. A fact about
 *                the world, not an unanswered question, so it scores at base without nagging.
 *   missing      Earlier than the calendar reaches. It happened; we just do not have it. A 1Y
 *                window hits this every time, and calling it "not announced yet" would be false.
 *   yours        A card with no calendar at all. The old dropdown, unchanged.
 *
 * Whether the bonus was activated is deliberately not modelled: this assumes it was. Discover and
 * Chase both require activating each quarter, so a quarter you forgot is overstated here.
 */
export default function RotatingQuarters({
  cards,
  wallet = {},
  spendTxs = [],
  cardRewards = {},
  range,
  currentQuarter,
  categories = [],
  custom = {},
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
        Published quarters come from the card catalog. Each quarter&rsquo;s cap is shared across
        everything it covers.
      </p>

      {rotating.map(card => {
        const entry = wallet[card.sourceName]
        // A resolved card always has an entry — it is what resolved it. Guarded anyway because
        // `withQuarter` on a missing entry would write back a wallet row with no `catalogId`,
        // silently unlinking the card it was meant to annotate.
        if (!entry) return null
        const catalog = cardById(entry.catalogId, custom)
        const span = calendarRangeOf(catalog)
        const recorded = entry.quarters ?? {}
        // A category recorded in an earlier quarter stays offered even if this window's filters
        // have since removed it — otherwise editing one quarter could silently drop another.
        const options = [...new Set([...categories, ...Object.values(recorded)])].sort()
        // How much of each quarter's allowance actually got used. This is the thing a long window
        // makes impossible to see by eye: the bonus moved every quarter and the cap reset with it,
        // so one aggregate number for "what Discover earned" hides whether you ever used it.
        const usage = new Map(rotatingUsage(spendTxs, card.sourceName, cardRewards, range).map(u => [u.quarterKey, u]))

        return (
          <div key={card.sourceName} className="mt-3.5 pt-3.5 border-t border-gray-100 first:border-0 first:mt-2 first:pt-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-medium text-gray-800">{card.short}</span>
              <span className="text-[11px] text-gray-400">
                {fmtRate(card.rotating.pct)} to {dollars(card.rotating.capQtr ?? 0)}/qtr
              </span>
            </div>
            {/* Said per card, because two cards can have calendars reaching different distances
                back. A window older than this is not a card that earned nothing — it is a quarter
                we do not have, and the two look identical unless one of them says so. */}
            {span && (
              <div className="mt-0.5 text-[10.5px] text-gray-400">
                Calendar covers {span.from.replace('-', ' ')} – {span.to.replace('-', ' ')}
              </div>
            )}

            <div className="mt-2 flex flex-col gap-2">
              {quarters.map(({ key, months }) => {
                const { source, entries } = rotatingQuarterFor(catalog, entry, key)
                const live = key === currentQuarter
                const use = usage.get(key)

                return (
                  <div key={key} className="flex items-start gap-2">
                    <span className="w-[62px] shrink-0 pt-0.5 text-[11.5px] text-gray-500">
                      {key.replace('-', ' ')}
                      {live && <span className="ml-1 text-[9.5px] uppercase tracking-wide text-violet-600">live</span>}
                    </span>

                    <span className="flex-1 min-w-0">
                      {source === 'catalog' ? (
                        <>
                        <span className="flex flex-wrap gap-1">
                          {entries.map(([category, meta]) => (
                            <span
                              key={category}
                              title={meta.note ? `${category} — ${meta.note}` : category}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-50 border border-gray-200 text-[11px] text-gray-700"
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ background: CATEGORY_COLORS[category] ?? '#94a3b8' }}
                              />
                              {category}
                              {meta.coverage === 'partial' && <sup className="text-gray-400">†</sup>}
                            </span>
                          ))}
                        </span>
                          {use && use.cap > 0 && (
                            <span className="mt-1 flex items-center gap-1.5">
                              <span className="flex-1 h-1 rounded-full bg-gray-100 overflow-hidden max-w-[110px]">
                                <span
                                  className="block h-full rounded-full"
                                  style={{ width: `${use.used * 100}%`, background: use.used > 0 ? '#8b5cf6' : 'transparent' }}
                                />
                              </span>
                              <span className="text-[10px] text-gray-400 whitespace-nowrap">
                                {use.scored > 0
                                  ? <>{dollars(use.scored)} of {dollars(use.cap)} · {money(use.earned)}</>
                                  : <>nothing eligible</>}
                              </span>
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {source === 'unpublished' && (
                            <span className="block text-[11px] text-gray-400 mb-1">
                              Not announced yet
                            </span>
                          )}
                          {source === 'missing' && (
                            <span className="block text-[11px] text-gray-400 mb-1">
                              Before our calendar — record it if you remember
                            </span>
                          )}
                          <select
                            value={recorded[key] ?? ''}
                            disabled={demoMode}
                            onChange={e => onEntryChange(card.sourceName, withQuarter(entry, key, e.target.value))}
                            aria-label={`${card.short} bonus category for ${key}`}
                            className={`w-full text-[12px] rounded-md border px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-gray-50 disabled:text-gray-400 ${
                              recorded[key]
                                ? 'border-gray-200 bg-white text-gray-800'
                                : 'border-dashed border-gray-300 bg-white text-gray-400'
                            }`}
                          >
                            <option value="">Not recorded</option>
                            {options.map(category => (
                              <option key={category} value={category}>{category}</option>
                            ))}
                          </select>
                        </>
                      )}
                    </span>

                    <span className="shrink-0 pt-0.5 text-[10px] text-gray-300" title={`${months} month${months === 1 ? '' : 's'} of this window`}>
                      {months}m
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <p className="mt-3.5 pt-3 border-t border-gray-100 text-[11px] leading-relaxed text-gray-400">
        <span className="text-gray-500">†</span> covers only part of the category. Assumes you
        activated the bonus each quarter — if you forgot one, that quarter is overstated here.
      </p>
    </div>
  )
}
