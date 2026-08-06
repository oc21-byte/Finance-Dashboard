import { buildAccountTypeColors, UNKNOWN_ACCOUNT } from '../dashboard/palette.js'

/**
 * Filter the ranked holdings by account type.
 *
 * The chips are built from `model.accountTypes`, which is the rollup the donut draws from — so a
 * chip can never offer a filter that empties the table, which the old `<select>` (populated from a
 * fixed eight-entry list) regularly did.
 *
 * Allocation stays unfiltered on purpose, per the mockup: the donut is the whole picture, and the
 * chip says which part of it the table is showing.
 */
export default function AccountChips({ accountTypes, value, onChange }) {
  if (accountTypes.length < 2) return null

  const colors = buildAccountTypeColors(accountTypes)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-gray-500">Account</span>
      {['All', ...accountTypes].map(type => {
        const active = value === type
        return (
          <button
            key={type}
            onClick={() => onChange(type)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800'
            }`}
          >
            {type !== 'All' && (
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: active ? 'rgba(255,255,255,.85)' : colors[type] ?? UNKNOWN_ACCOUNT }}
              />
            )}
            {type}
          </button>
        )
      })}
      <span className="text-[11.5px] text-gray-400">
        Filters the ranked list. Allocation stays unfiltered.
      </span>
    </div>
  )
}
