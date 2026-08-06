import { useState } from 'react'
import dayjs from 'dayjs'
import InfoTip from '../dashboard/InfoTip.jsx'

const money = n => '$' + Math.abs(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = n => (n < 0 ? '−' : '+') + money(n)

// Matches MATERIAL_FLOOR on the Dashboard: below this a gap is rounding rather than a short import.
const MATERIAL = 50

const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

/**
 * The closing balance printed on each bank statement, and how the ledger measured up to it.
 *
 * This is the only place a balance is ever entered. Cash is not editable anywhere else — see
 * `server/netWorthHistory.js` for why: a typed "what I think I have" is unfalsifiable, while a
 * statement close is a figure the bank issued on a known date, so it can be checked against the
 * rows imported since the previous one.
 *
 * `checks` arrive already computed from `/api/cash-status`. Nothing here recalculates them, and
 * nothing is stored beyond `{ date, balance }` — a discrepancy that survived a corrected ledger is
 * exactly the bug this design replaced.
 */
export default function StatementBalances({ balances = [], checks = [], onSave, saving = false }) {
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState(null)

  const checkFor = d => checks.find(c => c.date === d) ?? null
  const rows = [...balances].sort((a, b) => b.date.localeCompare(a.date))

  function add(event) {
    event.preventDefault()
    const value = Number(amount)
    if (!date) return setError('Pick the statement’s closing date.')
    if (!Number.isFinite(value)) return setError('Enter the closing balance as a number.')
    setError(null)
    // Re-entering a date corrects it rather than stacking a second anchor on the same day.
    onSave([...balances.filter(b => b.date !== date), { date, balance: value, source: 'statement' }])
    setDate('')
    setAmount('')
  }

  function remove(target) {
    onSave(balances.filter(b => b.date !== target))
  }

  return (
    // Header and form stay put; only the list of balances scrolls, so the card can sit in a fixed
    // share of the column without the "Add" control drifting out of reach.
    <div className="flex min-h-[240px] max-h-[480px] flex-col rounded-xl border border-gray-200 bg-white shadow-sm lg:max-h-none lg:flex-1 lg:basis-0">
      <div className="flex-none border-b border-dashed border-gray-200 px-5 pb-4 pt-4">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-gray-700">Statement closing balances</h2>
        <InfoTip label="Statement closing balances">
          The ending balance printed on each bank statement. Your cash figure is the newest of these
          plus every transaction since, which is why cash cannot be typed in directly — every dollar
          of it traces back to something your bank issued.
        </InfoTip>
      </div>
      <p className="mt-0.5 text-xs text-gray-400">
        Anchor balances used to reconcile cash between statement imports
      </p>

      <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[9rem] flex-1">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Statement ends
          </span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass} />
        </label>
        <label className="min-w-[9rem] flex-1">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Closing balance
          </span>
          <input
            type="number" step="0.01" inputMode="decimal" placeholder="0.00"
            value={amount} onChange={e => setAmount(e.target.value)} className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        >
          Add
        </button>
      </form>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">
      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
          None on file, so your cash balance is a reconstruction rather than a known figure. Add the
          closing balance from your most recent statement and it becomes exact.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map(entry => {
            const check = checkFor(entry.date)
            const gap = check?.discrepancy ?? 0
            const off = Math.abs(gap) >= MATERIAL
            return (
              <li key={entry.date} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-gray-800">
                    {dayjs(entry.date).format('MMM D, YYYY')}
                  </span>
                  {entry.source === 'typed' && (
                    <span
                      className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500"
                      title="Carried over from a balance typed before statement balances existed. Replace it with the figure printed on the statement."
                    >
                      unverified
                    </span>
                  )}
                  {/* The check is the point of the whole list: it is the app's only proof that a
                      statement's rows all made it in. Silence when it passes, plain English when
                      it does not. */}
                  <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400">
                    {!check || check.from === null
                      ? 'The starting point — nothing earlier to check it against.'
                      : check.beyondLedger
                        ? 'This statement’s transactions have not been imported yet.'
                        : off
                          ? `Ledger expected ${money(check.expected)} — off by ${signed(gap)}. A transaction is probably missing since ${dayjs(check.from).format('MMM D')}.`
                          : `Reconciles with every transaction since ${dayjs(check.from).format('MMM D')}.`}
                  </p>
                </div>
                <div className="flex shrink-0 items-baseline gap-3">
                  <span className={`text-[13px] tabular-nums ${off && check?.from ? 'font-semibold text-amber-700' : 'text-gray-700'}`}>
                    {money(entry.balance)}
                  </span>
                  <button
                    onClick={() => remove(entry.date)}
                    disabled={saving}
                    className="text-xs text-gray-300 transition-colors hover:text-red-500 disabled:opacity-60"
                    aria-label={`Remove the ${entry.date} statement balance`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      </div>
    </div>
  )
}
