import { useMemo, useState } from 'react'
import { buildCandidates } from '../../../utils/rewardsModel.js'
import { REGION_LABELS } from '../../../constants/cardCatalog.js'
import { issuerArt } from './cardArt.js'
import { money, dollars } from './format.js'
import CandidatePreview from './CandidatePreview.jsx'

const VISIBLE = 9

const REGIONS = [
  { value: null, label: 'All' },
  { value: 'us', label: REGION_LABELS.us },
  { value: 'ca', label: REGION_LABELS.ca },
]

/**
 * The catalog, ranked against your actual spending.
 *
 * Ordered by yearly gain after the annual fee, so the top of the list is the card that would
 * actually pay you the most rather than the one with the biggest number on its marketing page. A
 * card that would lose you money still appears, below the line — knowing a card is not worth it is
 * as useful as knowing one is, and hiding the losers would make the list look like an endorsement.
 *
 * Collapsed by default. The wallet and the grid answer "what do I have"; this answers "what else is
 * there", which is a question you ask occasionally rather than every visit.
 */
export default function CardCatalogBrowser({
  cards,
  monthly,
  ownedIds = [],
  region = null,
  onRegionChange,
  unlinkedSources = [],
  shortWindow = false,
  demoMode = false,
  onLink,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [showAll, setShowAll] = useState(false)

  const ranked = useMemo(
    () => buildCandidates({ cards, monthly, ownedIds, region }),
    [cards, monthly, ownedIds, region],
  )

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ranked
    return ranked.filter(({ card }) =>
      `${card.name} ${card.short} ${card.issuer} ${card.summary}`.toLowerCase().includes(q))
  }, [ranked, query])

  const selected = ranked.find(r => r.card.id === selectedId) ?? null
  const shown = showAll ? matched : matched.slice(0, VISIBLE)

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50/60 transition-colors rounded-xl"
      >
        <span>
          <span className="block text-[15px] font-semibold text-gray-900">Add a card</span>
          <span className="block mt-0.5 text-[12.5px] text-gray-400">
            {ranked.length} card{ranked.length === 1 ? '' : 's'} you don&rsquo;t hold, ranked by what
            they&rsquo;d pay on your spending
          </span>
        </span>
        <span className="text-gray-400 text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-100">
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg">
              {REGIONS.map(r => (
                <button
                  key={r.label}
                  onClick={() => onRegionChange?.(r.value)}
                  className={`px-2.5 py-1 text-[12px] font-medium rounded-md transition-colors ${
                    region === r.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search cards…"
              className="flex-1 min-w-[160px] text-[13px] rounded-lg border border-gray-300 px-3 py-1.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {selected && (
            <div className="mt-4">
              <CandidatePreview
                row={selected}
                unlinkedSources={unlinkedSources}
                shortWindow={shortWindow}
                demoMode={demoMode}
                onLink={onLink}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}

          {matched.length === 0 ? (
            <p className="mt-4 text-[12.5px] text-gray-400">
              No cards match “{query}” {region && <>in {REGION_LABELS[region]}</>}.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {shown.map(({ card, net }) => {
                const active = card.id === selectedId
                return (
                  <button
                    key={card.id}
                    onClick={() => setSelectedId(active ? null : card.id)}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      active
                        ? 'border-blue-400 bg-blue-50/60 ring-1 ring-blue-200'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/60'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-7 h-5 rounded shrink-0" style={{ background: issuerArt(card.issuer) }} />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-semibold text-gray-900 leading-tight truncate">
                          {card.short}
                        </span>
                        <span className="block text-[11px] text-gray-400 truncate">{card.issuer}</span>
                      </span>
                    </span>

                    <span className="mt-2 flex items-baseline justify-between gap-2">
                      {/* Suppressed rather than shown as $0 when the window is too short to
                          annualize — a fabricated ranking is worse than an absent one. */}
                      {shortWindow ? (
                        <span className="text-[12px] text-gray-400">Widen the period to rank</span>
                      ) : (
                        <span className={`text-[13.5px] font-semibold ${net > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                          {net > 0 ? '+' : net < 0 ? '−' : ''}{money(Math.abs(net))}
                          <span className="ml-1 text-[11px] font-normal text-gray-400">/yr</span>
                        </span>
                      )}
                      <span className="text-[11px] text-gray-400 shrink-0">
                        {card.fee ? `${dollars(card.fee)} fee` : 'No fee'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {matched.length > VISIBLE && (
            <button
              onClick={() => setShowAll(v => !v)}
              className="mt-3 text-[12.5px] font-medium text-blue-600 hover:text-blue-700"
            >
              {showAll ? 'Show fewer' : `Show all ${matched.length}`}
            </button>
          )}

          <p className="mt-4 pt-3.5 border-t border-gray-100 text-[11.5px] leading-relaxed text-gray-400">
            Ranked on your average monthly spend per category at published ongoing rates, minus the
            annual fee. Welcome bonuses are not counted.
            {cards.length === 0 && <> With nothing linked yet, each card is scored as if it were your only one.</>}
          </p>
        </div>
      )}
    </div>
  )
}
