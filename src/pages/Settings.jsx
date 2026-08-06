import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import StatementBalances from '../components/settings/StatementBalances.jsx'
import InfoTip from '../components/dashboard/InfoTip.jsx'
import { api } from '../api/client.js'
import { DEFAULT_VISION_MODEL, withSelected } from '../utils/modelCatalog.js'

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const numberInputClass = 'w-28 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500'
const cardClass = 'bg-white border border-gray-200 rounded-xl shadow-sm'
const smallSaveClass = 'px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors whitespace-nowrap'

/** The three ledgers an upload can belong to, in the order the filter shows them. */
const HISTORY_FILTERS = [
  {
    key: 'bank',
    label: 'Bank',
    empty: 'No bank imports yet.',
    about: 'Finances imports (CSV, XLSX, or PDF). Deleting a recent upload also removes its linked transactions. Older entries, from before this feature, only clear the history log.',
  },
  {
    key: 'credit_card',
    label: 'Card',
    empty: 'No credit card imports yet.',
    about: 'Spend Analyzer imports (CSV, XLSX, or PDF). Deleting a recent upload also removes its linked card transactions.',
  },
  {
    key: 'investment',
    label: 'Invest.',
    empty: 'No account statements imported yet.',
    about: 'Investments account summaries read by AI vision. An import reconciles an account to its statement, so deleting an entry removes the purchase lots or savings accounts that import wrote — it cannot restore positions the import replaced or removed.',
  },
]

function SectionLabel({ children }) {
  return (
    <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-400">
      {children}
    </h2>
  )
}

