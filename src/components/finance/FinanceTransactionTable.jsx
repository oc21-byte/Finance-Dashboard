import { useState } from 'react'
import dayjs from 'dayjs'
import { CREDIT_KIND_LABELS } from '../../constants/categories.js'
import TablePager from '../shared/TablePager.jsx'
import ConfirmDeleteButton from '../shared/ConfirmDeleteButton.jsx'
import { useTablePaging, COLLAPSED_ROWS } from '../shared/useTablePaging.js'

const TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expenses' },
  { value: 'savings', label: 'Savings' },
  { value: 'investments', label: 'Investments' },
]

/**
 * The Finances transaction list.
 *
 * Written fresh rather than shared with the card table: this one carries a bank type, an account
 * column and two destination linkers, while that one is wired to `isCredit`/`creditKind`. Unifying
 * them would take about six render-prop slots and leave neither readable. What IS shared is the
 * behaviour — paging, the two-step delete — which is where the subtle bugs live.
 *
 * Three row shapes:
 *  - a bank row, with an editable category and a destination linker when it is allocation
 *  - the same row tinted amber when it looks like a duplicate, with a dismiss action
 *  - a card credit, lime and read-only: it belongs to the card ledger, and editing it here would
 *    leave two rows for one event with no way to keep them in step
 */
