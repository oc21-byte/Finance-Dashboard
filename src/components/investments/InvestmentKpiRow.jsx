import { money, signedMoney, signedPct, gainClass } from './format.js'

function Tile({ label, value, valueClass = 'text-gray-900', sub, subClass = 'text-gray-400', lead }) {
  return (
    <div className={`min-w-0 border-r border-gray-100 px-5 py-4 last:border-r-0 ${lead ? 'bg-white' : 'bg-gray-50/40'}`}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`mt-2 truncate text-[27px] font-semibold leading-tight tracking-tight ${valueClass}`}>
        {value}
      </div>
      <div className={`mt-1 truncate text-xs ${subClass}`}>{sub}</div>
    </div>
  )
}

/**
 * The four headline figures, in one joined strip.
 *
 * These were three detached cards for the portfolio and two more for savings, sitting four hundred
 * lines apart with a whole table between them. Savings belongs here: it is the other half of what
 * this page holds, and burying its total below the fold made the page read as two unrelated
 * screens that happened to share a tab.
 */
export default function InvestmentKpiRow({ model, pricesFetching }) {
  const { totalValue, totalCost, totalGain, totalGainPct, totalSavings, totalAnnualInterest, rows } = model
  const fetching = pricesFetching && rows.length > 0

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        lead
        label="Portfolio value"
        value={fetching ? '—' : money(totalValue)}
        sub={fetching
          ? 'Fetching live prices…'
          : totalCost > 0
            ? `${signedMoney(totalGain)} · ${signedPct(totalGainPct)} since cost basis`
            : 'No holdings yet'}
        subClass={fetching || totalCost === 0 ? 'text-gray-400' : gainClass(totalGain)}
      />
      <Tile
        label="Cost basis"
        value={money(totalCost)}
        sub={`across ${rows.length} holding${rows.length === 1 ? '' : 's'}`}
      />
      <Tile
        label="Total gain / loss"
        value={fetching ? '—' : signedMoney(totalGain)}
        valueClass={fetching ? 'text-gray-300' : gainClass(totalGain)}
        sub={fetching ? '' : signedPct(totalGainPct)}
        subClass={fetching ? 'text-gray-400' : gainClass(totalGain)}
      />
      <Tile
        label="Savings balance"
        value={money(totalSavings)}
        sub={totalSavings > 0
          ? `${money(totalAnnualInterest)}/yr projected interest`
          : 'No savings accounts yet'}
        subClass={totalSavings > 0 ? 'text-amber-600' : 'text-gray-400'}
      />
    </div>
  )
}
