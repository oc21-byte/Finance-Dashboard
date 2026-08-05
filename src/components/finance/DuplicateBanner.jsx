const money = n => '$' + Math.round(n).toLocaleString()

/**
 * The amber "possible duplicates" review prompt.
 *
 * It leads with the dollars at stake rather than the set count, because that is what makes the
 * cost of ignoring it concrete — "3 sets" reads as housekeeping, "$412 double-counted" does not.
 * The figure is the extra copies only (a set of 2 counts once, not twice), so it is exactly what
 * would come off the totals if every set were resolved.
 *
 * Nothing is ever auto-deleted: a genuine repeat charge is indistinguishable from a re-import,
 * so the banner routes to the table and the call stays with the user.
 */
export default function DuplicateBanner({ setCount, dollarExposure, onReview }) {
  if (!setCount) return null

  return (
    <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-center justify-between gap-3 flex-wrap">
      <span>
        <strong>{setCount}</strong> set{setCount === 1 ? '' : 's'} of possible duplicate transaction
        {setCount === 1 ? '' : 's'}
        {dollarExposure > 0 && (
          <span className="text-amber-700"> — {money(dollarExposure)} double-counted if left in</span>
        )}
      </span>
      <button
        onClick={onReview}
        className="shrink-0 px-3 py-1 text-xs font-medium bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md transition-colors"
      >
        Review now
      </button>
    </div>
  )
}
