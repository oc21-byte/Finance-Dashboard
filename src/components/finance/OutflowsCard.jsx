import { useState } from 'react'
import BarList from '../shared/BarList.jsx'
import { buildOutflows } from '../../utils/financeAggregations.js'
import { SERIES_COLORS } from '../../utils/financeChartModel.js'

const TOP_N = 6
const money = n => '$' + Math.round(n).toLocaleString()

/**
 * "Where it went" — expense rows grouped by payee.
 *
 * Expenses only. Savings and investment transfers also leave the account but they are allocation,
 * not spending, and they get their own card below; mixing them in here would report a good saving
 * month as a heavy spending one and would double-count against that card.
 *
 * Card payments arrive here as a single bucket (see `payeeOf`) because each issuer words them
 * differently and they are all the same event. What was actually bought on the card is a card-side
 * question, which is why the subtitle points at the Spend Analyzer.
 */
export default function OutflowsCard({ rows, filters, onFilter }) {
  const [expanded, setExpanded] = useState(false)

  const ranked = buildOutflows(rows)
  const shown = expanded ? ranked : ranked.slice(0, TOP_N)
  const max = ranked[0]?.amount || 1
  const active = filters.payees ?? []

  return (
    <BarList
      title="Where it went"
      subtitle="Bank-side spending by description · savings and investments appear below; card detail lives on the Spend Analyzer."
      rows={shown.map(row => ({
        name: row.name,
        meta: `${money(row.amount)} · ${Math.round(row.share * 100)}%`,
        width: `${(row.amount / max) * 100}%`,
        color: SERIES_COLORS.expenses,
      }))}
      isActive={name => active.includes(name)}
      onSelect={name => onFilter('payees', name)}
      empty="No spending in this scope."
      footer={
        ranked.length > TOP_N && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-1 self-start text-[12.5px] font-medium text-blue-600 hover:text-blue-700"
          >
            {expanded ? 'Show top 6' : `+ ${ranked.length - TOP_N} more outflow type${ranked.length - TOP_N === 1 ? '' : 's'}`}
          </button>
        )
      }
    />
  )
}
