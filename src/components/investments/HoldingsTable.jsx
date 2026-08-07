import { Fragment, useState } from 'react'
import dayjs from 'dayjs'
import SortTh from '../shared/SortTh.jsx'
import ConfirmDeleteButton from '../shared/ConfirmDeleteButton.jsx'
import { money, exact, shares as fmtShares, signedMoney, signedPct, gainClass } from './format.js'

const date = value => (value ? dayjs(value).format('MMM D, YYYY') : '—')

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] text-gray-800">{children}</dd>
    </div>
  )
}

/**
 * Everything about one holding that the row deliberately leaves out.
 *
 * Purchase price, current price and purchase date all answer "what did I pay" — a follow-up
 * question. In the row they cost the ticker its place at 660px, and the ticker is the only column
 * that identifies which holding you are looking at.
 *
 * The account type is shown but not editable: it is set when the holding is created, by the add
 * form or by naming the account during a statement import, and fixed after that.
 */
function HoldingDetail({ row, colSpan, onDeletePurchase, onDeleteHolding, deletingHolding, deletingPurchase, readOnly }) {
  const [confirming, setConfirming] = useState(false)

  // A holding added before per-lot storage existed has no `purchases[]`. Its single implied lot is
  // shown so the panel is never blank, but it cannot be deleted individually — there is no lot id
  // to delete, and the row itself is the whole position.
  const legacy = !row.purchases || row.purchases.length === 0
  const lots = legacy
    ? [{ id: `${row.id}-legacy`, shares: row.shares, purchasePrice: row.purchasePrice, purchaseDate: row.purchaseDate }]
    : row.purchases

  return (
    <tr className="bg-gray-50/70">
      <td colSpan={colSpan} className="px-5 py-4">
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <Fact label="Avg cost">${exact(row.purchasePrice)}</Fact>
          <Fact label="Current price">
            {row.currentPrice === null
              ? <span className="text-gray-400">No live price</span>
              : `$${exact(row.currentPrice)}`}
          </Fact>
          <Fact label="Cost basis">{money(row.costBasis)}</Fact>
          <Fact label="Held since">{date(row.purchaseDate)}</Fact>
          <Fact label="Account">{row.accountType}</Fact>
          <Fact label="Market">
            {row.listing === 'CA' ? 'Canada (TSX)' : row.listing === 'US' ? 'United States' : 'Auto'}
          </Fact>
        </dl>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
            {lots.length} {lots.length === 1 ? 'buy' : 'buys'}
          </p>
          <ConfirmDeleteButton
            confirming={confirming}
            onRequest={() => setConfirming(true)}
            onCancel={() => setConfirming(false)}
            onConfirm={() => { setConfirming(false); onDeleteHolding(row.id) }}
            disabled={deletingHolding || readOnly}
            title={readOnly ? 'Unavailable in Demo Mode' : `Delete all ${row.ticker} in ${row.accountType}`}
          />
        </div>

        <table className="mt-1.5 w-full text-xs">
          <thead>
            <tr className="text-gray-400">
              <th className="py-1 pr-4 text-left font-medium">Date</th>
              <th className="py-1 pr-4 text-right font-medium">Shares</th>
              <th className="py-1 pr-4 text-right font-medium">Price</th>
              <th className="py-1 pr-4 text-right font-medium">Cost</th>
              <th className="w-6 py-1" />
            </tr>
          </thead>
          <tbody>
            {lots.map(lot => (
              <tr key={lot.id} className="border-t border-gray-200/70">
                <td className="py-1.5 pr-4 text-gray-600">{date(lot.purchaseDate)}</td>
                <td className="py-1.5 pr-4 text-right text-gray-600">{fmtShares(lot.shares)}</td>
                <td className="py-1.5 pr-4 text-right text-gray-600">${exact(lot.purchasePrice)}</td>
                <td className="py-1.5 pr-4 text-right text-gray-600">${exact(lot.shares * lot.purchasePrice)}</td>
                <td className="py-1.5">
                  <button
                    onClick={() => onDeletePurchase(row.id, lot.id)}
                    disabled={deletingPurchase || legacy || readOnly}
                    className="text-base leading-none text-gray-300 transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:hover:text-gray-300"
                    title={legacy ? 'Save a new buy first to enable per-purchase deletion' : 'Delete this buy'}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  )
}

/**
 * Holdings ranked by value, in a box that scrolls on its own.
 *
 * Beside Allocation the wrapper is `h-0 min-h-full` so row height is set by the donut card
 * alone; this card fills that height and scrolls. Stacked layouts keep a viewport cap.
 */
export default function HoldingsTable({
  rows,
  totalCount,
  accountFilter,
  showAccount,
  sortKey,
  sortDir,
  onSort,
  pricesFetching,
  loading,
  expandedId,
  onToggleExpanded,
  onDeleteHolding,
  onDeletePurchase,
  deletingHolding,
  deletingPurchase,
  readOnly,
}) {
  const colSpan = showAccount ? 6 : 5

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:h-full">
      <div className="shrink-0 border-b border-gray-100 px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-gray-900">Holdings ranked by value</h2>
        <p className="text-[12.5px] text-gray-400">
          {accountFilter === 'All'
            ? `${totalCount} holding${totalCount === 1 ? '' : 's'} · click a row for cost and buy history`
            : `${accountFilter} · ${rows.length} of ${totalCount} holdings`}
        </p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
      ) : totalCount === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">No holdings yet.</p>
          <p className="mt-1 text-xs text-gray-300">Add one by hand, or upload an account statement.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">No holdings in "{accountFilter}".</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto max-h-[min(560px,58vh)] lg:max-h-none">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                <SortTh label="Ticker" field="ticker" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                {showAccount && (
                  <SortTh label="Account" field="accountType" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                )}
                <SortTh label="Shares" field="shares" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="text-right" />
                <SortTh label="Value" field="value" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="text-right" />
                <th className="px-4 py-2.5 text-right">Weight</th>
                <SortTh label="Gain / loss" field="gainPct" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => {
                const isExpanded = expandedId === row.id
                const unpriced = row.currentPrice === null
                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => onToggleExpanded(row.id)}
                      className={`cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}
                    >
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          <span className={`w-3 shrink-0 text-[10px] leading-none transition-colors ${
                            isExpanded ? 'text-blue-500' : 'text-gray-300'
                          }`}>
                            {isExpanded ? '▾' : '▸'}
                          </span>
                          <span className="text-sm font-semibold text-gray-900">{row.ticker}</span>
                        </span>
                      </td>
                      {showAccount && (
                        <td className="px-4 py-3 text-sm text-gray-500">{row.accountType}</td>
                      )}
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-600">
                        {fmtShares(row.shares)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                        {money(row.value)}
                        {unpriced && !pricesFetching && (
                          <span className="ml-1 text-[10px] text-amber-600" title="No live price — valued at cost basis">
                            at cost
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-500">{row.weight}%</td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right text-sm font-medium ${
                        pricesFetching ? 'text-gray-300' : gainClass(row.gainDollar)
                      }`}>
                        {row.gainDollar === null || pricesFetching ? '—' : (
                          <>
                            {signedMoney(row.gainDollar)}{' '}
                            <span className="text-xs">({signedPct(row.gainPct)})</span>
                          </>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <HoldingDetail
                        row={row}
                        colSpan={colSpan}
                        onDeleteHolding={onDeleteHolding}
                        onDeletePurchase={onDeletePurchase}
                        deletingHolding={deletingHolding}
                        deletingPurchase={deletingPurchase}
                        readOnly={readOnly}
                      />
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
