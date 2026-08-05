import { useState } from 'react'
import dayjs from 'dayjs'
import PeriodChips from '../shared/PeriodChips.jsx'
import { buildWaterfall } from '../../utils/waterfallModel.js'
import { buildUnaccountedRows, MATERIAL_FLOOR, MATERIAL_SHARE } from '../../utils/liquidNetWorth.js'
import { WATERFALL } from './palette.js'

const MATERIAL_SHARE_PCT = Math.round(MATERIAL_SHARE * 100)

const money = n => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString()

// Bar labels sit over columns that get narrow at six bars on a phone, so they compact. Every
// figure in the drill-down below stays exact — this shortening is only for the chart itself.
function compact(n) {
  const abs = Math.abs(n)
  if (abs < 1000) return (n < 0 ? '−$' : '$') + Math.round(abs)
  const thousands = abs / 1000
  return (n < 0 ? '−$' : '$') + thousands.toFixed(thousands < 10 ? 1 : 0).replace(/\.0$/, '') + 'k'
}

const day = d => dayjs(d).format('MMM D')

const FILL = {
  total: WATERFALL.total,
  up: WATERFALL.moneyIn,
  down: WATERFALL.moneyOut,
  market: WATERFALL.market,
  unaccounted: WATERFALL.unaccounted,
}

const BAR_HELP = {
  start: 'Liquid net worth at the start of this window.',
  moneyIn: 'Everything that landed in your chequing account — pay, transfers in, refunds.',
  moneyOut: 'Everything that left it, including money moved into savings and investments.',
  market: 'Change in unrealised gain. Contributions cancel out, so this is performance only.',
  unaccounted: 'The gap between what the ledger predicted and what the bank actually held.',
  end: 'Liquid net worth at the end of this window.',
}

// Said once per group rather than once per row. Three identical sentences stacked down a list read
// as boilerplate, and the reader stops seeing any of them.
const GROUP = {
  unexplained: {
    title: 'The ledger disagreed with the bank',
    note: 'These stretches were fully imported and the balance still did not match. This is the part worth chasing.',
  },
  lag: {
    title: 'Statement lag',
    note: 'Statements arrive weeks after the fact, so this is spending that really happened and simply has not been imported yet. Expected, not a problem.',
  },
  residual: {
    title: 'Residual',
    note: 'What is left after every named explanation. It should sit near zero; anything large means the decomposition itself has sprung a leak.',
  },
}

const GROUP_ORDER = ['unexplained', 'lag', 'residual']

/**
 * "Where the change came from" — a bridge from the starting balance to today's.
 *
 * Replaces the Monthly Net Cash Flow bars, which showed net cash per month and so could never
 * explain the balance: cash flow is one of four things moving liquid net worth, and it was the
 * only one on screen.
 *
 * The card's whole claim is that the change is FULLY accounted for, which is why the Unaccounted
 * bar exists rather than being folded into Market. A residual smeared into an investment-return
 * figure is not a tidier chart, it is a false statement about performance. Clicking that bar opens
 * the itemised version — dated, with the ledger's expectation beside the bank's actual figure, and
 * a link into Finances scoped to exactly the window each gap opened up in.
 *
 * Scoped by its own period chips: the KPIs above are today's balances and the trend below runs on
 * calendar time, so a single shared control would mean three different things.
 */
