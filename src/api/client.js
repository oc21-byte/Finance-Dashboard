import { logEvent } from '../utils/diagnostics.js'

const BASE = '/api'

// Carries the server's own error text and status alongside the message, so a failure can be
// diagnosed without re-running it against the network tab.
export class ApiError extends Error {
  constructor(message, { method, path, status, body }) {
    super(message)
    this.name = 'ApiError'
    this.method = method
    this.path = path
    this.status = status
    this.body = body
    this.serverMessage = body?.error
    this.errorId = body?.errorId
  }
}

async function request(method, path, body) {
  const startedAt = Date.now()
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    logEvent('api', `${method} ${path} → network error (${Date.now() - startedAt}ms)`)
    throw new ApiError(err.message || 'Network request failed', { method, path })
  }

  logEvent('api', `${method} ${path} → ${res.status} (${Date.now() - startedAt}ms)`)

  if (!res.ok) {
    const errBody = await res.json().catch(() => null)
    throw new ApiError(
      errBody?.error || `${method} ${path} → ${res.status}`,
      { method, path, status: res.status, body: errBody },
    )
  }
  return res.json()
}

export const api = {
  transactions: {
    list: () => request('GET', '/transactions'),
    create: (data) => request('POST', '/transactions', data),
    batch: (data) => request('POST', '/transactions/batch', data),
    update: (id, data) => request('PUT', `/transactions/${id}`, data),
    remove: (id) => request('DELETE', `/transactions/${id}`),
  },
  holdings: {
    list: () => request('GET', '/holdings'),
    create: (data) => request('POST', '/holdings', data),
    update: (id, data) => request('PUT', `/holdings/${id}`, data),
    remove: (id) => request('DELETE', `/holdings/${id}`),
    removePurchase: (holdingId, purchaseId) => request('DELETE', `/holdings/${holdingId}/purchases/${purchaseId}`),
  },
  goals: {
    list: () => request('GET', '/goals'),
    create: (data) => request('POST', '/goals', data),
    update: (id, data) => request('PUT', `/goals/${id}`, data),
    remove: (id) => request('DELETE', `/goals/${id}`),
    sources: () => request('GET', '/goal-sources'),
    contributionRate: () => request('GET', '/contribution-rate'),
  },
  creditCardTransactions: {
    list: () => request('GET', '/credit-card-transactions'),
    create: (data) => request('POST', '/credit-card-transactions', data),
    batch: (data) => request('POST', '/credit-card-transactions/batch', data),
    update: (id, data) => request('PUT', `/credit-card-transactions/${id}`, data),
    remove: (id) => request('DELETE', `/credit-card-transactions/${id}`),
  },
  savingsAccounts: {
    list:   ()         => request('GET',    '/savings-accounts'),
    create: (data)     => request('POST',   '/savings-accounts', data),
    update: (id, data) => request('PUT',    `/savings-accounts/${id}`, data),
    remove: (id)       => request('DELETE', `/savings-accounts/${id}`),
  },
  prices: {
    get: (tickers) => request('GET', `/prices?tickers=${tickers.join(',')}`),
  },
  settings: {
    get: () => request('GET', '/settings'),
    update: (data) => request('PUT', '/settings', data),
  },
  categories: {
    list: () => request('GET', '/categories'),
    create: (data) => request('POST', '/categories', data),
    remove: (name) => request('DELETE', `/categories/${encodeURIComponent(name)}`),
  },
  monthlyFinancials: {
    get: () => request('GET', '/monthly-financials'),
  },
  netWorth: {
    snapshot: () => request('POST', '/net-worth-snapshot'),
    history:  () => request('GET',  '/net-worth-history'),
    backfill: () => request('POST', '/net-worth-backfill'),
  },
  demoMode: {
    get: () => request('GET', '/demo-mode'),
  },
  uploadHistory: {
    list:   ()     => request('GET',    '/upload-history'),
    create: (data) => request('POST',   '/upload-history', data),
    remove: (id)   => request('DELETE', `/upload-history/${id}`),
  },
  // The last generated Spend Analyzer insights and their chat. Written by the LLM routes, so
  // there is no create here — only read and clear.
  spendInsights: {
    get:   () => request('GET',    '/spend-insights'),
    clear: () => request('DELETE', '/spend-insights'),
  },
  shutdown: () => request('POST', '/shutdown'),
  llm: {
    insights: (payload) => request('POST', '/llm/insights', payload),
    goalAnalysis: (payload) => request('POST', '/llm/goal-analysis', payload),
    categorize: (transactions) => request('POST', '/llm/categorize', { transactions }),
    spendInsights: (period) => request('POST', '/llm/spend-insights', { period }),
    spendChat: (period, messages) => request('POST', '/llm/spend-chat', { period, messages }),
    dashboardChat: (messages) => request('POST', '/llm/dashboard-chat', { messages }),
    goalChat: (goalId, messages) => request('POST', '/llm/goal-chat', { goalId, messages }),
    budgetBuilder: (payload) => request('POST', '/llm/budget-builder', payload),
    detectColumns: (headers, samples) => request('POST', '/llm/detect-columns', { headers, samples }),
    extractRows: (rows, statementType) => request('POST', '/llm/extract-rows', { rows, statementType }),
  },
}
