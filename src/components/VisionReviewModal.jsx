import { useState } from 'react'
import dayjs from 'dayjs'

export default function VisionReviewModal({ transactions: initialTxs, onConfirm, onCancel }) {
  const [sourceName, setSourceName] = useState('Bank Statement')
  const [txs, setTxs] = useState(initialTxs)

  function remove(idx) {
    setTxs(prev => prev.filter((_, i) => i !== idx))
  }

  function handleConfirm() {
    if (!sourceName.trim() || txs.length === 0) return
    onConfirm(sourceName.trim(), txs.map(tx => ({ ...tx, source: sourceName.trim() })))
  }

  const income = txs.filter(t => t.amount >= 0).reduce((s, t) => s + t.amount, 0)
  const expenses = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Review AI-Extracted Transactions</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {txs.length} transaction{txs.length !== 1 ? 's' : ''} found — remove any incorrect rows before importing.
          </p>
        </div>

        <div className="px-6 pt-4 shrink-0">
          <label className="block text-sm font-medium text-gray-700 mb-1">Bank / source name</label>
          <input
            value={sourceName}
            onChange={e => setSourceName(e.target.value)}
            placeholder="e.g. Citizens Bank, Chase Checking…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>

        <div className="px-6 py-3 shrink-0 flex gap-4 text-sm text-gray-500">
          <span className="text-green-600 font-medium">+${income.toLocaleString(undefined, { minimumFractionDigits: 2 })} income</span>
          <span className="text-red-500 font-medium">−${expenses.toLocaleString(undefined, { minimumFractionDigits: 2 })} expenses</span>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-2">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2 w-6"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {txs.map((tx, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-500">
                    {tx.date ? dayjs(tx.date).format('MMM D, YYYY') : tx.date}
                  </td>
                  <td className="py-2 pr-3 text-gray-900 max-w-xs truncate">{tx.description}</td>
                  <td className={`py-2 pr-3 text-right font-medium whitespace-nowrap ${tx.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {tx.amount >= 0 ? '+' : '−'}${Math.abs(tx.amount).toFixed(2)}
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => remove(i)}
                      className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                      title="Remove"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {txs.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">All rows removed.</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 shrink-0">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!sourceName.trim() || txs.length === 0}
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Import {txs.length} transaction{txs.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
