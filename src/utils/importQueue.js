import { api } from '../api/client.js'
import { CREDIT_KINDS } from '../constants/categories.js'
import { buildReport, clearContext, friendlyMessage, logEvent, setContext } from './diagnostics.js'
import {
  PAYMENT_RE,
  classifyCreditKind,
  detectSource,
  isCitizensBankCsv,
  isPdfFile,
  parseCitizensBankCsv,
  processCSVRows,
  readTabularFile,
} from './csvHelpers.js'
import { parsePdfVision } from './pdfVision.js'

// Guards the 2mb JSON body cap on /api/llm/*; no personal statement comes close.
const MAX_AI_ROWS = 2000

// Rows arriving from an AI extraction (vision or grid) rather than a column mapping.
function normalizeExtracted(rawTxs, statementType) {
  const isCard = statementType === 'credit_card'
  return (rawTxs || [])
    .map(tx => {
      const amount = Math.round(Number(tx.amount) * 100) / 100
      if (!Number.isFinite(amount)) return null
      const description = String(tx.description ?? '').trim()
      const base = {
        date: String(tx.date ?? '').trim(),
        description,
        amount,
        // Cards carry merchant categories, so an unclassified card row is 'Other' and shows up
        // in the uncategorized banner. Bank rows use the reserved finance tags.
        category: isCard ? 'Other' : (amount >= 0 ? 'Income' : 'Expense'),
      }
      if (!isCard) return { ...base, type: amount >= 0 ? 'income' : 'expense' }
      // The model is asked for a creditKind on positive rows; fall back to the description
      // classifier when it omits one or returns something unrecognized.
      if (amount <= 0) return base
      const kind = String(tx.creditKind ?? '').trim().toLowerCase()
      return { ...base, creditKind: CREDIT_KINDS.includes(kind) ? kind : classifyCreditKind(description) }
    })
    .filter(Boolean)
    .filter(tx => tx.description || tx.amount !== 0)
    .filter(tx => !PAYMENT_RE.test(tx.description))
}

async function extractRowsWithAi(rawRows, statementType) {
  const rows = rawRows.slice(0, MAX_AI_ROWS)
  if (rawRows.length > MAX_AI_ROWS) {
    logEvent('import', `truncated grid to ${MAX_AI_ROWS} of ${rawRows.length} rows for AI extraction`)
  }
  const { transactions } = await api.llm.extractRows(rows, statementType)
  return normalizeExtracted(transactions, statementType)
}

