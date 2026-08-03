// Rolling activity log + failure-report builder. A report carries the run-up to a failure
// (recent API calls, import stages) rather than just the final throw, which is what makes a
// bulk-import failure on file 7 of 12 diagnosable from a single paste.

const MAX_EVENTS = 50

const events = []
let context = {}
const startedAt = Date.now()

// Anything resembling a provider key, in case one ever lands in an error string or URL.
const KEY_RE = /\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,})\b/g

export function redact(value) {
  if (value === null || value === undefined) return value
  return String(value).replace(KEY_RE, '<redacted-api-key>')
}

export function logEvent(kind, summary, detail) {
  events.push({ at: Date.now(), kind, summary: redact(summary), detail })
  if (events.length > MAX_EVENTS) events.shift()
}

// Ambient facts about what the user is doing, merged into every report. Pages set `tab`,
// the import queue sets `action`/`file`/`stage` as it advances.
export function setContext(patch) {
  context = { ...context, ...patch }
}

export function clearContext(...keys) {
  if (!keys.length) {
    context = {}
    return
  }
  const next = { ...context }
  for (const key of keys) delete next[key]
  context = next
}

export function getContext() {
  return { ...context }
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function describeFile(file) {
  if (!file) return null
  const size = formatBytes(file.size)
  return [file.name, size, file.type || 'unknown type'].filter(Boolean).join(', ')
}

function formatTrail() {
  if (!events.length) return '(no activity recorded)'
  return events
    .map(e => {
      const offset = ((e.at - startedAt) / 1000).toFixed(2).padStart(7)
      const kind = e.kind.padEnd(7)
      const detail = e.detail ? `  ${redact(JSON.stringify(e.detail))}` : ''
      return `+${offset}s  ${kind} ${e.summary}${detail}`
    })
    .join('\n')
}

// One-line, human-readable version of an error for the banner headline.
export function friendlyMessage(error) {
  if (!error) return 'Something went wrong.'
  if (error.serverMessage) return redact(error.serverMessage)
  return redact(error.message || String(error))
}

// Paste-ready markdown describing a failure. Deliberately excludes API keys and includes at
// most one sample data row, so a report can be shared without leaking a whole statement.
export function buildReport(error, extra = {}) {
  const ctx = { ...context, ...extra }
  const lines = ['### Finance Dashboard error report', '']

  const facts = [
    ['When', new Date().toISOString()],
    ['Tab', ctx.tab],
    ['Action', ctx.action],
    ['Stage', ctx.stage],
    ['File', describeFile(ctx.file) || ctx.fileName],
    ['Progress', ctx.fileIndex && ctx.fileCount ? `file ${ctx.fileIndex} of ${ctx.fileCount}` : null],
    ['Rows / pages', ctx.rowCount != null || ctx.pageCount != null
      ? [ctx.rowCount != null ? `${ctx.rowCount} rows` : null, ctx.pageCount != null ? `${ctx.pageCount} pages` : null].filter(Boolean).join(', ')
      : null],
    ['AI provider', ctx.aiProvider],
    ['App version', import.meta.env?.MODE],
    ['User agent', typeof navigator !== 'undefined' ? navigator.userAgent : null],
  ]
  for (const [label, value] of facts) {
    if (value) lines.push(`- **${label}:** ${redact(value)}`)
  }

  lines.push('', '**Error**')
  if (error?.method && error?.path) {
    lines.push(`- Request: \`${error.method} ${error.path}\` → ${error.status ?? 'no response'}`)
  }
  lines.push(`- Message: ${friendlyMessage(error)}`)
  if (error?.errorId) lines.push(`- Server error id: \`${error.errorId}\``)
  if (error?.body !== undefined && error?.body !== null && !error.serverMessage) {
    lines.push('', 'Response body:', '```', redact(JSON.stringify(error.body).slice(0, 1000)), '```')
  }
  if (error?.stack) {
    lines.push('', 'Stack:', '```', redact(error.stack).split('\n').slice(0, 12).join('\n'), '```')
  }
  if (ctx.componentStack) {
    lines.push('', 'Component stack:', '```', redact(ctx.componentStack).split('\n').slice(0, 12).join('\n'), '```')
  }

  if (ctx.sampleRow) {
    lines.push('', 'Sample row (one only):', '```json', redact(JSON.stringify(ctx.sampleRow, null, 2)).slice(0, 800), '```')
  }

  lines.push('', 'Recent activity (oldest first):', '```', formatTrail(), '```')

  return lines.join('\n')
}

// Shape a caught error into the `importStatus` object the pages already render.
export function errorStatus(error, extra = {}) {
  logEvent('error', friendlyMessage(error), extra.stage ? { stage: extra.stage } : undefined)
  return {
    type: 'error',
    message: friendlyMessage(error),
    report: buildReport(error, extra),
  }
}

// Async failures outside React's tree would otherwise vanish into the console; recording them
// means they still show up in the activity trail of whatever report gets built next.
export function installGlobalHandlers() {
  if (typeof window === 'undefined' || window.__diagHandlersInstalled) return
  window.__diagHandlersInstalled = true
  window.addEventListener('error', e => {
    logEvent('window', e.message || 'Uncaught error', { source: e.filename, line: e.lineno })
  })
  window.addEventListener('unhandledrejection', e => {
    const reason = e.reason
    logEvent('promise', reason?.message || String(reason) || 'Unhandled rejection')
  })
}
