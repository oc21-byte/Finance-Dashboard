import { SAVINGS_ACCOUNT_TYPES } from './SavingsTable.jsx'

export const DEFAULT_SAVINGS_FORM = { name: '', accountType: 'HYSA', balance: '', apy: '' }

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function SavingsForm({ form, onChange, onSubmit, saving }) {
  const field = key => ({
    value: form[key],
    onChange: e => onChange(key, e.target.value),
  })

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-medium text-gray-700">New savings account</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Account name</label>
          <input {...field('name')} placeholder="Marcus HYSA" className={inputClass} required />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Account type</label>
          <select {...field('accountType')} className={inputClass}>
            {SAVINGS_ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Balance ($)</label>
          <input {...field('balance')} type="number" min="0" step="0.01" placeholder="10000.00" className={inputClass} required />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">APY (%)</label>
          <input {...field('apy')} type="number" min="0" step="0.01" placeholder="4.50" className={inputClass} required />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Add account'}
        </button>
      </div>
    </form>
  )
}
