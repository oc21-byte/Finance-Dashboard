import * as pdfjsLib from 'pdfjs-dist'
import { logEvent } from './diagnostics.js'

// Kept separate from csvHelpers so the tabular parsing path carries no DOM dependency.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

export async function renderPdfToJpegPages(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise

  const pages = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    pages.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
  }
  return pages
}

async function postVisionBatch(pages, statementType, statementPeriod) {
  const res = await fetch('/api/parse-pdf-vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages, statementType, statementPeriod }),
  })
  logEvent('api', `POST /api/parse-pdf-vision → ${res.status} (${pages.length} pages)`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    // Mirror ApiError's shape so failure reports carry the server's message and error id.
    const err = new Error(body.error || 'Vision API request failed')
    Object.assign(err, {
      method: 'POST',
      path: '/api/parse-pdf-vision',
      status: res.status,
      body,
      serverMessage: body.error,
      errorId: body.errorId,
    })
    throw err
  }
  return res.json()
}

// Extraction accuracy drops when many pages are crammed into one request, so pages go up in
// small batches. The statement period is only printed on the first page, so whatever the model
// reads there is threaded into later batches — otherwise they have nothing to infer the year
// from and every date after the first batch lands in the wrong year.
export async function parsePdfVision(file, { statementType = 'bank', onProgress, batchSize = 8 } = {}) {
  const pages = await renderPdfToJpegPages(file)
  logEvent('vision', `rasterized ${pages.length} page(s) from ${file.name}`)

  const batches = []
  for (let i = 0; i < pages.length; i += batchSize) batches.push(pages.slice(i, i + batchSize))

  const transactions = []
  let statementPeriod = null
  for (let i = 0; i < batches.length; i++) {
    onProgress?.({ batch: i + 1, batchCount: batches.length })
    const result = await postVisionBatch(batches[i], statementType, statementPeriod)
    if (!statementPeriod && result.statementPeriod) statementPeriod = result.statementPeriod
    transactions.push(...(result.transactions || []))
  }

  return { transactions, pageCount: pages.length, statementPeriod }
}

/**
 * Read an investment or savings account SUMMARY, rather than a transaction ledger.
 *
 * Batching is the same, but nothing needs threading between batches the way a statement period
 * does for transactions: every position carries its own quantity, and the one as-of date is
 * printed on the first page. A ticker seen in two batches is the same position read twice — a
 * multi-page holdings table repeating its header, most often — so the first reading wins rather
 * than the two being summed into a doubled quantity.
 */
export async function parseAccountStatementVision(file, {
  statementType = 'investment', onProgress, batchSize = 8,
} = {}) {
  const pages = await renderPdfToJpegPages(file)
  logEvent('vision', `rasterized ${pages.length} page(s) from ${file.name} as an account summary`)

  const batches = []
  for (let i = 0; i < pages.length; i += batchSize) batches.push(pages.slice(i, i + batchSize))

  const positions = []
  const accounts = []
  const seenTickers = new Set()
  const seenAccounts = new Set()
  let statementDate = null
  let accountLabel = null
  let currency = null

  for (let i = 0; i < batches.length; i++) {
    onProgress?.({ batch: i + 1, batchCount: batches.length })
    const result = await postVisionBatch(batches[i], statementType, null)
    if (!statementDate && result.statementDate) statementDate = result.statementDate
    if (!accountLabel && result.accountLabel) accountLabel = result.accountLabel
    if (!currency && (result.currency === 'CAD' || result.currency === 'USD')) {
      currency = result.currency
    }

    for (const position of result.positions || []) {
      const key = String(position?.ticker ?? '').trim().toUpperCase()
      if (!key || seenTickers.has(key)) continue
      seenTickers.add(key)
      positions.push(position)
    }
    for (const account of result.accounts || []) {
      const key = String(account?.name ?? '').trim().toLowerCase()
      if (!key || seenAccounts.has(key)) continue
      seenAccounts.add(key)
      accounts.push(account)
    }
  }

  return { positions, accounts, statementDate, accountLabel, currency, pageCount: pages.length }
}
