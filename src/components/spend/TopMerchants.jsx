import { useMemo, useState } from 'react'
import { buildMerchantTotals } from '../../utils/spendAggregations.js'
import { MERCHANT_BAR } from './palette.js'
import BarList from '../shared/BarList.jsx'

const TOP_N = 6
const EXPANDED_N = 20
const money = n => '$' + Math.round(n).toLocaleString()

/**
 * Top merchants by spend. Descriptions are the raw statement text — the same string the duplicate
 * detector and the merchant filter chip key on, so what you click is exactly what gets filtered.
 */
export default function TopMerchants({ spendTxs, filters, onFilter }) {
  const [showAll, setShowAll] = useState(false)
  const ranked = useMemo(() => buildMerchantTotals(spendTxs), [spendTxs])

  const max = ranked[0]?.amount || 1
  const limit = showAll ? EXPANDED_N : TOP_N
  const rows = ranked.slice(0, limit).map(m => ({
    name: m.name,
    meta: money(m.amount),
    width: ((m.amount / max) * 100).toFixed(1) + '%',
    color: MERCHANT_BAR,
  }))

  return (
    <BarList
      title="Top merchants"
      subtitle={`Top ${Math.min(limit, ranked.length)} of ${ranked.length} · click a merchant to filter the page`}
      rows={rows}
      onSelect={name => onFilter('merchants', name)}
      isActive={name => filters.merchants.includes(name)}
      empty="No spending in this scope."
      footer={ranked.length > TOP_N && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="self-start text-[13px] font-medium text-blue-600 hover:text-blue-700 pt-0.5"
        >
          {showAll ? 'Show fewer' : `+ ${ranked.length - TOP_N} more merchant${ranked.length - TOP_N === 1 ? '' : 's'}`}
        </button>
      )}
    />
  )
}
