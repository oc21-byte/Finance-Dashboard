import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import dayjs from 'dayjs'
import { CATEGORIES, FINANCE_CATEGORIES } from '../constants/categories.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

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
    .filter(tx => mapping.statementType === 'credit_card' ? tx.type === 'expense' : true)
}

export async function parsePdfToTableData(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise

  const allBuckets = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const { items } = await page.getTextContent()

    const textItems = items
      .filter(item => item.str && item.str.trim())
      .map(item => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))

    const buckets = []
    for (const item of textItems) {
      const bucket = buckets.find(b => Math.abs(b.y - item.y) < 8)
      if (bucket) bucket.items.push(item)
      else buckets.push({ y: item.y, items: [item] })
    }

    buckets.sort((a, b) => b.y - a.y)
    for (const b of buckets) b.items.sort((a, b) => a.x - b.x)
    allBuckets.push(...buckets)
  }

  // Prefer years from an explicit billing period header so that payment-due / promotional
  // dates in the next year don't skew the count.
  const fullText = allBuckets.map(b => b.items.map(it => it.text).join(' ')).join(' ')
  const DASH = '(?:[-‐‑‒–—―−]|\\bthrough\\b)'
  // Match "Mon DD, YYYY – Mon DD, YYYY" (Capital One, TD Bank, etc.)
  // Groups: m[1]=startYear, m[2]=endMonthName, m[3]=endYear
  const namedPeriodMatch = fullText.match(
    new RegExp(
      String.raw`\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+(20[2-9]\d)\s*` +
      DASH + String.raw`\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+(20[2-9]\d)`,
      'i'
    )
  )
  // Match "MM/DD/YYYY – MM/DD/YYYY" (Discover, etc.)
  // Groups: m[1]=startYear, m[2]=endMonth, m[3]=endYear
  const numericPeriodMatch = fullText.match(
    new RegExp(
      String.raw`\b\d{1,2}\/\d{1,2}\/(20[2-9]\d)\s*` + DASH + String.raw`\s*(\d{1,2})\/\d{1,2}\/(20[2-9]\d)`
    )
  )
  const MONTH_ABBRS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
  let statementYear = null
  let statementEndYear = null
  let statementEndMonth = null

  if (namedPeriodMatch) {
    const y1 = parseInt(namedPeriodMatch[1])
    const y2 = parseInt(namedPeriodMatch[3])
    statementYear = y1
    if (y1 !== y2) {
      statementEndYear = y2
      statementEndMonth = MONTH_ABBRS.indexOf(namedPeriodMatch[2].slice(0, 3).toLowerCase()) + 1
    }
  } else if (numericPeriodMatch) {
    const y1 = parseInt(numericPeriodMatch[1])
    const y2 = parseInt(numericPeriodMatch[3])
    statementYear = y1
    if (y1 !== y2) {
      statementEndYear = y2
      statementEndMonth = parseInt(numericPeriodMatch[2])
    }
  }
  if (statementYear === null) {
    const yearCounts = {}
    for (const bucket of allBuckets) {
      for (const item of bucket.items) {
        const matches = item.text.match(/\b(20[2-9][0-9])\b/g)
        if (matches) {
          for (const y of matches) yearCounts[y] = (yearCounts[y] || 0) + 1
        }
      }
    }
    statementYear = Object.keys(yearCounts).length > 0
      ? parseInt(Object.entries(yearCounts).sort((a, b) => b[1] - a[1])[0][0])
      : null
  }

  const headerOccurrences = []
  for (let i = 0; i < allBuckets.length; i++) {
    const noDigitItems = allBuckets[i].items.filter(it => !/\d/.test(it.text))
    const allItemsShort = noDigitItems.length > 0 && noDigitItems.every(it => it.text.length <= 50)
    const nonDigitJoined = noDigitItems.map(it => it.text).join(' ')
    if (allItemsShort && (
      (/\b(description|purchases)\b/i.test(nonDigitJoined) && /\b(amount|debit|credit)\b/i.test(nonDigitJoined)) ||
      (/\bdate\b/i.test(nonDigitJoined) && /\b(amount|debit|credit|description)\b/i.test(nonDigitJoined))
    )) {
      let sectionType = 'unknown'
      for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        const prev = allBuckets[j].items.map(it => it.text).join(' ')
        if (/[\d$]/.test(prev)) continue
        if (/\bdeposit/i.test(prev)) { sectionType = 'deposit'; break }
        if (/\bpayment|\bcheck|\bwithdrawal|\bdebit/i.test(prev)) { sectionType = 'payment'; break }
      }
      headerOccurrences.push({ idx: i, sectionType })
    }
  }

  if (headerOccurrences.length === 0) return null

  const rawHeaderItems = allBuckets[headerOccurrences[0].idx].items
  // Merge adjacent items that are close in X — they belong to the same column label
  // (e.g. "Date of" + "Transaction", or "$" + "Amount").
  // Uses raw X gap between item start positions; within-label word gaps are ~8–48 pts,
  // while between-column gaps are typically 60+ pts.
  const mergedHeaderItems = []
  for (const it of rawHeaderItems) {
    const prev = mergedHeaderItems[mergedHeaderItems.length - 1]
    const gap = prev ? it.x - prev.x : Infinity
    const wouldMixTypes = prev
      && /\b(date|trans)\b/i.test(prev.text)
      && /\b(purchases|description|detail|memo)\b/i.test(it.text)
    if (gap < 50 && !wouldMixTypes) {
      prev.text += ' ' + it.text
    } else {
      mergedHeaderItems.push({ text: it.text, x: it.x })
    }
  }
  const seen = {}
  const headerCols = mergedHeaderItems.map(it => {
    seen[it.text] = (seen[it.text] || 0) + 1
    let name = seen[it.text] > 1 ? `${it.text} ${seen[it.text]}` : it.text
    if (/^purchases$/i.test(name.trim())) name = 'Description'
    return { name, x: it.x }
  }).filter(col => !/\bmerchant\s*category\b/i.test(col.name))
  const headers = headerCols.map(c => c.name)

  function buildRow(bucketItems) {
    const obj = {}
    const lastColIdx = headerCols.length - 1
    const LEFT_TOLERANCE = 15
    for (const item of bucketItems) {
      let colIdx = 0
      for (let i = 1; i <= lastColIdx; i++) {
        if (item.x + LEFT_TOLERANCE >= headerCols[i].x) colIdx = i
      }
      if (colIdx === lastColIdx && item.x < headerCols[lastColIdx].x) {
        const t = item.text.trim()
        const isCurrencyValue = !/^\d{7,}$/.test(t)
          && (/^[\d,]+(\.\d+)?(\s*(CR|DR))?$/i.test(t) || /^\(\d[\d,]*(\.\d+)?\)$/i.test(t))
        if (!isCurrencyValue) colIdx = lastColIdx - 1
      }
      const col = headers[colIdx]
      obj[col] = obj[col] ? obj[col] + ' ' + item.text : item.text
    }
    return obj
  }

  const datePattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}\/\d{1,2}|\d{4}-\d{2})/i
  const descKey = headers.find(h => /\b(description|desc|detail|memo|purchases)\b/i.test(h))
  const amountKey = headers.find(h => /\bamount\b/i.test(h)) || headers.at(-1)

  const rows = []
  for (let s = 0; s < headerOccurrences.length; s++) {
    const { idx: hIdx, sectionType } = headerOccurrences[s]
    const nextHdrIdx = s + 1 < headerOccurrences.length
      ? headerOccurrences[s + 1].idx
      : allBuckets.length

    for (let i = hIdx + 1; i < nextHdrIdx; i++) {
      const rawText = allBuckets[i].items.map(it => it.text).join(' ')
      if (/^(fees|interest charged|total fees|total interest|\d{4} totals|subtotal:|daily balance\b)/i.test(rawText)) break

      const rowObj = buildRow(allBuckets[i].items)
      if (descKey) {
        const descColIdx = headers.indexOf(descKey)
        for (let ci = 1; ci < descColIdx; ci++) {
          const col = headers[ci]
          const val = (rowObj[col] || '').trim()
          const m = val.match(/^(?:[A-Za-z]+\.?\s+\d{1,2}\s+)?(\d+)\s+(.+)$/)
          if (m) {
            rowObj[col] = m[1]
            rowObj[descKey] = rowObj[descKey] ? m[2] + ' ' + rowObj[descKey] : m[2]
          }
        }
      }
      const firstVal = rowObj[headers[0]] || ''

      if (datePattern.test(firstVal) && descKey) {
        const dateEndMatch = firstVal.match(
          /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?)\s*/i
        )
        if (dateEndMatch && dateEndMatch[0].length < firstVal.length) {
          const extra = firstVal.slice(dateEndMatch[0].length).trim()
          if (extra) {
            rowObj[headers[0]] = dateEndMatch[1]
            rowObj[descKey] = extra + (rowObj[descKey] ? ' ' + rowObj[descKey] : '')
          }
        }
      }

      if (datePattern.test(firstVal)) {
        rowObj._section = sectionType
        rows.push(rowObj)
      } else if (rows.length > 0) {
        if (/^(page:\s*\d|call \d{3}|bank deposits|how to balance|begin by adjusting|for consumer|interest notice|finance charges)/i.test(rawText)) continue
        const lastRow = rows[rows.length - 1]
        let descToAppend = ''
        if (descKey) {
          const dateColVal = (rowObj[headers[0]] || '').trim()
          const descColVal = (rowObj[descKey] || '').trim()
          const dateIsText = dateColVal && !datePattern.test(dateColVal) && !/^[\d,.\s()+\-$]+$/.test(dateColVal)
          if (dateIsText && descColVal) descToAppend = dateColVal + ' ' + descColVal
          else if (dateIsText) descToAppend = dateColVal
          else descToAppend = descColVal
        }
        if (descKey && descToAppend && (lastRow[descKey] || '').length < 150) {
          lastRow[descKey] = (lastRow[descKey] || '') + ' ' + descToAppend
        }
        if (amountKey && rowObj[amountKey] && !lastRow[amountKey]) {
          lastRow[amountKey] = rowObj[amountKey]
        }
      }
    }
  }

  if (statementYear) {
    const dateKey = headers[0]
    for (const row of rows) {
      if (!row[dateKey]) continue
      let d = dayjs(row[dateKey])
      if (!d.isValid()) {
        d = dayjs(`${row[dateKey]} ${statementYear}`)
        if (!d.isValid()) continue
      }
      if (statementEndYear) {
        const txMonth = d.month() + 1
        const yr = txMonth <= statementEndMonth ? statementEndYear : statementYear
        row[dateKey] = d.year(yr).format('YYYY-MM-DD')
      } else if (d.year() !== statementYear) {
        row[dateKey] = d.year(statementYear).format('YYYY-MM-DD')
      }
    }
  }

  return { headers, rows, statementYear, statementEndYear, statementEndMonth }
}
