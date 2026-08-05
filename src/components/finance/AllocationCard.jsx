import { useMemo } from 'react'
import { buildDestinations, UNASSIGNED_DESTINATION } from '../../utils/financeAggregations.js'
import { FINANCE_CATEGORY_COLORS } from '../../constants/categories.js'

const money = n => '$' + Math.round(n).toLocaleString()

const SEGMENT_COLOR = {
  Savings: FINANCE_CATEGORY_COLORS.Savings,
  Investments: FINANCE_CATEGORY_COLORS.Investments,
}

// The residual reads as absence, not as a third destination, so it gets no category colour.
const UNASSIGNED_COLOR = '#cbd5e1'

const colorOf = d => (d.name === UNASSIGNED_DESTINATION
  ? UNASSIGNED_COLOR
  : SEGMENT_COLOR[d.kind === 'savings' ? 'Savings' : 'Investments'])

/**
 * "Savings & investments" — where allocation went.
 *
 * The counterpart to "Where it went": both are money leaving checking, but this is money you still
 * have. That is why it is a separate card and why `netCash` never subtracts it — a month that moved
 * a lot into savings must not read as a month that spent a lot.
 *
 * Destinations come from the two link fields, which are set inline in the transaction table below.
 * `Unassigned` is always shown; it is the prompt to go link something.
 */
export default function AllocationCard({
  rows, months, savingsAccounts, income, hasHoldings, onLinkAccounts,
}) {
  const view = useMemo(
    () => buildDestinations(rows, savingsAccounts, months),
    [rows, savingsAccounts, months],
  )

  // Share of what came in, not of what was saved — the headline here is total allocation, so the
  // percentage has to be measured against the same total. Null rather than 0 with no income, so the
  // card omits the claim instead of printing "0% of income".
  const shareOfIncome = income > 0 ? view.total / income : null

  if (view.total === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <h2 className="text-[15px] font-semibold text-gray-900">Savings &amp; investments</h2>
        <div className="py-10 text-center">
          <p className="text-sm text-gray-400">Nothing set aside in this scope.</p>
          <p className="mt-1 text-xs text-gray-300">
            Categorize a transfer as Savings or Investments and it will show up here.
          </p>
        </div>
      </div>
    )
  }

  const segments = view.segments.filter(s => s.amount > 0)

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <div className="flex items-start justify-between gap-5 mb-1 flex-wrap">
        <h2 className="text-[15px] font-semibold text-gray-900">Savings &amp; investments</h2>
        <div className="text-right">
          <div className="text-xl font-semibold tracking-tight text-gray-900">{money(view.total)}</div>
          <div className="text-[11px] text-gray-400">
            {money(view.perMonth)}/mo
            {shareOfIncome != null && ` · ${Math.round(shareOfIncome * 100)}% of income`}
          </div>
        </div>
      </div>
      <p className="text-[12.5px] leading-relaxed text-gray-400 max-w-[760px] mb-5">
        Money that left checking but wasn't spent. It is allocation, not expense, so it is never
        subtracted from net cash — and it is deliberately absent from "Where it went".
      </p>

      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
        {segments.map(segment => (
          <div
            key={segment.key}
            title={`${segment.label} — ${money(segment.amount)} (${Math.round(segment.share * 100)}%)`}
            style={{ width: `${segment.share * 100}%`, background: SEGMENT_COLOR[segment.key] }}
          />
        ))}
      </div>
      <div className="flex items-center gap-5 flex-wrap mt-2.5">
        {segments.map(segment => (
          <div key={segment.key} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SEGMENT_COLOR[segment.key] }} />
            <span className="text-[12.5px] font-medium text-gray-700">{segment.label}</span>
            <span className="text-[12.5px] text-gray-500 tabular-nums">{money(segment.amount)}</span>
            <span className="text-[12.5px] text-gray-400 tabular-nums">
              {Math.round(segment.share * 100)}%
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-3 mt-5 pt-4 border-t border-gray-100">
        {view.destinations.map(destination => (
          <div key={destination.key} className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorOf(destination) }} />
              <span className="text-[12.5px] font-medium text-gray-700 truncate">{destination.name}</span>
            </div>
            <div className="mt-0.5 pl-4 text-[12.5px] text-gray-500 tabular-nums">
              {money(destination.amount)}
              <span className="text-gray-400">
                {' · '}{destination.transfers} transfer{destination.transfers === 1 ? '' : 's'}
                {destination.perMonth > 0 && ` · ${money(destination.perMonth)}/mo`}
              </span>
            </div>
          </div>
        ))}
      </div>

      {view.unassigned > 0 && (
        <p className="mt-4 pt-3.5 border-t border-gray-100 text-[12.5px] text-gray-400">
          {money(view.unassigned)} isn't linked to an account yet — link a transfer in the table
          below to see where it landed.
          {!hasHoldings && onLinkAccounts && (
            <>
              {' '}
              <button
                onClick={onLinkAccounts}
                className="font-medium text-blue-600 hover:text-blue-700"
              >
                Add an investment account
              </button>
              {' first, and the linker will appear.'}
            </>
          )}
        </p>
      )}
    </div>
  )
}
