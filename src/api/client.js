const BASE = '/api'

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
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
  netWorth: {
    snapshot: () => request('POST', '/net-worth-snapshot'),
    history:  () => request('GET',  '/net-worth-history'),
  },
  llm: {
    insights: (payload) => request('POST', '/llm/insights', payload),
    goalAnalysis: (payload) => request('POST', '/llm/goal-analysis', payload),
    categorize: (transactions) => request('POST', '/llm/categorize', { transactions }),
    spendInsights: (period) => request('POST', '/llm/spend-insights', { period }),
    spendChat: (period, messages) => request('POST', '/llm/spend-chat', { period, messages }),
    dashboardChat: (messages) => request('POST', '/llm/dashboard-chat', { messages }),
    goalChat: (goalId, messages) => request('POST', '/llm/goal-chat', { goalId, messages }),
    budgetBuilder: (payload) => request('POST', '/llm/budget-builder', payload),
  },
}
