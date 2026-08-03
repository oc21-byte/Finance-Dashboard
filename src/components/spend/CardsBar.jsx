import { useMemo, useState } from 'react'
import { buildCardTotals } from '../../utils/spendAggregations.js'

const money = n => '$' + Math.round(n).toLocaleString()

/**
 * Card share of period spend as a single 100%-wide stack, plus a legend.
 *
 * Stack and legend are one control in two places — hovering either lifts that card in both, and
 * clicking either filters the page. Colours are the same ones "Spend over time" uses in By card
 * mode, so a card is one colour everywhere on the page.
 *
 * A share label is only drawn inside its own segment when the segment is wide enough to hold it;
 * below that the number would overflow onto its neighbour and read as the wrong card's figure.
 */
export default function CardsBar({ spendTxs, cardColors, filters, onFilter }) {
  const [hovered, setHovered] = useState(null)
  const ranked = useMemo(() => buildCardTotals(spendTxs), [spendTxs])
  const total = ranked.reduce((sum, c) => sum + c.amount, 0)

  if (!ranked.length) return null

  const focus = hovered ?? (filters.cards.length === 1 ? filters.cards[0] : null)
  const hoverProps = name => ({
    onMouseEnter: () => setHovered(name),
    onMouseLeave: () => setHovered(h => (h === name ? null : h)),
  })

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 className="text-[15px] font-semibold text-gray-900">Cards</h2>
      <p className="mt-1 mb-4 text-[12.5px] text-gray-400">
        Share of period spend · click a card to filter the whole page to it
      </p>

      <div className="flex h-9 rounded-lg overflow-hidden mb-4">
        {ranked.map(c => {
          const share = total > 0 ? c.amount / total : 0
          const on = filters.cards.includes(c.name)
          return (
            <button
              key={c.name}
              onClick={() => onFilter('cards', c.name)}
              {...hoverProps(c.name)}
              title={`${on ? 'Remove the' : 'Filter the page to'} ${c.name} — ${money(c.amount)} (${Math.round(share * 100)}%)`}
              className={`relative flex items-center pl-3.5 text-xs font-semibold text-white overflow-hidden whitespace-nowrap transition-all ${
                focus !== null && focus !== c.name ? 'opacity-30' : 'opacity-100'
              }`}
              style={{
                flex: Math.max(Math.round(share * 1000), 1),
                background: cardColors[c.name] || '#94a3b8',
                outline: on
                  ? '2px solid #1d4ed8'
                  : focus === c.name ? '2px solid rgba(17,24,39,.55)' : 'none',
                outlineOffset: '-2px',
                zIndex: on || focus === c.name ? 2 : undefined,
              }}
            >
              {share >= 0.08 && Math.round(share * 100) + '%'}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {ranked.map(c => {
          const on = filters.cards.includes(c.name)
          return (
            <button
              key={c.name}
              onClick={() => onFilter('cards', c.name)}
              {...hoverProps(c.name)}
              title={on ? `Remove the ${c.name} filter` : `Filter the page to ${c.name}`}
              className={`group flex items-start gap-2.5 text-left rounded-lg px-2.5 py-2 border transition-all ${
                on
                  ? 'bg-blue-50 border-blue-200'
                  : focus === c.name
                    ? 'bg-gray-100 border-gray-200'
                    : 'bg-white border-transparent'
              } ${focus !== null && focus !== c.name ? 'opacity-50' : 'opacity-100'}`}
            >
              <span
                className="rounded-sm mt-1.5 shrink-0 transition-all"
                style={{
                  background: cardColors[c.name] || '#94a3b8',
                  width: on || focus === c.name ? 12 : 9,
                  height: on || focus === c.name ? 12 : 9,
                }}
              />
              <div className="min-w-0">
                <div className={`text-[13px] truncate transition-colors ${
                  on ? 'text-blue-800 font-semibold' : 'text-gray-700 font-medium group-hover:text-gray-900 group-hover:font-semibold'
                }`}>
                  {c.name}
                </div>
                <div className={`mt-0.5 text-[12.5px] ${on ? 'text-blue-600' : 'text-gray-400'}`}>
                  {money(c.amount)} · avg ${c.avg.toFixed(0)}
                  <span className={`ml-2 text-[11px] font-semibold transition-opacity ${
                    on ? 'text-blue-600 opacity-100' : 'text-gray-500 opacity-0 group-hover:opacity-100'
                  }`}>
                    {on ? 'Filtering ✕' : 'Filter →'}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
