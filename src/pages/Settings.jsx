import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

const DEFAULT_VISION_MODEL = 'claude-sonnet-4-6'

export default function Settings() {
  const queryClient = useQueryClient()
  const [showInput, setShowInput] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [incomeInput, setIncomeInput] = useState('')
  const [incomeSaved, setIncomeSaved] = useState(false)
  const [returnInput, setReturnInput] = useState('')
  const [returnSaved, setReturnSaved] = useState(false)
  const [savingsRateInput, setSavingsRateInput] = useState('')
  const [savingsRateSaved, setSavingsRateSaved] = useState(false)
  const [visionModelInput, setVisionModelInput] = useState('')
  const [visionModelSaved, setVisionModelSaved] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })

  const { data: uploadHistory = [] } = useQuery({
    queryKey: ['upload-history'],
    queryFn: api.uploadHistory.list,
  })

  const bankHistory = uploadHistory.filter(e => e.ledger !== 'credit_card')
  const cardHistory = uploadHistory.filter(e => e.ledger === 'credit_card')

  const deleteHistoryEntry = useMutation({
    mutationFn: api.uploadHistory.remove,
    onSuccess: () => {
      setPendingDelete(null)
      queryClient.invalidateQueries({ queryKey: ['upload-history'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['credit_card_transactions'] })
    },
  })

  function linkedTxCount(entry) {
    return Array.isArray(entry.transactionIds) ? entry.transactionIds.length : 0
  }

  function ledgerLabel(entry) {
    return entry.ledger === 'credit_card' ? 'Spend Analyzer' : 'Finances'
  }

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
    if (settings?.visionModel != null) {
      setVisionModelInput(settings.visionModel)
    }
  }, [settings])

  const currentProvider = settings?.aiProvider ?? 'claude'
  const hasKey = currentProvider === 'openai' ? settings?.hasOpenaiApiKey : settings?.hasClaudeApiKey

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
      setKeyInput('')
      setShowInput(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const saveIncome = useMutation({
    mutationFn: (val) => api.settings.update({
      confirmedMonthlyIncome: val === '' ? null : Number(val),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setIncomeSaved(true)
      setTimeout(() => setIncomeSaved(false), 3000)
    },
  })

  function handleSave(e) {
    e.preventDefault()
    if (!keyInput.trim()) return
    saveKey.mutate(keyInput.trim())
  }

  function handleSaveIncome(e) {
    e.preventDefault()
    saveIncome.mutate(incomeInput.trim())
  }

  const saveReturn = useMutation({
    // Input is a percent; store as a decimal. Blank resets to the 6% default.
    mutationFn: (val) => api.settings.update({
      assumedAnnualReturn: val === '' ? 0.06 : Number(val) / 100,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      setReturnSaved(true)
      setTimeout(() => setReturnSaved(false), 3000)
    },
  })

  function handleSaveReturn(e) {
    e.preventDefault()
    saveReturn.mutate(returnInput.trim())
  }

  const saveSavingsRate = useMutation({
    mutationFn: (val) => api.settings.update({
      budgetSavingsRate: val === '' ? 15 : Math.min(100, Math.max(0, Number(val))),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setSavingsRateSaved(true)
      setTimeout(() => setSavingsRateSaved(false), 3000)
    },
  })

  function handleSaveSavingsRate(e) {
    e.preventDefault()
    saveSavingsRate.mutate(savingsRateInput.trim())
  }

  const saveVisionModel = useMutation({
    mutationFn: (val) => api.settings.update({ visionModel: val === '' ? DEFAULT_VISION_MODEL : val }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setVisionModelSaved(true)
      setTimeout(() => setVisionModelSaved(false), 2000)
    },
  })

  function handleSaveVisionModel(e) {
    e.preventDefault()
    saveVisionModel.mutate(visionModelInput.trim())
  }

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-semibold text-gray-800 mb-6">Settings</h1>

      {/* Row 1: AI Provider | Monthly Income | Annual Return */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* AI Provider */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">AI Provider</h2>
          <p className="text-xs text-gray-400 mb-4">
            Choose which AI service powers insights, chat, categorization, and PDF imports.
          </p>
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => saveProvider.mutate('claude')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                currentProvider === 'claude'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Claude
            </button>
            <button
              onClick={() => saveProvider.mutate('openai')}
              className={`px-4 py-2 text-sm font-medium border-l border-gray-200 transition-colors ${
                currentProvider === 'openai'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              ChatGPT
            </button>
          </div>
        </div>

        {/* Monthly Income Baseline */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Monthly Income Baseline</h2>
          <p className="text-xs text-gray-400 mb-4">
            Your confirmed monthly take-home income. Used by Budget Builder as the income baseline — overrides the CSV-derived average when set.
          </p>
          {incomeSaved && <p className="text-xs text-green-600 mb-3">Saved ✓</p>}
          <form onSubmit={handleSaveIncome} className="flex gap-2 items-center">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 5000"
                value={incomeInput}
                onChange={(e) => setIncomeInput(e.target.value)}
                className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={saveIncome.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {saveIncome.isPending ? 'Saving…' : 'Save'}
            </button>
            {incomeInput !== '' && (
              <button
                type="button"
                onClick={() => { setIncomeInput(''); saveIncome.mutate('') }}
                className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
            )}
          </form>
        </div>

        {/* Assumed Annual Investment Return */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Assumed Annual Investment Return</h2>
          <p className="text-xs text-gray-400 mb-4">
            Used for the optimistic "with growth" projection on linked goals. Savings accounts use their own APY. Default 6%.
          </p>
          {returnSaved && <p className="text-xs text-green-600 mb-3">Saved ✓</p>}
          <form onSubmit={handleSaveReturn} className="flex gap-2 items-center">
            <div className="relative flex-1">
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="6"
                value={returnInput}
                onChange={(e) => setReturnInput(e.target.value)}
                className="w-full border border-gray-200 rounded-lg pl-3 pr-7 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
            </div>
            <button
              type="submit"
              disabled={saveReturn.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {saveReturn.isPending ? 'Saving…' : 'Save'}
            </button>
          </form>
        </div>
      </div>

      {/* Row 2: API Key | Default Savings Rate */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        {/* API Key */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-gray-700">API Key</h2>
            {hasKey && (
              <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
                Configured ✓
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mb-4">
            {currentProvider === 'openai'
              ? 'Your OpenAI API key. Uses gpt-4o-mini for insights and chat, gpt-4o for CSV detection and PDF imports.'
              : 'Your Anthropic API key. Used for AI insights, chat, and PDF imports. Stored locally, never sent to any third party.'}
          </p>
          {saved && <p className="text-xs text-green-600 mb-3">API key saved successfully.</p>}
          {hasKey && !showInput ? (
            <button
              onClick={() => setShowInput(true)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Replace key
            </button>
          ) : (
            <form onSubmit={handleSave} className="flex gap-2">
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
        </div>

        {/* Default Savings Rate */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Default Savings Rate</h2>
          <p className="text-xs text-gray-400 mb-4">
            Percentage of monthly income used as the default general savings target on the Budget page. Default is 15%.
          </p>
          {savingsRateSaved && <p className="text-xs text-green-600 mb-3">Saved ✓</p>}
          <form onSubmit={handleSaveSavingsRate} className="flex gap-2 items-center">
            <div className="relative flex-1">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                placeholder="15"
                value={savingsRateInput}
                onChange={(e) => setSavingsRateInput(e.target.value)}
                className="w-full border border-gray-200 rounded-lg pl-3 pr-7 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
            </div>
            <button
              type="submit"
              disabled={saveSavingsRate.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {saveSavingsRate.isPending ? 'Saving…' : 'Save'}
            </button>
          </form>
        </div>
      </div>

      {/* Statement Extraction Model */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mt-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Statement Extraction Model</h2>
        <p className="text-xs text-gray-400 mb-4">
          The Claude model used to read scanned PDF statements. Statements are sent one file at a time
          in small page batches, so the default handles multi-statement uploads accurately — switch to a
          stronger model only if a particular statement keeps coming out wrong.
          {currentProvider === 'openai' && ' Applies to the Claude provider only; OpenAI uses gpt-4o.'}
        </p>
        {visionModelSaved && <p className="text-xs text-green-600 mb-3">Saved ✓</p>}
        <form onSubmit={handleSaveVisionModel} className="flex gap-2 items-center">
          <input
            className={inputClass}
            type="text"
            placeholder={DEFAULT_VISION_MODEL}
            value={visionModelInput}
            onChange={(e) => setVisionModelInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={saveVisionModel.isPending}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {saveVisionModel.isPending ? 'Saving…' : 'Save'}
          </button>
          {visionModelInput !== DEFAULT_VISION_MODEL && (
            <button
              type="button"
              onClick={() => { setVisionModelInput(DEFAULT_VISION_MODEL); saveVisionModel.mutate(DEFAULT_VISION_MODEL) }}
              className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600 whitespace-nowrap"
            >
              Reset
            </button>
          )}
        </form>
      </div>

      {/* Row 3: Bank Upload History | Credit Card Upload History */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        <UploadHistoryPanel
          title="Bank Upload History"
          description="Finances imports (CSV, XLSX, or PDF). Deleting a recent upload also removes its linked transactions. Older entries (before this feature) only clear the history log."
          emptyLabel="No bank imports yet."
          entries={bankHistory}
          linkedTxCount={linkedTxCount}
          onDelete={setPendingDelete}
          deletePending={deleteHistoryEntry.isPending}
        />
        <UploadHistoryPanel
          title="Credit Card Upload History"
          description="Spend Analyzer imports (CSV, XLSX, or PDF). Deleting a recent upload also removes its linked card transactions."
          emptyLabel="No credit card imports yet."
          entries={cardHistory}
          linkedTxCount={linkedTxCount}
          onDelete={setPendingDelete}
          deletePending={deleteHistoryEntry.isPending}
        />
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
                    {linkedTxCount(pendingDelete)} linked {ledgerLabel(pendingDelete)} transaction
                    {linkedTxCount(pendingDelete) !== 1 ? 's' : ''}
                  </span>
                  . This cannot be undone.
                </>
              ) : (
                <>
                  This will remove the history entry for{' '}
                  <span className="font-medium">{pendingDelete.filename}</span>. Linked transactions
                  cannot be found for older uploads and will not be removed.
                </>
              )}
            </p>
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
    </div>
  )
}

function UploadHistoryPanel({ title, description, emptyLabel, entries, linkedTxCount, onDelete, deletePending }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">{title}</h2>
      <p className="text-xs text-gray-400 mb-4">{description}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {entries.map(entry => {
            const linked = linkedTxCount(entry)
            return (
              <li key={entry.id} className="flex items-center justify-between py-2 gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 truncate">{entry.filename}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {entry.sourceName && <span className="text-gray-500 mr-2">{entry.sourceName}</span>}
                    {entry.transactionCount} transaction{entry.transactionCount !== 1 ? 's' : ''}
                    {linked > 0 ? ` · ${linked} linked` : ' · history only'}
                    {' · '}
                    {new Date(entry.importedAt).toLocaleDateString(undefined, {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })}
                  </p>
                </div>
                <button
                  onClick={() => onDelete(entry)}
                  disabled={deletePending}
                  className="text-xs text-red-400 hover:text-red-600 transition-colors shrink-0 disabled:opacity-40"
                >
                  Delete
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
