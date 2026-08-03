import { useState } from 'react'
import dayjs from 'dayjs'
import { CREDIT_KIND_LABELS } from '../../constants/categories.js'
import { isCredit } from '../../utils/period.js'

const COLLAPSED_ROWS = 5
const PAGE_SIZE = 10

function SortTh({ label, field, sortKey, sortDir, onSort, className = '' }) {
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

/**
 * The transaction list.
 *
 * Collapsed to five rows by default and paginated at ten once expanded — with a year of statements
 * this table is the longest thing on the page by an order of magnitude, and rendering all of it
 * pushes every chart above it out of reach.
 *
 * The two review toggles override that: clicking "Review Now" on the duplicates or uncategorized
 * banner exists precisely to work through the whole list, so those views expand themselves.
 *
 * Sorting, search and the review toggles all live above this component because they also feed the
 * page's own counts. Only the three things nobody else needs are local: which row is being edited,
 * whether the list is expanded, and the page number.
 */
export default function TransactionTable({
  rows, scopeCount, isLoading,
  duplicateById, categories, categoryColors,
  sortKey, sortDir, onSort,
  searchQuery, onSearchChange,
  showUncategorizedOnly, showDuplicatesOnly, onClearUncategorized, onClearDuplicates,
  hasAiKey, uncategorizedCount, recategorizing, onRecategorize,
  onUpdate, onDelete, deleting,
  containerRef, scrollMarginTop, resetKey,
}) {
  const [editingId, setEditingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(0)

  // Reset to the first page when the underlying list changes out from under it. Done during
  // render rather than in an effect so the new page never paints at the old offset.
  const [seenKey, setSeenKey] = useState(resetKey)
  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    setPage(0)
  }

  const reviewing = showUncategorizedOnly || showDuplicatesOnly
  const isExpanded = expanded || reviewing

  const pageCount = Math.max(Math.ceil(rows.length / PAGE_SIZE), 1)
  // Clamped rather than stored: deleting the last row of the last page should land you on a page
  // that exists, without a round trip through state.
  const safePage = Math.min(page, pageCount - 1)
  const visible = isExpanded
    ? rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
    : rows.slice(0, COLLAPSED_ROWS)

  const narrowed = rows.length !== scopeCount
  const newestFirst = sortKey === 'date' && sortDir === 'desc'

  function goToPage(next) {
    setPage(next)
    setConfirmDeleteId(null)
    // Only when the table's header has already scrolled off — paging while the whole table is
    // visible shouldn't yank the viewport.
    const el = containerRef?.current
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const caption = isLoading
    ? 'Loading…'
    : rows.length === 0
      ? 'Nothing matches the current filters'
      : isExpanded
        ? `Showing ${visible.length} of ${rows.length}${narrowed ? ` (${scopeCount} in scope)` : ''}`
        : `${rows.length}${narrowed ? ` of ${scopeCount}` : ''} in scope — showing the ${
            Math.min(COLLAPSED_ROWS, rows.length)
          } ${newestFirst ? 'most recent' : 'first'}`

  return (
    <div
      ref={containerRef}
      className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
      style={{ scrollMarginTop }}
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-gray-900">Transactions</h2>
          <p className="mt-1 text-[12.5px] text-gray-400">{caption}</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search transactions…"
            className="text-[13px] border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full sm:w-52"
          />
          {rows.length > COLLAPSED_ROWS && !reviewing && (
            <button
              onClick={() => { setExpanded(v => !v); setPage(0) }}
              className="shrink-0 px-3.5 py-2 text-[13px] font-semibold border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              {expanded ? 'Collapse ▴' : 'Show all ▾'}
            </button>
          )}
        </div>
      </div>

      {(reviewing || (hasAiKey && uncategorizedCount > 0)) && (
        <div className="px-4 sm:px-5 py-2.5 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2.5 flex-wrap">
          {showUncategorizedOnly && (
            <button
              onClick={onClearUncategorized}
              className="px-2.5 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-300 rounded-full hover:bg-yellow-200 transition-colors"
            >
              Uncategorized only ✕
            </button>
          )}
          {showDuplicatesOnly && (
            <button
              onClick={onClearDuplicates}
              className="px-2.5 py-1 text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300 rounded-full hover:bg-amber-200 transition-colors"
            >
              Possible duplicates only ✕
            </button>
          )}
          {reviewing && (
            <span className="text-xs text-gray-400">Showing every match while you review</span>
          )}
          {hasAiKey && uncategorizedCount > 0 && (
            <button
              onClick={onRecategorize}
              disabled={recategorizing}
              className="ml-auto px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-60 transition-colors"
            >
              {recategorizing ? 'Categorizing…' : `Re-categorize ${uncategorizedCount} uncategorized`}
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-400 text-sm">
            {searchQuery || reviewing
              ? 'No transactions match the current filters.'
              : 'No transactions in this period.'}
          </p>
          {!searchQuery && !reviewing && (
            <p className="text-gray-300 text-xs mt-1">
              Widen the period, or upload a statement.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider bg-gray-50/60 border-b border-gray-100">
                <SortTh label="Date" field="date" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Description" field="description" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Category" field="category" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Source" field="source" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hidden sm:table-cell" />
                <SortTh label="Amount" field="amount" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="text-right" />
                <th className="px-4 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visible.map(tx => {
                const dup = duplicateById.get(tx.id)
                const credit = isCredit(tx)
                const confirming = confirmDeleteId === tx.id
                return (
                  <tr
                    key={tx.id}
                    className={`transition-colors ${
                      confirming ? 'bg-red-50' : dup ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap align-top">
                      {tx.date ? dayjs(tx.date).format('MMM D, YYYY') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-xs align-top">
                      <div className="flex items-center gap-2">
                        <span className="truncate" title={tx.description || undefined}>
                          {tx.description || <span className="text-gray-300 italic">No description</span>}
                        </span>
                        {credit && (
                          <span className="shrink-0 text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium">
                            {CREDIT_KIND_LABELS[tx.creditKind || 'credit'] ?? 'Credit'}
                          </span>
                        )}
                      </div>
                      {dup && (
                        <div className="flex items-center gap-2 mt-1 text-xs">
                          <span className="text-amber-700">
                            Possible duplicate{dup.otherDate ? ` of ${dayjs(dup.otherDate).format('MMM D')}` : ''}
                          </span>
                          <button
                            onClick={() => onUpdate({ id: tx.id, dupDismissed: true })}
                            className="text-gray-400 hover:text-gray-700 underline"
                          >
                            Not a duplicate
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {editingId === tx.id ? (
                        <select
                          autoFocus
                          defaultValue={tx.category || 'Other'}
                          onChange={e => {
                            onUpdate({ id: tx.id, category: e.target.value })
                            setEditingId(null)
                          }}
                          onBlur={() => setEditingId(null)}
                          className="text-xs border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {categories.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => setEditingId(tx.id)}
                          title="Click to change category"
                          className="px-2.5 py-0.5 rounded-full text-xs font-medium hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 transition-all"
                          style={{
                            backgroundColor: (categoryColors[tx.category] || '#94a3b8') + '1a',
                            color: categoryColors[tx.category] || '#94a3b8',
                          }}
                        >
                          {tx.category || 'Other'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell align-top">
                      {tx.source || '—'}
                    </td>
                    <td className={`px-4 py-3 text-sm font-medium text-right whitespace-nowrap align-top ${
                      credit ? 'text-green-600' : 'text-red-500'
                    }`}>
                      {credit ? '+' : '−'}${Math.abs(tx.amount).toFixed(2)}
                    </td>
                    <td className="px-2 py-3 align-top whitespace-nowrap text-right">
                      {/* Two-step, because a delete here is immediate and has no undo — a stray
                          click on a 400-row list would otherwise silently drop a transaction. */}
                      {confirming ? (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <button
                            onClick={() => { onDelete(tx.id); setConfirmDeleteId(null) }}
                            disabled={deleting}
                            className="px-2 py-0.5 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-1.5 py-0.5 rounded-md text-gray-500 hover:text-gray-900 transition-colors"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(tx.id)}
                          className="px-2 text-gray-300 hover:text-red-500 transition-colors text-lg leading-none"
                          title="Delete this transaction"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {isExpanded && pageCount > 1 && (
        <div className="px-4 sm:px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-4">
          <span className="text-[12.5px] text-gray-400">
            Page {safePage + 1} of {pageCount}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => goToPage(Math.max(safePage - 1, 0))}
              disabled={safePage === 0}
              className="px-3 py-1.5 text-[12.5px] font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => goToPage(Math.min(safePage + 1, pageCount - 1))}
              disabled={safePage >= pageCount - 1}
              className="px-3 py-1.5 text-[12.5px] font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
