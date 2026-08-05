import { useState } from 'react'
import BarList from '../shared/BarList.jsx'
import { buildInflows } from '../../utils/financeAggregations.js'
import { SERIES_COLORS } from '../../utils/financeChartModel.js'

const TOP_N = 6
const money = n => '$' + Math.round(n).toLocaleString()

/**
 * "Where money came from" — income rows grouped by payee.
 *
 * Also hosts the card-credits row and its setting, because this is the one place on the page
 * where the question "does this count as income?" is actually being asked. The row is drawn in a
 * lighter green than the payee bars: it is money back, and it is not a bank inflow at all until
 * the user says it is.
 */
export default function InflowsCard({
  rows, cardCredits, countCredits, onToggleCredits, creditsDisabled, filters, onFilter,
}) {
  const [expanded, setExpanded] = useState(false)

  const ranked = buildInflows(rows)
  const shown = expanded ? ranked : ranked.slice(0, TOP_N)
  const max = ranked[0]?.amount || 1
  const active = filters.payees ?? []

  const barRows = shown.map(row => ({
    name: row.name,
    meta: `${money(row.amount)} · ${Math.round(row.share * 100)}%`,
    width: `${(row.amount / max) * 100}%`,
    color: SERIES_COLORS.income,
  }))

  // Credits sit at the bottom regardless of size — they are a different kind of thing from the
  // payee rows above, not just a smaller one.
  if (cardCredits > 0) {
    barRows.push({
      name: 'Card credits',
      meta: `${money(cardCredits)}${countCredits ? '' : ' · not counted'}`,
      width: `${(cardCredits / max) * 100}%`,
      color: SERIES_COLORS.credits,
    })
  }

  return (
    <BarList
      title="Where money came from"
      subtitle="Income grouped by description. Click a row to filter the page."
      rows={barRows}
      isActive={name => active.includes(name)}
      onSelect={name => name !== 'Card credits' && onFilter('payees', name)}
      empty="No income in this scope."
      footer={
        <>
          {ranked.length > TOP_N && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="mt-1 self-start text-[12.5px] font-medium text-blue-600 hover:text-blue-700"
            >
              {expanded ? 'Show top 6' : `+ ${ranked.length - TOP_N} more income source${ranked.length - TOP_N === 1 ? '' : 's'}`}
            </button>
          )}
          {cardCredits > 0 && (
            <label className="flex items-start gap-2 mt-3 pt-3 border-t border-gray-100 cursor-pointer">
              <input
                type="checkbox"
                checked={countCredits}
                disabled={creditsDisabled}
                onChange={e => onToggleCredits(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-lime-600 focus:ring-lime-500 disabled:opacity-50"
              />
              <span className="text-[11.5px] text-gray-400 leading-relaxed">
                Count card credits toward income and net cash. Off by default: a statement credit
                makes your card bill smaller, and that bill is already an expense here, so adding it
                to income too counts the same money twice.
              </span>
            </label>
          )}
        </>
      }
    />
  )
}