export default function FinanceTransactionTable({
  rows, scopeCount, isLoading, rangeLabel,
  duplicateById, categories, categoryColors,
  searchQuery, onSearchChange,
  typeFilter, onTypeFilterChange,
  showDuplicatesOnly, onClearDuplicates,
  savingsAccounts, holdingAccountTypes,
  onUpdate, onDelete, deleting, readOnly,
  containerRef, resetKey,
}) {
  const [editingId, setEditingId] = useState(null)
  const [linkingId, setLinkingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const { expanded, isExpanded, toggleExpanded, visible, page, pageCount, goToPage } = useTablePaging(
    rows,
    {
      resetKey,
      // The duplicate review exists to work through every match, so it expands itself.
      forceExpanded: showDuplicatesOnly,
      containerRef,
      onPageChange: () => { setConfirmDeleteId(null); setEditingId(null); setLinkingId(null) },
    },
  )

  const narrowed = rows.length !== scopeCount
  const caption = isLoading
    ? 'Loading…'
    : rows.length === 0
      ? 'Nothing matches the current filters'
      : isExpanded
        ? `Showing ${visible.length} of ${rows.length}${narrowed ? ` (${scopeCount} in scope)` : ''}`
        : `${rows.length}${narrowed ? ` of ${scopeCount}` : ''} in scope — showing the ${
            Math.min(COLLAPSED_ROWS, rows.length)
          } most recent`

  return (
    <div
      ref={containerRef}
      className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-gray-900">Transactions</h2>
          <p className="mt-1 text-[12.5px] text-gray-400">{rangeLabel} · {caption}</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search transactions…"
            className="text-[13px] border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full sm:w-52"
          />
          <select
            value={typeFilter}
            onChange={e => onTypeFilterChange(e.target.value)}
            className="text-[13px] border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {TYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {rows.length > COLLAPSED_ROWS && !showDuplicatesOnly && (
            <button
              onClick={toggleExpanded}
              className="shrink-0 px-3.5 py-2 text-[13px] font-semibold border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              {expanded ? 'Collapse ▴' : 'Show all ▾'}
            </button>
          )}
        </div>
      </div>

      {showDuplicatesOnly && (
        <div className="px-4 sm:px-5 py-2.5 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2.5 flex-wrap">
          <button
            onClick={onClearDuplicates}
            className="px-2.5 py-1 text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300 rounded-full hover:bg-amber-200 transition-colors"
          >
            Possible duplicates only ✕
          </button>
          <span className="text-xs text-gray-400">Showing every match while you review</span>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-400 text-sm">
            {showDuplicatesOnly
              ? 'No possible duplicates left.'
              : searchQuery || typeFilter !== 'all'
                ? 'No transactions match the current filters.'
                : 'No transactions in this period.'}
          </p>
          {!showDuplicatesOnly && !searchQuery && typeFilter === 'all' && (
            <p className="text-gray-300 text-xs mt-1">Widen the period, or upload a statement.</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider bg-gray-50/60 border-b border-gray-100">
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Description</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5 hidden sm:table-cell">Account</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visible.map(tx => {
                if (tx._cardCredit) {
                  return (
                    <tr key={`cc-${tx.id}`} className="bg-lime-50/40 hover:bg-lime-50 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap align-top">
                        {tx.date ? dayjs(tx.date).format('MMM D, YYYY') : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 max-w-xs align-top">
                        <div className="truncate" title={tx.description || undefined}>{tx.description}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          Card credit — edit on the Spend Analyzer
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-lime-100 text-lime-700">
                          {CREDIT_KIND_LABELS[tx.creditKind || 'credit'] ?? 'Credit'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell align-top">
                        {tx.source || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-right whitespace-nowrap text-lime-600 align-top">
                        +${Math.abs(tx.amount).toFixed(2)}
                      </td>
                      <td className="px-2 py-3" />
                    </tr>
                  )
                }

                const dup = duplicateById.get(tx.id)
                const confirming = confirmDeleteId === tx.id
                const income = tx.type === 'income'
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
                      {/* No in/out pill: the category pill and the signed, tinted amount already
                          carry the direction, so a third marker for it is only noise. */}
                      <div className="truncate" title={tx.description || undefined}>
                        {tx.description || <span className="text-gray-300 italic">No description</span>}
                      </div>
                      {dup && (
                        <div className="flex items-center gap-2 mt-1 text-xs">
                          <span className="text-amber-700">
                            Possible duplicate{dup.otherDate ? ` of ${dayjs(dup.otherDate).format('MMM D')}` : ''}
                          </span>
                          {!readOnly && (
                            <button
                              onClick={() => onUpdate({ id: tx.id, dupDismissed: true })}
                              className="text-gray-400 hover:text-gray-700 underline"
                            >
                              Not a duplicate
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {editingId === tx.id ? (
                        <select
                          autoFocus
                          defaultValue={tx.category || 'Expense'}
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
                          onClick={() => !readOnly && setEditingId(tx.id)}
                          title={readOnly ? undefined : 'Click to change category'}
                          className="px-2.5 py-0.5 rounded-full text-xs font-medium hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 transition-all"
                          style={{
                            backgroundColor: (categoryColors[tx.category] || '#94a3b8') + '1a',
                            color: categoryColors[tx.category] || '#94a3b8',
                          }}
                        >
                          {tx.category || 'Other'}
                        </button>
                      )}
                      <DestinationLink
                        tx={tx}
                        editing={linkingId === tx.id}
                        readOnly={readOnly}
                        savingsAccounts={savingsAccounts}
                        holdingAccountTypes={holdingAccountTypes}
                        onOpen={() => setLinkingId(tx.id)}
                        onClose={() => setLinkingId(null)}
                        onUpdate={onUpdate}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden sm:table-cell align-top">
                      {tx.source || '—'}
                    </td>
                    <td className={`px-4 py-3 text-sm font-medium text-right whitespace-nowrap align-top ${
                      income ? 'text-green-600' : 'text-red-500'
                    }`}>
                      {income ? '+' : '−'}${Math.abs(tx.amount).toFixed(2)}
                    </td>
                    <td className="px-2 py-3 align-top whitespace-nowrap text-right">
                      <ConfirmDeleteButton
                        confirming={confirming}
                        onRequest={() => setConfirmDeleteId(tx.id)}
                        onCancel={() => setConfirmDeleteId(null)}
                        onConfirm={() => { onDelete(tx.id); setConfirmDeleteId(null) }}
                        disabled={readOnly || (confirming && deleting)}
                        title={readOnly ? 'Unavailable in Demo Mode' : undefined}
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

/**
 * The destination linker under an allocation row's category pill.
 *
 * Savings rows point at a savings account by id; investment rows carry a holding account-type
 * label, because holdings have no account entity to point at. Both hide entirely when there is
 * nothing to link to — an empty menu is worse than no menu.
 */
function DestinationLink({
  tx, editing, readOnly, savingsAccounts, holdingAccountTypes, onOpen, onClose, onUpdate,
}) {
  const savings = tx.category === 'Savings'
  const investments = tx.category === 'Investments'
  if (!savings && !investments) return null

  const options = savings
    ? savingsAccounts.map(a => ({ value: a.id, label: a.name }))
    : holdingAccountTypes.map(type => ({ value: type, label: type }))
  if (!options.length) return null

  const field = savings ? 'linkedSavingsAccountId' : 'linkedHoldingAccountType'
  const current = savings
    ? (tx.linkedSavingsAccountId
        ? (savingsAccounts.find(a => a.id === tx.linkedSavingsAccountId)?.name ?? 'Unknown account')
        : null)
    : (tx.linkedHoldingAccountType || null)
  const tint = savings ? 'text-teal-600' : 'text-indigo-600'
  const ring = savings ? 'focus:ring-teal-500' : 'focus:ring-indigo-500'

  return (
    <div className="mt-1">
      {editing ? (
        <select
          autoFocus
          defaultValue={(savings ? tx.linkedSavingsAccountId : tx.linkedHoldingAccountType) || ''}
          onChange={e => {
            onUpdate({ id: tx.id, [field]: e.target.value || null })
            onClose()
          }}
          onBlur={onClose}
          className={`text-xs border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 ${ring}`}
        >
          <option value="">— No account —</option>
          {options.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <span
          onClick={() => !readOnly && onOpen()}
          className={`text-xs cursor-pointer hover:underline ${tint}`}
          title={`Click to link ${savings ? 'savings' : 'investment'} account`}
        >
          {current ?? '+ Link account'}
        </span>
      )}
    </div>
  )
}
