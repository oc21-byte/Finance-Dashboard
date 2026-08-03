import { useMemo, useState } from 'react'
import { buildCategoryTotals } from '../../utils/spendAggregations.js'
import BarList from './BarList.jsx'

const TOP_N = 6
const money = n => '$' + Math.round(n).toLocaleString()

/** "Where it went" — categories ranked by spend, each row filtering the whole page. */
export default function CategoryBreakdown({ spendTxs, categoryColors, filters, onFilter }) {
  const [showAll, setShowAll] = useState(false)
  const ranked = useMemo(() => buildCategoryTotals(spendTxs), [spendTxs])

  const max = ranked[0]?.amount || 1
  const shown = showAll ? ranked : ranked.slice(0, TOP_N)
  const rows = shown.map(c => ({
    name: c.name,
    meta: `${money(c.amount)} · ${Math.round(c.share * 100)}%`,
    width: ((c.amount / max) * 100).toFixed(1) + '%',
    color: categoryColors[c.name] || '#94a3b8',
  }))

  const hidden = ranked.length - TOP_N

  return (
    <BarList
      title="Where it went"
      subtitle="Click a category to filter the whole page to it"
      rows={rows}
      onSelect={name => onFilter('categories', name)}
      isActive={name => filters.categories.includes(name)}
      empty="No spending in this scope."
      footer={hidden > 0 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="self-start text-[13px] font-medium text-blue-600 hover:text-blue-700 pt-0.5"
        >
          {showAll ? 'Show fewer' : `+ ${hidden} more categor${hidden === 1 ? 'y' : 'ies'}`}
        </button>
      )}
    />
  )
}
