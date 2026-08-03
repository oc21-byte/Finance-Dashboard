import Papa from 'papaparse'
import dayjs from 'dayjs'
import { CATEGORIES, FINANCE_CATEGORIES } from '../constants/categories.js'
import { logEvent } from './diagnostics.js'

// Payments to a credit card are settled from the bank account, where they already appear as an
// expense — importing them again on the card side would double-count the same money.
export const PAYMENT_RE = /\b(payment\s*(-\s*)?(thank\s*you|received|applied|posted)|autopay|auto\s*pay|directpay|online\s*payment|electronic\s*payment|ach\s*payment|mobile\s*payment)\b/i

// Classifies a positive card row for the non-AI import paths, where all we have is the
// description. Checked most-specific first: an issuer's rewards wording wins over the generic
// word "credit" that usually accompanies it.
const CREDIT_KIND_RES = [
  ['cashback', /\b(cash\s*back|cashback|reward(s)?|points?\s*(redeemed|redemption)|redemption|redeemed)\b/i],
  ['refund',   /\b(refund(ed)?|return(ed|s)?|reversal|reversed|chargeback|charge\s*back|dispute\s*credit|merchandise\s*credit|credit\s*voucher)\b/i],
  ['rebate',   /\b(rebate|adjustment|goodwill|courtesy|promotional\s*credit|promo\s*credit|price\s*protection|waiver|waived)\b/i],
]

export function classifyCreditKind(description) {
  const text = String(description ?? '')
  for (const [kind, re] of CREDIT_KIND_RES) {
    if (re.test(text)) return kind
  }
  return 'credit'
}

const SPREADSHEET_RE = /\.(xlsx|xlsm|xlsb|xls)$/i
const PDF_RE = /\.pdf$/i

export function isSpreadsheetFile(file) {
  return SPREADSHEET_RE.test(file.name)
}

export function isPdfFile(file) {
  return PDF_RE.test(file.name)
}

export function isCitizensBankCsv(text) {
  return /TRANSACTIONDETAILS?\s+FOR\s+CHECKING\s+ACCOUNT/i.test(text) ||
    (/Withdrawals\s*&\s*Debits/i.test(text) && /Deposits\s*&\s*Credits/i.test(text))
}

// Header names must be unique and non-empty to be usable as row-object keys.
function normalizeHeaders(cells) {
  const seen = new Map()
  return cells.map((cell, i) => {
    let name = String(cell ?? '').trim() || `Column ${i + 1}`
    if (seen.has(name)) {
      const n = seen.get(name) + 1
      seen.set(name, n)
      name = `${name}_${n}`
    } else {
      seen.set(name, 1)
    }
    return name
  })
}

// Bank spreadsheet exports often open with title/blank rows before the real header, so the
// header is taken to be the widest of the first several rows rather than always row 0.
function gridToRows(grid) {
  const countFilled = row => (row || []).filter(c => String(c ?? '').trim() !== '').length
  let headerIdx = -1
  let best = 1
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const filled = countFilled(grid[i])
    if (filled > best) {
      best = filled
      headerIdx = i
    }
  }
  if (headerIdx === -1) return { headers: [], rows: [] }

  const headers = normalizeHeaders(grid[headerIdx])
  const rows = []
  for (let i = headerIdx + 1; i < grid.length; i++) {
    if (countFilled(grid[i]) === 0) continue
    const row = {}
    headers.forEach((h, c) => { row[h] = String(grid[i][c] ?? '').trim() })
    rows.push(row)
  }
  return { headers, rows }
}

// One reader for CSV and XLSX/XLS, returning both the keyed rows the mapping path needs and the
// raw grid the Citizens parser and the AI row-extraction fallback need.
export async function readTabularFile(file) {
  if (isSpreadsheetFile(file)) {
    // Loaded on demand — SheetJS is large and most imports never touch it.
    const XLSX = await import('xlsx')
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) throw new Error('This spreadsheet has no sheets.')
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1, blankrows: false, defval: '', raw: false,
    })
    logEvent('import', `read sheet "${sheetName}" from ${file.name} (${grid.length} rows)`)
    return { ...gridToRows(grid), rawRows: grid, text: null }
  }

  const text = await file.text()
  const keyed = Papa.parse(text, { header: true, skipEmptyLines: true })
  const grid = Papa.parse(text, { header: false, skipEmptyLines: false })
  logEvent('import', `parsed CSV ${file.name} (${keyed.data.length} rows)`)
  return {
    headers: keyed.meta.fields || [],
    rows: keyed.data,
    rawRows: grid.data,
    text,
  }
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

export function processCSVRows(rows, mapping) {
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

      const description = (row[mapping.description] || '').trim()
      const base = { date, description, amount, category, source: mapping.sourceName }

      // Card rows are identified by sign, not by a `type` tag: negative is spending, positive is
      // a credit and carries the kind of credit it is.
      if (!isBank) {
        return amount > 0 ? { ...base, creditKind: classifyCreditKind(description) } : base
      }
      return { ...base, type: amount >= 0 ? 'income' : 'expense' }
    })
    .filter(tx => tx.description || tx.amount !== 0)
    // Payments to the card are the one thing dropped outright; credits are kept.
    .filter(tx => mapping.statementType === 'credit_card' ? !PAYMENT_RE.test(tx.description) : true)
}
