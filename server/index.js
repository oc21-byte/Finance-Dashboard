import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { DEMO_MODE } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '../data/db.json')
const MOCK_PATH = path.join(__dirname, '../data/mock_data.json')

const DEFAULT_DB = {
  transactions: [],
  credit_card_transactions: [],
  holdings: [],
  goals: [],
  savings_accounts: [],
  netWorthHistory: [],
  uploadHistory: [],
  settings: {
    claudeApiKey: '',
    openaiApiKey: '',
    aiProvider: 'claude',
    customCategories: [],
    cashBalance: 0,
    confirmedMonthlyIncome: null,
    assumedAnnualReturn: 0.06,
    budgetSavingsTarget: null,
    budgetSavingsRate: 15,
  },
}

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2))
    console.log(`Initialized empty db at ${DB_PATH}`)
    return
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
  let dirty = false
  for (const [key, val] of Object.entries(DEFAULT_DB)) {
    if (!(key in db)) { db[key] = val; dirty = true }
  }
  for (const [k, v] of Object.entries(DEFAULT_DB.settings)) {
    if (!(k in db.settings)) { db.settings[k] = v; dirty = true }
  }
  // Migrate: old default was 0 meaning "not set"; null is now the sentinel
  if (db.settings.budgetSavingsTarget === 0) {
    db.settings.budgetSavingsTarget = null
    dirty = true
  }
  if (dirty) fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

if (!DEMO_MODE) ensureDb()

const app = express()
app.use(cors())
app.use(express.json({ limit: '20mb' }))

function readDb() {
  return JSON.parse(fs.readFileSync(DEMO_MODE ? MOCK_PATH : DB_PATH, 'utf8'))
}

function writeDb(data) {
  if (DEMO_MODE) return
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
}

// Demo Mode: block all mutations; carve out read-only responses for auto-called POST endpoints.
app.get('/api/demo-mode', (_req, res) => {
  res.json({ demoMode: DEMO_MODE })
})

if (DEMO_MODE) {
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      if (req.path === '/api/net-worth-snapshot') {
        const db = readDb()
        const latest = (db.netWorthHistory ?? []).slice(-1)[0]
        return res.json(latest ?? { date: new Date().toISOString().slice(0, 10), netWorth: 0, breakdown: { cash: 0, savings: 0, portfolio: 0 } })
      }
      if (req.path === '/api/net-worth-backfill') {
        return res.json({ added: 0, dates: [] })
      }
      return res.status(403).json({ error: 'This action is disabled in Demo Mode.' })
    }
    next()
  })
}

// --- Transactions ---

app.get('/api/transactions', (req, res) => {
  const db = readDb()
  res.json(db.transactions)
})

app.post('/api/transactions', (req, res) => {
  const db = readDb()
  const tx = { id: uuidv4(), ...req.body }
  db.transactions.push(tx)
  writeDb(db)
  res.status(201).json(tx)
})

