import { useState } from 'react'
import { walletEntryFor } from '../../../utils/rewardsModel.js'
import { issuerArt } from './cardArt.js'
import { money, dollars, rate as fmtRate } from './format.js'

/**
 * What one card you don't hold would change, on your real spending.
 *
 * Three lines and their arithmetic, printed rather than summarised: what the wallet earns today,
 * what it would earn with this card in it, and the fee. `net` is the third minus the other two, and
 * showing the working is the point — a single "+$240 a year" is a number you either trust or
 * don't, while three lines you can check is an argument.
 *
 * Every figure is annualized from average monthly spend, which is the only honest basis for
 * comparing a card you have never used. It is also why a short window suppresses the whole panel.
 */
export default function CandidatePreview({
  row,
  unlinkedSources = [],
  shortWindow = false,
  demoMode = false,
  onLink,
  onClose,
}) {
  const [claiming, setClaiming] = useState(false)
  const [source, setSource] = useState('')
  const { card, baseAnnual, candidateAnnual, fee, net, changes } = row

  function claim() {
    if (!source) return
    onLink(source, walletEntryFor(card.id))
    setClaiming(false)
    setSource('')
    onClose?.()
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/70 overflow-hidden">
      <div className="flex items-start gap-3 px-4 pt-4">
        <span className="w-10 h-7 rounded shrink-0 mt-0.5" style={{ background: issuerArt(card.issuer) }} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-gray-900">{card.name}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{card.summary}</p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-gray-400 hover:text-gray-600 text-sm leading-none p-1"
          aria-label="Close comparison"
        >
          ✕
        </button>
      </div>

      {shortWindow ? (
        <p className="mx-4 my-4 text-[12px] leading-relaxed text-gray-600">
          Not enough spending on screen to compare cards. This panel annualizes your average monthly
          spend, and a window this short would turn one unusual week into a yearly claim. Widen the
          period and the numbers come back.
        </p>
      ) : (
        <>
          <div className="mt-3.5 mx-4 rounded-lg bg-white border border-blue-100 divide-y divide-gray-100">
            <Line label="Your wallet today" value={money(baseAnnual)} />
            <Line label={`With the ${card.short}`} value={money(candidateAnnual)} />
            <Line label="Annual fee" value={fee ? `− ${dollars(fee)}` : 'None'} muted={!fee} />
            <Line
              label="Net change"
              value={`${net >= 0 ? '+' : '−'}${money(Math.abs(net))} a year`}
              strong
              tone={net > 0 ? 'good' : net < 0 ? 'bad' : 'flat'}
            />
          </div>

          {changes.length > 0 ? (
            <div className="mt-3.5 mx-4">
              <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">What changes</p>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {changes.map(change => (
                  <div key={change.category} className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="text-gray-700 truncate">
                      {change.category}
                      <span className="text-gray-400">
                        {' '}{fmtRate(change.fromRate)}
                        {change.fromCard && <> on {change.fromCard}</>}
                        {' → '}{fmtRate(change.toRate)}
                        {change.capMo && <> to {dollars(change.capMo)}/mo</>}
                      </span>
                    </span>
                    <span className="text-green-700 font-medium shrink-0">
                      +{money(change.gain)}{change.partial && <sup className="ml-0.5 font-normal text-gray-400">†</sup>}
                    </span>
                  </div>
                ))}
              </div>

              {/* A partial bonus is the difference between a real case for a card and a mirage: 5%
                  on flights booked through one portal is not 5% on everything filed as Transport. */}
              {changes.some(c => c.partial) && (
                <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                  <span className="text-gray-600">†</span> covers only part of the category, so this
                  gain is an over-estimate — {[...new Set(changes.filter(c => c.partial).map(c => `${c.category}: ${c.note}`))].join(' · ')}.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-3.5 mx-4 text-[12px] leading-relaxed text-gray-600">
              Nothing you spend on would earn more than it already does. The cards you hold already
              beat this one in every category on screen.
            </p>
          )}
        </>
      )}

      {/* Deliberately amber and always shown, including when the net is negative: a welcome bonus is
          the single most common reason a card that loses money on rates is still worth taking, and
          leaving it unsaid would make this panel look like the whole answer. */}
      <p className="mt-4 mx-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11.5px] leading-relaxed text-amber-900">
        Ongoing earn rates only. Welcome bonuses, intro APRs and annual credits are not counted here
        and are often worth more in year one than everything above.
      </p>

      <div className="mt-3.5 px-4 pb-4 flex items-center gap-2 flex-wrap">
        {claiming ? (
          <>
            {/* A card is linked to a NAME from your statements — that is what the wallet is keyed
                by. Without an unlinked name there is nothing to attach it to, and inventing one
                would create a card with no transactions. */}
            {unlinkedSources.length > 0 ? (
              <>
                <select
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  className="text-[12.5px] rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="">Which card on your statements?</option>
                  {unlinkedSources.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <button
                  onClick={claim}
                  disabled={!source || demoMode}
                  className="px-3 py-1.5 text-[12.5px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Link it
                </button>
                <button
                  onClick={() => setClaiming(false)}
                  className="px-3 py-1.5 text-[12.5px] text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
              </>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-gray-600">
                Every card name on your statements is already linked. Import a statement for this
                card, or change an existing link in the wallet setup above.
              </p>
            )}
          </>
        ) : (
          <button
            onClick={() => setClaiming(true)}
            disabled={demoMode}
            className="px-3 py-1.5 text-[12.5px] font-medium border border-gray-300 bg-white rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            I have this card
          </button>
        )}
      </div>
    </div>
  )
}

function Line({ label, value, strong = false, muted = false, tone = 'flat' }) {
  const toneClass = tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-600' : 'text-gray-900'
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <span className={`text-[12px] ${strong ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>{label}</span>
      <span className={`${strong ? `text-[14px] font-semibold ${toneClass}` : `text-[12.5px] ${muted ? 'text-gray-400' : 'text-gray-800'}`}`}>
        {value}
      </span>
    </div>
  )
}
