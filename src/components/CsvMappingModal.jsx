import { useState, useEffect } from 'react'

function guess(headers, patterns, fallback) {
  return headers.find(h => patterns.some(p => p.test(h))) ?? fallback
}

export default function CsvMappingModal({ headers, existingSources, onConfirm, onCancel, initialSourceName = '', onUseVision = null }) {
  const firstHeader = headers[0] || ''

  const defaultDate = guess(headers, [/\btrans\w*\s*date\b/i, /^date$/i, /\bdate\b/i], firstHeader)
  const defaultDesc = guess(headers, [/^(description|desc|memo|detail|merchant)$/i, /\bdescription\b/i, /\bmemo\b/i], headers[1] || firstHeader)
  const defaultAmount = guess(headers, [/^amount$/i, /\bamount\b/i, /\bcharge\b/i], headers[2] || firstHeader)
  const defaultDebit = guess(headers, [/\bdebit\b/i, /\bwithdrawal\b/i], firstHeader)
  const defaultCredit = guess(headers, [/\bcredit\b/i, /\bdeposit\b/i], headers[1] || firstHeader)

  const [sourceName, setSourceName] = useState(initialSourceName)
  const [dateCol, setDateCol] = useState(defaultDate)
  const [descCol, setDescCol] = useState(defaultDesc)
  const [splitMode, setSplitMode] = useState(false)
  const [amountCol, setAmountCol] = useState(defaultAmount)
  const [debitCol, setDebitCol] = useState(defaultDebit)
  const [creditCol, setCreditCol] = useState(defaultCredit)
  const [invertAmounts, setInvertAmounts] = useState(true)
  const [categoryCol, setCategoryCol] = useState('')
  const [statementType, setStatementType] = useState('credit_card')

  useEffect(() => {
    if (initialSourceName) applyExistingSource(initialSourceName)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function applyExistingSource(name) {
    const m = existingSources[name]
    if (!m) return
    if (headers.includes(m.date)) setDateCol(m.date)
    if (headers.includes(m.description)) setDescCol(m.description)
    if (m.splitDebitCredit) {
      setSplitMode(true)
      if (headers.includes(m.debit)) setDebitCol(m.debit)
      if (headers.includes(m.credit)) setCreditCol(m.credit)
    } else {
      setSplitMode(false)
      if (headers.includes(m.amount)) setAmountCol(m.amount)
      setInvertAmounts(m.invertAmounts !== false)
    }
    setCategoryCol(m.category && headers.includes(m.category) ? m.category : '')
    setStatementType(m.statementType || 'credit_card')
  }

  function handleSourceNameChange(name) {
    setSourceName(name)
    applyExistingSource(name)
  }

  function handleConfirm() {
    if (!sourceName.trim()) return
    const mapping = {
      date: dateCol,
      description: descCol,
      splitDebitCredit: splitMode,
      ...(splitMode
        ? { debit: debitCol, credit: creditCol }
        : { amount: amountCol, invertAmounts }),
      ...(categoryCol ? { category: categoryCol } : {}),
      statementType,
    }
    onConfirm(sourceName.trim(), mapping)
  }

  const canSubmit = sourceName.trim() && dateCol && descCol &&
    (splitMode ? debitCol && creditCol : amountCol)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Map Statement Columns</h2>
          <p className="text-sm text-gray-500 mt-0.5">Tell us which columns contain which data.</p>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* Source name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Source name
            </label>
            <input
              list="source-suggestions"
              value={sourceName}
              onChange={e => handleSourceNameChange(e.target.value)}
              placeholder="e.g. TD Bank, Chase Visa…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <datalist id="source-suggestions">
              {Object.keys(existingSources).map(s => <option key={s} value={s} />)}
            </datalist>
            <p className="text-xs text-gray-400 mt-1">
              This name is saved so future uploads from this source skip this modal.
            </p>
          </div>

          {/* Date column */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date column</label>
            <ColSelect value={dateCol} onChange={setDateCol} options={headers} />
          </div>

          {/* Description column */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description column</label>
            <ColSelect value={descCol} onChange={setDescCol} options={headers} />
          </div>

          {/* Amount format */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Amount format</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={!splitMode}
                  onChange={() => setSplitMode(false)}
                  className="accent-blue-600"
                />
                Single column
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={splitMode}
                  onChange={() => setSplitMode(true)}
                  className="accent-blue-600"
                />
                Separate debit / credit
              </label>
            </div>
          </div>

          {splitMode ? (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Debit column</label>
                <ColSelect value={debitCol} onChange={setDebitCol} options={headers} />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Credit column</label>
                <ColSelect value={creditCol} onChange={setCreditCol} options={headers} />
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount column</label>
                <ColSelect value={amountCol} onChange={setAmountCol} options={headers} />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={invertAmounts}
                  onChange={e => setInvertAmounts(e.target.checked)}
                  className="accent-blue-600"
                />
                <span>Invert amounts <span className="text-gray-400">(expenses are positive in this file)</span></span>
              </label>
            </>
          )}

          {/* Statement type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Statement type</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={statementType === 'credit_card'}
                  onChange={() => setStatementType('credit_card')}
                  className="accent-blue-600"
                />
                Credit card
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={statementType === 'bank'}
                  onChange={() => setStatementType('bank')}
                  className="accent-blue-600"
                />
                Bank / checking
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Credit card: payments and credits excluded. Bank: deposits counted as income.
            </p>
          </div>

          {/* Optional category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category column <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <ColSelect
              value={categoryCol}
              onChange={setCategoryCol}
              options={headers}
              includeNone
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center shrink-0">
          {onUseVision && (
            <button
              onClick={onUseVision}
              className="px-4 py-2 text-sm text-violet-600 hover:text-violet-800 rounded-lg hover:bg-violet-50"
            >
              Use AI Vision instead
            </button>
          )}
          <div className="ml-auto flex gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canSubmit}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ColSelect({ value, onChange, options, includeNone = false }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {includeNone && <option value="">— none —</option>}
      {options.map(o => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  )
}
