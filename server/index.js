import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { DEMO_MODE } from './config.js'
import { buildSpendAnalysis } from './spendAnalysis.js'
import { createSpendChatBinding, createSpendChatTurn } from './spendChat.js'
import { createSpendInsightGeneration, normalizeSpendInsightRecord } from './spendInsightGeneration.js'
import { buildFinanceAnalysis } from './financeAnalysis.js'
import { createFinanceChatBinding, createFinanceChatTurn } from './financeChat.js'
import { createFinanceInsightGeneration, normalizeFinanceInsightRecord } from './financeInsightGeneration.js'
import { buildDashboardAnalysis } from './dashboardAnalysis.js'
import { createDashboardChatBinding, createDashboardChatTurn } from './dashboardChat.js'
import { createDashboardInsightGeneration, normalizeDashboardInsightRecord } from './dashboardInsightGeneration.js'
import { bankFlowOf } from '../src/constants/financeRules.js'
import {
  HISTORY_VERSION, rebuildHistory, valueHoldingsAsOf, buildEntry,
  cashAsOf, statementChecks, sortedBalances, deriveOpeningBalance, ledgerCoverageEnd,
} from './netWorthHistory.js'

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
  // Last generated Spend Analyzer insights and their follow-up chat. Stored server-side because
  // switching tabs unmounts the page, and a reload would lose them either way.
  spendInsights: null,
  // The same, for the Finances tab. `ensureDb()` back-fills any key missing from an existing
  // db.json, so adding this needs no migration.
  financeInsights: null,
  // And for the Dashboard. Three separate keys on purpose: they answer different questions over
  // different scopes, and refreshing one must not invalidate another's conversation.
  dashboardInsights: null,
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
    visionModel: 'claude-sonnet-4-6',
    // Off by default: a card credit already shows up as a smaller card bill on the bank side,
    // so counting it as income too would double-count it. See Finances for the full note.
    countCardCreditsAsIncome: false,
    // Shape version of `netWorthHistory`. Starts at 0 so an existing db.json — whose points were
    // built by the old cost-basis, frozen-savings logic — rebuilds once against HISTORY_VERSION.
    netWorthHistoryVersion: 0,
    // Cash is the chequing account the imported statements describe, so the STATEMENTS are the
    // authority on it and `cashBalance` above is a DERIVED cache of `cashAsOf(today)` — kept in
    // settings because goal links, the LLM prompts and the Goals tab all read it directly.
    //
    // There is no way to type a cash balance anywhere in the app, and that is deliberate. What the
    // user supplies is the closing balance printed on each statement — [{ date, balance, source }],
    // oldest first — and cash is that figure plus every row since. Discrepancies are DERIVED by
    // `statementChecks` on read, never stored: an earlier design froze them at entry time, and a
    // corrected ledger could not recompute them.
    cashOpeningBalance: null,
    statementBalances: [],
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
app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ }))
// PDF vision route needs large bodies (base64 JPEG pages); all other routes get a tighter cap
app.use('/api/parse-pdf-vision', express.json({ limit: '20mb' }))
app.use(express.json({ limit: '2mb' }))

// A bulk upload of a dozen statements issues one vision call per page-batch plus a categorize
// call per file, which comfortably exceeded the old cap of 20/min.
const llmRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests — please wait a moment and try again.' },
})
app.use('/api/llm', llmRateLimit)
app.use('/api/parse-pdf-vision', llmRateLimit)

function readDb() {
  return JSON.parse(fs.readFileSync(DEMO_MODE ? MOCK_PATH : DB_PATH, 'utf8'))
}

function writeDb(data) {
  if (DEMO_MODE) return
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
}

