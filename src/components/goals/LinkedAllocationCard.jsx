import { useState } from 'react'
import { allocationSegments, money } from '../../utils/goalsModel.js'
import { ALLOCATION } from './palette.js'

const keyOf = s => `${s.sourceType}::${s.sourceId}`
const inputClass = 'rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60'

/**
 * A goal's linked accounts, and how each of those accounts is spoken for.
 *
 * A link earmarks a percentage of a real source — a savings account, a holdings account-type
 * bucket, or cash — and a linked goal's current amount is derived from those sources rather than
 * typed. The bar is the point: a source is shared, capped at 100% across every goal, and until now
 * the only way to discover that another goal had claimed 60% of your TFSA was to be refused when
 * you tried to claim 50%.
 *
 * Changes save immediately rather than on a form submit, which is what lets an existing goal gain
 * its first link. The server re-validates capacity on every write and excludes the goal being
 * updated from the total, so there is no "don't count this goal against itself" arithmetic here.
 */
export default function LinkedAllocationCard({ goal, sources = [], onSave, saving, error, readOnly, readOnlyTitle }) {
  const [pickKey, setPickKey] = useState('')
  const [pickPct, setPickPct] = useState('')

  const links = goal.links ?? []
  const linkedKeys = links.map(keyOf)
  const candidates = sources.filter(s => !linkedKeys.includes(keyOf(s)) && s.remainingPct > 0)
  const picked = sources.find(s => keyOf(s) === pickKey)
  const maxPct = picked?.remainingPct ?? 0

  function addLink() {
    if (!picked) return
    const pct = Math.min(maxPct, parseFloat(pickPct))
    if (!pct || pct <= 0) return
    onSave([...links, { sourceType: picked.sourceType, sourceId: picked.sourceId, percent: pct }])
    setPickKey('')
    setPickPct('')
  }

  const linkedTotal = links.reduce((sum, link) => {
    const src = sources.find(s => keyOf(s) === keyOf(link))
    return sum + (src ? (src.currentValue * link.percent) / 100 : 0)
  }, 0)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-[13px] font-semibold text-gray-700">Linked accounts — allocation</h3>

      {links.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">
          Not linked to any account. Link one and this goal tracks its balance automatically instead
          of needing funds added by hand.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {links.map((link, i) => {
            const src = sources.find(s => keyOf(s) === keyOf(link))
            if (!src) {
              // A source can vanish — a savings account deleted, the last holding in a bucket sold.
              return (
                <div key={i} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-gray-500">{link.sourceId} — {link.percent}% (account no longer exists)</span>
                  <RemoveButton onClick={() => onSave(links.filter((_, j) => j !== i))} disabled={saving || readOnly} title={readOnlyTitle} />
                </div>
              )
            }
            const alloc = allocationSegments(src, link.percent)
            return (
              <div key={i}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="truncate text-xs font-medium text-gray-700">{src.name}</span>
                  <span className="flex shrink-0 items-baseline gap-3 text-[11px] text-gray-400">
                    ${money(src.currentValue)} total
                    <RemoveButton onClick={() => onSave(links.filter((_, j) => j !== i))} disabled={saving || readOnly} title={readOnlyTitle} />
                  </span>
                </div>
                <div className="flex h-4 gap-px overflow-hidden rounded bg-gray-100">
                  {alloc.segments.map(seg => (
                    <div
                      key={seg.kind}
                      style={{ width: `${seg.pct}%` }}
                      title={`${SEGMENT_LABEL[seg.kind]} ${seg.pct}% — $${money(seg.value)}`}
                      className={`flex items-center justify-center overflow-hidden whitespace-nowrap text-[9.5px] font-semibold ${ALLOCATION[seg.kind]}`}
                    >
                      {SEGMENT_LABEL[seg.kind]} {seg.pct}%
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-gray-400">
                  {alloc.freePct > 0
                    ? `${alloc.freePct}% free · $${money(alloc.freeValue)} available to link`
                    : 'Fully allocated'}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {candidates.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            className={inputClass + ' min-w-[12rem] flex-1'}
            value={pickKey}
            disabled={saving || readOnly}
            title={readOnly ? readOnlyTitle : undefined}
            onChange={(e) => { setPickKey(e.target.value); setPickPct('') }}
          >
            <option value="">Add an account…</option>
            {candidates.map(s => (
              <option key={keyOf(s)} value={keyOf(s)}>
                {s.name} (${money(s.currentValue)}, {s.remainingPct}% free)
              </option>
            ))}
          </select>
          <input
            className={inputClass + ' w-20'}
            type="number" min="0" max={maxPct} step="0.01" placeholder="%"
            value={pickPct}
            disabled={!picked || saving || readOnly}
            onChange={(e) => setPickPct(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addLink()}
          />
          <button
            type="button"
            onClick={addLink}
            disabled={!picked || !pickPct || saving || readOnly}
            title={readOnly ? readOnlyTitle : undefined}
            className="whitespace-nowrap rounded-lg bg-gray-800 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
          >
            Add
          </button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-gray-400">
          {sources.length === 0
            ? 'No accounts available to link. Add savings accounts or holdings on the Investments page.'
            : 'Every account is either already linked here or fully allocated to other goals.'}
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {links.length > 0 && (
        <p className="mt-3 text-[11px] text-blue-600">
          Linked total: ${money(linkedTotal)} — this is the goal’s current amount, auto-updated as
          balances and prices change.
        </p>
      )}
    </div>
  )
}

const SEGMENT_LABEL = { this: 'This goal', other: 'Other goals', free: 'Free' }

function RemoveButton({ onClick, disabled, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? title : undefined}
      className="text-[11px] text-gray-300 transition-colors hover:text-red-500 disabled:opacity-50 disabled:hover:text-gray-300"
    >
      Remove
    </button>
  )
}
