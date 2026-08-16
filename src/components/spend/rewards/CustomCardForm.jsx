import { useState } from 'react'
import { normalizeCustomCard, newCustomId } from '../../../utils/rewardsModel.js'
import { RATE_CATEGORIES, CATALOG_REGIONS, REGION_LABELS } from '../../../constants/cardCatalog.js'
import { rate as fmtRate, dollars } from './format.js'

const BLANK = { name: '', issuer: '', region: 'us', fee: '', base: '1', rates: {} }

/**
 * Cards you add yourself, for anything the catalog doesn't carry — a credit union card, a regional
 * issuer, a product that has since been discontinued.
 *
 * Stored in `settings.cardRewards.custom` under a `custom:`-prefixed id, never written into
 * `CARD_CATALOG`. The catalog stays a shipped, replaceable file in git; a card you authored is
 * yours and survives every update. The prefix is what guarantees the two can never collide.
 *
 * A custom card is read by exactly the same code that reads a shipped one, so everything typed here
 * goes through `normalizeCustomCard` on the way in. An empty rate is dropped rather than stored as
 * a zero — "I didn't fill this in" and "this card pays nothing here" are different claims.
 */
export default function CustomCardForm({ custom = {}, demoMode = false, onChange }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(BLANK)

  const entries = Object.entries(custom)
  const set = patch => setDraft(d => ({ ...d, ...patch }))

  function setRate(category, pct) {
    setDraft((d) => {
      const rates = { ...d.rates }
      if (pct === '') delete rates[category]
      else rates[category] = { pct }
      return { ...d, rates }
    })
  }

  function save() {
    const id = newCustomId(custom)
    onChange({ ...custom, [id]: normalizeCustomCard(draft, id) })
    setDraft(BLANK)
  }

  function remove(id) {
    const next = { ...custom }
    delete next[id]
    onChange(next)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50/60 transition-colors rounded-xl"
      >
        <span>
          <span className="block text-[15px] font-semibold text-gray-900">Add your own card</span>
          <span className="block mt-0.5 text-[12.5px] text-gray-400">
            {entries.length
              ? `${entries.length} card${entries.length === 1 ? '' : 's'} you added`
              : 'For a card the catalog doesn’t carry — a credit union, a regional issuer'}
          </span>
        </span>
        <span className="text-gray-400 text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-100">
          {entries.length > 0 && (
            <div className="mt-4 flex flex-col gap-1.5">
              {entries.map(([id, stored]) => {
                const card = normalizeCustomCard(stored, id)
                const rates = Object.entries(card.rates)
                return (
                  <div key={id} className="flex items-baseline justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                    <span className="text-[12.5px] text-gray-700 min-w-0">
                      <span className="font-medium">{card.short}</span>
                      <span className="text-gray-400">
                        {' · '}{fmtRate(card.base)} base
                        {rates.length > 0 && <> · {rates.map(([c, r]) => `${fmtRate(r.pct)} ${c}`).join(', ')}</>}
                        {card.fee > 0 && <> · {dollars(card.fee)}/yr</>}
                      </span>
                    </span>
                    <button
                      onClick={() => remove(id)}
                      disabled={demoMode}
                      className="shrink-0 text-[11.5px] text-gray-400 hover:text-red-600 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )
              })}
              {/* Removing a card its wallet entry still points at leaves that source unlinked
                  rather than mis-scored — `cardById` returns null and the setup screen asks again. */}
              <p className="text-[11px] text-gray-400">
                Removing a card unlinks any statement pointing at it, rather than scoring it wrong.
              </p>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Card name</span>
              <input
                value={draft.name}
                onChange={e => set({ name: e.target.value })}
                placeholder="Local Credit Union Visa"
                className="text-[12.5px] rounded-lg border border-gray-300 px-2 py-1.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Issuer</span>
              <input
                value={draft.issuer}
                onChange={e => set({ issuer: e.target.value })}
                placeholder="Optional"
                className="text-[12.5px] rounded-lg border border-gray-300 px-2 py-1.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Region</span>
              <select
                value={draft.region}
                onChange={e => set({ region: e.target.value })}
                className="text-[12.5px] rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {CATALOG_REGIONS.map(r => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Base %</span>
              <input
                type="number" min="0" step="0.1" value={draft.base}
                onChange={e => set({ base: e.target.value })}
                className="text-[12.5px] rounded-lg border border-gray-300 px-2 py-1.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Annual fee</span>
              <input
                type="number" min="0" step="5" value={draft.fee} placeholder="0"
                onChange={e => set({ fee: e.target.value })}
                className="text-[12.5px] rounded-lg border border-gray-300 px-2 py-1.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </label>
          </div>

          <p className="mt-3.5 text-[11px] uppercase tracking-wide text-gray-500">
            Bonus rates — leave blank for anything it pays the base rate on
          </p>
          <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {RATE_CATEGORIES.map(category => (
              <label key={category} className="flex items-center gap-1.5">
                <input
                  type="number" min="0" step="0.1"
                  value={draft.rates[category]?.pct ?? ''}
                  onChange={e => setRate(category, e.target.value)}
                  placeholder="—"
                  className="w-14 text-[12.5px] rounded-lg border border-gray-300 px-1.5 py-1 text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <span className="text-[11.5px] text-gray-600 truncate">{category}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={save}
              disabled={!draft.name.trim() || demoMode}
              className="px-3 py-1.5 text-[12.5px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Add card
            </button>
            <span className="text-[11.5px] text-gray-400">
              Then link it to a card name from your statements, the same as any other.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
