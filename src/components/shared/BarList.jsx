/**
 * The shared "label, amount, proportional bar" list used by Where it went and Top merchants.
 *
 * Bars are scaled against the largest row, not against the period total — with a long tail of
 * small categories, scaling to the total leaves every row but the first as an invisible sliver.
 *
 * Rows are filter controls, so they say so: the whole row lifts on hover and a "Filter" hint
 * appears in place of the amount. Without it a bar chart just looks like a bar chart.
 */
export default function BarList({ title, subtitle, rows, onSelect, isActive, footer, empty }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 mb-4 text-[12.5px] text-gray-400">{subtitle}</p>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{empty}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map(row => {
            const active = isActive?.(row.name)
            return (
              <button
                key={row.name}
                onClick={() => onSelect(row.name)}
                title={active ? `Remove the ${row.name} filter` : `Filter the page to ${row.name}`}
                className={`group block w-full text-left rounded-lg px-2 -mx-2 py-2 border transition-all ${
                  active
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-white border-transparent hover:bg-gray-100 hover:border-gray-200'
                }`}
              >
                <div className="flex justify-between items-baseline gap-3 mb-1.5">
                  <span className={`text-[13px] truncate transition-colors ${
                    active
                      ? 'text-blue-800 font-semibold'
                      : 'text-gray-700 font-medium group-hover:text-gray-900 group-hover:font-semibold'
                  }`}>
                    {row.name}
                  </span>
                  <span className="shrink-0 flex items-baseline gap-2">
                    <span className={`text-[13px] transition-colors ${active ? 'text-blue-600' : 'text-gray-500'}`}>
                      {row.meta}
                    </span>
                    <span className={`text-[11px] font-semibold whitespace-nowrap transition-opacity ${
                      active
                        ? 'text-blue-600 opacity-100'
                        : 'text-gray-500 opacity-0 group-hover:opacity-100'
                    }`}>
                      {active ? 'Filtering ✕' : 'Filter →'}
                    </span>
                  </span>
                </div>
                <div className={`h-[9px] rounded-[5px] overflow-hidden transition-colors ${
                  active ? 'bg-blue-100' : 'bg-gray-100 group-hover:bg-gray-200'
                }`}>
                  <div
                    className="h-full rounded-[5px] transition-all group-hover:brightness-95"
                    style={{
                      width: row.width,
                      background: row.color,
                      boxShadow: active ? 'inset 0 0 0 1.5px #1d4ed8' : undefined,
                    }}
                  />
                </div>
              </button>
            )
          })}
          {footer}
        </div>
      )}
    </div>
  )
}
