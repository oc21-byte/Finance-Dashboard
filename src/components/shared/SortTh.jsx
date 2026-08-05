/** A sortable table header cell. Sort state lives with the caller, which also does the sorting. */
export default function SortTh({ label, field, sortKey, sortDir, onSort, className = '' }) {
  const active = sortKey === field
  return (
    <th
      className={`px-4 py-2.5 cursor-pointer select-none transition-colors ${
        active ? 'text-gray-600' : 'hover:text-gray-600'
      } ${className}`}
      onClick={() => onSort(field)}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-xs leading-none ${active ? 'text-gray-500' : 'text-gray-300'}`}>
          {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </span>
    </th>
  )
}
