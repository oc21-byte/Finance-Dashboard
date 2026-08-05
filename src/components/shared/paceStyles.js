// Status tints for Financial Pace. One computation (`buildFinancialPace`) now feeds two rails —
// the Spend Analyzer's FinancialPaceCard and the Finances SavingsRateCard — so the mapping from
// status to colour lives here rather than in either card. Two copies would drift, and a status
// that reads emerald on one tab and amber on the other is worse than no colour at all.
export const PACE_STYLES = {
  on_track: {
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
    card: 'border-emerald-100 bg-emerald-50/35',
  },
  little_room: {
    badge: 'border-amber-200 bg-amber-50 text-amber-800',
    dot: 'bg-amber-500',
    card: 'border-amber-100 bg-amber-50/35',
  },
  over_pace: {
    badge: 'border-rose-200 bg-rose-50 text-rose-700',
    dot: 'bg-rose-500',
    card: 'border-rose-100 bg-rose-50/35',
  },
  not_enough_data: {
    badge: 'border-gray-200 bg-gray-50 text-gray-600',
    dot: 'bg-gray-400',
    card: 'border-gray-200 bg-gray-50/50',
  },
}

/** Never returns undefined — an unknown or missing status falls back to the neutral tint. */
export const paceStyle = status => PACE_STYLES[status] ?? PACE_STYLES.not_enough_data
