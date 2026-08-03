const money = n => '$' + Math.round(n).toLocaleString()

function Tile({ label, value, sub, onClick, active, children }) {
  const body = (
    <>
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</div>
      <div className="mt-2 text-[27px] leading-tight font-semibold tracking-tight text-gray-900 truncate">
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-400 truncate">{sub}</div>
      {children}
    </>
  )

  const shared = 'px-5 py-4 text-left min-w-0 border-r border-gray-100 last:border-r-0'
  return onClick ? (
    <button
      onClick={onClick}
      aria-expanded={active}
      className={`${shared} transition-colors ${active ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}
    >
      {body}
    </button>
  ) : (
    <div className={shared}>{body}</div>
  )
}

/**
 * The headline numbers for the current scope.
 *
 * `changeVsPrior` is null whenever the ledger doesn't fully cover the preceding window — comparing
 * six months against a partial one reports a jump that is really just the data starting. In that
 * case the tile says how long the range is instead of inventing a percentage.
 */
export default function KpiRow({ kpis, range, recurring, onRecurringClick, recurringOpen }) {
  const { total, txCount, avgPerMonth, avgTransaction, topCategory, topCategoryAmount, topCategoryShare, changeVsPrior } = kpis
  const months = range.monthCount || 1

  const delta = changeVsPrior === null
    ? `over ${months} month${months === 1 ? '' : 's'}`
    : `${changeVsPrior >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(changeVsPrior * 100))}% vs prior ${range.key}`

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <Tile label="Total spent" value={money(total)} sub={delta} />
      <Tile
        label="Avg / month"
        value={money(avgPerMonth)}
        sub={`over ${months} month${months === 1 ? '' : 's'}`}
      />
      <Tile
        label="Avg transaction"
        value={txCount ? '$' + avgTransaction.toFixed(2) : '—'}
        sub={`${txCount} transaction${txCount === 1 ? '' : 's'}`}
      />
      <Tile
        label="Top category"
        value={topCategory ?? '—'}
        sub={topCategory ? `${money(topCategoryAmount)} · ${Math.round(topCategoryShare * 100)}% of spend` : ''}
      />
      <Tile
        label="Recurring"
        value={
          <>
            {money(recurring.monthlyTotal)}
            <span className="text-[15px] text-gray-400">/mo</span>
          </>
        }
        sub={
          recurring.count
            ? `${recurring.count} subscription${recurring.count === 1 ? '' : 's'} · ${recurringOpen ? 'hide' : 'view'}`
            : 'none detected'
        }
        onClick={recurring.count ? onRecurringClick : undefined}
        active={recurringOpen}
      />
    </div>
  )
}
