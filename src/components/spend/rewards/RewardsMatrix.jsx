import { CATEGORY_COLORS } from '../../../constants/categories.js'
import { catalogCard } from '../../../constants/cardCatalog.js'
import { withSlot, withoutSlotFor, withQuarter } from '../../../utils/rewardsModel.js'
import { issuerArt } from './cardArt.js'
import { dollars, rate as fmtRate } from './format.js'

/**
 * Which card to reach for, per category.
 *
 * Rows are the categories your scoped spending actually touches — not the whole category list, so
 * a filter chip genuinely narrows this — ranked by monthly spend, because the top row is where
 * getting it wrong costs the most. Columns are the linked cards, likewise scoped.
 *
 * Two kinds of cell are editable, and both write through a pure transform in `rewardsModel`:
 *
 *   chooser  A card whose bonus categories you pick (TD Cash, Customized Cash). The cell asks
 *            which SLOT applies here, not which category — the row already is the category.
 *   rotating A card whose bonus category changes quarterly (Discover it). The cell records this
 *            window's quarter. Setting one moves the bonus off whatever else held it.
 *
 * Everything else is read-only: a published rate is not the user's to edit here. Correcting one is
 * a separate, deliberate act, and it lands in Phase 5 with its own editor.
 */
export default function RewardsMatrix({
  rows,
  cards,
  wallet = {},
  categoryColors = CATEGORY_COLORS,
  currentQuarter,
  demoMode = false,
  onEntryChange,
}) {
  if (!cards.length || !rows.length) return null

  // Derived up front rather than collected while rendering: the footnote sits after the table in
  // the tree, and depending on JSX evaluation order to have populated it is the kind of thing that
  // survives until someone reorders two blocks.
  const marks = {
    partial: rows.some(r => r.cells.some(c => c.partial)),
    corrected: rows.some(r => r.cells.some(c => c.corrected)),
    rotating: rows.some(r => r.cells.some(c => c.rotating)),
  }

  function cellSelect(card, row, cell) {
    const entry = card && wallet[card.sourceName]
    if (!entry) return null
    // A corrected rate is the user's own explicit statement about this card. Offering to overwrite
    // it with a slot pick from the same screen would make the correction look provisional.
    if (cell.corrected) return null

    // What this cell pays with no slot and no quarter recorded on it. Read from the catalog rather
    // than from the resolved card, whose rates already have the current choice merged in: on a card
    // that both publishes rates and lets you choose one (Customized Cash pays 2% on grocery *and*
    // 3% on a category you pick), calling the cleared option "1% base" would understate it.
    const published = catalogCard(card.id)?.rates?.[row.category]?.pct ?? card.base

    if (card.chooser) {
      const pcts = card.chooser.pcts ?? []
      const held = cell.detail?.chooser ? String(cell.detail.slot) : ''
      // What each slot is pointed at right now, so an option can say what moving it would cost.
      const slots = entry.slots ?? {}
      return {
        value: held,
        options: [
          { value: '', label: `${fmtRate(published)}${published === card.base ? ' base' : ''}` },
          ...pcts.map((pct, i) => {
            const on = slots[i] ?? slots[String(i)]
            const moving = on && on !== row.category
            return {
              value: String(i),
              label: moving ? `${fmtRate(pct)} — moves off ${on}` : fmtRate(pct),
            }
          }),
        ],
        onChange: value => onEntryChange(
          card.sourceName,
          value === '' ? withoutSlotFor(entry, row.category) : withSlot(entry, Number(value), row.category),
        ),
      }
    }

    // A published quarter is not the user's to set. Only a card with no calendar, or a quarter the
    // issuer has not announced yet, still asks.
    if (card.rotating && currentQuarter && card.rotatingSource !== 'catalog') {
      const on = entry.quarters?.[currentQuarter]
      return {
        value: on === row.category ? 'bonus' : '',
        options: [
          { value: '', label: `${fmtRate(published)}${published === card.base ? ' base' : ''}` },
          {
            value: 'bonus',
            label: on && on !== row.category
              ? `${fmtRate(card.rotating.pct)} — moves off ${on}`
              : fmtRate(card.rotating.pct),
          },
        ],
        onChange: value => onEntryChange(
          card.sourceName,
          withQuarter(entry, currentQuarter, value === 'bonus' ? row.category : null),
        ),
      }
    }

    return null
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 pt-5">
        <h3 className="text-[15px] font-semibold text-gray-900">Best card by category</h3>
        <p className="mt-1 text-[12.5px] text-gray-400">
          Published ongoing rates against the categories you actually spend in
          {currentQuarter && cards.some(c => c.rotating) && <> · rotating rates shown for {currentQuarter.replace('-', ' ')}</>}
        </p>
      </div>

      {/* Wide wallets scroll the table, never the page. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-y border-gray-100 bg-gray-50/60">
              <th className="text-left font-medium text-gray-500 text-[11.5px] uppercase tracking-wide px-5 py-2.5 min-w-[180px]">
                Category
              </th>
              {cards.map(card => (
                <th key={card.sourceName} className="px-3 py-2.5 min-w-[116px] align-bottom">
                  <span
                    className="block h-1 w-8 mx-auto mb-1.5 rounded-full"
                    style={{ background: issuerArt(card.issuer) }}
                  />
                  <span className="block text-[12px] font-semibold text-gray-700 leading-tight">
                    {card.short}
                  </span>
                  <span className="block text-[10.5px] text-gray-400 font-normal truncate max-w-[130px] mx-auto">
                    {card.sourceName}
                  </span>
                </th>
              ))}
              <th className="text-left font-medium text-gray-500 text-[11.5px] uppercase tracking-wide px-5 py-2.5 min-w-[170px]">
                Reach for
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const color = categoryColors[row.category] ?? '#94a3b8'
              return (
                <tr key={row.category} className="border-b border-gray-100 last:border-0">
                  <td className="px-5 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-[13px] text-gray-800">{row.category}</span>
                    </span>
                    <span className="block mt-0.5 ml-4 text-[11.5px] text-gray-400">
                      {dollars(row.monthly)}/mo average
                    </span>
                  </td>

                  {row.cells.map(cell => {
                    const card = cards.find(c => c.sourceName === cell.sourceName)
                    const select = cellSelect(card, row, cell)

                    return (
                      <td key={cell.sourceName} className="px-3 py-2.5 text-center">
                        {select ? (
                          <select
                            value={select.value}
                            disabled={demoMode}
                            onChange={e => select.onChange(e.target.value)}
                            aria-label={`${card?.short ?? cell.sourceName} rate on ${row.category}`}
                            className={`w-full max-w-[132px] text-[12.5px] rounded-md border px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:text-gray-400 disabled:bg-gray-50 ${
                              cell.isBest
                                ? 'border-transparent text-white font-semibold'
                                : 'border-gray-200 bg-white text-gray-600'
                            }`}
                            style={cell.isBest ? { background: color } : undefined}
                          >
                            {select.options.map(o => (
                              <option key={o.value} value={o.value} className="text-gray-900 bg-white font-normal">
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : cell.isBest ? (
                          <span
                            className="inline-block px-2.5 py-1 rounded-md text-[12.5px] font-semibold text-white"
                            style={{ background: color }}
                          >
                            {fmtRate(cell.pct)}
                            {cell.partial && <sup className="ml-0.5 font-normal">†</sup>}
                            {cell.corrected && <sup className="ml-0.5 font-normal">✎</sup>}
                          </span>
                        ) : (
                          <span className="text-[12.5px] text-gray-500">
                            {fmtRate(cell.pct)}
                            {cell.partial && <sup className="ml-0.5 text-gray-400">†</sup>}
                            {cell.corrected && <sup className="ml-0.5 text-gray-400">✎</sup>}
                          </span>
                        )}
                      </td>
                    )
                  })}

                  <td className="px-5 py-2.5">
                    <WinnerCell row={row} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3.5 border-t border-gray-100 text-[11.5px] leading-relaxed text-gray-400 flex flex-col gap-1">
        {marks.partial && (
          <span>
            <span className="text-gray-500">†</span> the bonus covers only part of this category, so
            the rate shown is an over-estimate. {partialNotes(rows)}
          </span>
        )}
        {marks.corrected && (
          <span><span className="text-gray-500">✎</span> a rate you corrected, not the catalog&rsquo;s.</span>
        )}
        {marks.rotating && (
          <span>Rotating rates apply only to the quarter recorded against them.</span>
        )}
        {!demoMode && (cards.some(c => c.chooser) || cards.some(c => c.rotating)) && (
          <span>Dropdown cells are yours to set — they record a choice the issuer already let you make.</span>
        )}
      </div>
    </div>
  )
}

/** The category names whose bonus is partial, with what the issuer actually covers. */
function partialNotes(rows) {
  const notes = new Set()
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.partial && cell.detail?.note) notes.add(`${row.category}: ${cell.detail.note}`)
    }
  }
  return [...notes].join(' · ')
}

/**
 * A tie is reported as a tie. Naming an arbitrary winner among three cards that all pay 1% would
 * send someone to dig out a specific card for no gain at all.
 */
function WinnerCell({ row }) {
  const best = row.best
  if (!best) return <span className="text-[12.5px] text-gray-300">—</span>

  if (best.tie) {
    return (
      <>
        <span className="text-[13px] text-gray-500">Any card</span>
        <span className="block text-[11.5px] text-gray-400">
          all pay {fmtRate(best.rate)} here
        </span>
      </>
    )
  }

  return (
    <>
      <span className="text-[13px] font-medium text-gray-900">{best.card.short}</span>
      <span className="block text-[11.5px] text-gray-400">
        {fmtRate(best.rate)}
        {best.capMo !== Infinity && (
          <> to {dollars(best.capMo)}/mo, then {fmtRate(row.secondRate)}</>
        )}
      </span>
    </>
  )
}
