import { useMemo, useRef, useState } from 'react'
import { parseAccountStatementVision } from '../../utils/pdfVision.js'
import { errorStatus } from '../../utils/diagnostics.js'
import {
  normalizePositions, reconcileHoldings,
  normalizeSavings, reconcileSavings,
} from '../../utils/statementReconcile.js'
import { HOLDING_ACCOUNT_TYPES } from './HoldingForm.jsx'
import { SAVINGS_ACCOUNT_TYPES } from './SavingsTable.jsx'
import { money, exact, shares as fmtShares } from './format.js'

export const ACCOUNT_NAME_KEY = 'visionAccount_investments'

const ACTION_STYLE = {
  add: 'bg-green-50 text-green-700 border-green-200',
  update: 'bg-blue-50 text-blue-700 border-blue-200',
  unchanged: 'bg-gray-50 text-gray-400 border-gray-200',
  remove: 'bg-red-50 text-red-700 border-red-200',
}

const ACTION_LABEL = { add: 'Add', update: 'Update', unchanged: 'No change', remove: 'Remove' }

function ActionBadge({ action }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ACTION_STYLE[action]}`}>
      {ACTION_LABEL[action]}
    </span>
  )
}

const cellInput = 'w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

/**
 * Read an account summary PDF, then show exactly what committing it would do.
 *
 * Deliberately not a reuse of `BulkImportReviewModal`: that one reviews transactions, with income
 * and expense totals, duplicate sets and closing-balance checks, none of which mean anything for a
 * list of positions.
 *
 * The plan shown here comes from `reconcileHoldings` — the same function the server runs on
 * commit — so this is a preview of the real thing rather than a second description of it.
 */
export default function StatementImportModal({
  holdings = [],
  savingsAccounts = [],
  accountTypes = [],
  onClose,
  onConfirm,
  committing,
  commitError,
}) {
  const fileInputRef = useRef()
  const [target, setTarget] = useState('holdings')
  const [status, setStatus] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [fileName, setFileName] = useState('')
  const [accountName, setAccountName] = useState(() => localStorage.getItem(ACCOUNT_NAME_KEY) || '')
  const [statementDate, setStatementDate] = useState('')
  // Keyed by ticker. A value here is a cost the USER stands behind — either typed, or confirmed
  // against the prefilled market value. An unconfirmed row deliberately has no entry, so the plan
  // reports it as missing a cost basis and the Import button stays disabled.
  const [costs, setCosts] = useState({})
  const [confirmed, setConfirmed] = useState(() => new Set())
  // Explicit ticks only. Everything defaults to included EXCEPT a proposed removal, which starts
  // unticked: an unwanted removal destroys a position and the upload history cannot put it back,
  // while an unwanted keep leaves a stale row the user can delete in one click. Same asymmetry the
  // bulk import modal handles by unticking likely duplicates.
  const [overrides, setOverrides] = useState(() => new Map())

  const isHoldings = target === 'holdings'

  function resetParse() {
    setParsed(null)
    setStatus(null)
    setFileName('')
    setCosts({})
    setConfirmed(new Set())
    setOverrides(new Map())
    setStatementDate('')
  }

  function switchTarget(next) {
    if (next === target) return
    setTarget(next)
    resetParse()
  }

  async function handleFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    resetParse()
    setFileName(file.name)
    setStatus({ type: 'loading', message: 'Reading statement with AI vision…' })

    try {
      const result = await parseAccountStatementVision(file, {
        statementType: target,
        onProgress: ({ batch, batchCount }) => batchCount > 1 && setStatus({
          type: 'loading',
          message: `Reading statement with AI vision (part ${batch} of ${batchCount})`,
        }),
      })

      const rows = isHoldings ? normalizePositions(result.positions) : normalizeSavings(result.accounts)
      if (!rows.length) {
        setStatus({
          type: 'error',
          message: isHoldings
            ? 'No holdings table found in this PDF. An account summary is needed here — a transaction statement goes on the Finances or Spend Analyzer tab.'
            : 'No savings account summary found in this PDF.',
        })
        return
      }

      setParsed({ rows, statementDate: result.statementDate, accountLabel: result.accountLabel })
      setStatementDate(result.statementDate || '')
      setStatus(null)

      if (isHoldings) {
        // The label printed on the statement is a suggestion, and only when it names an account
        // this portfolio already uses. Otherwise the remembered name stands and the user decides.
        const suggestion = (result.accountLabel || '').trim()
        const known = [...accountTypes, ...HOLDING_ACCOUNT_TYPES]
          .find(type => type.toLowerCase() === suggestion.toLowerCase())
        if (known) setAccountName(known)
        setCosts(Object.fromEntries(
          rows.filter(r => r.costBasis !== null).map(r => [r.ticker, String(r.costBasis)]),
        ))
        setConfirmed(new Set(rows.filter(r => r.costBasis !== null).map(r => r.ticker)))
      }
    } catch (err) {
      setStatus(errorStatus(err, { action: 'account statement import', stage: 'AI vision' }))
    }
  }

  const plan = useMemo(() => {
    if (!parsed) return null
    if (!isHoldings) return reconcileSavings({ accounts: savingsAccounts, parsed: parsed.rows })
    if (!accountName.trim()) return null
    const positions = parsed.rows.map(row => ({
      ...row,
      // No confirmation means no cost, whatever is sitting in the input box.
      costBasis: confirmed.has(row.ticker) ? Number(costs[row.ticker]) : null,
    }))
    return reconcileHoldings({
      holdings,
      accountType: accountName.trim(),
      statementDate: statementDate || null,
      positions: normalizePositions(positions),
    })
  }, [parsed, isHoldings, accountName, statementDate, costs, confirmed, holdings, savingsAccounts])

  const rowKey = row => (isHoldings ? row.ticker : row.name)
  const isSelected = row => overrides.get(rowKey(row)) ?? row.action !== 'remove'

  function toggleRow(row) {
    const key = rowKey(row)
    const next = !isSelected(row)
    setOverrides(prev => new Map(prev).set(key, next))
  }

  function setCost(ticker, value) {
    setCosts(prev => ({ ...prev, [ticker]: value }))
    // Typing IS the confirmation. Anything else needs a second click to say the same thing.
    setConfirmed(prev => new Set(prev).add(ticker))
  }

  const selectedRows = plan ? plan.rows.filter(isSelected) : []
  const writes = selectedRows.filter(r => r.action === 'add' || r.action === 'update')
  const missingCost = isHoldings ? writes.filter(r => r.needsCostBasis) : []
  const missingDate = isHoldings ? writes.filter(r => !r.purchaseDate) : []
  const counts = selectedRows.reduce((acc, row) => {
    const key = row.action === 'add' ? 'added' : row.action === 'update' ? 'updated'
      : row.action === 'remove' ? 'removed' : 'unchanged'
    acc[key]++
    return acc
  }, { added: 0, updated: 0, unchanged: 0, removed: 0 })

  const nothingToDo = counts.added + counts.updated + counts.removed === 0
  const canImport = !!plan
    && !committing
    && !nothingToDo
    && missingCost.length === 0
    && missingDate.length === 0
    && (!isHoldings || !!accountName.trim())

  function handleConfirm() {
    if (!canImport) return
    if (isHoldings) {
      localStorage.setItem(ACCOUNT_NAME_KEY, accountName.trim())
      onConfirm({
        target: 'holdings',
        fileName,
        accountName: accountName.trim(),
        statementDate: statementDate || null,
        // Unchanged rows travel too: the server re-derives the plan against live holdings, and
        // omitting a position would make it look absent from the statement.
        positions: selectedRows
          .filter(r => r.action !== 'remove')
          .map(r => ({
            ticker: r.ticker,
            name: r.name,
            shares: r.shares,
            marketValue: r.marketValue,
            costBasis: r.costBasis,
          })),
        removeTickers: selectedRows.filter(r => r.action === 'remove').map(r => r.ticker),
      })
      return
    }
    onConfirm({
      target: 'savings',
      fileName,
      accounts: selectedRows
        .filter(r => r.action !== 'unchanged')
        .map(r => ({ name: r.name, accountType: r.accountType, balance: r.balance, apy: r.apy })),
    })
  }

  const suggestions = [...new Set([...accountTypes, ...HOLDING_ACCOUNT_TYPES])]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div className="shrink-0 border-b border-gray-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Upload statement</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                AI reads a PDF account summary. Nothing is saved until you review it below.
              </p>
            </div>
            <button onClick={onClose} className="text-xl leading-none text-gray-300 hover:text-gray-600">×</button>
          </div>

          <div className="mt-4 inline-flex overflow-hidden rounded-lg border border-gray-200">
            {[['holdings', 'Investment holdings'], ['savings', 'Savings account']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => switchTarget(key)}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  target === key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                } ${key === 'savings' ? 'border-l border-gray-200' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {status?.type === 'error' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {status.message}
            </div>
          )}
          {commitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {commitError}
            </div>
          )}

          {!parsed ? (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={status?.type === 'loading'}
                className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-10 text-center transition-colors hover:border-blue-300 hover:bg-blue-50/40 disabled:cursor-wait"
              >
                <span className="text-2xl text-gray-300">↥</span>
                <span className="text-[13px] font-medium text-gray-600">
                  {status?.type === 'loading' ? status.message : 'Click to choose a PDF'}
                </span>
                <span className="text-xs text-gray-400">
                  {isHoldings
                    ? 'A brokerage account summary — the page listing what you hold'
                    : 'A savings or deposit account statement'}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleFile}
              />
              <p className="text-xs text-gray-400">
                {isHoldings
                  ? 'Committing makes this account match the statement — positions are added, updated, or proposed for removal. Uploading the same statement twice changes nothing.'
                  : 'Balances and rates are updated by account name. An account the statement does not mention is left alone.'}
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{fileName}</p>
                  <p className="text-xs text-gray-400">
                    {parsed.rows.length} {isHoldings ? 'position' : 'account'}{parsed.rows.length === 1 ? '' : 's'} read
                    {parsed.accountLabel ? ` · statement says "${parsed.accountLabel}"` : ''}
                  </p>
                </div>
                <button onClick={resetParse} className="text-xs font-medium text-gray-500 underline hover:text-gray-900">
                  Choose another file
                </button>
              </div>

              {isHoldings && (
                <div className="flex flex-wrap gap-4">
                  <div className="min-w-[220px] flex-1">
                    <label className="mb-1 block text-xs font-medium text-gray-500">
                      Account this statement is for
                    </label>
                    <input
                      list="investment-account-names"
                      value={accountName}
                      onChange={e => setAccountName(e.target.value)}
                      placeholder="TFSA, Roth IRA, 401(k)…"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <datalist id="investment-account-names">
                      {suggestions.map(t => <option key={t} value={t} />)}
                    </datalist>
                    <p className="mt-1 text-[11px] text-gray-400">
                      Only holdings under this name are touched.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Statement date</label>
                    <input
                      type="date"
                      value={statementDate}
                      onChange={e => setStatementDate(e.target.value)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">
                      Used only for positions that are new here.
                    </p>
                  </div>
                </div>
              )}

              {!plan ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Name the account above to see what this statement would change.
                </p>
              ) : (
                <>
                  {missingCost.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <span className="font-medium">
                        {missingCost.length} position{missingCost.length === 1 ? '' : 's'} had no cost basis printed
                      </span>{' '}
                      on the statement. Confirm or correct each one — the field is prefilled with the
                      market value, which would record the position as having made no gain.
                    </div>
                  )}
                  {missingDate.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      Set a statement date. New positions need a date to be recorded under.
                    </div>
                  )}

                  {isHoldings
                    ? <HoldingsPlan
                        rows={plan.rows}
                        isSelected={isSelected}
                        onToggle={toggleRow}
                        costs={costs}
                        confirmed={confirmed}
                        onSetCost={setCost}
                        onConfirmCost={(ticker, value) => setCost(ticker, String(value))}
                      />
                    : <SavingsPlan rows={plan.rows} isSelected={isSelected} onToggle={toggleRow} />}
                </>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-gray-100 px-6 py-4">
          <p className="text-xs text-gray-500">
            {plan
              ? [
                counts.added ? `${counts.added} added` : null,
                counts.updated ? `${counts.updated} updated` : null,
                counts.removed ? `${counts.removed} removed` : null,
                counts.unchanged ? `${counts.unchanged} unchanged` : null,
              ].filter(Boolean).join(' · ') || 'Nothing selected'
              : ''}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={committing}
              className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canImport}
              title={nothingToDo && plan ? 'This statement matches what is already stored' : undefined}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {committing ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HoldingsPlan({ rows, isSelected, onToggle, costs, confirmed, onSetCost, onConfirmCost }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left text-[10px] font-medium uppercase tracking-wide text-gray-400">
            <th className="w-8 px-3 py-2" />
            <th className="px-3 py-2">Position</th>
            <th className="px-3 py-2 text-right">Shares</th>
            <th className="px-3 py-2 text-right">Market value</th>
            <th className="px-3 py-2 text-right">Cost basis</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(row => {
            const selected = isSelected(row)
            const needs = row.needsCostBasis && row.action !== 'remove' && row.action !== 'unchanged'
            const marketDefault = Math.round(row.marketValue ?? 0)
            return (
              <tr key={row.ticker} className={`text-sm ${!selected ? 'opacity-40' : needs ? 'bg-amber-50/60' : ''}`}>
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle(row)}
                    className="h-4 w-4 rounded border-gray-300"
                    aria-label={`Include ${row.ticker}`}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">{row.ticker}</span>
                    <ActionBadge action={row.action} />
                  </div>
                  {row.name && <p className="truncate text-xs text-gray-400">{row.name}</p>}
                  {row.action === 'remove' && (
                    <p className="text-xs text-red-600">
                      Not on this statement. Tick to delete it; leave it unticked to keep it.
                    </p>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-gray-700">
                  {row.action === 'remove' ? (
                    <span className="text-gray-400 line-through">{fmtShares(row.prevShares)}</span>
                  ) : row.prevShares !== null && row.prevShares !== row.shares ? (
                    <>
                      <span className="text-gray-400">{fmtShares(row.prevShares)}</span>
                      <span className="mx-1 text-gray-300">→</span>
                      <span className="font-medium">{fmtShares(row.shares)}</span>
                    </>
                  ) : (
                    fmtShares(row.shares)
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-700">
                  {row.marketValue === null ? '—' : money(row.marketValue)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {row.action === 'remove' ? (
                    <span className="text-gray-300">—</span>
                  ) : (
                    <div className="flex items-center justify-end gap-2">
                      {needs && (
                        <button
                          onClick={() => onConfirmCost(row.ticker, marketDefault)}
                          className="whitespace-nowrap rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
                        >
                          Use {money(marketDefault)}
                        </button>
                      )}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={confirmed.has(row.ticker) ? (costs[row.ticker] ?? '') : marketDefault}
                        onChange={e => onSetCost(row.ticker, e.target.value)}
                        className={`${cellInput} ${needs ? 'border-amber-400 text-amber-700' : ''}`}
                        aria-label={`Cost basis for ${row.ticker}`}
                      />
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SavingsPlan({ rows, isSelected, onToggle }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left text-[10px] font-medium uppercase tracking-wide text-gray-400">
            <th className="w-8 px-3 py-2" />
            <th className="px-3 py-2">Account</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2 text-right">Balance</th>
            <th className="px-3 py-2 text-right">APY</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(row => {
            const selected = isSelected(row)
            return (
              <tr key={row.name} className={`text-sm ${selected ? '' : 'opacity-40'}`}>
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle(row)}
                    className="h-4 w-4 rounded border-gray-300"
                    aria-label={`Include ${row.name}`}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-gray-900">{row.name}</span>
                    <ActionBadge action={row.action} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-gray-500">
                  {SAVINGS_ACCOUNT_TYPES.includes(row.accountType) ? row.accountType : 'Other'}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-gray-700">
                  {row.prevBalance !== null && row.prevBalance !== row.balance ? (
                    <>
                      <span className="text-gray-400">{money(row.prevBalance)}</span>
                      <span className="mx-1 text-gray-300">→</span>
                      <span className="font-medium">{money(row.balance)}</span>
                    </>
                  ) : (
                    money(row.balance)
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-gray-700">
                  {exact(row.apy)}%
                  {!row.apyFromStatement && (
                    <span className="ml-1 text-[10px] text-gray-400" title="Not printed on the statement — your stored rate is kept">
                      kept
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
