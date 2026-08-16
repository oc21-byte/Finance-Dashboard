import { useState } from 'react'
import { withOverride, withoutOverride, listOverrides, cardById } from '../../../utils/rewardsModel.js'
import { RATE_CATEGORIES } from '../../../constants/cardCatalog.js'
import { rate as fmtRate, dollars } from './format.js'

/**
 * Correct a rate the catalog got wrong.
 *
 * Corrections are stored in `settings.cardRewards.overrides`, deliberately outside `CARD_CATALOG` —
 * that separation is the whole reason a catalog update is safe to ship. Replacing the catalog
 * wholesale cannot touch anything a user has told us here.
 *
 * A corrected cell is marked ✎ in the grid, so a correction can never be mistaken for a published
 * rate. Being able to find and clear one is as important as being able to make it, which is why
 * every correction on record is listed — including one belonging to a card that has since left the
 * catalog, which would otherwise be invisible and permanent.
 */
export default function RateCorrections({
  cards = [],
  overrides = {},
  custom = {},
  demoMode = false,
  onChange,
}) {
  const [open, setOpen] = useState(false)
  const [cardId, setCardId] = useState('')
  const [category, setCategory] = useState('')
  const [pct, setPct] = useState('')
  const [capMo, setCapMo] = useState('')

  const rows = listOverrides(overrides, custom)
  // Only cards actually in the wallet: correcting a rate on a card you don't hold changes nothing
  // you can see, and the list would be 39 entries long for no purpose.
  const options = cards.filter(c => c.id)

  function save() {
    const next = withOverride(overrides, cardId, category, { pct, capMo })
    if (next === overrides) return
    onChange(next)
    setCardId('')
    setCategory('')
    setPct('')
    setCapMo('')
  }

  const published = cardId ? cardById(cardId, custom)?.rates?.[category] : null
  const canSave = cardId && category && pct !== '' && Number.isFinite(Number(pct)) && Number(pct) >= 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50/60 transition-colors rounded-xl"
      >
        <span>
          <span className="block text-[15px] font-semibold text-gray-900">Correct a rate</span>
          <span className="block mt-0.5 text-[12.5px] text-gray-400">
            {rows.length
              ? `${rows.length} correction${rows.length === 1 ? '' : 's'} on record`
              : 'Tell the page what a card really pays, if the catalog has it wrong'}
          </span>
        </span>
        <span className="text-gray-400 text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-100">
          {rows.length > 0 && (
            <div className="mt-4 flex flex-col gap-1.5">
              {rows.map(row => (
                <div
                  key={`${row.cardId} ${row.category}`}
                  className="flex items-baseline justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200"
                >
                  <span className="text-[12.5px] text-gray-700 min-w-0 truncate">
                    <span className="text-gray-400 mr-1">✎</span>
                    {row.short} · {row.category}
                    {!row.card && <span className="text-gray-400"> · no longer in the catalog</span>}
                  </span>
                  <span className="flex items-baseline gap-3 shrink-0">
                    <span className="text-[12.5px] font-medium text-gray-900">
                      {fmtRate(row.pct)}
                      {row.capMo && <span className="text-gray-400 font-normal"> to {dollars(row.capMo)}/mo</span>}
                    </span>
                    <button
                      onClick={() => onChange(withoutOverride(overrides, row.cardId, row.category))}
                      disabled={demoMode}
                      className="text-[11.5px] text-gray-400 hover:text-red-600 disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Card</span>
              <select
                value={cardId}
                onChange={e => setCardId(e.target.value)}
                className="text-[12.5px] rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">Pick a card…</option>
                {options.map(card => (
                  <option key={card.id} value={card.id}>{card.short}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Category</span>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="text-[12.5px] rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">Pick a category…</option>
                {RATE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Rate %</span>
              <input
                type="number" min="0" step="0.1" value={pct}
                onChange={e => setPct(e.target.value)}
                className="w-20 text-[12.5px] rounded-lg border border-gray-300 px-2 py-1.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Cap $/mo</span>
              <input
                type="number" min="0" step="50" value={capMo} placeholder="none"
                onChange={e => setCapMo(e.target.value)}
                className="w-24 text-[12.5px] rounded-lg border border-gray-300 px-2 py-1.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </label>

            <button
              onClick={save}
              disabled={!canSave || demoMode}
              className="px-3 py-1.5 text-[12.5px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Save correction
            </button>
          </div>

          {published && (
            <p className="mt-2 text-[11.5px] text-gray-400">
              The catalog currently says {fmtRate(published.pct)}
              {published.note && <> — {published.note}</>}.
            </p>
          )}

          <p className="mt-4 pt-3.5 border-t border-gray-100 text-[11.5px] leading-relaxed text-gray-400">
            Corrections are yours and are stored separately from the catalog, so updating the app
            never overwrites one. A corrected rate shows ✎ in the grid so it is never mistaken for a
            published one.
          </p>
        </div>
      )}
    </div>
  )
}
