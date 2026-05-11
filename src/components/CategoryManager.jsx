import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'
import { CATEGORIES, CATEGORY_COLORS } from '../constants/categories.js'

export default function CategoryManager() {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6366f1')
  const [error, setError] = useState(null)

  const { data: customCategories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories.list,
  })

  const createMutation = useMutation({
    mutationFn: api.categories.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setNewName('')
      setError(null)
    },
    onError: () => setError('That category already exists.'),
  })

  const deleteMutation = useMutation({
    mutationFn: api.categories.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories'] }),
  })

  function handleAdd(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    if (CATEGORIES.some(c => c.toLowerCase() === name.toLowerCase())) {
      setError('That name is already a built-in category.')
      return
    }
    setError(null)
    createMutation.mutate({ name, color: newColor })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-5">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        <span>Manage Categories</span>
        <span className="text-gray-300 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
          <div>
            <p className="text-xs text-gray-400 mb-2">Built-in</p>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(cat => (
                <span
                  key={cat}
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: (CATEGORY_COLORS[cat] || '#94a3b8') + '1a',
                    color: CATEGORY_COLORS[cat] || '#94a3b8',
                  }}
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>

          {customCategories.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-2">Custom</p>
              <div className="flex flex-wrap gap-1.5">
                {customCategories.map(cat => (
                  <span
                    key={cat.name}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: cat.color + '1a',
                      color: cat.color,
                    }}
                  >
                    {cat.name}
                    <button
                      onClick={() => deleteMutation.mutate(cat.name)}
                      disabled={deleteMutation.isPending}
                      className="opacity-50 hover:opacity-100 leading-none ml-0.5"
                      title="Remove category"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleAdd} className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={newName}
              onChange={e => { setNewName(e.target.value); setError(null) }}
              placeholder="New category name…"
              className="flex-1 text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="color"
              value={newColor}
              onChange={e => setNewColor(e.target.value)}
              title="Pick a color"
              className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0.5 shrink-0"
            />
            <button
              type="submit"
              disabled={!newName.trim() || createMutation.isPending}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
            >
              Add
            </button>
          </form>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </div>
  )
}
