import { agoLabel } from './format.js'

/**
 * Title, what the page is counting, and the actions.
 *
 * The freshness line is not decoration: prices come from Yahoo with a 60-second stale time and are
 * refetched on mount, so a portfolio value can be minutes old. Saying how old it is costs a line
 * and stops the figure being read as live.
 */
export default function InvestmentsHeader({
  holdingCount,
  savingsCount,
  pricesUpdatedAt,
  pricesFetching,
  unpricedCount,
  onRefreshPrices,
  onUpload,
  onAddHolding,
  addingHolding,
  readOnly,
}) {
  const ago = agoLabel(pricesUpdatedAt)
  const disabledTitle = readOnly ? 'Unavailable in Demo Mode' : undefined

  const parts = [
    `${holdingCount} holding${holdingCount === 1 ? '' : 's'}`,
    `${savingsCount} savings account${savingsCount === 1 ? '' : 's'}`,
  ]

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-gray-900">Investments</h1>
        <p className="mt-1 text-[12.5px] text-gray-400">
          {pricesFetching
            ? 'Fetching live prices…'
            : ago
              ? `Prices updated ${ago}`
              : 'Prices not fetched yet'}
          {' · '}
          {parts.join(' · ')}
          {unpricedCount > 0 && (
            <span className="text-amber-600">
              {' · '}{unpricedCount} priced at cost
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onRefreshPrices}
          disabled={pricesFetching || holdingCount === 0}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pricesFetching ? 'Refreshing…' : 'Refresh prices'}
        </button>
        {onUpload && (
          <button
            onClick={onUpload}
            disabled={readOnly}
            title={disabledTitle}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Upload Statement
          </button>
        )}
        <button
          onClick={onAddHolding}
          disabled={readOnly}
          title={disabledTitle}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {addingHolding ? 'Cancel' : '+ Add Holding'}
        </button>
      </div>
    </div>
  )
}