// Resolves one file into transactions, trying the cheapest reliable strategy first. Returns
// either `{ kind: 'transactions', ... }` or `{ kind: 'needsMapping', ... }`; throws if nothing
// worked, so the caller can record the file as skipped and carry on.
export async function processStatementFile(file, {
  statementType,
  csvSources = {},
  hasAiKey = false,
  allowManualMapping = false,
  onStage,
} = {}) {
  const isCard = statementType === 'credit_card'

  if (isPdfFile(file)) {
    if (!hasAiKey) throw new Error('A PDF needs an AI key to read. Add one in Settings.')
    onStage?.('Reading PDF with AI vision')
    const { transactions, pageCount, account } = await parsePdfVision(file, {
      statementType,
      onProgress: ({ batch, batchCount }) =>
        batchCount > 1 && onStage?.(`Reading PDF with AI vision (part ${batch} of ${batchCount})`),
    })
    const normalized = normalizeExtracted(transactions, statementType)
    if (!normalized.length) throw new Error('AI could not find any transactions in this PDF.')
    // `account` is EVIDENCE, not a name. It goes to the review screen to be shown beside the
    // source-name field; only `matchSourceName` may turn it into a suggestion, and only when it
    // clearly points at a name the user already uses.
    return {
      kind: 'transactions',
      transactions: normalized,
      note: `AI vision, ${pageCount} page(s)`,
      account: account ?? null,
    }
  }

  onStage?.('Reading file')
  const { headers, rows, rawRows, text } = await readTabularFile(file)

  // Citizens exports use two labelled sections instead of a signed amount column, which no
  // column mapping can express.
  if (!isCard && text && isCitizensBankCsv(text)) {
    onStage?.('Parsing Citizens Bank format')
    const txs = parseCitizensBankCsv(rawRows)
    if (txs.length) {
      return { kind: 'transactions', transactions: txs, sourceName: 'Citizens Bank', note: 'Citizens Bank format' }
    }
    logEvent('import', 'Citizens parser found no rows, falling through to detection')
  }

  const detected = detectSource(headers, csvSources, statementType)
  if (detected) {
    onStage?.(`Applying saved mapping: ${detected.name}`)
    const txs = processCSVRows(rows, { ...detected.mapping, sourceName: detected.name })
    if (txs.length) {
      return {
        kind: 'transactions',
        transactions: txs,
        mapping: detected.mapping,
        sourceName: detected.name,
        note: `Saved mapping: ${detected.name}`,
        headers,
        rows,
      }
    }
    logEvent('import', `saved mapping "${detected.name}" produced no rows, re-detecting`)
  }

  // Fewer than two columns means the header row wasn't really a header (a title line, say), so
  // column detection cannot succeed and would just burn a call.
  if (hasAiKey && headers.length >= 2) {
    try {
      onStage?.('Detecting columns with AI')
      const { mapping: detectedMapping } = await api.llm.detectColumns(headers, rows.slice(0, 3))
      // The tab the user uploaded from is authoritative; the model only guesses the type, and a
      // wrong guess saved into csvSources would misroute every later import from this source.
      const mapping = { ...detectedMapping, statementType }
      const txs = processCSVRows(rows, mapping)
      if (txs.length) {
        return {
          kind: 'transactions',
          transactions: txs,
          mapping,
          sourceName: mapping.suggestedSourceName || '',
          note: 'AI column detection',
          headers,
          rows,
        }
      }
      logEvent('import', 'AI column mapping produced no rows, trying row extraction')
    } catch (err) {
      logEvent('import', `column detection failed: ${err.message}`)
    }
  }

  if (hasAiKey && rawRows?.length) {
    onStage?.('Extracting rows with AI')
    const txs = await extractRowsWithAi(rawRows, statementType)
    if (txs.length) {
      return { kind: 'transactions', transactions: txs, note: 'AI row extraction' }
    }
  }

  if (allowManualMapping && headers.length >= 2) {
    return { kind: 'needsMapping', headers, rows }
  }
  throw new Error(
    headers.length >= 2
      ? 'Could not work out the columns in this file. Upload it on its own to map the columns by hand.'
      : 'No recognizable transaction table found in this file.',
  )
}

let groupSeq = 0

// Runs files one at a time so a single bad statement can't take down the batch, and so AI calls
// stay naturally spaced. Returns review-ready groups plus whatever had to be skipped.
export async function runImportQueue(files, {
  statementType,
  csvSources = {},
  hasAiKey = false,
  onProgress,
  postProcess,
} = {}) {
  const groups = []
  const skipped = []
  let needsMapping = null
  const action = `${statementType === 'credit_card' ? 'credit card' : 'bank'} import`
  const allowManualMapping = files.length === 1

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const position = { index: i + 1, total: files.length, fileName: file.name }
    setContext({ action, file, fileIndex: i + 1, fileCount: files.length })

    const report = stage => {
      setContext({ stage })
      onProgress?.({ ...position, stage })
    }

    try {
      const result = await processStatementFile(file, {
        statementType, csvSources, hasAiKey, allowManualMapping, onStage: report,
      })

      if (result.kind === 'needsMapping') {
        needsMapping = { file, headers: result.headers, rows: result.rows }
        continue
      }

      let transactions = result.transactions
      if (postProcess) {
        transactions = await postProcess(transactions, { ...position, report })
      }

      groups.push({
        id: `g${++groupSeq}`,
        fileName: file.name,
        transactions,
        mapping: result.mapping ?? null,
        sourceName: result.sourceName ?? '',
        account: result.account ?? null,
        note: result.note ?? '',
        headers: result.headers ?? null,
        rows: result.rows ?? null,
      })
      logEvent('import', `${file.name}: ${transactions.length} transaction(s) ready`)
    } catch (err) {
      logEvent('import', `${file.name} failed: ${err.message}`)
      skipped.push({
        fileName: file.name,
        reason: friendlyMessage(err),
        report: buildReport(err, { action, file, fileIndex: i + 1, fileCount: files.length }),
      })
    }
  }

  clearContext('action', 'file', 'fileIndex', 'fileCount', 'stage')
  return { groups, skipped, needsMapping }
}

// "chase-march-2026.csv" -> "Chase March 2026", a decent default when nothing better is known.
export function sourceNameFromFile(fileName) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}
