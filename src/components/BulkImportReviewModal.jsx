import { useState } from 'react'
import dayjs from 'dayjs'

function money(n) {
  return `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function totals(txs) {
  return {
    income: txs.filter(t => t.amount >= 0).reduce((s, t) => s + t.amount, 0),
    expenses: txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
  }
}

function formatDate(date) {
  return date && dayjs(date).isValid() ? dayjs(date).format('MMM D, YYYY') : (date || '—')
}

export default function BulkImportReviewModal({
  groups: initialGroups,
  skipped = [],
  onConfirm,
  onCancel,
  onRemap,
  busy = false,
}) {
  // Rows carry a stable id so selection survives removing other rows.
  const [groups, setGroups] = useState(() => initialGroups.map(g => ({
    ...g,
    transactions: g.transactions.map((tx, i) => ({ ...tx, _rid: `${g.id}:${i}` })),
  })))

  // Possible duplicates start deselected, so the safe outcome is the default one.
  const [deselected, setDeselected] = useState(() => {
    const initial = new Set()
    for (const g of initialGroups) {
      g.transactions.forEach((tx, i) => { if (tx.duplicateOf) initial.add(`${g.id}:${i}`) })
    }
    return initial
  })

  const [expanded, setExpanded] = useState(() =>
    new Set(initialGroups.length === 1 ? initialGroups.map(g => g.id) : []),
  )

  function toggleExpanded(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleRow(rid) {
    setDeselected(prev => {
      const next = new Set(prev)
      next.has(rid) ? next.delete(rid) : next.add(rid)
      return next
    })
  }

  function setGroupRows(group, include) {
    setDeselected(prev => {
      const next = new Set(prev)
      for (const tx of group.transactions) {
        include ? next.delete(tx._rid) : next.add(tx._rid)
      }
      return next
    })
  }

  function setSourceName(id, sourceName) {
    setGroups(prev => prev.map(g => (g.id === id ? { ...g, sourceName } : g)))
  }

  function removeRow(id, rid) {
    setGroups(prev => prev.map(g =>
      g.id === id ? { ...g, transactions: g.transactions.filter(tx => tx._rid !== rid) } : g,
    ))
  }

  function removeGroup(id) {
    setGroups(prev => prev.filter(g => g.id !== id))
  }

  const selectedOf = group => group.transactions.filter(tx => !deselected.has(tx._rid))

  const ready = groups.filter(g => selectedOf(g).length > 0 && g.sourceName.trim())
  const totalRows = ready.reduce((s, g) => s + selectedOf(g).length, 0)
  const missingNames = groups.filter(g => selectedOf(g).length > 0 && !g.sourceName.trim()).length
  const duplicateTotal = groups.reduce((s, g) => s + g.transactions.filter(tx => tx.duplicateOf).length, 0)
  const grand = totals(ready.flatMap(selectedOf))

  function handleConfirm() {
    if (!ready.length || busy) return
    onConfirm(ready.map(g => ({
      ...g,
      sourceName: g.sourceName.trim(),
      transactions: selectedOf(g).map(({ _rid, duplicateOf, ...tx }) => ({
        ...tx,
        source: g.sourceName.trim(),
      })),
    })))
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Review AI-Extracted Transactions</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {totalRows} transaction{totalRows !== 1 ? 's' : ''} selected from {groups.length} file{groups.length !== 1 ? 's' : ''}
            {' '}— name each source and untick anything you don't want.
          </p>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {duplicateTotal > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
              <span className="font-medium">
                {duplicateTotal} row{duplicateTotal !== 1 ? 's' : ''} look{duplicateTotal === 1 ? 's' : ''} like duplicates
              </span>{' '}
              and {duplicateTotal === 1 ? 'has' : 'have'} been unticked. Tick any that are genuinely separate charges.
            </div>
          )}

          {skipped.length > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm font-medium text-red-900">
                {skipped.length} file{skipped.length !== 1 ? 's' : ''} could not be read
              </p>
              <ul className="mt-1.5 space-y-1">
                {skipped.map((s, i) => (
                  <li key={i} className="text-xs text-red-800">
                    <span className="font-medium">{s.fileName}</span> — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {groups.map(group => {
            const isOpen = expanded.has(group.id)
            const selected = selectedOf(group)
            const t = totals(selected)
            const groupDupes = group.transactions.filter(tx => tx.duplicateOf).length
            return (
              <div key={group.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleExpanded(group.id)}
                        className="text-xs text-gray-400 hover:text-gray-700 w-4 shrink-0"
                        title={isOpen ? 'Collapse' : 'Expand'}
                      >
                        {isOpen ? '▾' : '▸'}
                      </button>
                      <span className="text-sm font-medium text-gray-900 truncate">{group.fileName}</span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {selected.length} of {group.transactions.length} row{group.transactions.length !== 1 ? 's' : ''}
                      </span>
                      {groupDupes > 0 && (
                        <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded shrink-0">
                          {groupDupes} possible dupe{groupDupes !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 ml-6 text-xs flex-wrap">
                      {group.note && <span className="text-gray-400">{group.note}</span>}
                      <span className="text-green-600 font-medium">+{money(t.income)}</span>
                      <span className="text-red-500 font-medium">−{money(t.expenses)}</span>
                      <button
                        onClick={() => setGroupRows(group, selected.length !== group.transactions.length)}
                        className="text-gray-400 hover:text-gray-700 underline"
                      >
                        {selected.length === group.transactions.length ? 'Untick all' : 'Tick all'}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      value={group.sourceName}
                      onChange={e => setSourceName(group.id, e.target.value)}
                      placeholder="Source name…"
                      className="w-44 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                    {onRemap && group.headers && (
                      <button
                        onClick={() => onRemap(group)}
                        className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                        title="Map this file's columns by hand"
                      >
                        Remap
                      </button>
                    )}
                    <button
                      onClick={() => removeGroup(group.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                      title="Skip this file"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                          <th className="py-2 pl-4 pr-2 w-8"></th>
                          <th className="py-2 pr-3">Date</th>
                          <th className="py-2 pr-3">Description</th>
                          <th className="py-2 pr-3 text-right">Amount</th>
                          <th className="py-2 pr-4 w-6"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {group.transactions.map(tx => {
                          const isOff = deselected.has(tx._rid)
                          return (
                            <tr
                              key={tx._rid}
                              className={tx.duplicateOf ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-gray-50'}
                            >
                              <td className="py-2 pl-4 pr-2">
                                <input
                                  type="checkbox"
                                  checked={!isOff}
                                  onChange={() => toggleRow(tx._rid)}
                                  className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                                />
                              </td>
                              <td className={`py-2 pr-3 whitespace-nowrap ${isOff ? 'text-gray-300' : 'text-gray-500'}`}>
                                {formatDate(tx.date)}
                              </td>
                              <td className={`py-2 pr-3 max-w-xs ${isOff ? 'text-gray-300' : 'text-gray-900'}`}>
                                <div className="truncate">{tx.description}</div>
                                {tx.duplicateOf && (
                                  <div className="text-xs text-amber-700 mt-0.5 truncate">
                                    Possible duplicate of {formatDate(tx.duplicateOf.date)} — {tx.duplicateOf.origin}
                                  </div>
                                )}
                              </td>
                              <td className={`py-2 pr-3 text-right font-medium whitespace-nowrap ${
                                isOff ? 'text-gray-300' : tx.amount >= 0 ? 'text-green-600' : 'text-red-500'
                              }`}>
                                {tx.amount >= 0 ? '+' : '−'}{money(tx.amount)}
                              </td>
                              <td className="py-2 pr-4">
                                <button
                                  onClick={() => removeRow(group.id, tx._rid)}
                                  className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                                  title="Remove"
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {group.transactions.length === 0 && (
                      <p className="text-center text-sm text-gray-400 py-6">All rows removed.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {groups.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">No files left to import.</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 shrink-0 flex-wrap">
          <div className="text-sm text-gray-500">
            {missingNames > 0 ? (
              <span className="text-amber-700">
                {missingNames} file{missingNames !== 1 ? 's' : ''} still need{missingNames === 1 ? 's' : ''} a source name
              </span>
            ) : (
              <>
                <span className="text-green-600 font-medium">+{money(grand.income)}</span>
                <span className="mx-2 text-gray-300">·</span>
                <span className="text-red-500 font-medium">−{money(grand.expenses)}</span>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!ready.length || busy}
              className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Importing…' : `Import ${totalRows} transaction${totalRows !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
