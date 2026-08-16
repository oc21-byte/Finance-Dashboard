import { catalogCard } from '../../../constants/cardCatalog.js'
import CardPicker, { pickerValueFor, walletEntryFor } from './CardPicker.jsx'

const money = n => '$' + Math.round(n).toLocaleString()

/**
 * The bridge between free-text source names and the catalog.
 *
 * A "card" in this app is `t.source` — whatever string was typed when a statement was imported.
 * Nothing else about it is known, so nothing can be scored until each source is pointed at a card.
 * This lists every source the ledger actually holds, most spend first, and asks once.
 *
 * Sources are never renamed or merged here. `source` is a persistence contract shared with the
 * filter chips, the card colours and the saved CSV mappings; this screen only adds a link beside
 * it, and deleting the link leaves the ledger untouched.
 */
export default function WalletSetup({
  sourceStates,
  wallet = {},
  onLink,
  demoMode = false,
  onDone,
}) {
  // Unlinked first — they are the only rows that are a question rather than an answer.
  const rows = [
    ...sourceStates.unlinked.map(s => ({ ...s, kind: null })),
    ...sourceStates.catalog.map(s => ({ ...s, kind: 'catalog' })),
    ...sourceStates.unlisted.map(s => ({ ...s, kind: 'unlisted' })),
    ...sourceStates.none.map(s => ({ ...s, kind: 'none' })),
  ]

  if (!rows.length) return null

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">Your cards</h2>
          <p className="mt-1 text-[12.5px] text-gray-400">
            Every card name in your statements. Point each one at the card you actually hold — rates
            come from there.
          </p>
        </div>
        {onDone && (
          <button
            onClick={onDone}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Done
          </button>
        )}
      </div>

      {demoMode && (
        <p className="mt-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-[12.5px] text-gray-500">
          Demo mode — cards can&rsquo;t be linked here, because nothing written in demo mode is saved.
        </p>
      )}

      <div className="mt-4 divide-y divide-gray-100">
        {rows.map(row => {
          const card = row.kind === 'catalog' ? catalogCard(row.catalogId) : null
          return (
            <div key={row.sourceName} className="py-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-gray-900 truncate">
                  {row.sourceName}
                </div>
                <div className="mt-0.5 text-[12px] text-gray-400">
                  {money(row.spend)} in this period
                  {card && <> · {card.summary}</>}
                  {row.kind === 'unlisted' && <> · counted, but no rates to score it with</>}
                  {row.kind === 'none' && <> · left out of the rewards page</>}
                  {row.stale && <> · the card it pointed at is no longer in the catalog</>}
                </div>
              </div>
              <CardPicker
                value={pickerValueFor(wallet[row.sourceName])}
                disabled={demoMode}
                className="w-72 max-w-full"
                onChange={value => onLink(row.sourceName, walletEntryFor(value, wallet[row.sourceName] ?? {}))}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
