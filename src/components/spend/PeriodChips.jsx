import { PERIOD_KEYS } from '../../utils/period.js'

/**
 * The period selector: a rolling range, not the single month the page used to offer.
 *
 * Keys the ledger cannot cover are disabled rather than hidden — a user with three months of
 * statements should be able to see that 1Y exists and why it is unavailable, instead of watching
 * chips appear as they import more.
 *
 * `compact` is the pinned form: label and meta drop away, since by then the range is established
 * and the chips only need to stay reachable.
 */
export default function PeriodChips({ value, onChange, range, txCount, monthsAvailable, compact }) {
  return (
    <div className={`flex items-center flex-wrap ${compact ? 'gap-2' : 'gap-3'}`}>
      {!compact && <span className="text-sm font-medium text-gray-500">Period</span>}
      <div
        className={`flex gap-0.5 bg-white border border-gray-200 rounded-lg ${compact ? 'p-0' : 'p-0.5'}`}
        title={compact ? range.label : undefined}
      >
        {PERIOD_KEYS.map(key => {
          const active = key === value
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              aria-pressed={active}
              className={`rounded-md font-semibold transition-colors ${
                compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
              } ${
                active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {key}
            </button>
          )
        })}
      </div>
      {!compact && (
        <span className="text-sm text-gray-400">
          {range.monthCount > 0
            ? `${range.monthCount} month${range.monthCount === 1 ? '' : 's'} · ${txCount} transaction${txCount === 1 ? '' : 's'}`
            : 'no transactions in range'}
          {monthsAvailable > 0 && range.monthCount >= monthsAvailable && value !== 'All' && (
            <span className="text-gray-300"> · all available history</span>
          )}
        </span>
      )}
    </div>
  )
}
