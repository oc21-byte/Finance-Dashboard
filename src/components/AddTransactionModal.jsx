import { useState } from 'react'
import dayjs from 'dayjs'
import { CATEGORIES } from '../constants/categories.js'

function defaultCategory(type, categories) {
  if (type === 'income') return categories.includes('Income') ? 'Income' : categories[0]
  return categories.includes('Expense') ? 'Expense' : (categories.includes('Other') ? 'Other' : categories[0])
}

export default function AddTransactionModal({ onConfirm, onCancel, categories = CATEGORIES }) {
  const [type, setType] = useState('expense')
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(() => defaultCategory('expense', categories))

  function handleTypeChange(t) {
    setType(t)
    setCategory(defaultCategory(t, categories))
  }

  function handleSubmit(e) {
    e.preventDefault()
    const abs = Math.abs(parseFloat(amount))
    if (!description.trim() || !abs) return
    onConfirm({
      date,
      description: description.trim(),
      amount: type === 'expense' ? -abs : abs,
      category,
      source: 'manual',
      type,
    })
  }

  const valid = description.trim() && parseFloat(amount) > 0

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Add Transaction</h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Type toggle */}
          <div className="flex gap-2">
            {['expense', 'income'].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => handleTypeChange(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  type === t
                    ? t === 'expense'
                      ? 'bg-red-100 text-red-700 ring-1 ring-red-300'
                      : 'bg-green-100 text-green-700 ring-1 ring-green-300'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {t === 'expense' ? 'Expense' : 'Income'}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Grocery run"
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">$</span>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                step="0.01"
                min="0"
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!valid}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
