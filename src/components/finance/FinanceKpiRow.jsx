const money = n => '$' + Math.round(Math.abs(n)).toLocaleString()
const signedMoney = n => (n < 0 ? '−' : '+') + money(n)

function Tile({ label, value, sub, valueClass = 'text-gray-900', lead }) {
  return (
    <div className={`px-5 py-4 min-w-0 border-r border-gray-100 last:border-r-0 ${lead ? 'bg-white' : 'bg-gray-50/40'}`}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`mt-2 text-[27px] leading-tight font-semibold tracking-tight truncate ${valueClass}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-400 truncate">{sub}</div>
    </div>
  )
}

/**
 * The headline numbers for the current scope.
 *
 * Net cash leads and is tinted white against the rest of the strip: it is the one figure that
 * answers "did this period go well", and the other four are the workings behind it.
 *
 * Net cash is income − expenses. Saved and Invested are shown alongside but never subtracted —
 * they are allocation, not spending, so a month that moved a lot into savings should read as a
 * good month, not a break-even one.
 */
export default function FinanceKpiRow({ kpis, countCreditsAsIncome }) {
  const { netCash, income, expenses, saved, invested, credits, months, perMonth, savedShareOfIncome } = kpis
  const monthsLabel = months ? `${months} month${months === 1 ? '' : 's'}` : 'no complete months'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <Tile
        lead
        label="Net cash"
        value={signedMoney(netCash)}
        valueClass={netCash >= 0 ? 'text-green-600' : 'text-red-500'}
        sub={`income − expenses · ${monthsLabel}`}
      />
      <Tile
        label="Income"
        value={money(income)}
        sub={
          countCreditsAsIncome && credits > 0
            ? `${money(perMonth.income)} / mo · +${money(credits)} card credits`
            : `${money(perMonth.income)} / mo`
        }
      />
      <Tile label="Expenses" value={money(expenses)} sub={`${money(perMonth.expenses)} / mo`} />
      <Tile
        label="Saved"
        value={money(saved)}
        sub={savedShareOfIncome === null ? 'no income in range' : `${Math.round(savedShareOfIncome * 100)}% of income`}
      />
      <Tile label="Invested" value={money(invested)} sub={`${money(perMonth.invested)} / mo`} />
    </div>
  )
}