// Short id echoed to both the JSON error response and the server log, so a failure report
// copied out of the UI can be matched to the full stack trace here.
function failure(res, label, err, { status = 500, detail } = {}) {
  const errorId = Math.random().toString(36).slice(2, 8)
  console.error(`[${errorId}] ${label}:`, err.stack || err.message)
  if (detail) console.error(`[${errorId}] detail:`, detail)
  return res.status(status).json({ error: err.message, errorId })
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

// Monthly closes for the last 5 years, used to value historical holdings when rebuilding net
// worth history. Same Yahoo endpoint as `fetchPrices`, coarser interval: each bar's timestamp is
// the month it opened and its close is that month's last traded price, which is what a month-end
// snapshot wants.
//
// Returns { TICKER: { 'YYYY-MM': close } }. Any failure yields no entry for that ticker rather
// than throwing — `valueHoldingsAsOf` falls the holding back to cost basis and downgrades the
// entry's `basis`, so a Yahoo outage degrades the chart instead of breaking the rebuild.
async function fetchHistoricalPrices(tickers) {
  const unique = [...new Set(tickers.filter(Boolean).map(t => t.toUpperCase()))]
  if (!unique.length) return {}
  const entries = await Promise.all(
    unique.map(async (ticker) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1mo&range=5y`
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!r.ok) return [ticker, null]
        const data = await r.json()
        const result = data?.chart?.result?.[0]
        const stamps = result?.timestamp ?? []
        const closes = result?.indicators?.quote?.[0]?.close ?? []
        if (!stamps.length) return [ticker, null]
        const byMonth = {}
        stamps.forEach((ts, i) => {
          const close = closes[i]
          if (close === null || close === undefined) return
          byMonth[new Date(ts * 1000).toISOString().slice(0, 7)] = close
        })
        return [ticker, Object.keys(byMonth).length ? byMonth : null]
      } catch {
        return [ticker, null]
      }
    })
  )
  return Object.fromEntries(entries.filter(([, v]) => v !== null))
}

/**
 * Build the `priceOf(ticker, yyyymm)` lookup that the history module expects.
 *
 * Months before a ticker's earliest bar have no close, so the nearest EARLIER month is carried
 * forward rather than returning null — otherwise a holding bought mid-history would flicker
 * between market and cost basis from month to month and fake a return each time it did.
 */
function historicalPriceLookup(history, livePrices = {}) {
  return (ticker, yyyymm) => {
    const series = history[ticker]
    if (!series) return livePrices[ticker] ?? null
    if (!yyyymm) return livePrices[ticker] ?? null
    if (series[yyyymm] !== undefined) return series[yyyymm]
    const earlier = Object.keys(series).filter(m => m < yyyymm).sort()
    if (earlier.length) return series[earlier[earlier.length - 1]]
    return null
  }
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
  if (link.sourceType === 'cash') return db.settings.cashBalance ?? 0
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
  if (link.sourceType === 'cash') return 'Cash Balance'
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
    if (sourceType !== 'savings' && sourceType !== 'holdingsAccountType' && sourceType !== 'cash') return `Invalid sourceType: ${sourceType}`
    if (typeof percent !== 'number' || percent <= 0 || percent > 100) return 'percent must be between 0 and 100'
    if (sourceType === 'cash' && sourceId !== 'cash') return 'Invalid cash sourceId'
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
    const tl = goalTimeline(withAmount, goalGrowthRate(db, withAmount, priceMap))
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

  const cashBalance = db.settings.cashBalance ?? 0
  const sources = [
    ...(cashBalance > 0 ? [build({ sourceType: 'cash', sourceId: 'cash' })] : []),
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
  const previousCash = db.settings?.cashBalance ?? 0
  db.settings = { ...db.settings, ...req.body }

  // `cashBalance` is a cache of a derivation, never an input. A client that PUTs one is ignored
  // rather than obeyed — there is no field for it in the UI, and honouring a stray value would
  // reintroduce exactly the typed-balance drift this model exists to remove.
  db.settings.cashBalance = cashAsOf(cashSourcesFor(db), new Date().toISOString().slice(0, 10))
  // Statement balances arrive here as a whole array. Normalized at the door so a malformed entry
  // cannot poison every downstream derivation.
  if ('statementBalances' in (req.body ?? {})) {
    db.settings.statementBalances = sortedBalances(req.body.statementBalances ?? [])
  }

  writeDb(db)
  const { claudeApiKey, openaiApiKey, ...rest } = db.settings
  res.json({ ...rest, hasClaudeApiKey: !!(claudeApiKey), hasOpenaiApiKey: !!(openaiApiKey) })
})

// Where cash comes from, in one place: the opening anchor, the reconciliations, and the rows.
function cashSourcesFor(db) {
  return {
    opening: db.settings?.cashOpeningBalance ?? null,
    statementBalances: db.settings?.statementBalances ?? [],
    bankRows: (db.transactions ?? []).filter(t => t.date),
  }
}

// How fresh the derived cash figure is. The chequing balance is only knowable up to the last
// statement plus whatever the user has reconciled since, so the UI states an "as of" date rather
// than implying it knows today.
app.get('/api/cash-status', (req, res) => {
  const db = readDb()
  const sources = cashSourcesFor(db)
  const today = new Date().toISOString().slice(0, 10)
  const coverageEnd = ledgerCoverageEnd(sources.bankRows)
  const balances = sortedBalances(sources.statementBalances)
  const lastStatement = balances[balances.length - 1] ?? null
  // Cash is only knowable to the newest statement; anything after it is rows the user typed.
  const asOf = lastStatement?.date ?? coverageEnd ?? null
  // Derived here rather than stored, and shipped to the client so the waterfall decomposes against
  // the same figures this card reports. One computation, two readers.
  const checks = statementChecks(sources)
  res.json({
    balance: cashAsOf(sources, today),
    opening: sources.opening,
    ledgerCoverageEnd: coverageEnd,
    asOf,
    uncoveredDays: coverageEnd ? Math.max(0, Math.round((new Date(today) - new Date(coverageEnd)) / 86400000)) : null,
    lastStatement,
    statementCount: balances.length,
    checks,
    // Discrepancies inside ledger coverage are short imports; ones past it are statements whose
    // rows were never brought in at all.
    unexplained: checks.filter(c => !c.beyondLedger).reduce((s, c) => s + c.discrepancy, 0),
  })
})

// Wipe every top-level collection and restore default settings (including API keys).
app.post('/api/factory-reset', (req, res) => {
  writeDb(JSON.parse(JSON.stringify(DEFAULT_DB)))
  res.json({ ok: true })
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
  const { filename, sourceName, transactionCount, transactionIds, ledger } = req.body
  const ids = Array.isArray(transactionIds)
    ? transactionIds.filter(id => typeof id === 'string' && id)
    : []
  const entry = {
    id: uuidv4(),
    filename: filename || 'unknown.pdf',
    sourceName: sourceName || '',
    transactionCount: Number(transactionCount) || ids.length || 0,
    transactionIds: ids,
    ledger: ledger === 'credit_card' ? 'credit_card' : 'bank',
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

  // Cascade only when this entry recorded IDs at import time (post-cascade feature).
  // Legacy rows have no transactionIds — deleting them only clears the history log.
  const ids = new Set(
    Array.isArray(removed.transactionIds) ? removed.transactionIds.filter(Boolean) : [],
  )
  let deletedTransactionCount = 0
  if (ids.size) {
    if (removed.ledger === 'credit_card') {
      const before = (db.credit_card_transactions ?? []).length
      db.credit_card_transactions = (db.credit_card_transactions ?? []).filter(t => !ids.has(t.id))
      deletedTransactionCount = before - db.credit_card_transactions.length
    } else {
      const before = db.transactions.length
      db.transactions = db.transactions.filter(t => !ids.has(t.id))
      deletedTransactionCount = before - db.transactions.length
    }
  }

  writeDb(db)
  res.json({ removed, deletedTransactionCount })
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

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthLabel(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

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
    cardSpendMonthly: 0, cardCreditsMonthly: 0, cardBreakdown: [],
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
    // bankFlowOf applies the same Savings/Investments-first ordering this chain used to spell
    // out, so an allocation row can't fall through to expenses on its type: 'expense'.
    switch (bankFlowOf(t)) {
      case 'savings': savingsContrib += amt; break
      case 'investments': investContrib += amt; break
      case 'income': income += amt; break
      case 'expense': expenses += amt; break
    }
  }

  // Credit-card category breakdown over the same full-month window (advice only). Positive card
  // rows are credits, not spending, so they are tallied on their own rather than inflating a
  // category total.
  const cardByCat = {}
  let cardTotal = 0
  let cardCredits = 0
  for (const t of cc) {
    if (!inWindow(t.date)) continue
    const raw = Number(t.amount)
    if (raw > 0) { cardCredits += raw; continue }
    const amt = Math.abs(raw)
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
    if (bankFlowOf(t) === 'income') continue
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
    cardCreditsMonthly: Math.round(cardCredits / divisor),
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
  if (fin.cardCreditsMonthly > 0) {
    lines.push(``)
    lines.push(`Credit-card credits received: $${fin.cardCreditsMonthly}/mo (cashback, refunds, rebates). Already excluded from the card spending above. These make the card bill smaller, so the expense total already reflects them — do NOT also add them to income.`)
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
function goalTimeline(goal, growth = null) {
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount)
  const monthsAtCurrent = goal.monthlySavings > 0 ? Math.ceil(remaining / goal.monthlySavings) : null
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
    verdict = `BEHIND: at the current rate the goal is reached in ${monthsAtCurrent} months (${projectedDate}), which is ${monthsAtCurrent - monthsToTarget} month(s) AFTER the ${monthYearLabel(goal.targetDate)} target. To hit the target date the user must save about $${requiredMonthly}/month (currently $${goal.monthlySavings || 0}/month).`
  }

  let growthMonths = null, growthDate = null, growthVerdict = null, blendedAnnualRate = null, assumedReturnUsed = null, hasInvestments = false
  if (growth && growth.blendedAnnualRate > 0 && remaining > 0) {
    blendedAnnualRate = Math.round(growth.blendedAnnualRate * 10000) / 10000
    assumedReturnUsed = growth.assumedReturn
    hasInvestments = growth.hasInvestments
    const proj = projectWithGrowth({
      balance: goal.currentAmount,
      monthly: goal.monthlySavings || 0,
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

  return { remaining, monthsAtCurrent, monthsToTarget, projectedDate, requiredMonthly, verdict, growthMonths, growthDate, growthVerdict, blendedAnnualRate, assumedReturnUsed, hasInvestments }
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

// `model` overrides the tier choice outright; otherwise vision uses the configurable
// settings.visionModel, `smart` gets Sonnet, and everything else gets Haiku.
async function callLLM({ system, userMessages, maxTokens, vision = false, smart = false, model }) {
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
      model: model || (vision || smart ? 'gpt-4o' : 'gpt-4o-mini'),
      max_tokens: maxTokens,
      messages,
    })
    return result.choices[0].message.content
  } else {
    if (!claudeApiKey) throw new Error('No Claude API key configured. Add one in Settings.')
    const client = new Anthropic({ apiKey: claudeApiKey })
    const result = await client.messages.create({
      model: model || (vision
        ? (db.settings.visionModel || 'claude-sonnet-4-6')
        : smart ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'),
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: userMessages,
    })
    return result.content[0].text
  }
}

// `POST /api/llm/insights` lived here: three free-form strings from one unvalidated model call,
// with every number in them written by the model. It was the Dashboard's only caller and is
// replaced by the deterministic triad below (`/api/llm/dashboard-insights`), where the figures come
// from `buildDashboardAnalysis` and the model contributes wording alone.

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

  let raw = null
  try {
    const text = await callLLM({
      system: 'You are a personal finance transaction categorizer. Respond with valid JSON only.',
      userMessages: [{ role: 'user', content: userMsg }],
      maxTokens: 1024,
    })
    raw = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const result = JSON.parse(raw)
    const validated = (result.categories || []).map(({ id, category }) => ({
      id,
      category: VALID_CATEGORIES.includes(category) ? category : 'Other',
    }))
    res.json({ categories: validated })
  } catch (err) {
    // Categorization is best-effort: still return 200 so imports proceed uncategorized, but
    // surface a warning so the UI can say why rather than silently degrading.
    const errorId = Math.random().toString(36).slice(2, 8)
    console.error(`[${errorId}] LLM categorize error:`, err.stack || err.message)
    if (raw) console.error(`[${errorId}] detail:`, raw)
    res.json({ categories: [], warning: err.message, errorId })
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

  const tl = goalTimeline(goal, goalGrowthRate(db, goal, priceMap))
  const volatilityNote = goal.breakdown.some(b => b.sourceType === 'holdingsAccountType')
    ? '\nNote: part of this goal is backed by investments, so its value moves with the market — mention this volatility if relevant.'
    : ''

  const userMsg = `Goal being analyzed: ${goal.name}
Target: $${goal.targetAmount} | Saved: $${goal.currentAmount} (${goal.targetAmount > 0 ? Math.round(goal.currentAmount / goal.targetAmount * 100) : 0}%)
Remaining: $${tl.remaining}
Monthly savings rate: ${goal.monthlySavings ? '$' + goal.monthlySavings : 'not set'}
Target date: ${goal.targetDate || 'not set'}${tl.monthsToTarget == null ? '' : ` (${monthYearLabel(goal.targetDate)}, ${tl.monthsToTarget} months from today)`}
${fundingLine ? fundingLine + '\n' : ''}
Timeline (already computed — use these figures, do NOT recompute dates yourself):
${tl.verdict}${tl.growthVerdict ? `\nOptimistic projection (assumes investment/interest returns hold — do NOT present as guaranteed): ${tl.growthVerdict}` : ''}

All goals:
${allGoalsSummary || '  No other goals'}

Liquid net worth snapshot (cash + savings + investments; excludes property, vehicles, private shares, and debts):
${netWorthSummary}

${formatMonthlyFinancials(fin)}${volatilityNote}

Write 3–4 sentences: (1) state whether they are on track or behind using the linear Timeline — if a growth projection is also provided, present both as a range (e.g. "conservatively X months, or as few as Y months if returns hold") and make clear the optimistic figure assumes investment returns; if behind on the linear timeline, give the monthly savings rate needed to hit the target date; (2) name one specific credit-card spending category (from the breakdown) to reduce and roughly how much sooner it would get them there; (3) briefly state the data basis — how many full months and that expenses come from bank transactions. Be specific, practical, and honest. Do not add the card breakdown to total expenses. Plain text only, no markdown.`

  try {
    const text = await callLLM({
      system: `You are a practical personal finance advisor. ${todayLine()} Be concise and specific.`,
      userMessages: [{ role: 'user', content: userMsg }],
      maxTokens: 512,
    })
    res.json({ analysis: text.trim() })
  } catch (err) {
    failure(res, 'LLM goal-analysis error', err)
  }
})

// Replaces the stored record wholesale: there is only ever one set of current insights, and a
// fresh generation invalidates any chat that was following the old one. Re-reads the db rather
// than reusing the copy from the start of the route, since the LLM call takes seconds and an
// import may have written in the meantime.
function saveSpendInsights(record) {
  const db = readDb()
  db.spendInsights = record
  writeDb(db)
  return db.spendInsights
}

// Every insight route takes the same body: a `period` scope key plus, optionally, the range and
// filters it stands for. Without the range this is the old prefix-match behaviour. Shared by both
// triads — the filter vocabularies differ, but they are opaque here.
function readScopeBody(body = {}) {
  const { period = 'all', from, to, filters, periodLabel } = body
  const scope = (from || to || filters) ? { from, to, filters, label: periodLabel } : period
  return { period, scope, periodLabel: periodLabel ?? null }
}

app.get('/api/spend-insights', (req, res) => {
  const db = readDb()
  res.json(normalizeSpendInsightRecord(db.spendInsights ?? null))
})

app.delete('/api/spend-insights', (req, res) => {
  const db = readDb()
  db.spendInsights = null
  writeDb(db)
  res.json(null)
})

app.post('/api/llm/spend-insights', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { period, scope, periodLabel } = readScopeBody(req.body)
  const analysis = buildSpendAnalysis({
    bankTransactions: db.transactions || [],
    cardTransactions: db.credit_card_transactions || [],
    settings: db.settings || {},
    insightScope: scope,
  })
  const generation = createSpendInsightGeneration({ analysis, period, periodLabel, scope })

  let raw = null
  try {
    const text = await callLLM({
      system: generation.prompt.system,
      userMessages: [{ role: 'user', content: generation.prompt.user }],
      maxTokens: generation.prompt.maxTokens,
    })
    raw = text
    const result = generation.complete(text, new Date().toISOString())
    saveSpendInsights(result)
    res.json(result)
  } catch (err) {
    failure(res, 'LLM spend-insights error', err, { detail: raw })
  }
})

app.post('/api/llm/spend-chat', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { messages = [] } = req.body
  if (!messages.length) return res.status(400).json({ error: 'No messages provided' })
  if (![...messages].reverse().some(message => message.role === 'user' && message.content?.trim())) {
    return res.status(400).json({ error: 'No user message provided' })
  }

  const { period, scope: requestScope } = readScopeBody(req.body)

  // The stored record owns the conversational scope. If it no longer matches the request, use the
  // client's scope but do not borrow profile or Financial Pace facts from a different analysis.
  const binding = createSpendChatBinding({ record: db.spendInsights, period, requestScope })
  const { storedInsights, scope } = binding
  const analysis = buildSpendAnalysis({
    bankTransactions: db.transactions || [],
    cardTransactions: db.credit_card_transactions || [],
    settings: db.settings || {},
    insightScope: scope,
  })
  const turn = createSpendChatTurn({
    analysis,
    storedInsights,
    bankTransactions: db.transactions || [],
    cardTransactions: db.credit_card_transactions || [],
    settings: db.settings || {},
    messages,
  })

  let rawIntent = null
  let rawAdvice = null
  try {
    let reply = turn.directReply
    if (!reply) {
      const intentText = await callLLM({
        system: turn.intentPrompt.system,
        userMessages: [{ role: 'user', content: turn.intentPrompt.user }],
        maxTokens: turn.intentPrompt.maxTokens,
      })
      rawIntent = intentText
      const outcome = turn.completeIntent(intentText)
      if (outcome.type === 'advice') {
        const adviceText = await callLLM({
          system: outcome.prompt.system,
          userMessages: outcome.prompt.messages,
          maxTokens: outcome.prompt.maxTokens,
        })
        rawAdvice = adviceText
        reply = turn.completeAdvice(adviceText)
      } else {
        reply = outcome.reply
      }
    }

    // Appended only when the stored insights still describe the scope being discussed — the same
    // range *and* the same filters. Otherwise this exchange belongs to a set of insights that has
    // since been replaced or re-scoped.
    const fresh = readDb()
    if (binding.canAppend(fresh.spendInsights)) {
      fresh.spendInsights.messages = [
        ...(fresh.spendInsights.messages ?? []),
        turn.userMessage,
        { role: 'assistant', content: reply },
      ]
      writeDb(fresh)
    }

    res.json({ reply })
  } catch (err) {
    failure(res, 'LLM spend-chat error', err, {
      detail: rawAdvice ?? rawIntent,
    })
  }
})

// The Finances triad. Structurally identical to the spend routes above — same replace-wholesale
// storage, same re-read before appending a chat reply — over the bank ledger instead of the card
// one. The two records are separate keys on purpose: they answer different questions over different
// scopes, and one refresh must not invalidate the other's conversation.
function saveFinanceInsights(record) {
  const db = readDb()
  db.financeInsights = record
  writeDb(db)
  return db.financeInsights
}

app.get('/api/finance-insights', (req, res) => {
  const db = readDb()
  res.json(normalizeFinanceInsightRecord(db.financeInsights ?? null))
})

app.delete('/api/finance-insights', (req, res) => {
  const db = readDb()
  db.financeInsights = null
  writeDb(db)
  res.json(null)
})

app.post('/api/llm/finance-insights', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { period, scope, periodLabel } = readScopeBody(req.body)
  const analysis = buildFinanceAnalysis({
    bankTransactions: db.transactions || [],
    cardTransactions: db.credit_card_transactions || [],
    savingsAccounts: db.savings_accounts || [],
    settings: db.settings || {},
    insightScope: scope,
  })
  const generation = createFinanceInsightGeneration({ analysis, period, periodLabel, scope })

  let raw = null
  try {
    const text = await callLLM({
      system: generation.prompt.system,
      userMessages: [{ role: 'user', content: generation.prompt.user }],
      maxTokens: generation.prompt.maxTokens,
    })
    raw = text
    const result = generation.complete(text, new Date().toISOString())
    saveFinanceInsights(result)
    res.json(result)
  } catch (err) {
    failure(res, 'LLM finance-insights error', err, { detail: raw })
  }
})

app.post('/api/llm/finance-chat', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { messages = [] } = req.body
  if (!messages.length) return res.status(400).json({ error: 'No messages provided' })
  if (![...messages].reverse().some(message => message.role === 'user' && message.content?.trim())) {
    return res.status(400).json({ error: 'No user message provided' })
  }

  const { period, scope: requestScope } = readScopeBody(req.body)

  // The stored record owns the conversational scope. If it no longer matches the request, use the
  // client's scope but do not borrow Financial Pace facts from a different analysis.
  const binding = createFinanceChatBinding({ record: db.financeInsights, period, requestScope })
  const { storedInsights, scope } = binding
  const analysis = buildFinanceAnalysis({
    bankTransactions: db.transactions || [],
    cardTransactions: db.credit_card_transactions || [],
    savingsAccounts: db.savings_accounts || [],
    settings: db.settings || {},
    insightScope: scope,
  })
  const turn = createFinanceChatTurn({
    analysis,
    storedInsights,
    bankTransactions: db.transactions || [],
    settings: db.settings || {},
    messages,
  })

  let rawIntent = null
  let rawAdvice = null
  try {
    let reply = turn.directReply
    if (!reply) {
      const intentText = await callLLM({
        system: turn.intentPrompt.system,
        userMessages: [{ role: 'user', content: turn.intentPrompt.user }],
        maxTokens: turn.intentPrompt.maxTokens,
      })
      rawIntent = intentText
      const outcome = turn.completeIntent(intentText)
      if (outcome.type === 'advice') {
        const adviceText = await callLLM({
          system: outcome.prompt.system,
          userMessages: outcome.prompt.messages,
          maxTokens: outcome.prompt.maxTokens,
        })
        rawAdvice = adviceText
        reply = turn.completeAdvice(adviceText)
      } else {
        reply = outcome.reply
      }
    }

    // Appended only when the stored insights still describe the scope being discussed. Otherwise
    // this exchange belongs to a generation that has since been replaced or re-scoped.
    const fresh = readDb()
    if (binding.canAppend(fresh.financeInsights)) {
      fresh.financeInsights.messages = [
        ...(fresh.financeInsights.messages ?? []),
        turn.userMessage,
        { role: 'assistant', content: reply },
      ]
      writeDb(fresh)
    }

    res.json({ reply })
  } catch (err) {
    failure(res, 'LLM finance-chat error', err, {
      detail: rawAdvice ?? rawIntent,
    })
  }
})

// The Dashboard triad. Structurally identical to the two above — same replace-wholesale storage,
// same re-read before appending a chat reply — over BALANCES rather than a ledger. Everything it
// quotes comes from `src/utils/liquidNetWorth.js`, the same module the cards render from, which is
// what makes an insight agreeing with the KPI strip structural rather than a coincidence.
function saveDashboardInsights(record) {
  const db = readDb()
  db.dashboardInsights = record
  writeDb(db)
  return db.dashboardInsights
}

// Everything the deterministic analysis needs, assembled from the db. Kept in one place because
// the insight route and the chat route MUST see the same figures — a chat reply computed from a
// different cash basis than the insights above it is the exact failure the triad exists to prevent.
async function dashboardAnalysisInputs(db, insightScope) {
  const priceMap = await fetchPrices((db.holdings ?? []).map(h => h.ticker).filter(Boolean))
  const today = new Date().toISOString().slice(0, 10)
  return {
    netWorthHistory: db.netWorthHistory ?? [],
    bankTransactions: (db.transactions ?? []).filter(t => t.date),
    // Linked goals derive their balance from the accounts they point at, so the stored
    // `currentAmount` is stale for them. Use the same computation `/api/goals` serves the UI.
    goals: (db.goals ?? []).map(goal => ({
      ...goal,
      currentAmount: computeGoalProgress(db, goal, priceMap).currentAmount,
    })),
    savingsAccounts: db.savings_accounts ?? [],
    holdings: db.holdings ?? [],
    prices: priceMap,
    // The statements are the authority on chequing, not `settings.cashBalance`, which is a cache.
    cash: cashAsOf(cashSourcesFor(db), today),
    checks: statementChecks(cashSourcesFor(db)),
    settings: db.settings ?? {},
    insightScope,
    asOf: today,
  }
}

app.get('/api/dashboard-insights', (req, res) => {
  const db = readDb()
  res.json(normalizeDashboardInsightRecord(db.dashboardInsights ?? null))
})

app.delete('/api/dashboard-insights', (req, res) => {
  const db = readDb()
  db.dashboardInsights = null
  writeDb(db)
  res.json(null)
})

app.post('/api/llm/dashboard-insights', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { period, scope, periodLabel } = readScopeBody(req.body)
  const analysis = buildDashboardAnalysis(await dashboardAnalysisInputs(db, scope))
  const generation = createDashboardInsightGeneration({ analysis, period, periodLabel, scope })

  let raw = null
  try {
    const text = await callLLM({
      system: generation.prompt.system,
      userMessages: [{ role: 'user', content: generation.prompt.user }],
      maxTokens: generation.prompt.maxTokens,
    })
    raw = text
    const result = generation.complete(text, new Date().toISOString())
    saveDashboardInsights(result)
    res.json(result)
  } catch (err) {
    failure(res, 'LLM dashboard-insights error', err, { detail: raw })
  }
})

app.post('/api/llm/dashboard-chat', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { messages = [] } = req.body
  if (!messages.length) return res.status(400).json({ error: 'No messages provided' })
  if (![...messages].reverse().some(message => message.role === 'user' && message.content?.trim())) {
    return res.status(400).json({ error: 'No user message provided' })
  }

  const { period, scope: requestScope } = readScopeBody(req.body)

  // The stored record owns the conversational scope, so re-scoping the page while a question is in
  // flight still gets an answer about what was asked. See `chatBinding.js`.
  const binding = createDashboardChatBinding({ record: db.dashboardInsights, period, requestScope })
  const { storedInsights, scope } = binding
  const analysis = buildDashboardAnalysis(await dashboardAnalysisInputs(db, scope))
  const turn = createDashboardChatTurn({ analysis, storedInsights, messages })

  let rawIntent = null
  let rawAdvice = null
  try {
    let reply = turn.directReply
    if (!reply) {
      const intentText = await callLLM({
        system: turn.intentPrompt.system,
        userMessages: [{ role: 'user', content: turn.intentPrompt.user }],
        maxTokens: turn.intentPrompt.maxTokens,
      })
      rawIntent = intentText
      const outcome = turn.completeIntent(intentText)
      if (outcome.type === 'advice') {
        const adviceText = await callLLM({
          system: outcome.prompt.system,
          userMessages: outcome.prompt.messages,
          maxTokens: outcome.prompt.maxTokens,
        })
        rawAdvice = adviceText
        reply = turn.completeAdvice(adviceText)
      } else {
        reply = outcome.reply
      }
    }

    // Appended only when the stored insights still describe the scope being discussed.
    const fresh = readDb()
    if (binding.canAppend(fresh.dashboardInsights)) {
      fresh.dashboardInsights.messages = [
        ...(fresh.dashboardInsights.messages ?? []),
        turn.userMessage,
        { role: 'assistant', content: reply },
      ]
      writeDb(fresh)
    }

    res.json({ reply })
  } catch (err) {
    failure(res, 'LLM dashboard-chat error', err, { detail: rawAdvice ?? rawIntent })
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

  const allGoalLines = db.goals.map(g => {
    const { currentAmount } = computeGoalProgress(db, g, priceMap)
    const pct = g.targetAmount > 0 ? Math.round(currentAmount / g.targetAmount * 100) : 0
    return `  ${g.name}: $${currentAmount} / $${g.targetAmount} (${pct}%)${g.monthlySavings ? `, saving $${g.monthlySavings}/mo` : ''}`
  }).join('\n')

  const cashBalance = db.settings.cashBalance ?? 0
  const savingsTotal = (db.savings_accounts ?? []).reduce((s, a) => s + a.balance, 0)
  const portfolioValue = (db.holdings ?? []).reduce((s, h) => s + h.purchasePrice * h.shares, 0)

  const pct = goal.targetAmount > 0 ? Math.round(goal.currentAmount / goal.targetAmount * 100) : 0
  const tl = goalTimeline(goal, goalGrowthRate(db, goal, priceMap))

  const systemMsg = `You are a personal finance advisor helping with a savings goal. ${todayLine()}

Goal: ${goal.name}
Target: $${goal.targetAmount} | Saved: $${goal.currentAmount} (${pct}%)
Remaining: $${tl.remaining}
Monthly savings rate: ${goal.monthlySavings ? '$' + goal.monthlySavings : 'not set'}
Target date: ${goal.targetDate || 'not set'}${tl.monthsToTarget == null ? '' : ` (${monthYearLabel(goal.targetDate)}, ${tl.monthsToTarget} months from today)`}
${fundingLine ? fundingLine + '\n' : ''}
Timeline (already computed — use these figures, do NOT recompute dates yourself):
${tl.verdict}${tl.growthVerdict ? `\nOptimistic projection (assumes investment/interest returns hold — do NOT present as guaranteed): ${tl.growthVerdict}` : ''}

All goals:
${allGoalLines || '  No other goals'}

Liquid net worth: Cash $${cashBalance.toFixed(2)}, Savings $${savingsTotal.toFixed(2)}, Portfolio cost basis $${portfolioValue.toFixed(2)}

${formatMonthlyFinancials(fin)}

Be concise, specific, and honest. When a growth projection is available, acknowledge both the conservative and optimistic estimates. Answer in 2–4 sentences.`

  try {
    const text = await callLLM({ system: systemMsg, userMessages: messages, maxTokens: 512 })
    res.json({ reply: text.trim() })
  } catch (err) {
    failure(res, 'LLM goal-chat error', err)
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

  let raw = null
  try {
    const text = await callLLM({
      system: `You are a personal finance advisor. ${todayLine()} You always respond with valid JSON only.`,
      userMessages: [{ role: 'user', content: userMsg }],
      maxTokens: 1024,
    })
    raw = text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
    const result = JSON.parse(raw)
    res.json(result)
  } catch (err) {
    if (err instanceof SyntaxError) {
      return failure(res, 'LLM budget-builder error', new Error('Failed to parse AI response'), { detail: raw })
    }
    failure(res, 'LLM budget-builder error', err, { detail: raw })
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
  let raw = null
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
  "splitDebitCredit": <true if money out and money in are in SEPARATE columns, false if one signed amount column>,
  "amount": "<header name for the single amount column, or empty string when splitDebitCredit is true>",
  "debit": "<header name for the money-out column, or empty string when splitDebitCredit is false>",
  "credit": "<header name for the money-in column, or empty string when splitDebitCredit is false>",
  "invertAmounts": <true if purchases show as positive numbers, false if negative>,
  "statementType": "credit_card" or "bank",
  "suggestedSourceName": "<best guess at institution name from the data, or empty string>"
}

For splitDebitCredit: set true when the statement has two separate value columns such as Debit/Credit, Withdrawals/Deposits, or Charges/Payments, and name both. Otherwise set false and name the single amount column.

For invertAmounts (only meaningful when splitDebitCredit is false): look at the sample rows. If typical purchase/spending amounts appear as POSITIVE numbers (e.g. 50.00 for a store charge), set true so they get negated to expenses. If purchases appear as NEGATIVE numbers (e.g. -50.00), set false. Do not guess by bank name — read the actual values in the samples.`,
      }],
      maxTokens: 512,
      smart: true,
    })
    raw = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const mapping = JSON.parse(raw)
    res.json({ mapping })
  } catch (err) {
    failure(res, 'detect-columns error', err, { detail: raw })
  }
})

