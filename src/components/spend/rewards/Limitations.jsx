import { catalogVerifiedAt } from '../../../constants/cardCatalog.js'

/**
 * What this page does not do.
 *
 * Kept as a permanent fixture rather than a dismissible notice. Every figure here is an estimate
 * built from rates a human typed into a file, and the honest move is to say where that breaks
 * before someone changes a real habit on the strength of it. A rewards page that never states its
 * limits is asking to be trusted further than it has earned.
 */
export default function Limitations({ hasPartial = false, hasRotating = false }) {
  const verified = catalogVerifiedAt()

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <h3 className="text-[13.5px] font-semibold text-gray-900">What this doesn&rsquo;t cover</h3>

      <ul className="mt-2.5 flex flex-col gap-2 text-[11.5px] leading-relaxed text-gray-500">
        <li>
          <span className="text-gray-700">Ongoing rates only.</span> Welcome bonuses, sign-up offers,
          intro APRs and annual travel credits are all excluded — they are one-off or conditional,
          and folding them in would flatter a card for a year it will not repeat.
        </li>
        <li>
          <span className="text-gray-700">Rates go stale.</span> The catalog is hand-maintained and
          last verified {verified || 'recently'}. Issuers change categories and caps without notice,
          and nothing here checks. Your statement is the authority; this is an estimate.
        </li>
        <li>
          <span className="text-gray-700">Your categories aren&rsquo;t the issuer&rsquo;s.</span> Rewards
          follow merchant codes, not the category a transaction was filed under here. A restaurant
          inside a grocery store earns what the issuer says it earns.
          {hasPartial && <> Bonuses marked † cover only part of a category and are over-estimates.</>}
        </li>
        <li>
          <span className="text-gray-700">Points are converted at an assumed value.</span> A card
          earning 3x on dining is scored as a percentage using a fixed cents-per-point figure from
          the catalog. Change that assumption and the ranking changes with it — points cards are
          only ever as good as what you actually redeem them for.
        </li>
        {hasRotating && (
          <li>
            <span className="text-gray-700">Rotating bonuses are assumed activated.</span> Discover
            and Chase both make you turn each quarter on by hand, and a quarter you forgot earned
            the base rate instead — up to $75 of the difference. Nothing here knows which you
            activated, so every published quarter is counted as if you did.
          </li>
        )}
        <li>
          <span className="text-gray-700">No redemption tracking.</span> This is what your spending
          earned, not what you have banked or what a point is worth when you spend it. Cash back
          already credited to a statement lives on the Spend view, and is deliberately never added
          to the figures here — the same dollar would be counted twice.
        </li>
        <li>
          <span className="text-gray-700">No alerts.</span> Nothing watches for a rotating quarter
          opening or a cap you are about to hit. The page tells you what happened when you open it.
        </li>
      </ul>
    </div>
  )
}
