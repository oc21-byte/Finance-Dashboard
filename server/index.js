import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import Anthropic from '@anthropic-ai/sdk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '../data/db.json')

const DEFAULT_DB = {
  transactions: [],
  credit_card_transactions: [],
  holdings: [],
  goals: [],
  savings_accounts: [],
  netWorthHistory: [],
  settings: {
    claudeApiKey: '',
    customCategories: [],
    cashBalance: 0,
    confirmedMonthlyIncome: null,
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
  if (dirty) fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

ensureDb()

const app = express()
app.use(cors())
app.use(express.json({ limit: '20mb' }))

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
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

app.get('/api/prices', async (req, res) => {
  const tickers = (req.query.tickers || '').split(',').filter(Boolean)
  if (!tickers.length) return res.json({})
  const entries = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!r.ok) return [ticker.toUpperCase(), null]
        const data = await r.json()
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null
        return [ticker.toUpperCase(), price]
      } catch {
        return [ticker.toUpperCase(), null]
      }
    })
  )
  res.json(Object.fromEntries(entries))
})

// --- Goals ---

app.get('/api/goals', (req, res) => {
  const db = readDb()
  res.json(db.goals)
})

app.post('/api/goals', (req, res) => {
  const db = readDb()
  const goal = { id: uuidv4(), ...req.body }
  db.goals.push(goal)
  writeDb(db)
  res.status(201).json(goal)
})

