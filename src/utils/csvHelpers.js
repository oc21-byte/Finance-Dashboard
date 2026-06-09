import * as pdfjsLib from 'pdfjs-dist'
import dayjs from 'dayjs'
import { CATEGORIES, FINANCE_CATEGORIES } from '../constants/categories.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

export function isCitizensBankCsv(text) {
  return /TRANSACTIONDETAILS?\s+FOR\s+CHECKING\s+ACCOUNT/i.test(text) ||
    (/Withdrawals\s*&\s*Debits/i.test(text) && /Deposits\s*&\s*Credits/i.test(text))
}

export async function parsePdfVision(file) {
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

  const res = await fetch('/api/parse-pdf-vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Vision API request failed')
  }
  return res.json()
}

export function parseCitizensBankCsv(rawRows) {
  // Extract year from YYMMDD codes in descriptions (e.g. "260217" → 2026)
  let year = dayjs().year()
  outer: for (const row of rawRows) {
    for (const cell of row) {
      const m = String(cell).match(/\b(2\d)(0[1-9]|1[0-2])([0-2]\d|3[01])\b/)
      if (m) { year = 2000 + parseInt(m[1]); break outer }
    }
  }

  const txs = []
  let section = null
  const dateRe = /^\d{1,2}\/\d{1,2}$/

  for (const row of rawRows) {
    const col0 = String(row[0] || '').trim()
    const rowText = row.join(' ')

    if (/Withdrawals\s*&\s*Debits/i.test(rowText)) { section = 'withdrawal'; continue }
    if (/Deposits\s*&\s*Credits/i.test(rowText)) { section = 'deposit'; continue }
    if (/Daily\s*Balance/i.test(rowText)) break

    if (!section || !dateRe.test(col0)) continue

    const [month, day] = col0.split('/')
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`

    if (section === 'withdrawal') {
      const amount = Math.abs(parseAmount(row[1]))
      const desc = String(row[2] || '').trim()
      if (amount > 0 && desc) {
        txs.push({ date, description: desc, amount: -amount, category: 'Expense', type: 'expense', source: 'Citizens Bank' })
      }
    } else {
      const amount = Math.abs(parseAmount(row[2]))
      const desc = String(row[3] || '').trim()
      if (amount > 0 && desc) {
        txs.push({ date, description: desc, amount, category: 'Income', type: 'income', source: 'Citizens Bank' })
      }
    }
  }

  return txs
}

export function parseAmount(str) {
  if (str === null || str === undefined || str === '') return 0
  const trimmed = String(str).trim()
  const isCR = /\bCR$/i.test(trimmed)
  const s = trimmed.replace(/[$,\s]/g, '').replace(/CR$/i, '')
  if (s.startsWith('(') && s.endsWith(')')) return -(parseFloat(s.slice(1, -1)) || 0)
  const n = parseFloat(s) || 0
  return isCR ? -n : n
}

export function detectSource(headers, csvSources, statementTypeFilter = null) {
  for (const [name, mapping] of Object.entries(csvSources)) {
    if (statementTypeFilter && mapping.statementType !== statementTypeFilter) continue
    const required = mapping.splitDebitCredit
      ? [mapping.date, mapping.description, mapping.debit, mapping.credit]
      : [mapping.date, mapping.description, mapping.amount]
    if (required.filter(Boolean).every(col => headers.includes(col))) {
      return { name, mapping }
    }
  }
  return null
}

export function processCSVRows(rows, mapping, { skipTypeFilter = false } = {}) {
  return rows
    .map(row => {
      let amount
      if (mapping.splitDebitCredit) {
        const debit = Math.abs(parseAmount(row[mapping.debit]))
        const credit = Math.abs(parseAmount(row[mapping.credit]))
        amount = credit > 0 ? credit : -debit
      } else {
        const raw = parseAmount(row[mapping.amount])
        if (mapping.statementType === 'bank' && row._section === 'deposit') {
          amount = Math.abs(raw)
        } else if (mapping.statementType === 'bank' && row._section === 'payment') {
          amount = -Math.abs(raw)
        } else {
          amount = mapping.invertAmounts ? -raw : raw
        }
      }
      amount = Math.round(amount * 100) / 100

      const isBank = mapping.statementType === 'bank'
      const categoryList = isBank ? FINANCE_CATEGORIES : CATEGORIES
      let category = isBank ? (amount >= 0 ? 'Income' : 'Expense') : 'Other'
      if (mapping.category && row[mapping.category]) {
        const csv = row[mapping.category].trim()
        category = categoryList.find(c => c.toLowerCase() === csv.toLowerCase()) || category
      }

      const rawDate = (row[mapping.date] || '').trim()
      const parsed = dayjs(rawDate)
      let date
      if (parsed.isValid()) {
        if (mapping.statementEndYear) {
          const txMonth = parsed.month() + 1
          const yr = txMonth <= mapping.statementEndMonth ? mapping.statementEndYear : mapping.statementYear
          date = parsed.year(yr).format('YYYY-MM-DD')
        } else if (mapping.statementYear && parsed.year() !== mapping.statementYear) {
          date = parsed.year(mapping.statementYear).format('YYYY-MM-DD')
        } else {
          date = parsed.format('YYYY-MM-DD')
        }
      } else if (mapping.statementYear) {
        const withYear = dayjs(`${rawDate} ${mapping.statementYear}`)
        if (withYear.isValid()) {
          if (mapping.statementEndYear) {
            const txMonth = withYear.month() + 1
            const yr = txMonth <= mapping.statementEndMonth ? mapping.statementEndYear : mapping.statementYear
            date = withYear.year(yr).format('YYYY-MM-DD')
          } else {
            date = withYear.format('YYYY-MM-DD')
          }
        } else {
          date = rawDate
        }
      } else {
        date = rawDate
      }

      return {
        date,
        description: (row[mapping.description] || '').trim(),
        amount,
        category,
        source: mapping.sourceName,
        type: amount >= 0 ? 'income' : 'expense',
      }
    })
    .filter(tx => tx.description || tx.amount !== 0)
    .filter(tx => skipTypeFilter ? true : mapping.statementType === 'credit_card' ? tx.type === 'expense' : true)
}
