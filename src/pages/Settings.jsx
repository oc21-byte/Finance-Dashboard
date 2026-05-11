import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function Settings() {
  const queryClient = useQueryClient()
  const [showInput, setShowInput] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [saved, setSaved] = useState(false)

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })

  const saveKey = useMutation({
    mutationFn: (claudeApiKey) => api.settings.update({ claudeApiKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setKeyInput('')
      setShowInput(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const hasKey = settings?.hasClaudeApiKey

  function handleSave(e) {
    e.preventDefault()
    if (!keyInput.trim()) return
    saveKey.mutate(keyInput.trim())
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold text-gray-800 mb-6">Settings</h1>

      {/* Claude API Key */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-700">Claude API Key</h2>
          {hasKey && (
            <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
              Configured ✓
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Used for AI insights on the Dashboard and goal analysis. Stored locally, never sent to any third party.
        </p>

        {saved && (
          <p className="text-xs text-green-600 mb-3">API key saved successfully.</p>
        )}

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
              placeholder="sk-ant-…"
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
    </div>
  )
}
