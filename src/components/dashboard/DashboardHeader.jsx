import dayjs from 'dayjs'

/** "4 min ago" / "just now". Null when prices have never been fetched (no tickers held). */
function freshness(updatedAt) {
  if (!updatedAt) return null
  const minutes = Math.floor((Date.now() - updatedAt) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

/**
 * Title plus a one-line provenance strip: when this was true, how much it covers, how stale the
 * prices are. A dashboard of balances with no "as of" invites the reader to assume "right now",
 * which for anything derived from statements is never quite true.
 */
export default function DashboardHeader({ asOf, accountCount, pricesUpdatedAt }) {
  const priceAge = freshness(pricesUpdatedAt)
  const parts = [
    asOf ? `As of ${dayjs(asOf).format('MMM D, YYYY')}` : null,
    accountCount ? `${accountCount} account${accountCount === 1 ? '' : 's'}` : null,
    priceAge ? `prices updated ${priceAge}` : null,
  ].filter(Boolean)

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
      {parts.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">{parts.join(' · ')}</p>
      )}
    </div>
  )
}
