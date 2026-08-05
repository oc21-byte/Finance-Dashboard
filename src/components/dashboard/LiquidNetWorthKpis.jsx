import dayjs from 'dayjs'
import InfoTip from './InfoTip.jsx'
import Sparkline from './Sparkline.jsx'
import { BUCKETS, deltaArrow, deltaClass } from './palette.js'

const money = n => Math.abs(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
const signed = n => `${n < 0 ? '−' : ''}$${money(n)}`

/** One trailing-window delta, as `▲ $4,210 · +3.3% in 30 days`. */
function Delta({ delta, days, suffix = true }) {
  if (!delta) return <p className="mt-1 text-[11px] text-gray-400">No earlier reading yet</p>
  const { abs, pct } = delta
  if (!abs) return <p className="mt-1 text-[11px] text-gray-400">Unchanged in {days} days</p>
  return (
    <p className={`mt-1 text-[11px] ${deltaClass(abs)}`}>
      {deltaArrow(abs)} {signed(abs)}
      {pct !== null && ` · ${abs > 0 ? '+' : '−'}${Math.abs(pct)}%`}
      {suffix && ` in ${days} days`}
    </p>
  )
}

function Label({ children, tip, tipLabel }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
      {children}
      {tip && <InfoTip label={tipLabel}>{tip}</InfoTip>}
    </div>
  )
}

/**
 * The four headline balances: liquid net worth, and the three buckets it is made of.
 *
 * Today's figures come from live queries, not from the newest history point, so the strip agrees
 * with the rest of the app the instant a balance changes. The deltas come from history, because
 * that is the only record of the past. `buildLiquidKpis` owns that split.
 */
export default function LiquidNetWorthKpis({
  kpis,
  sparkline = [],
  monthsOfSpend = null,
  cashStatus = null,
  pricesFetching = false,
  onOpenSettings,
}) {
  const { liquid, cash, savings, portfolio, deltas, days } = kpis
  const cashShare = liquid > 0 ? Math.round((cash / liquid) * 100) : 0
  const pending = cashStatus?.uncoveredDays ?? 0

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-gray-200 bg-gray-50/60 shadow-sm sm:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr_1fr]">
      {/* Liquid net worth — the headline, lifted onto white so it reads as primary. */}
      <div className="border-b border-gray-200 bg-white p-4 sm:border-r xl:border-b-0">
        <Label
          tipLabel="liquid net worth"
          tip={
            <>
              <strong className="text-gray-800">Liquid net worth</strong> = cash + savings +
              investment accounts. Excludes property, vehicles, private or corporate shares, and
              debts.
            </>
          }
        >
          Liquid net worth
        </Label>
        <p className="mt-2 text-[31px] font-semibold leading-tight tracking-tight text-gray-900">
          ${money(liquid)}
        </p>
        <Delta delta={deltas?.liquid} days={days} />
        <div className="mt-2.5">
          <Sparkline points={sparkline} stroke={BUCKETS.portfolio.stroke} />
        </div>
      </div>

      {/* Cash — the only balance with an "as of", because it is anchored to the newest statement.
          Read-only, and deliberately so: there is no figure a user could type here that their bank
          has not already printed, and a typed number is what previously let the ledger and the
          balance drift apart with no way to tell which was wrong. */}
      {/* Borders track the grid: bottom edges while stacked or two-up, right edges once four-up. */}
      <div className="border-b border-gray-200 p-4 xl:border-b-0 xl:border-r">
        <Label
          tipLabel="cash"
          tip={
            <>
              Your chequing balance, taken from the closing balance of your newest statement plus
              every transaction since. Anything spent after{' '}
              <strong className="text-gray-800">
                {cashStatus?.asOf ? dayjs(cashStatus.asOf).format('MMM D') : 'the last statement'}
              </strong>{' '}
              is only counted once you import or add it. Not editable — record closing balances in
              Settings instead, so the figure always traces back to something your bank issued.
            </>
          }
        >
          Cash
        </Label>
        <p className="mt-2 text-[25px] font-semibold leading-tight tracking-tight text-gray-900">
          ${money(cash)}
        </p>
        <p className="mt-1 text-[11px] text-gray-500">
          {cashShare}% of total
          {monthsOfSpend !== null && ` · ${monthsOfSpend} months of spend`}
        </p>
        {/* With no statement on file the figure is a reconstruction rather than a fact, and saying
            so beats printing it with the same confidence as the three beside it. */}
        {!cashStatus?.statementCount ? (
          <button
            onClick={() => onOpenSettings?.()}
            className="mt-0.5 text-left text-[10px] font-medium text-amber-600 hover:text-amber-700"
          >
            No statement balance on file — add one
          </button>
        ) : pending > 0 && (
          <p className="mt-0.5 text-[10px] text-gray-400">
            Statement to {dayjs(cashStatus.asOf).format('MMM D')} · {pending} days pending
          </p>
        )}
      </div>

      <div className="border-b border-gray-200 p-4 sm:border-r sm:border-b-0">
        <Label>Savings</Label>
        <p className="mt-2 text-[25px] font-semibold leading-tight tracking-tight text-gray-900">
          ${money(savings)}
        </p>
        <Delta delta={deltas?.savings} days={days} />
      </div>

      <div className="p-4">
        <Label>Portfolio</Label>
        <p className="mt-2 text-[25px] font-semibold leading-tight tracking-tight text-gray-900">
          ${money(portfolio)}
        </p>
        {pricesFetching
          ? <p className="mt-1 text-[11px] text-gray-400">Fetching live prices…</p>
          : <Delta delta={deltas?.portfolio} days={days} />}
      </div>
    </div>
  )
}
