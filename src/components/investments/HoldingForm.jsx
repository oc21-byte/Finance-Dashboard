import dayjs from 'dayjs'

// The flat list of account types offered as suggestions. Not a closed set: the statement importer
// lets the user name any account, so this seeds the dropdown rather than fencing it.
export const HOLDING_ACCOUNT_TYPES = [
  'TFSA', 'RRSP', 'FHSA', 'Non-Registered',
  'Roth IRA', 'Traditional IRA', '401(k)', 'HSA', 'Other',
]

export const DEFAULT_HOLDING_FORM = {
  ticker: '',
  shares: '',
  purchasePrice: '',
  purchaseDate: dayjs().format('YYYY-MM-DD'),
  accountType: 'Non-Registered',
}

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

/** Adding one lot by hand. A whole statement goes through the importer instead. */
export default function HoldingForm({ form, onChange, onSubmit, saving, accountTypes = [] }) {
  const field = key => ({
    value: form[key],
    onChange: e => onChange(key, e.target.value),
  })

  // Types already in use come first: they are the ones this user actually has.
  const options = [...new Set([...accountTypes, ...HOLDING_ACCOUNT_TYPES])]

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-medium text-gray-700">New holding</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Ticker</label>
          <input {...field('ticker')} placeholder="AAPL" className={inputClass} required />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Shares</label>
          <input {...field('shares')} type="number" min="0.000001" step="any" placeholder="10" className={inputClass} required />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Purchase price ($)</label>
          <input {...field('purchasePrice')} type="number" min="0.01" step="0.01" placeholder="150.00" className={inputClass} required />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Purchase date</label>
          <input {...field('purchaseDate')} type="date" className={inputClass} required />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Account</label>
          {/*
            Free text, not a closed dropdown. The account is NAMED here, the same way a card is
            named in the Spend Analyzer and an account is named when importing a statement — a
            fixed list is why every holding ends up under the default, and it cannot cover every
            registration a brokerage offers anyway. The name is fixed once the holding exists.
          */}
          <input
            {...field('accountType')}
            list="holding-account-names"
            placeholder="TFSA, Roth IRA, 401(k)…"
            className={inputClass}
            required
          />
          <datalist id="holding-account-names">
            {options.map(t => <option key={t} value={t} />)}
          </datalist>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Add holding'}
        </button>
      </div>
    </form>
  )
}
