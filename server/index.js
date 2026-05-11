import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import Anthropic from '@anthropic-ai/sdk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '../data/db.json')

const app = express()
app.use(cors())
app.use(express.json())

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

app.get('/api/holdings', (req, res) => {
  const db = readDb()
  res.json(db.holdings)
})

app.post('/api/holdings', (req, res) => {
  const db = readDb()
  const holding = { id: uuidv4(), ...req.body }
  db.holdings.push(holding)
  writeDb(db)
  res.status(201).json(holding)
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

// --- Start ---

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`)
})
