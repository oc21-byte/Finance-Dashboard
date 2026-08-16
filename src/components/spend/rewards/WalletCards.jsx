import { issuerArt, INERT_ART } from './cardArt.js'
import { money, dollars } from './format.js'

/**
 * The wallet: one tile per linked card, plus the cards we were told we cannot score.
 *
 * A tile shows what that card earned over the window on screen — an observation, never annualized.
 * Unlisted cards get an inert grey tile rather than being hidden: their spend is real and their
 * absence from the total has to be visible, or the headline quietly reads low.
 */
export default function WalletCards({
  cards,
  earnedByCard = [],
  unlisted = [],
  windowLabel,
  onSetup,
  canSetup = true,
}) {
  const earned = Object.fromEntries(earnedByCard.map(c => [c.sourceName, c.period]))

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
      {cards.map(card => (
        <div
          key={card.sourceName}
          className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col"
        >
          <div
            className="h-14 shrink-0 flex items-end justify-between px-3 pb-2"
            style={{ background: issuerArt(card.issuer) }}
          >
            <span className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/85">
              {card.issuer}
            </span>
            {card.rotating && (
              <span className="px-2 py-0.5 rounded-full bg-white/20 text-[9.5px] font-semibold text-white">
                rotates
              </span>
            )}
            {card.chooser && (
              <span className="px-2 py-0.5 rounded-full bg-white/20 text-[9.5px] font-semibold text-white">
                you choose
              </span>
            )}
          </div>
          <div className="px-4 pt-3 pb-4 flex flex-col flex-1">
            <div className="text-[14px] font-semibold text-gray-900">{card.name}</div>
            {/* The ledger's own name for this card, which is what every other tab calls it. */}
            <div className="mt-0.5 text-[11.5px] text-gray-400 truncate">{card.sourceName}</div>
            <p className="mt-2 flex-1 text-[12px] leading-relaxed text-gray-500">{card.summary}</p>
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-baseline justify-between gap-2">
              <span className="text-[16px] font-semibold text-gray-900">
                {money(earned[card.sourceName] ?? 0)}
              </span>
              <span className="text-[12px] text-gray-400">
                {card.fee ? `${dollars(card.fee)} / yr` : 'No annual fee'}
              </span>
            </div>
            <div className="mt-0.5 text-[11.5px] text-gray-400">
              estimated, {windowLabel}
            </div>
          </div>
        </div>
      ))}

      {unlisted.map(row => (
        <div
          key={row.sourceName}
          className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col"
        >
          <div className="h-14 shrink-0 flex items-end px-3 pb-2" style={{ background: INERT_ART }}>
            <span className="text-[9px] font-semibold tracking-[0.12em] uppercase text-gray-500">
              not in the catalog
            </span>
          </div>
          <div className="px-4 pt-3 pb-4 flex flex-col flex-1">
            <div className="text-[14px] font-semibold text-gray-900 truncate">{row.sourceName}</div>
            <p className="mt-2 flex-1 text-[12px] leading-relaxed text-gray-500">
              A rewards card we have no rates for, so nothing below scores it. Its
              spend still counts — {dollars(row.spend)} this period.
            </p>
            <div className="mt-3 pt-3 border-t border-gray-100 text-[12px] text-gray-400">
              Not included in the estimate
            </div>
          </div>
        </div>
      ))}

      {canSetup && (
        <button
          onClick={onSetup}
          className="border border-dashed border-gray-300 rounded-xl bg-white flex flex-col items-center justify-center gap-2 p-5 min-h-[180px] hover:border-blue-500 hover:bg-slate-50 transition-colors"
        >
          <span className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-xl text-gray-400">
            +
          </span>
          <span className="text-[13px] font-semibold text-gray-700">Link another card</span>
          <span className="text-[11.5px] leading-snug text-gray-400 text-center max-w-[200px]">
            Point a card name from your statements at the card you actually hold
          </span>
        </button>
      )}
    </div>
  )
}