export default function Settings() {
  const queryClient = useQueryClient()
  const [showInput, setShowInput] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [incomeInput, setIncomeInput] = useState('')
  const [returnInput, setReturnInput] = useState('')
  const [savingsRateInput, setSavingsRateInput] = useState('')
  const [budgetSaved, setBudgetSaved] = useState(false)
  const [visionModelSaved, setVisionModelSaved] = useState(false)
  const [histFilter, setHistFilter] = useState('bank')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [showFactoryReset, setShowFactoryReset] = useState(false)

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })

  // Cash is derived from these, so the page needs both the stored anchors and the live checks.
  const { data: cashStatus = null } = useQuery({
    queryKey: ['cash-status'],
    queryFn: api.cashStatus,
  })

  const saveStatementBalances = useMutation({
    mutationFn: (statementBalances) => api.settings.update({ statementBalances }),
    onSuccess: async () => {
      // Every derived view of cash moves with these, not just settings.
      await api.netWorth.snapshot()
      for (const key of [['settings'], ['cash-status'], ['net-worth-history']]) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  const { data: uploadHistory = [] } = useQuery({
    queryKey: ['upload-history'],
    queryFn: api.uploadHistory.list,
  })

  // Bank is the negative case so legacy entries, written before `ledger` existed, still appear.
  const historyByLedger = {
    bank: uploadHistory.filter(e => e.ledger !== 'credit_card' && e.ledger !== 'investment'),
    credit_card: uploadHistory.filter(e => e.ledger === 'credit_card'),
    investment: uploadHistory.filter(e => e.ledger === 'investment'),
  }
  const activeFilter = HISTORY_FILTERS.find(f => f.key === histFilter) ?? HISTORY_FILTERS[0]
  const visibleHistory = historyByLedger[activeFilter.key]

  const deleteHistoryEntry = useMutation({
    mutationFn: api.uploadHistory.remove,
    onSuccess: () => {
      setPendingDelete(null)
      for (const key of [
        ['upload-history'], ['transactions'], ['credit_card_transactions'],
        // An investment entry cascades into holdings or savings accounts, either of which moves
        // liquid net worth.
        ['holdings'], ['savings-accounts'], ['net-worth-history'],
      ]) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  const factoryResetMutation = useMutation({
    mutationFn: api.factoryReset,
    onSuccess: () => {
      // Remembered source names live outside db.json.
      localStorage.removeItem('visionSource_finances')
      localStorage.removeItem('visionSource_spendAnalyzer')
      queryClient.clear()
      window.location.reload()
    },
  })

  // An investment import records the lots or accounts it wrote under `recordIds`; the two ledgers
  // record transaction ids. Both answer "what would deleting this entry take with it".
  function linkedTxCount(entry) {
    const ids = entry.ledger === 'investment' ? entry.recordIds : entry.transactionIds
    return Array.isArray(ids) ? ids.length : 0
  }

  function ledgerLabel(entry) {
    if (entry.ledger === 'credit_card') return 'Spend Analyzer'
    if (entry.ledger === 'investment') return 'Investments'
    return 'Finances'
  }

  function linkedNoun(entry) {
    if (entry.ledger !== 'investment') return 'transaction'
    return entry.target === 'savings' ? 'savings account' : 'purchase lot'
  }

  const currentProvider = settings?.aiProvider ?? 'claude'
  const hasKey = currentProvider === 'openai' ? settings?.hasOpenaiApiKey : settings?.hasClaudeApiKey

  // Each provider remembers its own extraction model; the ids are not interchangeable.
  const providerDefaultModel = DEFAULT_VISION_MODEL[currentProvider === 'openai' ? 'openai' : 'claude']
  const selectedModel = (currentProvider === 'openai'
    ? settings?.openaiVisionModel
    : settings?.visionModel) || providerDefaultModel

  const { data: modelCatalog, isLoading: modelsLoading } = useQuery({
    queryKey: ['models', currentProvider],
    queryFn: api.models.list,
    // The provider's catalogue is not going to move during a visit.
    staleTime: 10 * 60 * 1000,
  })
  // The stored id always appears, even if the provider no longer lists it — otherwise the select
  // renders blank and the first change silently rewrites a working setting.
  const modelOptions = withSelected(modelCatalog?.models ?? [], selectedModel)
  const modelsAreFallback = modelCatalog?.source === 'fallback'

  useEffect(() => {
    if (settings?.confirmedMonthlyIncome != null) {
      setIncomeInput(String(settings.confirmedMonthlyIncome))
    }
    // Stored as a decimal (0.06); shown as a percent (6).
    if (settings?.assumedAnnualReturn != null) {
      setReturnInput(String(Math.round(settings.assumedAnnualReturn * 10000) / 100))
    }
    if (settings?.budgetSavingsRate != null) {
      setSavingsRateInput(String(settings.budgetSavingsRate))
    }
  }, [settings])

  const saveProvider = useMutation({
    mutationFn: (aiProvider) => api.settings.update({ aiProvider }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setShowInput(false)
      setKeyInput('')
    },
  })

  const saveKey = useMutation({
    mutationFn: (key) => api.settings.update(
      currentProvider === 'openai' ? { openaiApiKey: key } : { claudeApiKey: key }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      // A new key can unlock a different catalogue, and the server has just dropped its cache.
      queryClient.invalidateQueries({ queryKey: ['models'] })
      setKeyInput('')
      setShowInput(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  // The three budget defaults share one "Saved ✓", so they share one success handler.
  function budgetSavedFlash() {
    queryClient.invalidateQueries({ queryKey: ['settings'] })
    setBudgetSaved(true)
    setTimeout(() => setBudgetSaved(false), 2500)
  }

  const saveIncome = useMutation({
    // Blank clears the override back to the CSV-derived average.
    mutationFn: (val) => api.settings.update({
      confirmedMonthlyIncome: val === '' ? null : Number(val),
    }),
    onSuccess: budgetSavedFlash,
  })

  const saveReturn = useMutation({
    // Input is a percent; store as a decimal. Blank resets to the 6% default.
    mutationFn: (val) => api.settings.update({
      assumedAnnualReturn: val === '' ? 0.06 : Number(val) / 100,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      budgetSavedFlash()
    },
  })

  const saveSavingsRate = useMutation({
    mutationFn: (val) => api.settings.update({
      budgetSavingsRate: val === '' ? 15 : Math.min(100, Math.max(0, Number(val))),
    }),
    onSuccess: budgetSavedFlash,
  })

  const saveVisionModel = useMutation({
    mutationFn: (val) => api.settings.update(
      currentProvider === 'openai' ? { openaiVisionModel: val } : { visionModel: val }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setVisionModelSaved(true)
      setTimeout(() => setVisionModelSaved(false), 2000)
    },
  })

  function handleSave(e) {
    e.preventDefault()
    if (!keyInput.trim()) return
    saveKey.mutate(keyInput.trim())
  }

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-semibold text-gray-800 mb-6">Settings</h1>

      {/* `items-stretch` is load-bearing: it makes the right column as tall as the left, which is
          what lets its two cards split that height and scroll instead of running past it. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        {/* ── AI & Automation ────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <SectionLabel>AI &amp; Automation</SectionLabel>

          {/* AI Provider */}
          <div className={`${cardClass} px-5 py-4 flex items-center justify-between gap-4`}>
            <div>
              <h3 className="text-sm font-semibold text-gray-700">AI Provider</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Powers insights, chat, categorization, and PDF imports
              </p>
            </div>
            <div className="flex gap-0.5 p-0.5 border border-gray-200 rounded-lg bg-gray-50 shrink-0">
              {[['claude', 'Claude'], ['openai', 'ChatGPT']].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => saveProvider.mutate(value)}
                  aria-pressed={currentProvider === value}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    currentProvider === value
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div className={`${cardClass} px-5 py-4`}>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-700">API Key</h3>
              {hasKey && (
                <span className="text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                  Configured ✓
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {currentProvider === 'openai'
                ? 'Your OpenAI API key. Uses gpt-4o-mini for insights and chat, gpt-4o for CSV detection.'
                : 'Your Anthropic API key. Stored locally, never sent to any third party.'}
            </p>
            {hasKey && !showInput ? (
              <button
                onClick={() => setShowInput(true)}
                className="mt-2.5 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Replace key
              </button>
            ) : (
              <form onSubmit={handleSave} className="flex gap-2 mt-2.5">
                <input
                  className={inputClass}
                  type="password"
                  placeholder={currentProvider === 'openai' ? 'sk-…' : 'sk-ant-…'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={saveKey.isPending || !keyInput.trim()}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {saveKey.isPending ? 'Saving…' : 'Save Key'}
                </button>
                {hasKey && (
                  <button
                    type="button"
                    onClick={() => { setShowInput(false); setKeyInput('') }}
                    className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600"
                  >
                    Cancel
                  </button>
                )}
              </form>
            )}
            {saved && <p className="text-xs text-green-600 mt-2">API key saved successfully.</p>}
          </div>

          {/* Statement Extraction Model */}
          <div className={`${cardClass} px-5 py-4`}>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-gray-700">Statement Extraction Model</h3>
              <InfoTip label="Statement Extraction Model">
                The model used to read scanned PDF statements. Statements are sent one file at a
                time in small page batches, so the default handles multi-statement uploads
                accurately — switch to a stronger model only if a particular statement keeps
                coming out wrong.
              </InfoTip>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {currentProvider === 'openai'
                ? 'The OpenAI model used to read scanned PDF statements.'
                : 'The Claude model used to read scanned PDF statements.'}
            </p>
            <div className="flex gap-2 items-center mt-2.5">
              <select
                className={`${inputClass} cursor-pointer disabled:cursor-wait disabled:opacity-60`}
                value={selectedModel}
                disabled={modelsLoading || saveVisionModel.isPending}
                onChange={(e) => saveVisionModel.mutate(e.target.value)}
              >
                {modelOptions.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.id === providerDefaultModel ? ' — default' : ''}
                  </option>
                ))}
              </select>
              {selectedModel !== providerDefaultModel && (
                <button
                  type="button"
                  onClick={() => saveVisionModel.mutate(providerDefaultModel)}
                  className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap"
                >
                  Reset
                </button>
              )}
            </div>
            {visionModelSaved && <p className="text-xs text-green-600 mt-2">Saved ✓</p>}
            {/* Only worth saying when a key exists — without one, the fallback list is expected. */}
            {modelsAreFallback && hasKey && (
              <p className="text-xs text-amber-600 mt-2">
                Could not reach {currentProvider === 'openai' ? 'OpenAI' : 'Anthropic'} to list
                models. Showing defaults.
              </p>
            )}
          </div>

          <SectionLabel>Budget Defaults</SectionLabel>

          <div className={`${cardClass} px-5 py-4 flex flex-col gap-3`}>
            <BudgetRow
              label="Monthly income baseline"
              tip="Your confirmed monthly take-home income. Used by Budget Builder as the income baseline — it overrides the CSV-derived average when set, and clearing it hands the baseline back to the CSVs."
              prefix="$"
              placeholder="e.g. 5000"
              step="0.01"
              value={incomeInput}
              onChange={setIncomeInput}
              onSave={() => saveIncome.mutate(incomeInput.trim())}
              pending={saveIncome.isPending}
            />
            <BudgetRow
              label="Assumed annual return"
              tip="Used for the optimistic “with growth” projection on linked goals. Savings accounts use their own APY instead. Default 6%."
              suffix="%"
              placeholder="6"
              step="0.1"
              value={returnInput}
              onChange={setReturnInput}
              onSave={() => saveReturn.mutate(returnInput.trim())}
              pending={saveReturn.isPending}
            />
            <BudgetRow
              label="Default savings rate"
              tip="Percentage of monthly income used as the default general savings target on the Budget page. Default 15%."
              suffix="%"
              placeholder="15"
              step="1"
              value={savingsRateInput}
              onChange={setSavingsRateInput}
              onSave={() => saveSavingsRate.mutate(savingsRateInput.trim())}
              pending={saveSavingsRate.isPending}
            />
            {budgetSaved && <p className="text-xs text-green-600">Saved ✓</p>}
          </div>
        </div>

        {/* ── Data & Imports ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <SectionLabel>Data &amp; Imports</SectionLabel>

          <StatementBalances
            balances={settings?.statementBalances ?? []}
            checks={cashStatus?.checks ?? []}
            onSave={list => saveStatementBalances.mutate(list)}
            saving={saveStatementBalances.isPending}
          />

          {/* Upload history — one card, one filter per ledger. */}
          <div className={`${cardClass} flex min-h-[240px] max-h-[480px] flex-col lg:max-h-none lg:flex-1 lg:basis-0`}>
            <div className="flex flex-none items-center gap-2 border-b border-dashed border-gray-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-gray-700">Upload History</h3>
              <InfoTip label="Upload History">{activeFilter.about}</InfoTip>
              <div className="ml-auto flex gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                {HISTORY_FILTERS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setHistFilter(f.key)}
                    aria-pressed={histFilter === f.key}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      histFilter === f.key
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {f.label}
                    <span className={`ml-1 tabular-nums ${histFilter === f.key ? 'text-blue-200' : 'text-gray-400'}`}>
                      {historyByLedger[f.key].length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">
              {visibleHistory.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">{activeFilter.empty}</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {visibleHistory.map(entry => {
                    const linked = linkedTxCount(entry)
                    // Derived from the row rather than passed in, so the unit and the ledger
                    // cannot disagree.
                    const unit = entry.ledger === 'investment' ? 'position' : 'transaction'
                    return (
                      <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-gray-800">{entry.filename}</p>
                          <p className="mt-0.5 text-xs text-gray-400">
                            {entry.sourceName && <span className="mr-2 text-gray-500">{entry.sourceName}</span>}
                            {entry.transactionCount} {unit}{entry.transactionCount !== 1 ? 's' : ''}
                            {linked > 0 ? ` · ${linked} linked` : ' · history only'}
                            {' · '}
                            {new Date(entry.importedAt).toLocaleDateString(undefined, {
                              year: 'numeric', month: 'short', day: 'numeric',
                            })}
                          </p>
                        </div>
                        <button
                          onClick={() => setPendingDelete(entry)}
                          disabled={deleteHistoryEntry.isPending}
                          className="shrink-0 text-xs text-red-400 transition-colors hover:text-red-600 disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Factory reset — full width, and the only destructive control on the page. */}
      <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50/40 px-5 py-3">
        <div>
          <span className="text-sm font-semibold text-red-700">Factory Reset</span>
          <span className="ml-3 text-xs text-gray-500">
            Permanently deletes everything, including your API keys. Cannot be undone.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowFactoryReset(true)}
          disabled={factoryResetMutation.isPending}
          className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          Reset all data…
        </button>
      </div>

      {pendingDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900">Delete this upload?</h3>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              {linkedTxCount(pendingDelete) > 0 ? (
                <>
                  This will permanently remove <span className="font-medium">{pendingDelete.filename}</span>
                  {' '}and{' '}
                  <span className="font-medium">
                    {linkedTxCount(pendingDelete)} linked {ledgerLabel(pendingDelete)} {linkedNoun(pendingDelete)}
                    {linkedTxCount(pendingDelete) !== 1 ? 's' : ''}
                  </span>
                  . This cannot be undone.
                </>
              ) : (
                <>
                  This will remove the history entry for{' '}
                  <span className="font-medium">{pendingDelete.filename}</span>. Linked records
                  cannot be found for older uploads and will not be removed.
                </>
              )}
            </p>
            {pendingDelete.ledger === 'investment' && (
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                This import reconciled <span className="font-medium">{pendingDelete.sourceName}</span> to
                its statement. Deleting it removes what the import wrote, but cannot bring back any
                position it replaced or removed at the time.
              </p>
            )}
            {deleteHistoryEntry.isError && (
              <p className="text-sm text-red-500 mt-3">
                {deleteHistoryEntry.error?.message || 'Delete failed. Please try again.'}
              </p>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setPendingDelete(null)
                  deleteHistoryEntry.reset()
                }}
                disabled={deleteHistoryEntry.isPending}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteHistoryEntry.mutate(pendingDelete.id)}
                disabled={deleteHistoryEntry.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteHistoryEntry.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFactoryReset && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900">Reset all data?</h3>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              This permanently deletes every transaction, holding, goal, savings account, liquid net worth
              history, upload history, AI insights, custom categories, and saved settings —
              including your API keys. The app will reload as a blank slate. This cannot be undone.
            </p>
            {factoryResetMutation.isError && (
              <p className="text-sm text-red-500 mt-3">
                {factoryResetMutation.error?.message || 'Reset failed. Please try again.'}
              </p>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowFactoryReset(false)
                  factoryResetMutation.reset()
                }}
                disabled={factoryResetMutation.isPending}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => factoryResetMutation.mutate()}
                disabled={factoryResetMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {factoryResetMutation.isPending ? 'Resetting…' : 'Yes, delete everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One labelled number field with its own Save.
 *
 * A real `<form>` rather than a div, so Enter still commits the way it did when each of these was
 * its own card — the field is the kind a user tabs into, types, and presses Enter on.
 */
function BudgetRow({ label, tip, prefix, suffix, placeholder, step, value, onChange, onSave, pending }) {
  return (
    <form
      onSubmit={e => { e.preventDefault(); onSave() }}
      className="flex items-center justify-between gap-3"
    >
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-gray-700">
        {label}
        <InfoTip label={label}>{tip}</InfoTip>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <div className="relative">
          {prefix && (
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">{prefix}</span>
          )}
          <input
            type="number"
            min="0"
            step={step}
            placeholder={placeholder}
            value={value}
            onChange={e => onChange(e.target.value)}
            className={`${numberInputClass} ${prefix ? 'pl-6' : ''} ${suffix ? 'pr-6' : ''}`}
          />
          {suffix && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">{suffix}</span>
          )}
        </div>
        <button type="submit" disabled={pending} className={smallSaveClass}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
