import { CATEGORY_COLORS } from '../../../constants/categories.js'
import { money, dollars, rate as fmtRate } from './format.js'

/**
 * Where your spending actually went — the one block that reads real per-row card attribution
 * rather than modelling what a card would pay.
 *
 * Each row is a category, and the bar beneath it is the money split by the card it really landed
 * on. Solid where that card was the best one available, faded where it was not. The faded width is
 * the thing to look at: it is spending that could have earned more by doing nothing except reaching
 * for a different card.
 *
 * Ranked by what the misrouting cost, not by size, so the top row is always the one worth fixing.
 * A category already routed correctly still appears — a clean row is information too, and hiding it
 * would make the page look like an accusation rather than an account.
 */
export default function SpendAudit({ rows = [], unknownQuarters = [], leftBehind = 0 }) {
  const actionable = rows.filter(row => row.spend > 0)
  if (!actionable.length) return null

  const max = actionable.reduce((m, row) => Math.max(m, row.spend), 0)

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="text-[15px] font-semibold text-gray-900">Where your spending went</h3>
      <p className="mt-1 text-[12.5px] text-gray-400">
        {leftBehind > 0 ? (
          <>
            {money(leftBehind)} of this window earned less than it could have, by card choice alone
          </>
        ) : (
          <>Every category is already on the best card you hold</>
        )}
      </p>

      {/* A window whose rotating quarters nobody knows is scored at base, so everything above is a
          floor. Said once here rather than hatched onto every row: we cannot tell which categories
          an unknown quarter would have covered, and marking all of them would be noise. */}
      {unknownQuarters.length > 0 && (
        <p className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11.5px] leading-relaxed text-amber-900">
          {unknownQuarters.map(q => `${q.short} ${q.quarterKey.replace('-', ' ')}`).join(', ')}
          {unknownQuarters.length === 1 ? ' is a quarter' : ' are quarters'} nobody has recorded, so
          those months are scored at the base rate. Every figure here is a floor, not a ceiling.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3.5">
        {actionable.map((row) => {
          const color = CATEGORY_COLORS[row.category] ?? '#94a3b8'
          return (
            <div key={row.category}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0 self-center" style={{ background: color }} />
                  <span className="text-[13px] text-gray-800">{row.category}</span>
                  <span className="text-[11.5px] text-gray-400 truncate">{dollars(row.spend)}</span>
                </span>
                <span className="text-[12px] shrink-0">
                  {row.leftBehind > 0 ? (
                    <span className="text-amber-600 font-medium">{money(row.leftBehind)} left behind</span>
                  ) : row.unlinkedSpend >= row.spend ? (
                    // "$0 earned" here would read as "this card pays nothing", when what it means
                    // is that nobody has told us what the card is. Different problem, different fix.
                    <span className="text-gray-400">not scored</span>
                  ) : (
                    <span className="text-gray-400">{money(row.earned)} earned</span>
                  )}
                </span>
              </div>

              {/* Width is the category's share of the biggest category, so rows are comparable to
                  each other rather than each being stretched to full width. */}
              {/* Each card gets one segment, split where it needs to be: solid for the months that
                  card WAS the best one here, faded for the months it was not. A rotating bonus makes
                  that a per-month answer, so a single card can legitimately be both. */}
              <div className="mt-1.5 flex h-2.5 rounded-full overflow-hidden bg-gray-100" style={{ width: `${max > 0 ? (row.spend / max) * 100 : 0}%`, minWidth: '12%' }}>
                {row.slices.flatMap((slice) => {
                  const onW = row.spend > 0 ? (slice.onBestSpend / row.spend) * 100 : 0
                  const offW = row.spend > 0 ? (slice.offBestSpend / row.spend) * 100 : 0
                  const unW = slice.linked ? 0 : slice.share * 100
                  const seg = (kind, width, opacity, note) => width <= 0 ? null : (
                    <div
                      key={`${slice.sourceName}-${kind}`}
                      title={`${slice.short} · ${dollars(slice.spend)} · ${note}`}
                      style={{ width: `${width}%`, background: color, opacity }}
                    />
                  )
                  return [
                    seg('on', onW, 1, 'on the best card for those months'),
                    seg('off', offW, 0.28, 'a better card was available those months'),
                    seg('unlinked', unW, 0.15, 'not linked, so not scored'),
                  ].filter(Boolean)
                })}
              </div>

              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px] text-gray-400">
                {row.slices.map(slice => (
                  <span key={slice.sourceName}>
                    <span className={slice.onBestShare > 0.5 ? 'text-gray-600' : 'text-gray-400'}>{slice.short}</span>
                    {' '}{Math.round(slice.share * 100)}%
                    {!slice.linked && <span className="text-gray-300"> · not linked</span>}
                  </span>
                ))}
                {/* Only stated flatly when it held all window. With a rotating bonus in play the
                    best card for a category changes with the quarter, and "Discover it pays 5% on
                    Transport" is true in one and false in the next. */}
                {row.leftBehind > 0 && (
                  row.bestVaries ? (
                    <span className="text-gray-500">→ best card changed during this window</span>
                  ) : row.best && !row.best.tie ? (
                    <span className="text-gray-500">
                      → {row.best.card.short} pays {fmtRate(row.best.rate)}
                    </span>
                  ) : null
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-4 pt-3.5 border-t border-gray-100 text-[11.5px] leading-relaxed text-gray-400">
        Solid is spending that landed on the best card you held <em>that month</em>; faded is spending
        that did not. Rotating categories change every quarter, so one card can be the right call in
        part of a window and the wrong one in the rest — which is why a bar can be part solid and
        part faded for the same card. Money on a card you haven&rsquo;t linked is shown palest of
        all and never counted as left behind; there is nowhere for it to have been rerouted to.
      </p>
    </div>
  )
}
