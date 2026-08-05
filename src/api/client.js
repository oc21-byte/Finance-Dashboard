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

function scopeBody(scope) {
  return typeof scope === 'string' || !scope ? { period: scope || 'all' } : scope
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
  factoryReset: () => request('POST', '/factory-reset'),
  categories: {
    list: () => request('GET', '/categories'),
    create: (data) => request('POST', '/categories', data),
    remove: (name) => request('DELETE', `/categories/${encodeURIComponent(name)}`),
  },
  monthlyFinancials: {
    get: () => request('GET', '/monthly-financials'),
  },
  // Route paths keep the `net-worth` spelling even though the UI calls the metric "liquid net
  // worth" — they are persisted contracts, renamed nowhere. `rebuild` is version-guarded server
  // side, so calling it on every mount is safe and runs at most once per shape change.
  netWorth: {
    snapshot: () => request('POST', '/net-worth-snapshot'),
    history:  () => request('GET',  '/net-worth-history'),
    backfill: () => request('POST', '/net-worth-backfill'),
    rebuild:  () => request('POST', '/net-worth-rebuild'),
  },
  // Chequing is derived from the ledger, so the UI has to say how fresh the figure is: statements
  // lag by weeks, and the balance is only knowable to the last one plus any reconciliation since.
  cashStatus: () => request('GET', '/cash-status'),
  demoMode: {
    get: () => request('GET', '/demo-mode'),
  },
  uploadHistory: {
    list:   ()     => request('GET',    '/upload-history'),
    create: (data) => request('POST',   '/upload-history', data),
    remove: (id)   => request('DELETE', `/upload-history/${id}`),
  },
  // The last generated insights and their chat, one record per tab. Written by the LLM routes, so
  // there is no create here — only read and clear.
  spendInsights: {
    get:   () => request('GET',    '/spend-insights'),
    clear: () => request('DELETE', '/spend-insights'),
  },
  financeInsights: {
    get:   () => request('GET',    '/finance-insights'),
    clear: () => request('DELETE', '/finance-insights'),
  },
  dashboardInsights: {
    get:   () => request('GET',    '/dashboard-insights'),
    clear: () => request('DELETE', '/dashboard-insights'),
  },
  shutdown: () => request('POST', '/shutdown'),
  llm: {
    goalAnalysis: (payload) => request('POST', '/llm/goal-analysis', payload),
    categorize: (transactions) => request('POST', '/llm/categorize', { transactions }),
    // `scope` is either a bare period string ('all' | 'YYYY-MM') or a page scope,
    // { period, from, to, filters, periodLabel } — a rolling range can't be a date prefix.
    // The filter vocabularies differ per tab; the server treats them as opaque.
    spendInsights: (scope) => request('POST', '/llm/spend-insights', scopeBody(scope)),
    spendChat: (scope, messages) => request('POST', '/llm/spend-chat', { ...scopeBody(scope), messages }),
    financeInsights: (scope) => request('POST', '/llm/finance-insights', scopeBody(scope)),
    financeChat: (scope, messages) => request('POST', '/llm/finance-chat', { ...scopeBody(scope), messages }),
    dashboardInsights: (scope) => request('POST', '/llm/dashboard-insights', scopeBody(scope)),
    dashboardChat: (scope, messages) => request('POST', '/llm/dashboard-chat', { ...scopeBody(scope), messages }),
    goalChat: (goalId, messages) => request('POST', '/llm/goal-chat', { goalId, messages }),
    budgetBuilder: (payload) => request('POST', '/llm/budget-builder', payload),
    detectColumns: (headers, samples) => request('POST', '/llm/detect-columns', { headers, samples }),
    extractRows: (rows, statementType) => request('POST', '/llm/extract-rows', { rows, statementType }),
  },
}