app.put('/api/goals/:id', (req, res) => {
  const db = readDb()
  const idx = db.goals.findIndex(g => g.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
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

// --- Settings ---

app.get('/api/settings', (req, res) => {
  const db = readDb()
  const { claudeApiKey, ...rest } = db.settings
  res.json({ ...rest, hasClaudeApiKey: !!(claudeApiKey) })
})

app.put('/api/settings', (req, res) => {
  const db = readDb()
  db.settings = { ...db.settings, ...req.body }
  writeDb(db)
  const { claudeApiKey, ...rest } = db.settings
  res.json({ ...rest, hasClaudeApiKey: !!(claudeApiKey) })
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

function buildCategoryTotals(transactions, days = 30) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const recent = transactions.filter(t => new Date(t.date) >= cutoff)
  const totals = {}
  for (const t of recent) {
    totals[t.category] = (totals[t.category] ?? 0) + t.amount
  }
  return totals
}

app.post('/api/llm/insights', async (req, res) => {
  const db = readDb()
  const apiKey = db.settings.claudeApiKey
  if (!apiKey) return res.status(400).json({ error: 'No API key configured' })

  const categoryTotals = buildCategoryTotals(db.transactions, 90)
  const income = Object.values(categoryTotals).filter(v => v > 0).reduce((s, v) => s + v, 0)
  const expenses = Object.values(categoryTotals).filter(v => v < 0).reduce((s, v) => s + Math.abs(v), 0)
  const goalSummaries = db.goals.map(g =>
    `${g.name}: $${g.currentAmount} of $${g.targetAmount} (${g.targetAmount > 0 ? Math.round(g.currentAmount / g.targetAmount * 100) : 0}%)` +
    (g.monthlySavings ? `, saving $${g.monthlySavings}/mo` : '')
  ).join('\n')

  const userMsg = `Financial data — last 90 days:
Spending by category: ${JSON.stringify(categoryTotals, null, 2)}
Total income: $${income.toFixed(2)}
Total expenses: $${expenses.toFixed(2)}
Net: $${(income - expenses).toFixed(2)}

Goals:
${goalSummaries || 'No goals set'}

Return ONLY a valid JSON array of exactly 3 strings. Each string is one concise, actionable insight (1–2 sentences). No markdown, no wrapping object — just the array.`

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: 'You are a personal finance assistant. You always respond with valid JSON only.',
      messages: [{ role: 'user', content: userMsg }],
    })
    const raw = message.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const insights = JSON.parse(raw)
    res.json({ insights })
  } catch (err) {
    console.error('LLM insights error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/categorize', async (req, res) => {
  const db = readDb()
  const apiKey = db.settings.claudeApiKey
  if (!apiKey) return res.json({ categories: [] })

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
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: 'You are a personal finance transaction categorizer. Respond with valid JSON only.',
      messages: [{ role: 'user', content: userMsg }],
    })
    const raw = message.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
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
  const apiKey = db.settings.claudeApiKey
  if (!apiKey) return res.status(400).json({ error: 'No API key configured' })

  const { goalId } = req.body
  const goal = db.goals.find(g => g.id === goalId)
  if (!goal) return res.status(404).json({ error: 'Goal not found' })

  const categoryTotals = buildCategoryTotals(db.transactions, 90)

  const incomeLines = Object.entries(categoryTotals)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, amt]) => `  ${cat}: $${amt.toFixed(2)}`)
    .join('\n')

  const expenseLines = Object.entries(categoryTotals)
    .filter(([, v]) => v < 0)
    .sort(([, a], [, b]) => a - b)
    .map(([cat, amt]) => `  ${cat}: $${Math.abs(amt).toFixed(2)}`)
    .join('\n')

  const allGoalsSummary = db.goals
    .map(g => {
      const pct = g.targetAmount > 0 ? Math.round(g.currentAmount / g.targetAmount * 100) : 0
      const line = `  ${g.name}: $${g.currentAmount} / $${g.targetAmount} (${pct}%)`
      return g.monthlySavings ? line + `, saving $${g.monthlySavings}/mo` : line
    })
    .join('\n')

  const cashBalance = db.settings.cashBalance ?? 0
  const savingsTotal = (db.savings_accounts ?? []).reduce((s, a) => s + a.balance, 0)
  const portfolioValue = (db.holdings ?? []).reduce((s, h) => s + h.purchasePrice * h.shares, 0)
  const netWorth = cashBalance + savingsTotal + portfolioValue
  const netWorthSummary = `Cash: $${cashBalance.toFixed(2)}, Savings accounts: $${savingsTotal.toFixed(2)}, Portfolio (cost basis): $${portfolioValue.toFixed(2)}, Total: $${netWorth.toFixed(2)}`

  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount)
  const monthsAtCurrent = goal.monthlySavings > 0 ? Math.ceil(remaining / goal.monthlySavings) : null

  const userMsg = `Goal being analyzed: ${goal.name}
Target: $${goal.targetAmount} | Saved: $${goal.currentAmount} (${goal.targetAmount > 0 ? Math.round(goal.currentAmount / goal.targetAmount * 100) : 0}%)
Monthly savings rate: ${goal.monthlySavings ? '$' + goal.monthlySavings : 'not set'}
Target date: ${goal.targetDate}
Months to goal at current rate: ${monthsAtCurrent ?? 'unknown (no savings rate set)'}

All goals:
${allGoalsSummary || '  No other goals'}

Net worth snapshot:
${netWorthSummary}

Monthly income by category (last 90 days):
${incomeLines || '  No income data'}

Monthly spending by category (last 90 days):
${expenseLines || '  No expense data'}

Write 2–3 sentences: (1) timeline at current savings rate and how it compares to the target date, (2) one specific spending category to reduce and how much faster it would get them to the goal. Be specific and practical. Plain text only, no markdown.`

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: 'You are a practical personal finance advisor. Be concise and specific.',
      messages: [{ role: 'user', content: userMsg }],
    })
    res.json({ analysis: message.content[0].text.trim() })
  } catch (err) {
    console.error('LLM goal-analysis error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/spend-insights', async (req, res) => {
  const db = readDb()
  const apiKey = db.settings.claudeApiKey
  if (!apiKey) return res.status(400).json({ error: 'No API key configured' })

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
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 768,
      system: 'You are a personal finance assistant analyzing credit card spending. Respond with valid JSON only.',
      messages: [{ role: 'user', content: userMsg }],
    })
    const raw = message.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const result = JSON.parse(raw)
    res.json({ insights: result.insights })
  } catch (err) {
    console.error('LLM spend-insights error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/spend-chat', async (req, res) => {
  const db = readDb()
  const apiKey = db.settings.claudeApiKey
  if (!apiKey) return res.status(400).json({ error: 'No API key configured' })

  const { period = 'all', messages = [] } = req.body
  if (!messages.length) return res.status(400).json({ error: 'No messages provided' })

  const context = buildSpendContextFromTransactions(db.credit_card_transactions || [], period)
  const summaryText = buildSpendSummaryText(period, context)

  const systemMsg = `You are a personal finance assistant. The user is asking follow-up questions about their credit card spending.

${summaryText}

Be concise and specific. Answer in 2–4 sentences.`

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemMsg,
      messages,
    })
    res.json({ reply: message.content[0].text.trim() })
  } catch (err) {
    console.error('LLM spend-chat error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/dashboard-chat', async (req, res) => {
  const db = readDb()
  const apiKey = db.settings.claudeApiKey
  if (!apiKey) return res.status(400).json({ error: 'No API key configured' })

  const { messages = [] } = req.body
  if (!messages.length) return res.status(400).json({ error: 'No messages provided' })

  const categoryTotals = buildCategoryTotals(db.transactions, 90)
  const income = Object.values(categoryTotals).filter(v => v > 0).reduce((s, v) => s + v, 0)
  const expenses = Object.values(categoryTotals).filter(v => v < 0).reduce((s, v) => s + Math.abs(v), 0)

  const spendingLines = Object.entries(categoryTotals)
    .filter(([, v]) => v < 0)
    .sort(([, a], [, b]) => a - b)
    .map(([cat, amt]) => `  ${cat}: $${Math.abs(amt).toFixed(2)}`)
    .join('\n')

  const goalLines = db.goals.map(g => {
    const pct = g.targetAmount > 0 ? Math.round(g.currentAmount / g.targetAmount * 100) : 0
    return `  ${g.name}: $${g.currentAmount} / $${g.targetAmount} (${pct}%)${g.monthlySavings ? `, saving $${g.monthlySavings}/mo` : ''}`
  }).join('\n')

  const cashBalance = db.settings.cashBalance ?? 0
  const savingsTotal = (db.savings_accounts ?? []).reduce((s, a) => s + a.balance, 0)
  const portfolioValue = (db.holdings ?? []).reduce((s, h) => s + h.purchasePrice * h.shares, 0)
  const netWorth = cashBalance + savingsTotal + portfolioValue

  const systemMsg = `You are a personal finance assistant. Here is the user's current financial picture:

Net worth: $${netWorth.toFixed(2)} (Cash: $${cashBalance.toFixed(2)}, Savings: $${savingsTotal.toFixed(2)}, Portfolio cost basis: $${portfolioValue.toFixed(2)})

Last 90 days — Income: $${income.toFixed(2)}, Expenses: $${expenses.toFixed(2)}, Net: $${(income - expenses).toFixed(2)}

Spending by category (last 90 days):
${spendingLines || '  No expense data'}

Goals:
${goalLines || '  No goals set'}

Be concise and specific. Answer in 2–4 sentences.`

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemMsg,
      messages,
    })
    res.json({ reply: message.content[0].text.trim() })
  } catch (err) {
    console.error('LLM dashboard-chat error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/goal-chat', async (req, res) => {
  const db = readDb()
  const apiKey = db.settings.claudeApiKey
  if (!apiKey) return res.status(400).json({ error: 'No API key configured' })

  const { goalId, messages = [] } = req.body
  if (!messages.length) return res.status(400).json({ error: 'No messages provided' })

  const goal = db.goals.find(g => g.id === goalId)
  if (!goal) return res.status(404).json({ error: 'Goal not found' })

  const categoryTotals = buildCategoryTotals(db.transactions, 90)
  const expenseLines = Object.entries(categoryTotals)
    .filter(([, v]) => v < 0)
    .sort(([, a], [, b]) => a - b)
    .map(([cat, amt]) => `  ${cat}: $${Math.abs(amt).toFixed(2)}`)
    .join('\n')

  const allGoalLines = db.goals.map(g => {
    const pct = g.targetAmount > 0 ? Math.round(g.currentAmount / g.targetAmount * 100) : 0
    return `  ${g.name}: $${g.currentAmount} / $${g.targetAmount} (${pct}%)${g.monthlySavings ? `, saving $${g.monthlySavings}/mo` : ''}`
  }).join('\n')

  const cashBalance = db.settings.cashBalance ?? 0
  const savingsTotal = (db.savings_accounts ?? []).reduce((s, a) => s + a.balance, 0)
  const portfolioValue = (db.holdings ?? []).reduce((s, h) => s + h.purchasePrice * h.shares, 0)

  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount)
  const monthsAtCurrent = goal.monthlySavings > 0 ? Math.ceil(remaining / goal.monthlySavings) : null
  const pct = goal.targetAmount > 0 ? Math.round(goal.currentAmount / goal.targetAmount * 100) : 0

  const systemMsg = `You are a personal finance advisor helping with a savings goal.

Goal: ${goal.name}
Target: $${goal.targetAmount} | Saved: $${goal.currentAmount} (${pct}%)
Monthly savings rate: ${goal.monthlySavings ? '$' + goal.monthlySavings : 'not set'}
Target date: ${goal.targetDate}
Months to goal at current rate: ${monthsAtCurrent ?? 'unknown'}

All goals:
${allGoalLines || '  No other goals'}

Net worth: Cash $${cashBalance.toFixed(2)}, Savings $${savingsTotal.toFixed(2)}, Portfolio cost basis $${portfolioValue.toFixed(2)}

Monthly spending by category (last 90 days):
${expenseLines || '  No expense data'}

Be concise and specific. Answer in 2–4 sentences.`

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemMsg,
      messages,
    })
    res.json({ reply: message.content[0].text.trim() })
  } catch (err) {
    console.error('LLM goal-chat error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/llm/budget-builder', async (req, res) => {
  const db = readDb()
  const apiKey = db.settings.claudeApiKey
  if (!apiKey) return res.status(400).json({ error: 'No API key configured' })

  const { income, timelinePreference, excludeNote } = req.body

  const activeGoals = (db.goals || []).filter(g => Number(g.currentAmount) < Number(g.targetAmount))
  if (activeGoals.length === 0) return res.json({ allGoalsComplete: true })

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)

  const recentCC = (db.credit_card_transactions || []).filter(t => new Date(t.date) >= cutoff)
  const catTotals = {}
  for (const t of recentCC) {
    if (!t.category) continue
    catTotals[t.category] = (catTotals[t.category] || 0) + Math.abs(Number(t.amount))
  }
  const avgMonthlySpend = Object.fromEntries(
    Object.entries(catTotals).map(([cat, total]) => [cat, Math.round(total / 3)])
  )

  const goalLines = activeGoals.map(g =>
    `- ${g.name}: target $${g.targetAmount}, current $${g.currentAmount}` +
    (g.monthlySavings ? `, saving $${g.monthlySavings}/mo` : '') +
    (g.targetDate ? `, due ${g.targetDate}` : '')
  ).join('\n')

  const spendLines = Object.entries(avgMonthlySpend)
    .map(([cat, amt]) => `- ${cat}: $${amt}`)
    .join('\n')

  const userMsg = `You are a personal finance advisor. Generate a monthly budget that maximizes progress toward the user's financial goals.

Monthly take-home income: $${income}
Timeline preference: ${timelinePreference}
  - aggressive: maximize savings, cut discretionary spend hard
  - balanced: reasonable cuts, maintain quality of life
  - comfortable: minimal cuts, small optimizations only

Active goals (exclude funded ones):
${goalLines}

Average monthly spend by category (last 90 days):
${spendLines || 'No spend data available'}

One-time expenses to exclude: ${excludeNote || 'None'}

Return ONLY valid JSON — no markdown, no code fences, no explanation outside the JSON:
{
  "budgets": { "Category Name": number },
  "projectedMonthlySurplus": number,
  "monthsToGoal": { "Goal Name": number },
  "rationale": "2-3 sentence plain English explanation of key tradeoffs"
}

Only include categories that have spend data. Do not invent categories.`

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: 'You are a personal finance advisor. You always respond with valid JSON only.',
      messages: [{ role: 'user', content: userMsg }],
    })
    const raw = message.content[0].text.trim()
      .replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
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
  const apiKey = db.settings.claudeApiKey
  if (!apiKey) return res.status(400).json({ error: 'No Claude API key configured.' })
  const { headers, samples } = req.body
  if (!Array.isArray(headers) || headers.length === 0) {
    return res.status(400).json({ error: 'headers required' })
  }
  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{
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

For invertAmounts: most credit card CSVs (Chase, Discover, Capital One) export purchases as positive → true. Bank CSVs typically export expenses as negative → false.`,
      }],
    })
    const raw = message.content[0].text.trim()
      .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const mapping = JSON.parse(raw)
    res.json({ mapping })
  } catch (err) {
    console.error('detect-columns error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/parse-pdf-vision', async (req, res) => {
  const db = readDb()
  const apiKey = db.settings.claudeApiKey
  if (!apiKey) return res.status(400).json({ error: 'No Claude API key configured. Add one in Settings.' })

  const { pages } = req.body
  if (!Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: 'No pages provided' })
  }

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extract all bank transactions from this scanned bank statement. Return ONLY a JSON array of transaction objects:
- "date": YYYY-MM-DD (infer the year from the statement period shown on the page)
- "description": transaction description
- "amount": number, positive for deposits/credits, negative for withdrawals/debits

Exclude balance summaries, running totals, fee summaries, and any non-transaction rows. For credit card statements, also exclude payment transactions (payments made TO the card, e.g. "PAYMENT THANK YOU", "AUTOPAY", "DIRECTPAY"). Return valid JSON only, no markdown.`,
          },
          ...pages.map(data => ({
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data },
          })),
        ],
      }],
    })

    const raw = message.content[0].text.trim()
      .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
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

// --- Start ---

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`)
})
