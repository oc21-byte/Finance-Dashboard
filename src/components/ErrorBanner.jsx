import { useState } from 'react'

export default function ErrorBanner({ message, report, onDismiss, className = '' }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard is unavailable outside secure contexts, so fall back to a file download.
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([report], { type: 'text/markdown' }))
      a.download = `finance-dashboard-error-${Date.now()}.md`
      a.click()
      URL.revokeObjectURL(a.href)
    }
  }

  return (
    <div className={`rounded-lg bg-red-50 border border-red-200 text-red-800 ${className}`}>
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium break-words">{message}</p>
          {report && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button
                onClick={handleCopy}
                className="px-2.5 py-1 text-xs font-medium bg-red-100 hover:bg-red-200 border border-red-300 rounded-md transition-colors"
              >
                {copied ? 'Copied' : 'Copy diagnosis'}
              </button>
              <button
                onClick={() => setExpanded(e => !e)}
                className="px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 rounded-md transition-colors"
              >
                {expanded ? 'Hide details ▲' : 'Show details ▼'}
              </button>
            </div>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            title="Dismiss"
            className="shrink-0 text-red-400 hover:text-red-700 text-lg leading-none -mt-0.5"
          >
            ✕
          </button>
        )}
      </div>

      {expanded && report && (
        <pre className="mx-4 mb-3 p-3 max-h-72 overflow-auto bg-white/70 border border-red-200 rounded-md text-[11px] leading-relaxed text-red-900 whitespace-pre-wrap break-words">
          {report}
        </pre>
      )}
    </div>
  )
}