export default function ChangeAttributionCard({
  attribution,
  period,
  onPeriodChange,
  range,
  trailingRows = 0,
  onInspectWindow,
  onOpenFinances,
  onOpenSpend,
}) {
  const [expanded, setExpanded] = useState(false)

  const model = buildWaterfall(attribution)
  const rows = buildUnaccountedRows(attribution)
  const unaccounted = model.bars.find(b => b.key === 'unaccounted')
  // The flags `buildChangeAttribution` already computes, finally read. Either one being true means
  // the gap is worth a reader's time; neither means it is reconstruction rounding.
  const material = !!(attribution?.hasReconciliation || attribution?.hasOther)

  // The card ends on the newest RECORDED BALANCE, which can sit behind the newest transaction.
  // Rows in that gap are real and will appear next reading, so Finances will legitimately report a
  // bigger total for what looks like the same period. Better to say so than to be caught at it.
  const endsShort = attribution?.to && range?.to && attribution.to < range.to

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <div className="flex items-start justify-between gap-5 flex-wrap mb-1">
        <h2 className="text-[15px] font-semibold text-gray-900">Where the change came from</h2>
        {/* `compact` on purpose: this card already states its window in the subtitle and its
            shortfall in the footnote, so the chips' own "N months · N transactions" meta would be
            a third telling of the same thing. That is why no count is passed here. */}
        <PeriodChips value={period} onChange={onPeriodChange} range={range} compact />
      </div>

      <p className="text-[12.5px] leading-relaxed text-gray-400 max-w-[760px]">
        {model.empty
          ? 'Not enough history yet to break a change down.'
          : <>Every dollar between {day(attribution.from)} and {day(attribution.to)}, accounted for.
              Scopes this card only — the balances above are today&apos;s, and the trend below has its own range.</>}
      </p>

      {model.empty ? (
        <div className="py-14 text-center">
          <p className="text-sm text-gray-400">Nothing to compare against in this range.</p>
          <p className="mt-1 text-xs text-gray-300">
            A breakdown needs two readings of your balances. Come back after another day of history.
          </p>
        </div>
      ) : (
        <>
          <Headline attribution={attribution} />

          <div className="mt-5 overflow-x-auto">
            <div style={{ minWidth: model.bars.length * 62 }}>
              <div className="relative px-1" style={{ height: model.height }}>
                {/* Gridlines behind everything, so a bar is never read against nothing. */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="border-t border-dashed border-gray-100" />
                  ))}
                </div>

                <div className="absolute inset-0 flex">
                  {model.bars.map((bar, i) => {
                    const isUnaccounted = bar.key === 'unaccounted'
                    const connector = model.connectors.find(c => c.index === i)
                    return (
                      <div key={bar.key} className="group relative flex-1 min-w-0 px-1.5">
                        {/* The carry from this bar's landing level to the next bar's start. */}
                        {connector && (
                          <div
                            className="absolute right-0 w-[calc(50%+0.375rem)] border-t border-dashed border-gray-300 pointer-events-none"
                            style={{ top: connector.y, transform: 'translateX(50%)' }}
                          />
                        )}

                        <button
                          type="button"
                          onClick={isUnaccounted ? () => setExpanded(e => !e) : undefined}
                          aria-expanded={isUnaccounted ? expanded : undefined}
                          title={BAR_HELP[bar.key] ?? ''}
                          disabled={!isUnaccounted}
                          className={`absolute inset-x-1.5 rounded-[3px] transition-opacity ${
                            isUnaccounted ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
                          }`}
                          style={{
                            top: bar.y,
                            height: bar.h,
                            background: FILL[bar.kind],
                            // The truncated axis cuts the two totals off at the floor. A dashed
                            // base edge says the bar continues below rather than starting there.
                            borderBottom: model.truncated && bar.kind === 'total'
                              ? `2px dashed ${WATERFALL.totalStroke}` : undefined,
                            outline: isUnaccounted && expanded ? `2px solid ${WATERFALL.totalStroke}` : undefined,
                          }}
                        />

                        <span
                          className="absolute inset-x-0 text-center text-[10.5px] font-semibold text-gray-600 pointer-events-none"
                          style={{ top: Math.max(0, bar.y - 15) }}
                        >
                          {bar.delta === null ? compact(bar.value) : compact(bar.delta)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex border-t border-gray-200 pt-2">
                {model.bars.map(bar => (
                  <div key={bar.key} className="flex-1 min-w-0 px-1 text-center">
                    {/* Wraps rather than truncates: at phone width "Money in" and "Money out" both
                        clip to "Money …", which is worse than two short lines. */}
                    <p className="text-[11px] font-medium leading-tight text-gray-600">{bar.label}</p>
                    {bar.date && (
                      <p className="text-[10px] leading-tight text-gray-400">{day(bar.date)}</p>
                    )}
                    {bar.key === 'unaccounted' && material && (
                      <button
                        onClick={() => setExpanded(e => !e)}
                        className="text-[10px] font-semibold text-blue-600 hover:text-blue-800"
                      >
                        {expanded ? 'Hide' : 'Break down'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {endsShort && (
            <p className="mt-2.5 text-[11px] text-gray-400">
              This ends {day(attribution.to)}, the last day with a recorded balance — not{' '}
              {day(range.to)}, where your transactions end. The{' '}
              {trailingRows > 0 ? `${trailingRows} transaction${trailingRows === 1 ? '' : 's'}` : 'transactions'}{' '}
              in between are real and land in the next reading, so Finances will report a larger
              total for the same chip.
            </p>
          )}

          {model.truncated && (
            <p className="mt-2.5 text-[11px] text-gray-400">
              The axis starts at {money(model.floor)}, not zero — otherwise a change this size would
              be invisible against the balance. The dashed base on{' '}
              {model.bars.filter(b => b.kind === 'total').map(b => b.label).join(' and ')} marks the
              cut; read the amounts from the labels, not the heights.
            </p>
          )}

          {/* The bar is drawn whenever it is non-zero, because dropping it would leave the steps
              short of End — and folding the remainder into Market would report untraceable movement
              as investment return, which is the one thing this card exists not to do. What changes
              below the materiality line is the WORDING: a residual this small is rounding in the
              reconstruction, and inviting someone to go chase it costs more than it is worth. */}
          {unaccounted && !expanded && (
            material ? (
              <p className="mt-2 text-[11.5px] text-gray-500">
                {money(unaccounted.delta)} could not be traced to a transaction or to the market.{' '}
                <button onClick={() => setExpanded(true)} className="font-semibold text-blue-600 hover:text-blue-800">
                  See what it is
                </button>
              </p>
            ) : (
              <p className="mt-2.5 text-[11px] text-gray-400">
                {money(unaccounted.delta)} is rounding in the reconstruction, not untraced money —
                under {money(MATERIAL_FLOOR)} and {MATERIAL_SHARE_PCT}% of the change. Everything
                else is accounted for.
              </p>
            )
          )}

          {expanded && (
            <UnaccountedBreakdown rows={rows} onInspectWindow={onInspectWindow} />
          )}

          <div className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
            <Pill onClick={onOpenFinances}>Cashflow ↗ Finances</Pill>
            <Pill onClick={onOpenSpend}>Credit Card Spending ↗ Spend Analyzer</Pill>
          </div>
        </>
      )}
    </div>
  )
}

function Pill({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-semibold border border-gray-200 bg-white text-gray-500 hover:text-gray-800 hover:border-gray-300 transition-colors"
    >
      {children}
    </button>
  )
}

/**
 * The saved-vs-markets split, which is the sentence most people actually want from this card.
 *
 * Shares are over |saved| + |market| so they still total 100% when one term is negative. The
 * residual is deliberately absent: it is not an explanation, so giving it a percentage of the
 * explanation would be misleading.
 */
function Headline({ attribution }) {
  const { change, saved, market, savedShare, marketShare, basis } = attribution
  return (
    <div className="mt-3.5 flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <p className="text-[13px] text-gray-500">
        <span className={`text-lg font-semibold ${change >= 0 ? 'text-green-700' : 'text-red-600'}`}>
          {money(change)}
        </span>{' '}
        change in liquid net worth
      </p>
      <p className="text-[12.5px] text-gray-500">
        You saved <strong className="font-semibold text-gray-800">{money(saved)}</strong>
        {savedShare !== null && ` · ${savedShare}%`}
      </p>
      <p className="text-[12.5px] text-gray-500">
        Markets did <strong className="font-semibold text-gray-800">{money(market)}</strong>
        {marketShare !== null && ` · ${marketShare}%`}
        {basis === 'partial' && (
          <span className="ml-1 text-gray-400" title="One endpoint was valued at cost basis because a price was unavailable, so this figure understates or overstates the real return.">
            (partial pricing)
          </span>
        )}
      </p>
    </div>
  )
}

/**
 * The Unaccounted bar, itemised.
 *
 * Every row is dated and carries both figures — what the ledger predicted, and what you told it
 * the bank actually held. "Inspect" opens Finances on the exact stretch the gap opened up in,
 * which is the difference between a finding and an errand.
 */
function UnaccountedBreakdown({ rows, onInspectWindow }) {
  const groups = GROUP_ORDER
    .map(kind => ({
      kind,
      ...GROUP[kind],
      rows: rows.filter(r => r.kind === kind),
    }))
    .filter(g => g.rows.length > 0)

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/70 p-4">
      <h3 className="text-[13px] font-semibold text-gray-800">What the Unaccounted bar is made of</h3>

      {groups.length === 0 ? (
        <p className="mt-2 text-[12px] text-gray-400">
          Nothing to itemise — the whole amount is rounding noise.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map(group => {
            const total = group.rows.reduce((s, r) => s + r.amount, 0)
            // The residual is a single undateable number, so a card with a date column and an
            // "inspect" link would be scaffolding around nothing. It gets a line, not a row.
            const bare = group.kind === 'residual'
            return (
              <section key={group.kind}>
                <p className="text-[12px] font-semibold text-gray-700">
                  {group.title}
                  <span className={`ml-2 ${total >= 0 ? 'text-green-700' : 'text-red-600'}`}>{money(total)}</span>
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">{group.note}</p>

                {!bare && (
                  <ul className="mt-2 space-y-2">
                    {group.rows.map(row => (
                      <li key={row.key} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <p className="text-[13px] font-semibold text-gray-800">
                            {day(row.date)}
                            <span className={`ml-2 ${row.amount >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              {money(row.amount)}
                            </span>
                          </p>
                          <p className="text-[11.5px] text-gray-500">
                            Ledger expected <strong className="font-medium text-gray-700">{money(row.expected)}</strong>
                            {' · '}bank held <strong className="font-medium text-gray-700">{money(row.balance)}</strong>
                          </p>
                        </div>

                        {row.kind === 'unexplained' && onInspectWindow && (
                          <button
                            onClick={() => onInspectWindow({
                              from: row.from,
                              to: row.to,
                              reason: `${money(row.amount)} the ledger could not account for on ${day(row.date)}`,
                            })}
                            className="mt-1.5 text-[11.5px] font-semibold text-blue-600 hover:text-blue-800"
                          >
                            Inspect {day(row.from)} – {day(row.to)} in Finances ↗
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
