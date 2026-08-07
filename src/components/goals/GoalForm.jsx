import { useState } from 'react'
import dayjs from 'dayjs'
import { money } from '../../utils/goalsModel.js'

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export const blankGoal = () => ({
  name: '',
  targetAmount: '',
  targetDate: dayjs().add(1, 'year').format('YYYY-MM-DD'),
  monthlySavings: '',
})

/**
 * One-click suggestions to fill the monthly-savings field from real transaction averages.
 * Shows savings contrib (blue) and, when the goal has investment links, invest contrib (purple).
 *
 * The 7c wireframe drops these; they stay because they are the only place the app offers a rate
 * derived from what you actually transfer rather than a number you invented.
 */
function SuggestSavings({ rate, onUse }) {
  const suggested = rate?.savingsContrib || 0
  const investSuggested = rate?.investContrib || 0
  if (!suggested && !investSuggested) return null
  return (
    <div>
      {!!suggested && (
        <button
          type="button"
          onClick={() => onUse(suggested)}
          className="block text-xs text-blue-600 hover:text-blue-700 mt-1 text-left"
          title="Fill from your average monthly savings contributions"
        >
          Your avg savings: ${money(suggested)}/mo over {rate.monthsCovered} mo ({rate.windowLabel})
        </button>
      )}
      {!!investSuggested && (
        <button
          type="button"
          onClick={() => onUse(investSuggested)}
          className="block text-xs text-purple-600 hover:text-purple-700 mt-1 text-left"
          title="Fill from your average monthly investment contributions"
        >
          Your avg investing: ${money(investSuggested)}/mo over {rate.monthsCovered} mo ({rate.windowLabel})
        </button>
      )}
    </div>
  )
}

/**
 * The create and edit form, rendered into the detail slot below the grid.
 *
 * One component for both: the fields are identical and the only differences are the seed values
 * and the submit label. Field state is local — it is transient UI, not something the page needs to
 * know about — so the page resets it by changing the `key`, not by clearing four state variables.
 *
 * Linking is deliberately not here. It lives in `LinkedAllocationCard` in the detail panel and
 * saves on its own, so it is reachable for a goal that already exists rather than only at the
 * moment one is created or edited.
 */
export default function GoalForm({ initial, submitLabel, pending, error, onSubmit, onCancel, contribRate }) {
  const [form, setForm] = useState(initial ?? blankGoal())

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  function submit(e) {
    e.preventDefault()
    if (!form.name || !form.targetAmount || !form.targetDate) return
    onSubmit({
      name: form.name,
      targetAmount: parseFloat(form.targetAmount),
      targetDate: form.targetDate,
      monthlySavings: form.monthlySavings ? parseFloat(form.monthlySavings) : 0,
    })
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">Goal name</label>
          <input className={inputClass} placeholder="e.g. Emergency Fund" value={form.name} onChange={set('name')} required autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Target amount ($)</label>
          <input className={inputClass} type="number" min="0" step="0.01" placeholder="10000" value={form.targetAmount} onChange={set('targetAmount')} required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Target date</label>
          <input className={inputClass} type="date" value={form.targetDate} onChange={set('targetDate')} required />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">Monthly savings (optional)</label>
          <input className={inputClass} type="number" min="0" step="0.01" placeholder="500" value={form.monthlySavings} onChange={set('monthlySavings')} />
          <SuggestSavings rate={contribRate} onUse={(v) => setForm(f => ({ ...f, monthlySavings: String(v) }))} />
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
