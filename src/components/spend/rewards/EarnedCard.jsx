import { money, dollars } from './format.js'
import { SHORT_WINDOW_MONTHS } from '../../../utils/rewardsModel.js'

/**
 * The rail's headline: what your cards paid you over the window on screen.
 *
 * The three figures here are deliberately kept apart, because collapsing any two of them is how a
 * rewards page starts lying:
 *
 *   the headline    An OBSERVATION. The window's own total, at the rates that applied in each of
 *                   its months. A short window makes it small, not wrong — "$12 this week" is
 *                   true however short the week — so it never carries the short-window caution.
 *   the projection  An EXTRAPOLATION. Average monthly spend at today's rates, ×12. This is the one
 *                   figure a 7-day window can make ridiculous, and the only one cautioned.
 *   left behind     A COMPARISON against perfect routing over the same window.
 *
 * Every number is estimated from published rates and says so. None of it reads the ledger's own
 * cashback rows: those are redemptions posted as statement credits, and adding them here would
 * count the same dollar twice.
 */
export default function EarnedCard({
  earned,
  optimal,
  leftBehind = 0,
  projection,
  range,
  coverage,
}) {
  const byCard = (earned?.byCard ?? []).filter(c => c.period > 0)
  const max = byCard.reduce((m, c) => Math.max(m, c.period), 0)
  const windowLabel = range?.label ?? 'this period'
  const unscored = coverage ? coverage.scorable - coverage.scored : 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <h3 className="text-[13.5px] font-semibold text-gray-900">Estimated earned</h3>

      <p className="mt-2 text-[28px] leading-none font-semibold tracking-tight text-gray-900">
        {money(earned?.period ?? 0)}
      </p>
      <p className="mt-1.5 text-[11.5px] text-gray-400">
        {windowLabel} · estimated from published rates
      </p>

      {byCard.length > 0 && (
        <div className="mt-3.5 flex flex-col gap-2">
          {byCard.map(card => (
            <div key={card.sourceName}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-gray-600 truncate">{card.short}</span>
                <span className="text-[12px] font-medium text-gray-800 shrink-0">{money(card.period)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-500"
                  style={{ width: `${max > 0 ? (card.period / max) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Spend on a card nobody linked earns nothing HERE, which is not the same as earning
          nothing. Said plainly, because a total that quietly excludes half the wallet is worse
          than no total at all. */}
      {earned?.unattributedSpend > 0 && (
        <p className="mt-3 pt-3 border-t border-gray-100 text-[11.5px] leading-relaxed text-gray-500">
          {dollars(earned.unattributedSpend)} of spending sits on {unscored === 1 ? 'a card' : 'cards'} this
          page can&rsquo;t score{unscored > 0 && <> — {unscored} of {coverage.scorable} unscored</>}. Whatever
          it earned isn&rsquo;t in the figure above.
        </p>
      )}

      <div className="mt-3 pt-3 border-t border-gray-100">
        {projection?.shortWindow ? (
          // The observed figure above stands; only the annualization is withheld.
          // `monthCount` rounds a 7-day window up to 1, so it is not something to quote back —
          // "1 month of spending" would be a plain misstatement of a week.
          <p className="text-[11.5px] leading-relaxed text-gray-400">
            Too short a window to project a year from — this much spending says more about the
            window than about the habit. Pick {SHORT_WINDOW_MONTHS} months or more for a yearly
            estimate. What you earned above still stands.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] text-gray-500">A year at this rate</span>
              <span className="text-[13.5px] font-semibold text-gray-900">
                {money(projection?.annualCurrent ?? projection?.annualOptimal ?? 0)}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-gray-400">
              Your average monthly spend per category at today&rsquo;s rates, ×12 — a forecast, not
              a total.
            </p>
          </>
        )}
      </div>

      {/* The gap between what you earned and what perfect routing would have earned. One line
          here; the category-by-category audit that explains it is still to come. */}
      {leftBehind > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] text-gray-500">Left behind</span>
            <span className="text-[13.5px] font-semibold text-amber-600">{money(leftBehind)}</span>
          </div>
          {/* Not `windowLabel.toLowerCase()` — the label is often a date range, and lowercasing it
              produces "feb 1, 2026". */}
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-400">
            This same window would have paid {money(optimal?.period ?? 0)} with every category on the
            card the grid names.
          </p>
        </div>
      )}
    </div>
  )
}
