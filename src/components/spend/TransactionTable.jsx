import { useState } from 'react'
import dayjs from 'dayjs'
import { CREDIT_KIND_LABELS } from '../../constants/categories.js'
import { isCredit } from '../../utils/period.js'
import SortTh from '../shared/SortTh.jsx'
import TablePager from '../shared/TablePager.jsx'
import ConfirmDeleteButton from '../shared/ConfirmDeleteButton.jsx'
import { useTablePaging, COLLAPSED_ROWS } from '../shared/useTablePaging.js'

/**
 * The transaction list.
 *
 * Collapsing and paging come from `shared/useTablePaging`, which the Finances table uses too — the
 * page-clamp and reset-during-render subtleties are the kind of thing that only stays correct in
 * one place. The two review toggles force it expanded: clicking "Review Now" on the duplicates or
 * uncategorized banner exists precisely to work through the whole list.
 *
 * Sorting, search and the review toggles all live above this component because they also feed the
 * page's own counts. Only the two things nobody else needs are local: which row is being edited and
 * which row is confirming a delete.
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

  // The two review toggles override the collapse: clicking "Review Now" on the duplicates or
  // uncategorized banner exists precisely to work through the whole list.
  const reviewing = showUncategorizedOnly || showDuplicatesOnly

  const { expanded, isExpanded, toggleExpanded, visible, page, pageCount, goToPage } = useTablePaging(
    rows,
    {
      resetKey,
      forceExpanded: reviewing,
      containerRef,
      onPageChange: () => setConfirmDeleteId(null),
    },
  )

  const narrowed = rows.length !== scopeCount
  const newestFirst = sortKey === 'date' && sortDir === 'desc'

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
              onClick={toggleExpanded}
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
                      <ConfirmDeleteButton
                        confirming={confirming}
                        onRequest={() => setConfirmDeleteId(tx.id)}
                        onCancel={() => setConfirmDeleteId(null)}
                        onConfirm={() => { onDelete(tx.id); setConfirmDeleteId(null) }}
                        disabled={confirming && deleting}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {isExpanded && <TablePager page={page} pageCount={pageCount} onGoToPage={goToPage} />}
    </div>
  )
}