// Fallback for spreadsheets whose layout defeats column mapping — multi-section statements
// (separate "Withdrawals" / "Deposits" blocks), stacked sub-tables, headers mid-file. The grid
// goes up as text in chunks, which is both cheaper and more faithful than rasterizing it.
app.post('/api/llm/extract-rows', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { rows, statementType = 'bank' } = req.body
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows required' })
  }

  const isCard = statementType === 'credit_card'
  const grid = rows.map(row => {
    const cells = Array.isArray(row) ? row : Object.values(row ?? {})
    return cells.map(c => String(c ?? '').replace(/\t/g, ' ').trim()).join('\t')
  })

  // Chunked so a long export neither blows the output token budget nor loses rows to
  // truncation. Chunks overlap by a few rows so a section header isn't stranded.
  const CHUNK = 120
  const OVERLAP = 3
  const transactions = []
  const seen = new Set()
  let raw = null

  try {
    for (let start = 0; start < grid.length; start += CHUNK) {
      const from = start === 0 ? 0 : start - OVERLAP
      const chunk = grid.slice(from, start + CHUNK)
      const text = await callLLM({
        system: 'You extract transactions from tabular financial statements. Respond with valid JSON only.',
        userMessages: [{
          role: 'user',
          content: `These are tab-separated rows from a ${isCard ? 'credit card' : 'bank'} statement export${grid.length > CHUNK ? ` (rows ${from + 1}-${Math.min(start + CHUNK, grid.length)} of ${grid.length})` : ''}. The layout may include title rows, section headers, blank rows, subtotals, and separate sections for debits and credits.

${chunk.join('\n')}

Return ONLY a JSON object:
{"transactions":[{"date":"YYYY-MM-DD","description":"<description>","amount":<number>${isCard ? ',"creditKind":"<only for positive amounts>"' : ''}}]}

Rules:
- Infer the year from any statement period, header text, or date codes present. If no year is discoverable, use ${new Date().getFullYear()}.
${isCard
  ? `- "amount" is NEGATIVE for purchases, fees, interest, and cash advances (omit "creditKind" for those).
- Money credited back to you gets a POSITIVE "amount" and a "creditKind" of exactly one of "cashback" (rewards redeemed), "refund" (merchant refund, return, or reversed charge), "rebate" (issuer promotional credit, goodwill adjustment, waived fee), or "credit" (none of the above).
- SKIP payments made TO the card entirely ("Payment - Thank You", "Autopay", "Online Payment", and similar), along with balance transfers. Those are paid from a bank account where they are already recorded. A payment reduces what you owe; a refund or cashback is money returned to you — decide from the DESCRIPTION, since both print as credits.`
  : `- "amount" is positive for deposits/credits and negative for withdrawals/debits. Respect which section a row falls under: rows under a withdrawals/debits heading are negative, rows under a deposits/credits heading are positive, regardless of how the number is printed.`}
- Skip title rows, column headers, blank rows, running balances, subtotals, and "daily balance" style sections.
- If this chunk contains no transactions, return {"transactions":[]}.`,
        }],
        maxTokens: 8000,
        smart: true,
      })
      raw = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
      const parsed = JSON.parse(raw)
      const batch = Array.isArray(parsed) ? parsed : (parsed.transactions ?? [])
      for (const tx of batch) {
        // Overlapping chunk edges can yield the same row twice.
        const key = `${tx.date}|${tx.description}|${tx.amount}`
        if (seen.has(key)) continue
        seen.add(key)
        transactions.push(tx)
      }
    }
    res.json({ transactions })
  } catch (err) {
    failure(res, 'extract-rows error', err, { detail: raw })
  }
})