app.put('/api/transactions/:id', (req, res) => {
  const db = readDb()
  const idx = db.transactions.findIndex(t => t.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  db.transactions[idx] = { ...db.transactions[idx], ...req.body, id: req.params.id }
  writeDb(db)
  res.json(db.transactions[idx])
})

app.delete('/api/transactions/:id', (req, res) => {
  const db = readDb()
  const idx = db.transactions.findIndex(t => t.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  const [removed] = db.transactions.splice(idx, 1)
  writeDb(db)
  res.json(removed)
})

// --- Holdings ---

function ensurePurchasesArray(holding) {
  if (!holding.purchases || holding.purchases.length === 0) {
    holding.purchases = [{
      id: uuidv4(),
      shares: holding.shares,
      purchasePrice: holding.purchasePrice,
      purchaseDate: holding.purchaseDate,
    }]
  }
}

function recalculateHoldingTotals(holding) {
  const totalShares = holding.purchases.reduce((s, p) => s + p.shares, 0)
  const weightedAvg = holding.purchases.reduce((s, p) => s + p.purchasePrice * p.shares, 0) / totalShares
  const latestDate = holding.purchases.reduce((d, p) => (p.purchaseDate > d ? p.purchaseDate : d), '')
  holding.shares = totalShares
  holding.purchasePrice = Math.round(weightedAvg * 10000) / 10000
  holding.purchaseDate = latestDate
}

app.get('/api/holdings', (req, res) => {
  const db = readDb()
  res.json(db.holdings)
})

app.post('/api/holdings', (req, res) => {
  const db = readDb()
  const { ticker: rawTicker, shares, purchasePrice, purchaseDate, accountType } = req.body
  const ticker = (rawTicker || '').toUpperCase()

  const existing = db.holdings.find(h => h.ticker === ticker && h.accountType === accountType)

  if (!existing) {
    const holding = {
      id: uuidv4(),
      ticker,
      shares,
      purchasePrice,
      purchaseDate,
      accountType,
      purchases: [{ id: uuidv4(), shares, purchasePrice, purchaseDate }],
    }
    db.holdings.push(holding)
    writeDb(db)
    return res.status(201).json(holding)
  }

  ensurePurchasesArray(existing)
  existing.purchases.push({ id: uuidv4(), shares, purchasePrice, purchaseDate })
  recalculateHoldingTotals(existing)
  writeDb(db)
  res.json(existing)
})

app.put('/api/holdings/:id', (req, res) => {
  const db = readDb()
  const idx = db.holdings.findIndex(h => h.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  db.holdings[idx] = { ...db.holdings[idx], ...req.body, id: req.params.id }
  writeDb(db)
  res.json(db.holdings[idx])
})

app.delete('/api/holdings/:id', (req, res) => {
  const db = readDb()
  const idx = db.holdings.findIndex(h => h.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  const [removed] = db.holdings.splice(idx, 1)
  writeDb(db)
  res.json(removed)
})

app.delete('/api/holdings/:holdingId/purchases/:purchaseId', (req, res) => {
  const db = readDb()
  const holding = db.holdings.find(h => h.id === req.params.holdingId)
  if (!holding) return res.status(404).json({ error: 'Holding not found' })

  ensurePurchasesArray(holding)
  const purchaseIdx = holding.purchases.findIndex(p => p.id === req.params.purchaseId)
  if (purchaseIdx === -1) return res.status(404).json({ error: 'Purchase not found' })

  holding.purchases.splice(purchaseIdx, 1)

  if (holding.purchases.length === 0) {
    const holdingIdx = db.holdings.findIndex(h => h.id === req.params.holdingId)
    db.holdings.splice(holdingIdx, 1)
    writeDb(db)
    return res.json({ deleted: true, holdingId: req.params.holdingId })
  }

  recalculateHoldingTotals(holding)
  writeDb(db)
  res.json(holding)
})

// --- Prices (Yahoo Finance) ---

// Fetch live prices for a list of tickers. Returns { TICKER: price|null }. Shared by the
// /api/prices route and all goal valuation (holdings priced server-side, never in the browser).
async function fetchPrices(tickers) {
  const unique = [...new Set(tickers.filter(Boolean).map(t => t.toUpperCase()))]
  if (!unique.length) return {}
  const entries = await Promise.all(
    unique.map(async (ticker) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!r.ok) return [ticker, null]
        const data = await r.json()
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null
        return [ticker, price]
      } catch {
        return [ticker, null]
      }
    })
  )
  return Object.fromEntries(entries)
}

app.get('/api/prices', async (req, res) => {
  const tickers = (req.query.tickers || '').split(',').filter(Boolean)
  res.json(await fetchPrices(tickers))
})

// --- Goals ---

// A goal can earmark a percentage of real accounts via `links[]`:
//   { sourceType: 'savings', sourceId: '<savings_account_id>', percent }
//   { sourceType: 'holdingsAccountType', sourceId: '<accountType>', percent }
// Linked goals derive their currentAmount from those sources (the stored value is ignored).

// Full current value of a single source (before applying the link percentage).
function sourceValue(db, link, priceMap) {
  if (link.sourceType === 'savings') {
    const acct = (db.savings_accounts ?? []).find(a => a.id === link.sourceId)
    return acct ? acct.balance : 0
  }
  if (link.sourceType === 'holdingsAccountType') {
    return (db.holdings ?? [])
      .filter(h => (h.accountType || 'Other') === link.sourceId)
      .reduce((s, h) => {
        const price = h.ticker ? (priceMap[h.ticker.toUpperCase()] ?? null) : null
        return s + (price !== null ? price * h.shares : h.purchasePrice * h.shares)
      }, 0)
  }
  return 0
}

// Human-readable name for a link's source, e.g. "Capital One HYSA" or "TFSA holdings".
function sourceName(db, link) {
  if (link.sourceType === 'savings') {
    const acct = (db.savings_accounts ?? []).find(a => a.id === link.sourceId)
    return acct ? acct.name : 'Unknown account'
  }
  if (link.sourceType === 'holdingsAccountType') return `${link.sourceId} holdings`
  return 'Unknown source'
}

// Tickers needed to price every holdings bucket linked by any goal (so we only hit Yahoo
// when a holdings-backed goal actually exists).
function tickersForGoalLinks(db) {
  const buckets = new Set()
  for (const g of db.goals ?? []) {
    for (const link of g.links ?? []) {
      if (link.sourceType === 'holdingsAccountType') buckets.add(link.sourceId)
    }
  }
  if (!buckets.size) return []
  return (db.holdings ?? [])
    .filter(h => buckets.has(h.accountType || 'Other'))
    .map(h => h.ticker)
    .filter(Boolean)
}

// Derived progress for a goal. Linked goals sum (sourceValue × percent); unlinked goals keep
// their stored currentAmount. Returns { currentAmount, breakdown[], isLinked }.
function computeGoalProgress(db, goal, priceMap = {}) {
  const links = goal.links ?? []
  if (!links.length) {
    return { currentAmount: goal.currentAmount ?? 0, breakdown: [], isLinked: false }
  }
  const breakdown = links.map(link => {
    const value = Math.round(sourceValue(db, link, priceMap) * (link.percent / 100) * 100) / 100
    return { sourceType: link.sourceType, sourceId: link.sourceId, name: sourceName(db, link), percent: link.percent, value }
  })
  const currentAmount = Math.round(breakdown.reduce((s, b) => s + b.value, 0) * 100) / 100
  return { currentAmount, breakdown, isLinked: true }
}

// Sum of percent already allocated for a source across all goals, optionally excluding one goal.
function allocatedPercent(db, sourceType, sourceId, excludeGoalId = null) {
  let total = 0
  for (const g of db.goals ?? []) {
    if (g.id === excludeGoalId) continue
    for (const link of g.links ?? []) {
      if (link.sourceType === sourceType && link.sourceId === sourceId) total += link.percent
    }
  }
  return total
}

// Validate a goal's links: shape, that the source exists, and that allocations across all other
// goals stay within 100%. Returns an error string, or null if valid.
function validateGoalLinks(db, links, excludeGoalId = null) {
  if (links === undefined) return null
  if (!Array.isArray(links)) return 'links must be an array'
  for (const link of links) {
    const { sourceType, sourceId, percent } = link
    if (sourceType !== 'savings' && sourceType !== 'holdingsAccountType') return `Invalid sourceType: ${sourceType}`
    if (typeof percent !== 'number' || percent <= 0 || percent > 100) return 'percent must be between 0 and 100'
    if (sourceType === 'savings' && !(db.savings_accounts ?? []).some(a => a.id === sourceId)) {
      return `Savings account not found: ${sourceId}`
    }
    if (sourceType === 'holdingsAccountType' && !(db.holdings ?? []).some(h => (h.accountType || 'Other') === sourceId)) {
      return `No holdings in account type: ${sourceId}`
    }
    const used = allocatedPercent(db, sourceType, sourceId, excludeGoalId)
    if (used + percent > 100) {
      return `${sourceName(db, link)} is over-allocated: ${used}% already used, cannot add ${percent}% (max ${100 - used}%)`
    }
  }
  return null
}

app.get('/api/goals', async (req, res) => {
  const db = readDb()
  const priceMap = await fetchPrices(tickersForGoalLinks(db))
  const fin = buildMonthlyFinancials(db)
  const goals = (db.goals ?? []).map(g => {
    const { currentAmount, breakdown, isLinked } = computeGoalProgress(db, g, priceMap)
    const withAmount = { ...g, currentAmount }
    const investContribPerMonth = investContribForGoal(db, g, fin)
    const tl = goalTimeline(withAmount, goalGrowthRate(db, withAmount, priceMap), investContribPerMonth)
    return {
      ...g,
      currentAmount,
      linkedBreakdown: breakdown,
      isLinked,
      investContribPerMonth,
      growthMonths: tl.growthMonths,
      growthDate: tl.growthDate,
      growthVerdict: tl.growthVerdict,
      blendedAnnualRate: tl.blendedAnnualRate,
      assumedReturnUsed: tl.assumedReturnUsed,
      hasInvestments: tl.hasInvestments,
    }
  })
  res.json(goals)
})

app.post('/api/goals', (req, res) => {
  const db = readDb()
  const err = validateGoalLinks(db, req.body.links)
  if (err) return res.status(400).json({ error: err })
  const goal = { id: uuidv4(), ...req.body }
  db.goals.push(goal)
  writeDb(db)
  res.status(201).json(goal)
})

app.put('/api/goals/:id', (req, res) => {
  const db = readDb()
  const idx = db.goals.findIndex(g => g.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  const err = validateGoalLinks(db, req.body.links, req.params.id)
  if (err) return res.status(400).json({ error: err })
  db.goals[idx] = { ...db.goals[idx], ...req.body, id: req.params.id }
  writeDb(db)
  res.json(db.goals[idx])
})

app.delete('/api/goals/:id', (req, res) => {
  const db = readDb()
  const idx = db.goals.findIndex(g => g.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  const [removed] = db.goals.splice(idx, 1)
  writeDb(db)
  res.json(removed)
})

// Catalog of linkable sources for the goal link picker: every savings account plus every
// holdings account-type bucket, with live current value and how much capacity is still free.
app.get('/api/goal-sources', async (req, res) => {
  const db = readDb()
  const buckets = [...new Set((db.holdings ?? []).map(h => h.accountType || 'Other'))]
  const tickers = (db.holdings ?? []).map(h => h.ticker).filter(Boolean)
  const priceMap = await fetchPrices(tickers)

  const build = (link) => {
    const allocatedPct = allocatedPercent(db, link.sourceType, link.sourceId)
    return {
      sourceType: link.sourceType,
      sourceId: link.sourceId,
      name: sourceName(db, link),
      currentValue: Math.round(sourceValue(db, link, priceMap) * 100) / 100,
      allocatedPct,
      remainingPct: Math.max(0, 100 - allocatedPct),
    }
  }

  const sources = [
    ...(db.savings_accounts ?? []).map(a => build({ sourceType: 'savings', sourceId: a.id })),
    ...buckets.map(b => build({ sourceType: 'holdingsAccountType', sourceId: b })),
  ]
  res.json(sources)
})

// Average monthly savings/investment contributions from real transaction history, surfaced as a
// suggestion for a goal's monthly savings rate. Read-only; no per-goal attribution.
app.get('/api/contribution-rate', (req, res) => {
  const db = readDb()
  const fin = buildMonthlyFinancials(db)
  res.json({
    savingsContrib: fin.savingsContrib,
    investContrib: fin.investContrib,
    monthsCovered: fin.monthsCovered,
    windowLabel: fin.windowLabel,
  })
})

app.get('/api/monthly-financials', (req, res) => {
  const db = readDb()
  const fin = buildMonthlyFinancials(db)
  res.json(fin)
})

// --- Settings ---

app.get('/api/settings', (req, res) => {
  const db = readDb()
  const { claudeApiKey, openaiApiKey, ...rest } = db.settings
  res.json({ ...rest, assumedAnnualReturn: rest.assumedAnnualReturn ?? 0.06, hasClaudeApiKey: !!(claudeApiKey), hasOpenaiApiKey: !!(openaiApiKey) })
})

app.put('/api/settings', (req, res) => {
  const db = readDb()
  db.settings = { ...db.settings, ...req.body }
  writeDb(db)
  const { claudeApiKey, openaiApiKey, ...rest } = db.settings
  res.json({ ...rest, hasClaudeApiKey: !!(claudeApiKey), hasOpenaiApiKey: !!(openaiApiKey) })
})

// --- Batch transactions ---

app.post('/api/transactions/batch', (req, res) => {
  const db = readDb()
  const incoming = Array.isArray(req.body) ? req.body : []
  const newTxs = incoming.map(tx => ({ id: uuidv4(), ...tx }))
  db.transactions.push(...newTxs)
  writeDb(db)
  res.status(201).json(newTxs)
})

// --- Upload History ---

app.get('/api/upload-history', (req, res) => {
  const db = readDb()
  res.json((db.uploadHistory ?? []).slice().reverse())
})

app.post('/api/upload-history', (req, res) => {
  const db = readDb()
  if (!db.uploadHistory) db.uploadHistory = []
  const { filename, sourceName, transactionCount } = req.body
  const entry = {
    id: uuidv4(),
    filename: filename || 'unknown.pdf',
    sourceName: sourceName || '',
    transactionCount: Number(transactionCount) || 0,
    importedAt: new Date().toISOString(),
  }
  db.uploadHistory.push(entry)
  writeDb(db)
  res.status(201).json(entry)
})

app.delete('/api/upload-history/:id', (req, res) => {
  const db = readDb()
  if (!db.uploadHistory) db.uploadHistory = []
  const idx = db.uploadHistory.findIndex(e => e.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  const [removed] = db.uploadHistory.splice(idx, 1)
  writeDb(db)
  res.json(removed)
})

// --- Credit Card Transactions ---

app.get('/api/credit-card-transactions', (req, res) => {
  const db = readDb()
  res.json(db.credit_card_transactions)
})

app.post('/api/credit-card-transactions', (req, res) => {
  const db = readDb()
  const tx = { id: uuidv4(), ...req.body }
  db.credit_card_transactions.push(tx)
  writeDb(db)
  res.status(201).json(tx)
})

app.post('/api/credit-card-transactions/batch', (req, res) => {
  const db = readDb()
  const incoming = Array.isArray(req.body) ? req.body : []
  const newTxs = incoming.map(tx => ({ id: uuidv4(), ...tx }))
  db.credit_card_transactions.push(...newTxs)
  writeDb(db)
  res.status(201).json(newTxs)
})

app.put('/api/credit-card-transactions/:id', (req, res) => {
  const db = readDb()
  const idx = db.credit_card_transactions.findIndex(t => t.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  db.credit_card_transactions[idx] = { ...db.credit_card_transactions[idx], ...req.body, id: req.params.id }
  writeDb(db)
  res.json(db.credit_card_transactions[idx])
})

app.delete('/api/credit-card-transactions/:id', (req, res) => {
  const db = readDb()
  const idx = db.credit_card_transactions.findIndex(t => t.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  const [removed] = db.credit_card_transactions.splice(idx, 1)
  writeDb(db)
  res.json(removed)
})

// --- Savings Accounts ---

app.get('/api/savings-accounts', (req, res) => {
  const db = readDb()
  res.json(db.savings_accounts ?? [])
})

app.post('/api/savings-accounts', (req, res) => {
  const db = readDb()
  if (!db.savings_accounts) db.savings_accounts = []
  const account = { id: uuidv4(), ...req.body }
  db.savings_accounts.push(account)
  writeDb(db)
  res.status(201).json(account)
})

app.put('/api/savings-accounts/:id', (req, res) => {
  const db = readDb()
  const idx = (db.savings_accounts ?? []).findIndex(a => a.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  db.savings_accounts[idx] = { ...db.savings_accounts[idx], ...req.body, id: req.params.id }
  writeDb(db)
  res.json(db.savings_accounts[idx])
})

app.delete('/api/savings-accounts/:id', (req, res) => {
  const db = readDb()
  const idx = (db.savings_accounts ?? []).findIndex(a => a.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  const [removed] = db.savings_accounts.splice(idx, 1)
  writeDb(db)
  res.json(removed)
})

// --- Categories ---

app.get('/api/categories', (req, res) => {
  const db = readDb()
  res.json(db.settings.customCategories ?? [])
})

app.post('/api/categories', (req, res) => {
  const db = readDb()
  const { name, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })
  if (!db.settings.customCategories) db.settings.customCategories = []
  const exists = db.settings.customCategories.some(c => c.name.toLowerCase() === name.trim().toLowerCase())
  if (exists) return res.status(409).json({ error: 'Category already exists' })
  const cat = { name: name.trim(), color: color || '#94a3b8' }
  db.settings.customCategories.push(cat)
  writeDb(db)
  res.status(201).json(cat)
})

app.delete('/api/categories/:name', (req, res) => {
  const db = readDb()
  if (!db.settings.customCategories) db.settings.customCategories = []
  const name = decodeURIComponent(req.params.name)
  const idx = db.settings.customCategories.findIndex(c => c.name === name)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  const [removed] = db.settings.customCategories.splice(idx, 1)
  writeDb(db)
  res.json(removed)
})

// --- LLM ---

function buildSpendContextFromTransactions(ccTransactions, period) {
  const filtered = period === 'all'
    ? ccTransactions
    : ccTransactions.filter(t => t.date?.startsWith(period))

  const totalSpend = filtered.reduce((s, t) => s + Math.abs(t.amount), 0)

  const catMap = {}
  for (const t of filtered) {
    const cat = t.category || 'Other'
    catMap[cat] = (catMap[cat] || 0) + Math.abs(t.amount)
  }
  const categories = Object.entries(catMap)
    .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)

  const merchantMap = {}
  const merchantCount = {}
  for (const t of filtered) {
    const key = t.description || 'Unknown'
    merchantMap[key] = (merchantMap[key] || 0) + Math.abs(t.amount)
    merchantCount[key] = (merchantCount[key] || 0) + 1
  }
  const topMerchants = Object.entries(merchantMap)
    .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100, visits: merchantCount[name] }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)

  const largestTxs = [...filtered]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 10)
    .map(t => ({ description: t.description, amount: Math.round(Math.abs(t.amount) * 100) / 100, date: t.date, category: t.category || 'Other' }))

  return { filtered, totalSpend: Math.round(totalSpend * 100) / 100, txCount: filtered.length, categories, topMerchants, largestTxs }
}

function formatPeriodLabel(period) {
  if (period === 'all') return 'all time'
  const [year, month] = period.split('-')
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December']
  return `${names[parseInt(month, 10) - 1]} ${year}`
}

function buildSpendSummaryText(period, { totalSpend, txCount, categories, topMerchants, largestTxs }) {
  const periodLabel = formatPeriodLabel(period)
  const catLines = categories.map(c => {
    const pct = totalSpend > 0 ? Math.round(c.amount / totalSpend * 100) : 0
    return `- ${c.name}: $${c.amount.toFixed(2)} (${pct}%)`
  }).join('\n')
  const merchantLines = topMerchants.map((m, i) =>
    `${i + 1}. ${m.name}: $${m.amount.toFixed(2)} (${m.visits} transaction${m.visits !== 1 ? 's' : ''})`
  ).join('\n')
  const largeTxLines = largestTxs.map(t =>
    `- $${t.amount.toFixed(2)} at ${t.description} on ${t.date} [${t.category}]`
  ).join('\n')

  return `Credit card spending for ${periodLabel}:
Total: $${totalSpend.toFixed(2)} across ${txCount} transaction${txCount !== 1 ? 's' : ''}

Categories:
${catLines || '  (none)'}

Top merchants:
${merchantLines || '  (none)'}

Largest transactions:
${largeTxLines || '  (none)'}`
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthLabel(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

// Matches FINANCE_CATEGORIES in src/constants/categories.js — the reserved bank-side
// category tags. Used to fall back to a transaction's type only for non-finance categories.
const FINANCE_CAT_SET = new Set(['Income', 'Expense', 'Savings', 'Investments'])

// Calendar months that the bank data FULLY spans — the overall date range covers the 1st
// through the last day of the month. Excludes leading/trailing partial months (e.g. data
// starting Nov 14 or ending May 24) and the current incomplete month, so monthly averages
// are computed only over genuinely complete months.
function fullMonthsWithData(transactions) {
  const dates = transactions.map(t => t.date).filter(Boolean).sort()
  if (!dates.length) return []
  const min = dates[0], max = dates[dates.length - 1]
  const daysInMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate() }
  const present = [...new Set(dates.map(d => d.slice(0, 7)))].sort()
  return present.filter(ym =>
    min <= `${ym}-01` && max >= `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`
  )
}

// Monthly financials for insight prompts, using the SAME definitions as the Finances tab
// (src/pages/Finances.jsx buildMonthlyData) so the numbers the model cites equal what the
// user sees in the app:
//   income / expenses / savings / investments  ->  from BANK transactions, by category.
// Expenses are the bank "Expense" category, which already includes credit-card bill
// payments — so credit-card transactions are NOT added to the total (that would
// double-count the same spending). Card transactions are used only to break down WHERE
// card spending went (a subset of expenses: $/month and % of card spend) for category
// advice. Averages use only FULL calendar months of bank data, divided by that count,
// limited to the most recent `maxMonths`.
function buildMonthlyFinancials(db, maxMonths = 6) {
  const bank = db.transactions || []
  const cc = db.credit_card_transactions || []

  const empty = {
    monthsCovered: 0, windowLabel: 'no data', excluded: [],
    income: 0, expenses: 0, savingsContrib: 0, investContrib: 0,
    cardSpendMonthly: 0, cardBreakdown: [],
  }
  const allFull = fullMonthsWithData(bank)
  if (!allFull.length) return empty

  const months = allFull.slice(-maxMonths)   // most recent full months
  const windowSet = new Set(months)
  const divisor = months.length
  const inWindow = d => d && windowSet.has(d.slice(0, 7))

  let income = 0, expenses = 0, savingsContrib = 0, investContrib = 0
  for (const t of bank) {
    if (!inWindow(t.date)) continue
    const amt = Math.abs(Number(t.amount))
    const cat = t.category
    if (cat === 'Savings') savingsContrib += amt
    else if (cat === 'Investments') investContrib += amt
    else if (cat === 'Income' || (t.type === 'income' && !FINANCE_CAT_SET.has(cat))) income += amt
    else if (cat === 'Expense' || (t.type === 'expense' && !FINANCE_CAT_SET.has(cat))) expenses += amt
  }

  // Credit-card category breakdown over the same full-month window (advice only).
  const cardByCat = {}
  let cardTotal = 0
  for (const t of cc) {
    if (!inWindow(t.date)) continue
    const amt = Math.abs(Number(t.amount))
    cardTotal += amt
    const cat = t.category || 'Other'
    cardByCat[cat] = (cardByCat[cat] || 0) + amt
  }
  const cardBreakdown = Object.entries(cardByCat)
    .map(([category, total]) => ({
      category,
      monthly: Math.round(total / divisor),
      pct: cardTotal > 0 ? Math.round(total / cardTotal * 100) : 0,
    }))
    .sort((a, b) => b.monthly - a.monthly)

  // Bank transaction breakdown by category — captures savings contributions and goal payments
  // that don't appear on credit cards (direct transfers, ACH, etc.).
  const bankByCat = {}
  for (const t of bank) {
    if (!inWindow(t.date)) continue
    const cat = t.category
    if (!cat || cat === 'Income' || cat === 'Transfer') continue
    if (t.type === 'income' && !FINANCE_CAT_SET.has(cat)) continue
    const amt = Math.abs(Number(t.amount))
    bankByCat[cat] = (bankByCat[cat] || 0) + amt
  }
  const bankBreakdown = Object.entries(bankByCat)
    .map(([category, total]) => ({ category, monthly: Math.round(total / divisor) }))
    .sort((a, b) => b.monthly - a.monthly)

  const perMonth = x => Math.round(x / divisor)
  const windowLabel = months.length === 1
    ? monthLabel(months[0])
    : `${monthLabel(months[0])}–${monthLabel(months[months.length - 1])}`
  const excluded = [...new Set(bank.map(t => t.date?.slice(0, 7)).filter(Boolean))]
    .filter(m => !windowSet.has(m)).sort()

  return {
    monthsCovered: divisor,
    windowLabel,
    excluded,
    income: perMonth(income),
    expenses: perMonth(expenses),
    savingsContrib: perMonth(savingsContrib),
    investContrib: perMonth(investContrib),
    cardSpendMonthly: Math.round(cardTotal / divisor),
    cardBreakdown,
    bankBreakdown,
  }
}

// Transparent monthly summary block for insight/chat prompts. States the data window,
// source, and the no-double-count rule explicitly so the model can explain its basis.
function formatMonthlyFinancials(fin) {
  if (!fin.monthsCovered) return 'No complete months of transaction data are available yet.'
  const lines = [
    `DATA BASIS — figures below are averaged over ${fin.monthsCovered} FULL month(s) of bank data (${fin.windowLabel}), each total divided by ${fin.monthsCovered}. Partial/empty months are excluded${fin.excluded.length ? ` (excluded: ${fin.excluded.join(', ')})` : ''}.`,
    `Source: bank-account transactions by category. The expense total already includes credit-card bill payments, so individual card transactions are NOT added again (avoids double-counting).`,
    ``,
    `Average monthly income: $${fin.income}`,
    `Average monthly expenses: $${fin.expenses}`,
  ]
  if (fin.savingsContrib > 0) lines.push(`Average monthly savings contributions: $${fin.savingsContrib}`)
  if (fin.investContrib > 0) lines.push(`Average monthly investment contributions: $${fin.investContrib}`)
  if (fin.cardBreakdown.length) {
    lines.push(``)
    lines.push(`Where credit-card spending went ($${fin.cardSpendMonthly}/mo of card purchases — this is a SUBSET of the expenses above, for category-level advice only; do NOT add it to total expenses):`)
    for (const c of fin.cardBreakdown) lines.push(`  ${c.category}: $${c.monthly}/mo (${c.pct}% of card spend)`)
  }
  return lines.join('\n')
}

// Claude has no knowledge of the real current date, so any prompt that reasons
// about timelines (goal target dates, "months from now", etc.) must state it.
function todayLine() {
  return `Today's date is ${new Date().toISOString().slice(0, 10)}.`
}

// Whole months from today until a YYYY-MM-DD target date (rounded to nearest
// month). Computed server-side so the model never has to do date arithmetic.
// Returns null for a missing/unparseable date, negative if the date is past.
function monthsUntil(targetDate) {
  if (!targetDate) return null
  const target = new Date(targetDate)
  if (Number.isNaN(target.getTime())) return null
  const days = (target - new Date()) / (1000 * 60 * 60 * 24)
  return Math.round(days / 30.4375)
}

// "Aug 2027" from a YYYY-MM-DD date. Computed server-side so the model never has to
// translate a month count into a calendar date (a step Haiku frequently gets wrong).
function monthYearLabel(date) {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return 'unknown'
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
}

// Calendar month `n` whole months from today, e.g. dateAfterMonths(29) => "Nov 2028".
function dateAfterMonths(months) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return monthYearLabel(d)
}

// Blended expected annual growth rate for a goal, weighted by the value of each linked source:
// savings sources contribute their APY (stored as a percent), holdings buckets the user's assumed
// return (stored as a decimal). Unlinked goals — or links with no yield — return rate 0.
function goalGrowthRate(db, goal, priceMap = {}) {
  const assumedReturn = db.settings.assumedAnnualReturn ?? 0.06
  let weighted = 0, total = 0, hasInvestments = false, hasYield = false
  for (const link of goal.links ?? []) {
    const value = sourceValue(db, link, priceMap) * (link.percent / 100)
    if (value <= 0) continue
    let rate = 0
    if (link.sourceType === 'savings') {
      const acct = (db.savings_accounts ?? []).find(a => a.id === link.sourceId)
      rate = acct && acct.apy ? acct.apy / 100 : 0
      if (rate > 0) hasYield = true
    } else if (link.sourceType === 'holdingsAccountType') {
      rate = assumedReturn
      hasInvestments = true
    }
    weighted += value * rate
    total += value
  }
  return { blendedAnnualRate: total > 0 ? weighted / total : 0, hasInvestments, hasYield, assumedReturn }
}

// Months to grow `balance` to `target`, compounding monthly at annualRate and adding `monthly`
// each month. Returns { months, date } or null if unreachable within the cap.
function projectWithGrowth({ balance, monthly, target, annualRate }) {
  if (balance >= target) return { months: 0, date: dateAfterMonths(0) }
  const r = annualRate / 12
  let bal = balance
  for (let m = 1; m <= 1200; m++) {
    bal = bal * (1 + r) + monthly
    if (bal >= target) return { months: m, date: dateAfterMonths(m) }
  }
  return null
}

// Pre-computed, plain-English timeline verdict for a goal so the prompt never asks the
// model to do date arithmetic. Returns the linear (baseline) verdict plus, when a meaningful
// `growth` rate is supplied, an additive, clearly-labeled optimistic "with growth" projection.
function goalTimeline(goal, growth = null, investContribPerMonth = 0) {
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount)
  const effectiveMonthly = (goal.monthlySavings || 0) + investContribPerMonth
  const monthsAtCurrent = effectiveMonthly > 0 ? Math.ceil(remaining / effectiveMonthly) : null
  const monthsToTarget = monthsUntil(goal.targetDate)
  const projectedDate = monthsAtCurrent == null ? null : dateAfterMonths(monthsAtCurrent)
  const requiredMonthly = (monthsToTarget != null && monthsToTarget > 0) ? Math.ceil(remaining / monthsToTarget) : null

  let verdict
  if (monthsAtCurrent == null) {
    verdict = 'No monthly savings rate is set, so a completion date cannot be projected.'
  } else if (monthsToTarget == null) {
    verdict = `At the current rate the goal is reached in ${monthsAtCurrent} months (${projectedDate}). No target date is set.`
  } else if (monthsAtCurrent <= monthsToTarget) {
    verdict = `ON TRACK: at the current rate the goal is reached in ${monthsAtCurrent} months (${projectedDate}), about ${monthsToTarget - monthsAtCurrent} month(s) BEFORE the ${monthYearLabel(goal.targetDate)} target.`
  } else {
    verdict = `BEHIND: at the current rate the goal is reached in ${monthsAtCurrent} months (${projectedDate}), which is ${monthsAtCurrent - monthsToTarget} month(s) AFTER the ${monthYearLabel(goal.targetDate)} target. To hit the target date the user must save about $${requiredMonthly}/month (currently $${effectiveMonthly}/month effective).`
  }

  let growthMonths = null, growthDate = null, growthVerdict = null, blendedAnnualRate = null, assumedReturnUsed = null, hasInvestments = false
  if (growth && growth.blendedAnnualRate > 0 && remaining > 0) {
    blendedAnnualRate = Math.round(growth.blendedAnnualRate * 10000) / 10000
    assumedReturnUsed = growth.assumedReturn
    hasInvestments = growth.hasInvestments
    const proj = projectWithGrowth({
      balance: goal.currentAmount,
      monthly: effectiveMonthly,
      target: goal.targetAmount,
      annualRate: growth.blendedAnnualRate,
    })
    if (proj) {
      const comp = []
      if (growth.hasYield) comp.push('savings APY')
      if (growth.hasInvestments) comp.push(`${Math.round(growth.assumedReturn * 100)}% assumed investment return`)
      const rateLabel = `~${(growth.blendedAnnualRate * 100).toFixed(1)}%/yr (${comp.join(' + ')})`
      if (monthsAtCurrent != null) {
        const sooner = monthsAtCurrent - proj.months
        if (sooner >= 1) {
          growthMonths = proj.months
          growthDate = proj.date
          growthVerdict = `With growth ${rateLabel}: reached in ${proj.months} months (${proj.date}), about ${sooner} month(s) sooner than the no-growth estimate. Optimistic — assumes returns hold.`
        }
      } else {
        growthMonths = proj.months
        growthDate = proj.date
        growthVerdict = `With growth ${rateLabel} and no monthly contributions, the linked balance compounds to the target in ${proj.months} months (${proj.date}). Optimistic — assumes returns hold.`
      }
    }
  }

  return { remaining, monthsAtCurrent, monthsToTarget, projectedDate, requiredMonthly, verdict, growthMonths, growthDate, growthVerdict, blendedAnnualRate, assumedReturnUsed, hasInvestments, effectiveMonthly }
}

// Plain-English line describing which accounts back a goal, e.g.
// "Funded by: Capital One HYSA (50% = $30,000.00), TFSA holdings (50% = $25,300.00, live market value)".
function goalFundingLine(breakdown) {
  if (!breakdown.length) return null
  const parts = breakdown.map(b => {
    const live = b.sourceType === 'holdingsAccountType' ? ', live market value' : ''
    return `${b.name} (${b.percent}% = $${b.value.toFixed(2)}${live})`
  })
  return `Funded by linked accounts: ${parts.join(', ')}.`
}

// Returns a goal with its derived currentAmount and breakdown folded in, for use in prompts.
function goalWithProgress(db, goal, priceMap) {
  const { currentAmount, breakdown } = computeGoalProgress(db, goal, priceMap)
  return { ...goal, currentAmount, breakdown }
}

// Avg monthly investment contributions attributable to this goal, weighted by the percent of
// holdings sources linked. E.g. if the goal links 50% of a holdings bucket and the user
// contributes $400/mo to investments overall, this returns $200/mo.
function investContribForGoal(db, goal, fin) {
  if (!fin.investContrib) return 0
  const holdingsPct = (goal.links ?? [])
    .filter(l => l.sourceType === 'holdingsAccountType')
    .reduce((sum, l) => sum + l.percent, 0)
  if (!holdingsPct) return 0
  return Math.round((fin.investContrib * holdingsPct / 100) * 100) / 100
}

async function callLLM({ system, userMessages, maxTokens, vision = false, smart = false }) {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings

  if (aiProvider === 'openai') {
    if (!openaiApiKey) throw new Error('No OpenAI API key configured. Add one in Settings.')
    const client = new OpenAI({ apiKey: openaiApiKey })
    const messages = []
    if (system) messages.push({ role: 'system', content: system })
    for (const msg of userMessages) {
      if (Array.isArray(msg.content)) {
        const content = msg.content.map(block =>
          block.type === 'image'
            ? { type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } }
            : block
        )
        messages.push({ ...msg, content })
      } else {
        messages.push(msg)
      }
    }
    const result = await client.chat.completions.create({
      model: vision || smart ? 'gpt-4o' : 'gpt-4o-mini',
      max_tokens: maxTokens,
      messages,
    })
    return result.choices[0].message.content
  } else {
    if (!claudeApiKey) throw new Error('No Claude API key configured. Add one in Settings.')
    const client = new Anthropic({ apiKey: claudeApiKey })
    const result = await client.messages.create({
      model: vision || smart ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: userMessages,
    })
    return result.content[0].text
  }
}

app.post('/api/llm/insights', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const fin = buildMonthlyFinancials(db)
  const priceMap = await fetchPrices(tickersForGoalLinks(db))
  const goalSummaries = db.goals.map(g => {
    const { currentAmount } = computeGoalProgress(db, g, priceMap)
    return `${g.name}: $${currentAmount} of $${g.targetAmount} (${g.targetAmount > 0 ? Math.round(currentAmount / g.targetAmount * 100) : 0}%)` +
      (g.monthlySavings ? `, saving $${g.monthlySavings}/mo` : '')
  }).join('\n')

  const userMsg = `Financial data (monthly averages):
${formatMonthlyFinancials(fin)}
Net monthly cash flow (income − expenses): $${fin.income - fin.expenses}

Goals:
${goalSummaries || 'No goals set'}

Return ONLY a valid JSON array of exactly 3 strings. Each string is one concise, actionable insight (1–2 sentences). No markdown, no wrapping object — just the array.`

  try {
    const text = await callLLM({
      system: `You are a personal finance assistant. ${todayLine()} You always respond with valid JSON only.`,
      userMessages: [{ role: 'user', content: userMsg }],
      maxTokens: 512,
    })
    const raw = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const insights = JSON.parse(raw)
    res.json({ insights })
  } catch (err) {
    console.error('LLM insights error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/categorize', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.json({ categories: [] })

  const { transactions } = req.body
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.json({ categories: [] })
  }

  const BUILTIN_CATEGORIES = [
    'Food & Dining', 'Grocery', 'Transport', 'Housing', 'Entertainment',
    'Subscription', 'Health', 'Shopping', 'Income', 'Transfer', 'Other',
  ]
  const customNames = (db.settings.customCategories ?? []).map(c => c.name)
  const VALID_CATEGORIES = [...BUILTIN_CATEGORIES, ...customNames]

  const userMsg = `Categorize each transaction into exactly one of these categories:
${VALID_CATEGORIES.join(', ')}

Transactions:
${JSON.stringify(transactions)}

Respond with this exact JSON format, no other text:
{"categories":[{"id":"<id>","category":"<category>"}]}`

  try {
    const text = await callLLM({
      system: 'You are a personal finance transaction categorizer. Respond with valid JSON only.',
      userMessages: [{ role: 'user', content: userMsg }],
      maxTokens: 1024,
    })
    const raw = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const result = JSON.parse(raw)
    const validated = (result.categories || []).map(({ id, category }) => ({
      id,
      category: VALID_CATEGORIES.includes(category) ? category : 'Other',
    }))
    res.json({ categories: validated })
  } catch (err) {
    console.error('LLM categorize error:', err.message)
    res.json({ categories: [] })
  }
})

app.post('/api/llm/goal-analysis', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { goalId } = req.body
  const rawGoal = db.goals.find(g => g.id === goalId)
  if (!rawGoal) return res.status(404).json({ error: 'Goal not found' })

  const fin = buildMonthlyFinancials(db)
  const priceMap = await fetchPrices((db.holdings ?? []).map(h => h.ticker).filter(Boolean))
  const goal = goalWithProgress(db, rawGoal, priceMap)
  const fundingLine = goalFundingLine(goal.breakdown)
  const investContribPerMonth = investContribForGoal(db, rawGoal, fin)
  const effectiveMonthly = (rawGoal.monthlySavings || 0) + investContribPerMonth

  const allGoalsSummary = db.goals
    .map(g => {
      const { currentAmount } = computeGoalProgress(db, g, priceMap)
      const pct = g.targetAmount > 0 ? Math.round(currentAmount / g.targetAmount * 100) : 0
      const line = `  ${g.name}: $${currentAmount} / $${g.targetAmount} (${pct}%)`
      return g.monthlySavings ? line + `, saving $${g.monthlySavings}/mo` : line
    })
    .join('\n')

  const cashBalance = db.settings.cashBalance ?? 0
  const savingsTotal = (db.savings_accounts ?? []).reduce((s, a) => s + a.balance, 0)
  const portfolioValue = (db.holdings ?? []).reduce((s, h) => s + h.purchasePrice * h.shares, 0)
  const netWorth = cashBalance + savingsTotal + portfolioValue
  const netWorthSummary = `Cash: $${cashBalance.toFixed(2)}, Savings accounts: $${savingsTotal.toFixed(2)}, Portfolio (cost basis): $${portfolioValue.toFixed(2)}, Total: $${netWorth.toFixed(2)}`

  const tl = goalTimeline(goal, goalGrowthRate(db, goal, priceMap), investContribPerMonth)
  const volatilityNote = goal.breakdown.some(b => b.sourceType === 'holdingsAccountType')
    ? '\nNote: part of this goal is backed by investments, so its value moves with the market — mention this volatility if relevant.'
    : ''

  const monthlyRateLine = investContribPerMonth > 0
    ? `Monthly savings rate: ${goal.monthlySavings ? '$' + goal.monthlySavings : 'not set'}\nAvg monthly investment contributions (linked account): $${investContribPerMonth}\nEffective combined monthly rate: $${effectiveMonthly}`
    : `Monthly savings rate: ${goal.monthlySavings ? '$' + goal.monthlySavings : 'not set'}`

  const userMsg = `Goal being analyzed: ${goal.name}
Target: $${goal.targetAmount} | Saved: $${goal.currentAmount} (${goal.targetAmount > 0 ? Math.round(goal.currentAmount / goal.targetAmount * 100) : 0}%)
Remaining: $${tl.remaining}
${monthlyRateLine}
Target date: ${goal.targetDate || 'not set'}${tl.monthsToTarget == null ? '' : ` (${monthYearLabel(goal.targetDate)}, ${tl.monthsToTarget} months from today)`}
${fundingLine ? fundingLine + '\n' : ''}
Timeline (already computed — use these figures, do NOT recompute dates yourself):
${tl.verdict}${tl.growthVerdict ? `\nOptimistic projection (assumes investment/interest returns hold — do NOT present as guaranteed): ${tl.growthVerdict}` : ''}

All goals:
${allGoalsSummary || '  No other goals'}

Net worth snapshot:
${netWorthSummary}

${formatMonthlyFinancials(fin)}${volatilityNote}

Write 3–4 sentences: (1) state plainly whether they are on track or behind for the target date using the Timeline above — if behind, say so directly and give the monthly savings rate needed to hit the date; (2) name one specific credit-card spending category (from the breakdown) to reduce and roughly how much sooner it would get them there; (3) briefly state the data basis you used — how many full months and that expenses come from bank transactions — so the user understands where the numbers come from. Be specific, practical, and honest. Do not add the card breakdown to total expenses. Plain text only, no markdown.`

  try {
    const text = await callLLM({
      system: `You are a practical personal finance advisor. ${todayLine()} Be concise and specific.`,
      userMessages: [{ role: 'user', content: userMsg }],
      maxTokens: 256,
    })
    res.json({ analysis: text.trim() })
  } catch (err) {
    console.error('LLM goal-analysis error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/spend-insights', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { period = 'all' } = req.body
  const context = buildSpendContextFromTransactions(db.credit_card_transactions || [], period)

  if (context.txCount === 0) {
    return res.json({ insights: [{ title: 'No Data', body: 'No credit card transactions found for the selected period.' }] })
  }

  const summaryText = buildSpendSummaryText(period, context)
  const userMsg = `${summaryText}

Provide exactly 3 insights as JSON:
{"insights":[{"title":"...","body":"..."},{"title":"...","body":"..."},{"title":"...","body":"..."}]}

Cover exactly these three areas:
1. Category spending patterns — which categories dominate and whether the distribution looks healthy
2. Notable merchant habits — repeat merchants or high-spend vendors worth noting
3. Anomalies or outliers — large one-offs, unexpected charges, or patterns worth flagging

Be specific with dollar amounts. No markdown. Valid JSON only.`

  try {
    const text = await callLLM({
      system: 'You are a personal finance assistant analyzing credit card spending. Respond with valid JSON only.',
      userMessages: [{ role: 'user', content: userMsg }],
      maxTokens: 768,
    })
    const raw = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const result = JSON.parse(raw)
    res.json({ insights: result.insights })
  } catch (err) {
    console.error('LLM spend-insights error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/spend-chat', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { period = 'all', messages = [] } = req.body
  if (!messages.length) return res.status(400).json({ error: 'No messages provided' })

  const context = buildSpendContextFromTransactions(db.credit_card_transactions || [], period)
  const summaryText = buildSpendSummaryText(period, context)

  const systemMsg = `You are a personal finance assistant. The user is asking follow-up questions about their credit card spending.

${summaryText}

Be concise and specific. Answer in 2–4 sentences.`

  try {
    const text = await callLLM({ system: systemMsg, userMessages: messages, maxTokens: 512 })
    res.json({ reply: text.trim() })
  } catch (err) {
    console.error('LLM spend-chat error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/dashboard-chat', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { messages = [] } = req.body
  if (!messages.length) return res.status(400).json({ error: 'No messages provided' })

  const fin = buildMonthlyFinancials(db)

  const goalLines = db.goals.map(g => {
    const pct = g.targetAmount > 0 ? Math.round(g.currentAmount / g.targetAmount * 100) : 0
    return `  ${g.name}: $${g.currentAmount} / $${g.targetAmount} (${pct}%)${g.monthlySavings ? `, saving $${g.monthlySavings}/mo` : ''}`
  }).join('\n')

  const cashBalance = db.settings.cashBalance ?? 0
  const savingsTotal = (db.savings_accounts ?? []).reduce((s, a) => s + a.balance, 0)
  const portfolioValue = (db.holdings ?? []).reduce((s, h) => s + h.purchasePrice * h.shares, 0)
  const netWorth = cashBalance + savingsTotal + portfolioValue

  const systemMsg = `You are a personal finance assistant. ${todayLine()} Here is the user's current financial picture:

Net worth: $${netWorth.toFixed(2)} (Cash: $${cashBalance.toFixed(2)}, Savings: $${savingsTotal.toFixed(2)}, Portfolio cost basis: $${portfolioValue.toFixed(2)})

${formatMonthlyFinancials(fin)}

Goals:
${goalLines || '  No goals set'}

Be concise and specific. Answer in 2–4 sentences.`

  try {
    const text = await callLLM({ system: systemMsg, userMessages: messages, maxTokens: 512 })
    res.json({ reply: text.trim() })
  } catch (err) {
    console.error('LLM dashboard-chat error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/goal-chat', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { goalId, messages = [] } = req.body
  if (!messages.length) return res.status(400).json({ error: 'No messages provided' })

  const rawGoal = db.goals.find(g => g.id === goalId)
  if (!rawGoal) return res.status(404).json({ error: 'Goal not found' })

  const fin = buildMonthlyFinancials(db)
  const priceMap = await fetchPrices((db.holdings ?? []).map(h => h.ticker).filter(Boolean))
  const goal = goalWithProgress(db, rawGoal, priceMap)
  const fundingLine = goalFundingLine(goal.breakdown)
  const investContribPerMonth = investContribForGoal(db, rawGoal, fin)
  const effectiveMonthly = (rawGoal.monthlySavings || 0) + investContribPerMonth

  const allGoalLines = db.goals.map(g => {
    const { currentAmount } = computeGoalProgress(db, g, priceMap)
    const pct = g.targetAmount > 0 ? Math.round(currentAmount / g.targetAmount * 100) : 0
    return `  ${g.name}: $${currentAmount} / $${g.targetAmount} (${pct}%)${g.monthlySavings ? `, saving $${g.monthlySavings}/mo` : ''}`
  }).join('\n')

  const cashBalance = db.settings.cashBalance ?? 0
  const savingsTotal = (db.savings_accounts ?? []).reduce((s, a) => s + a.balance, 0)
  const portfolioValue = (db.holdings ?? []).reduce((s, h) => s + h.purchasePrice * h.shares, 0)

  const pct = goal.targetAmount > 0 ? Math.round(goal.currentAmount / goal.targetAmount * 100) : 0
  const tl = goalTimeline(goal, goalGrowthRate(db, goal, priceMap), investContribPerMonth)

  const chatMonthlyRateLine = investContribPerMonth > 0
    ? `Monthly savings rate: ${goal.monthlySavings ? '$' + goal.monthlySavings : 'not set'}\nAvg monthly investment contributions (linked account): $${investContribPerMonth}\nEffective combined monthly rate: $${effectiveMonthly}`
    : `Monthly savings rate: ${goal.monthlySavings ? '$' + goal.monthlySavings : 'not set'}`

  const systemMsg = `You are a personal finance advisor helping with a savings goal. ${todayLine()}

Goal: ${goal.name}
Target: $${goal.targetAmount} | Saved: $${goal.currentAmount} (${pct}%)
Remaining: $${tl.remaining}
${chatMonthlyRateLine}
Target date: ${goal.targetDate || 'not set'}${tl.monthsToTarget == null ? '' : ` (${monthYearLabel(goal.targetDate)}, ${tl.monthsToTarget} months from today)`}
${fundingLine ? fundingLine + '\n' : ''}
Timeline (already computed — use these figures, do NOT recompute dates yourself):
${tl.verdict}${tl.growthVerdict ? `\nOptimistic projection (assumes investment/interest returns hold — do NOT present as guaranteed): ${tl.growthVerdict}` : ''}

All goals:
${allGoalLines || '  No other goals'}

Net worth: Cash $${cashBalance.toFixed(2)}, Savings $${savingsTotal.toFixed(2)}, Portfolio cost basis $${portfolioValue.toFixed(2)}

${formatMonthlyFinancials(fin)}

Be concise, specific, and honest about whether they are on track. Answer in 2–4 sentences.`

  try {
    const text = await callLLM({ system: systemMsg, userMessages: messages, maxTokens: 512 })
    res.json({ reply: text.trim() })
  } catch (err) {
    console.error('LLM goal-chat error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/budget-builder', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { income, timelinePreference, excludeNote } = req.body

  const activeGoals = (db.goals || []).filter(g => Number(g.currentAmount) < Number(g.targetAmount))

  const fin = buildMonthlyFinancials(db)

  const goalLines = activeGoals.length > 0
    ? activeGoals.map(g => {
        const m = monthsUntil(g.targetDate)
        return `- ${g.name}: target $${g.targetAmount}, current $${g.currentAmount}` +
          (g.monthlySavings ? `, saving $${g.monthlySavings}/mo` : '') +
          (g.targetDate ? `, due ${g.targetDate}${m == null ? '' : ` (${m} months from today)`}` : '')
      }).join('\n')
    : '(none)'

  const spendLines = fin.cardBreakdown
    .map(c => `- ${c.category}: $${c.monthly}`)
    .join('\n')

  const userMsg = `You are a personal finance advisor. Generate a monthly budget that balances spending discipline with savings goals.

Monthly take-home income: $${income}
Timeline preference: ${timelinePreference}
  - aggressive: maximize savings, cut discretionary spend hard
  - balanced: reasonable cuts, maintain quality of life
  - comfortable: minimal cuts, small optimizations only

Active goals:
${goalLines}

Average monthly spend by category (${fin.windowLabel}):
${spendLines || 'No spend data available'}

One-time expenses to exclude: ${excludeNote || 'None'}

Goal names to EXCLUDE from budgets (tracked separately via monthlySavings on each goal): ${activeGoals.length > 0 ? activeGoals.map(g => g.name).join(', ') : 'none'}

Return ONLY valid JSON — no markdown, no code fences, no explanation outside the JSON:
{
  "budgets": { "Category Name": number },
  "projectedMonthlySurplus": number,
  "monthsToGoal": { "Goal Name": number },
  "suggestedSavingsTarget": number,
  "rationale": "2-3 sentence plain English explanation of key tradeoffs"
}

Only include categories that have spend data. Do not invent categories. Do NOT include goal names in budgets — goal funding is tracked via monthlySavings fields, not spending caps. If no active goals, set monthsToGoal to {}. Always set suggestedSavingsTarget to a round monthly dollar amount representing 10-20% of income based on the timeline preference.`

  try {
    const text = await callLLM({
      system: `You are a personal finance advisor. ${todayLine()} You always respond with valid JSON only.`,
      userMessages: [{ role: 'user', content: userMsg }],
      maxTokens: 1024,
    })
    const raw = text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
    const result = JSON.parse(raw)
    res.json(result)
  } catch (err) {
    console.error('LLM budget-builder error:', err.message)
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'Failed to parse AI response' })
    }
    res.status(500).json({ error: err.message })
  }
})

// --- PDF Vision ---

app.post('/api/llm/detect-columns', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured.' })
  const { headers, samples } = req.body
  if (!Array.isArray(headers) || headers.length === 0) {
    return res.status(400).json({ error: 'headers required' })
  }
  try {
    const text = await callLLM({
      userMessages: [{
        role: 'user',
        content: `You are analyzing a bank/credit card statement CSV. Given these column headers and sample rows, identify which column is the transaction date, which is the description, and which is the amount.

Headers: ${JSON.stringify(headers)}
Sample rows (up to 3): ${JSON.stringify(samples)}

Return ONLY a JSON object with these exact keys:
{
  "date": "<header name for date column>",
  "description": "<header name for description/merchant column>",
  "splitDebitCredit": false,
  "amount": "<header name for amount column>",
  "invertAmounts": <true if purchases show as positive numbers, false if negative>,
  "statementType": "credit_card" or "bank",
  "suggestedSourceName": "<best guess at institution name from the data, or empty string>"
}

For invertAmounts: look at the sample rows. If typical purchase/spending amounts appear as POSITIVE numbers (e.g. 50.00 for a store charge), set true so they get negated to expenses. If purchases appear as NEGATIVE numbers (e.g. -50.00), set false. Do not guess by bank name — read the actual values in the samples.`,
      }],
      maxTokens: 512,
      smart: true,
    })
    const raw = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const mapping = JSON.parse(raw)
    res.json({ mapping })
  } catch (err) {
    console.error('detect-columns error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/parse-pdf-vision', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { pages } = req.body
  if (!Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: 'No pages provided' })
  }

  try {
    const text = await callLLM({
      userMessages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extract all bank transactions from this scanned bank statement. Return ONLY a JSON array of transaction objects:
- "date": YYYY-MM-DD (infer the year from the statement period shown on the page)
- "description": transaction description
- "amount": number, positive for deposits/credits, negative for withdrawals/debits

Exclude balance summaries, running totals, fee summaries, and any non-transaction rows. Return valid JSON only, no markdown.`,
          },
          ...pages.map(data => ({
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data },
          })),
        ],
      }],
      maxTokens: 4096,
      vision: true,
    })

    const raw = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const transactions = JSON.parse(raw)
    res.json({ transactions })
  } catch (err) {
    console.error('PDF vision error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// --- Net Worth History ---

app.post('/api/net-worth-snapshot', (req, res) => {
  const db = readDb()
  const cash = db.settings.cashBalance ?? 0
  const savings = (db.savings_accounts ?? []).reduce((s, a) => s + a.balance, 0)
  const portfolio = (db.holdings ?? []).reduce((s, h) => s + h.shares * h.purchasePrice, 0)
  const netWorth = Math.round((cash + savings + portfolio) * 100) / 100
  const breakdown = {
    cash: Math.round(cash * 100) / 100,
    savings: Math.round(savings * 100) / 100,
    portfolio: Math.round(portfolio * 100) / 100,
  }
  const date = new Date().toISOString().slice(0, 10)

  if (!db.netWorthHistory) db.netWorthHistory = []
  const idx = db.netWorthHistory.findIndex(e => e.date === date)
  const entry = { date, netWorth, breakdown }
  if (idx !== -1) {
    db.netWorthHistory[idx] = entry
  } else {
    db.netWorthHistory.push(entry)
  }
  writeDb(db)
  res.json(entry)
})

app.get('/api/net-worth-history', (req, res) => {
  const db = readDb()
  const history = (db.netWorthHistory ?? []).slice().sort((a, b) => a.date.localeCompare(b.date))
  res.json(history)
})

app.post('/api/net-worth-backfill', (req, res) => {
  const db = readDb()
  const bankTxns = db.transactions ?? []
  const allTxns = [...bankTxns, ...(db.credit_card_transactions ?? [])]
  if (!allTxns.length) return res.json({ added: 0 })

  const today = new Date().toISOString().slice(0, 10)
  const earliestDate = allTxns.map(t => t.date).sort()[0]

  // Skip months that already have any snapshot
  const existingMonths = new Set((db.netWorthHistory ?? []).map(e => e.date.slice(0, 7)))

  const currentCash = db.settings?.cashBalance ?? 0
  const currentSavings = (db.savings_accounts ?? []).reduce((s, a) => s + (a.balance ?? 0), 0)

  const added = []
  let year = parseInt(earliestDate.slice(0, 4))
  let month = parseInt(earliestDate.slice(5, 7))
  const [todayYear, todayMonth] = today.split('-').map(Number)

  while (year < todayYear || (year === todayYear && month <= todayMonth)) {
    const ym = `${year}-${String(month).padStart(2, '0')}`
    if (!existingMonths.has(ym)) {
      const daysInMonth = new Date(year, month, 0).getDate()
      const lastDay = `${ym}-${String(daysInMonth).padStart(2, '0')}`
      const targetDate = lastDay > today ? today : lastDay

      // Cash: work backwards from current balance using bank transactions after this date
      const cashAdjustment = bankTxns
        .filter(t => t.date > targetDate)
        .reduce((s, t) => s + (t.amount ?? 0), 0)
      const cashAtDate = Math.round((currentCash - cashAdjustment) * 100) / 100

      // Portfolio: holdings (and lots) with purchaseDate on or before this date
      const portfolioAtDate = Math.round(
        (db.holdings ?? []).reduce((sum, h) => {
          if (h.purchases?.length) {
            return sum + h.purchases
              .filter(p => (p.purchaseDate ?? '') <= targetDate)
              .reduce((s, p) => s + (p.shares ?? 0) * (p.purchasePrice ?? 0), 0)
          }
          return (h.purchaseDate ?? '') <= targetDate
            ? sum + (h.shares ?? 0) * (h.purchasePrice ?? 0)
            : sum
        }, 0) * 100
      ) / 100

      const netWorth = Math.round((cashAtDate + currentSavings + portfolioAtDate) * 100) / 100
      const entry = {
        date: targetDate,
        netWorth,
        breakdown: { cash: cashAtDate, savings: currentSavings, portfolio: portfolioAtDate },
      }
      if (!db.netWorthHistory) db.netWorthHistory = []
      db.netWorthHistory.push(entry)
      existingMonths.add(ym)
      added.push(targetDate)
    }

    month++
    if (month > 12) { month = 1; year++ }
  }

  if (added.length > 0) writeDb(db)
  res.json({ added: added.length, dates: added })
})

// --- Shutdown ---

app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true })
  setTimeout(() => process.kill(0, 'SIGINT'), 150)
})

// --- Start ---

const PORT = 3001
app.listen(PORT, () => {
  if (DEMO_MODE) {
    console.log(`[DEMO MODE] Express server on http://localhost:${PORT} — serving mock_data.json, all writes blocked`)
  } else {
    console.log(`Express server running on http://localhost:${PORT}`)
  }
})