app.post('/api/parse-pdf-vision', async (req, res) => {
  const db = readDb()
  const { aiProvider = 'claude', claudeApiKey, openaiApiKey } = db.settings
  const hasKey = aiProvider === 'openai' ? !!openaiApiKey : !!claudeApiKey
  if (!hasKey) return res.status(400).json({ error: 'No AI API key configured. Add one in Settings.' })

  const { pages, statementType = 'bank', statementPeriod = null } = req.body
  if (!Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: 'No pages provided' })
  }

  const isCard = statementType === 'credit_card'
  const kindLabel = isCard ? 'credit card statement' : 'bank statement'
  const shape = isCard
    ? `{ "date": "YYYY-MM-DD", "description": "<description>", "amount": <number>, "creditKind": "<only for positive amounts, see below>" }`
    : `{ "date": "YYYY-MM-DD", "description": "<description>", "amount": <number> }`
  // Later page-batches of the same document no longer see the cover page, so the period read
  // from the first batch is supplied to them explicitly.
  const periodHint = statementPeriod
    ? `The statement period is ${statementPeriod} — use it to resolve the year for every date.`
    : `Read the statement period printed on the page and return it as "statementPeriod".`
  // Credits are the subtle part: the money-back rows must be kept and labelled, while payments
  // to the card must be dropped, and both are printed the same way on most statements.
  const amountRules = isCard
    ? `Rules for "amount" and "creditKind":
- Purchases, fees, interest charges, and cash advances: NEGATIVE "amount", and omit "creditKind".
- Money credited back to you: POSITIVE "amount", plus a "creditKind" of exactly one of:
  - "cashback" — cash-back or rewards redeemed as a statement credit
  - "refund"   — a merchant refund, return, or reversed/disputed charge
  - "rebate"   — an issuer promotional credit, goodwill adjustment, or waived fee
  - "credit"   — a credit you cannot place in the three above
- SKIP these rows entirely, do not return them at all:
  - PAYMENTS made TO the card (wording like "Payment - Thank You", "Autopay", "Online Payment",
    "Electronic Payment", "Direct Debit"). These are paid from a bank account, where they are
    already recorded, so returning them here would double-count the same money.
  - balance transfers and cash-advance repayments.
A payment reduces what you owe; a refund or cashback is money returned to you. Both are printed
as credits, often with "CR" or in a credits column, so decide from the DESCRIPTION, not the sign.`
    : `Rules for "amount": positive for deposits/credits, negative for withdrawals/debits.`

  const exclusions = isCard
    ? 'Exclude previous/new balance lines, minimum payment due, payment due date, credit limit and available credit figures, interest-charge and fees-year-to-date summary boxes, and rewards-points balances. Only return rows from the itemized transaction list.'
    : 'Exclude balance summaries, running totals, fee summaries, and any non-transaction rows.'

  let raw = null
  try {
    const text = await callLLM({
      userMessages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extract all transactions from this scanned ${kindLabel}.

${periodHint}

Return ONLY a JSON object:
{
  "statementPeriod": "<the statement period as printed, or null>",
  "transactions": [
    ${shape}
  ]
}

${amountRules}

${exclusions}

Return valid JSON only, no markdown.`,
          },
          ...pages.map(data => ({
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data },
          })),
        ],
      }],
      maxTokens: 8192,
      vision: true,
    })

    raw = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(raw)
    // Tolerate a bare array, which is what the prompt used to ask for.
    const transactions = Array.isArray(parsed) ? parsed : (parsed.transactions ?? [])
    res.json({
      transactions,
      statementPeriod: Array.isArray(parsed) ? null : (parsed.statementPeriod ?? null),
    })
  } catch (err) {
    failure(res, 'PDF vision error', err, { detail: raw })
  }
})

// --- Net Worth History ---
//
// Three routes over the one derivation in `netWorthHistory.js`:
//
//   snapshot — overwrite today's point with live-priced balances (every Dashboard mount)
//   backfill — add month-end points for months that have none yet (every mount; usually a no-op)
//   rebuild  — recompute every point from scratch, once, when the stored shape is out of date
//
// The route paths and the `netWorthHistory` key keep their original names even though the UI now
// calls the metric "liquid net worth". They are persisted contracts; renaming them would cost a
// db migration and buy nothing a user can see.

// Live and monthly-historical prices for everything held, fetched together. Both are needed on
// any path that touches more than today: `historicalPriceLookup` falls back to the live price for
// a ticker Yahoo has no monthly series for.
async function priceLookupForHoldings(db) {
  const tickers = (db.holdings ?? []).map(h => h.ticker).filter(Boolean)
  const [live, historical] = await Promise.all([
    fetchPrices(tickers),
    fetchHistoricalPrices(tickers),
  ])
  return historicalPriceLookup(historical, live)
}

async function computeHistory(db, today, keepDates) {
  const sources = cashSourcesFor(db)
  return rebuildHistory({
    transactions: db.transactions ?? [],
    holdings: db.holdings ?? [],
    savingsAccounts: db.savings_accounts ?? [],
    opening: sources.opening,
    statementBalances: sources.statementBalances,
    today,
    keepDates,
    priceOf: await priceLookupForHoldings(db),
  })
}

/**
 * Establish the cash anchor for a db that predates it, in place, returning whether anything moved.
 *
 * Two jobs. First, seed `cashOpeningBalance` by running the earliest balance we ever recorded
 * backwards to the start of the ledger — the six months before that first entry have no anchor at
 * all otherwise.
 *
 * Second, convert the legacy `cashBalanceHistory` observations into reconciliations. Those were
 * harvested from DAILY SNAPSHOTS, so a value repeats for every day the user simply had not
 * re-typed it; only the first date of each run is a real edit, and treating the repeats as
 * observations pins the balance flat across days when money genuinely moved. Runs are collapsed
 * to their first date, and a value that survives a single day before reversing is dropped as a
 * typo rather than enshrined as fact.
 */
function migrateCashModel(db) {
  const settings = db.settings ?? {}
  // The array rename runs even for a db that already has an opening balance — the anchor is fine,
  // it is the storage key underneath it that moved.
  if (settings.cashReconciliations && !settings.statementBalances?.length) {
    settings.statementBalances = sortedBalances(
      settings.cashReconciliations.map(r => ({ date: r.date, balance: r.balance, source: 'typed' })),
    )
    delete settings.cashReconciliations
  }
  if (settings.cashOpeningBalance) return false

  const bankRows = (db.transactions ?? []).filter(t => t.date)
  if (!bankRows.length) return false
  const openingDate = bankRows.map(t => t.date).sort()[0]

  const legacy = (settings.cashBalanceHistory ?? [])
    .filter(o => o?.date && Number.isFinite(o.balance))
    .sort((a, b) => a.date.localeCompare(b.date))

  const edits = []
  let prev = null
  for (const o of legacy) {
    if (o.balance !== prev) { edits.push(o); prev = o.balance }
  }
  // A balance that lasts one day and then reverses is a mis-key, not a reconciliation.
  const real = edits.filter((o, i) => {
    const next = edits[i + 1]
    const prevEdit = edits[i - 1]
    if (!next || !prevEdit) return true
    const oneDay = (new Date(next.date) - new Date(o.date)) / 86400000 <= 1
    const reverses = Math.sign(o.balance - prevEdit.balance) !== Math.sign(next.balance - o.balance)
    const large = Math.abs(o.balance - prevEdit.balance) > 10000
    return !(oneDay && reverses && large)
  })

  const anchor = real[0]
  settings.cashOpeningBalance = anchor
    ? deriveOpeningBalance(bankRows, anchor.date, anchor.balance, openingDate)
    : deriveOpeningBalance(bankRows, ledgerCoverageEnd(bankRows), settings.cashBalance ?? 0, openingDate)

  // Every balance ever recorded becomes a dated anchor. They were typed rather than read off a
  // statement, so they are carried with `source: 'typed'` — the Settings list marks them as
  // unverified, because a round number someone estimated is not a bank-issued figure and the app
  // should not present it as one.
  settings.statementBalances = sortedBalances(
    [...real, ...(settings.cashReconciliations ?? [])]
      .map(o => ({ date: o.date, balance: o.balance, source: 'typed' })),
  )
  delete settings.cashBalanceHistory
  delete settings.cashReconciliations

  const today = new Date().toISOString().slice(0, 10)
  settings.cashBalance = cashAsOf(
    { opening: settings.cashOpeningBalance, statementBalances: settings.statementBalances, bankRows },
    today,
  )
  return true
}

app.post('/api/net-worth-snapshot', async (req, res) => {
  const db = readDb()
  const date = new Date().toISOString().slice(0, 10)
  const prices = await fetchPrices((db.holdings ?? []).map(h => h.ticker).filter(Boolean))
  const { market, cost, basis } = valueHoldingsAsOf(db.holdings ?? [], date, t => prices[t] ?? null)
  const entry = buildEntry({
    date,
    // Derived, not the cached settings value: the ledger is the authority on chequing.
    cash: cashAsOf(cashSourcesFor(db), date),
    savings: (db.savings_accounts ?? []).reduce((s, a) => s + (a.balance ?? 0), 0),
    market,
    cost,
    basis,
  })

  if (!db.netWorthHistory) db.netWorthHistory = []
  const idx = db.netWorthHistory.findIndex(e => e.date === date)
  if (idx !== -1) db.netWorthHistory[idx] = entry
  else db.netWorthHistory.push(entry)
  writeDb(db)
  res.json(entry)
})

app.get('/api/net-worth-history', (req, res) => {
  const db = readDb()
  const history = (db.netWorthHistory ?? []).slice().sort((a, b) => a.date.localeCompare(b.date))
  res.json(history)
})

app.post('/api/net-worth-backfill', async (req, res) => {
  const db = readDb()
  const dated = (db.transactions ?? []).filter(t => t.date)
  if (!dated.length) return res.json({ added: 0 })

  const today = new Date().toISOString().slice(0, 10)
  const existingMonths = new Set((db.netWorthHistory ?? []).map(e => e.date.slice(0, 7)))

  // Derive the full series, then keep only the months that have no point at all. Existing points
  // are never touched here — correcting stale ones is `rebuild`'s job, and doing it silently on
  // every mount would rewrite history behind the user's back.
  const derived = await computeHistory(db, today, [])
  const added = derived.filter(e => !existingMonths.has(e.date.slice(0, 7)))
  if (!added.length) return res.json({ added: 0 })

  db.netWorthHistory = [...(db.netWorthHistory ?? []), ...added]
    .sort((a, b) => a.date.localeCompare(b.date))
  writeDb(db)
  res.json({ added: added.length, dates: added.map(e => e.date) })
})

// Recompute every point. Guarded by `settings.netWorthHistoryVersion` so the Dashboard can call
// it unconditionally on mount and have it run exactly once per shape change — the version check
// lives here rather than in the client because HISTORY_VERSION does. `?force=1` re-runs it, which
// is the escape hatch after editing holdings or savings balances by hand.
app.post('/api/net-worth-rebuild', async (req, res) => {
  const db = readDb()
  const force = req.query.force === '1' || req.body?.force === true
  const stored = db.settings?.netWorthHistoryVersion ?? 0
  if (!force && stored >= HISTORY_VERSION) {
    return res.json({ rebuilt: 0, skipped: true, version: stored })
  }

  const today = new Date().toISOString().slice(0, 10)
  // Establish the cash anchor before deriving anything from it.
  migrateCashModel(db)
  // Carry the existing dates forward so a rebuild keeps the daily granularity the 30-day delta
  // and the KPI sparkline read from; only the values are recomputed.
  const keepDates = (db.netWorthHistory ?? []).map(e => e.date)
  const history = await computeHistory(db, today, keepDates)

  db.netWorthHistory = history
  db.settings.netWorthHistoryVersion = HISTORY_VERSION
  writeDb(db)
  res.json({ rebuilt: history.length, skipped: false, version: HISTORY_VERSION })
})

// --- Shutdown ---

app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true })
  // Exit this process only — process.kill(0) would SIGINT the whole group and take Vite with it.
  setTimeout(() => process.exit(0), 150)
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
