import { normalizeDescription } from '../src/utils/duplicates.js'
import { detectRecurring } from '../src/utils/recurring.js'
import { formatUsd, normalizeUsdText } from './currencyFormatting.js'

const FACT_METRICS = new Set([
  'spend', 'credits', 'transactions', 'recurring', 'income', 'expenses', 'headroom',
  'savings_target', 'financial_pace', 'profile', 'budget',
])
const FACT_OPERATIONS = new Set(['sum', 'count', 'average', 'share', 'largest', 'smallest', 'list', 'compare', 'get', 'explain'])
const QUERY_SCOPES = new Set(['insight', 'profile', 'financial'])
const COMPARISON_DIMENSIONS = new Set(['category', 'merchant', 'card', 'period'])
const MAX_CLARIFICATION_CHARS = 300
const MAX_ADVICE_CHARS = 1200
const MAX_MESSAGE_CHARS = 2000
const MAX_CONTEXT_MESSAGES = 12

const DEFAULT_GUIDED_OPTIONS = [
  { id: '1', key: 'category_patterns', title: 'Category patterns', prompt: 'What patterns stand out across my spending categories?' },
  { id: '2', key: 'merchant_habits', title: 'Merchant habits', prompt: 'What do my merchant habits reveal?' },
  { id: '3', key: 'anomalies_opportunities', title: 'Anomalies & opportunities', prompt: 'Show me unusual spending and realistic opportunities to improve.' },
]

function formatMoney(value) {
  return formatUsd(Number(value) || 0)
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm
}

function stripJsonFence(text) {
  return String(text ?? '').trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
}

function validateModelPlainText(value, label, maxChars) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`AI ${label} response was empty`)
  if (text.length > maxChars) throw new Error(`AI ${label} response exceeds ${maxChars} characters`)
  if (/`/.test(text) || /<\/?[a-z][^>]*>/i.test(text)) throw new Error(`AI ${label} response must be plain text`)
  return text
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) throw new Error('Spend chat messages must be an array')
  return messages.map(message => {
    if (!['user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') {
      throw new Error('Spend chat messages must use user or assistant roles with text content')
    }
    const content = message.content.trim()
    if (!content) throw new Error('Spend chat messages cannot be empty')
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new Error(`Spend chat messages cannot exceed ${MAX_MESSAGE_CHARS} characters`)
    }
    return { role: message.role, content }
  }).slice(-MAX_CONTEXT_MESSAGES)
}

function normalizedText(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function rowsInScope(rows, scope) {
  if (!scope) return rows.filter(row => validDate(row.date))
  return rows.filter(row => {
    if (!validDate(row.date)) return false
    if (scope.from && row.date < scope.from) return false
    if (scope.to && row.date > scope.to) return false
    const filters = scope.filters ?? {}
    if (filters.categories?.length && !filters.categories.includes(row.category || 'Other')) return false
    if (filters.cards?.length && !filters.cards.includes(row.source)) return false
    if (filters.merchants?.length && !filters.merchants.includes(row.description)) return false
    return true
  })
}

function scopeLabel(scope, fallback) {
  return scope?.label || fallback || 'the stored analysis period'
}

function withBasis(answer, label) {
  return `${answer} Based on ${label}.`
}

function listSentence(items) {
  if (!items.length) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}

function guidedCategoryReply(analysis, label) {
  const facts = analysis.scopedFacts
  if (!facts.txCount) return withBasis('There are no purchases in this scope to analyze by category.', label)
  const leaders = facts.categories.slice(0, 3)
  const descriptions = leaders.map(category =>
    `${category.name} at ${formatMoney(category.amount)} (${Math.round(category.share * 100)}%)`
  )
  const combined = Math.round(leaders.reduce((sum, category) => sum + category.share, 0) * 100)
  return withBasis(
    `${leaders[0].name} was the largest category. The leading categories were ${listSentence(descriptions)}; together they represented ${combined}% of ${formatMoney(facts.totalSpend)} in spending.`,
    label,
  )
}

function guidedMerchantReply(analysis, label) {
  const facts = analysis.scopedFacts
  if (!facts.txCount) return withBasis('There are no purchases in this scope to analyze by merchant.', label)
  const leaders = facts.merchants.slice(0, 3)
  const descriptions = leaders.map(merchant =>
    `${merchant.name} at ${formatMoney(merchant.amount)} across ${merchant.visits} ${plural(merchant.visits, 'purchase')}`
  )
  const repeatLeaders = leaders.filter(merchant => merchant.visits > 1).length
  const habit = repeatLeaders
    ? `${repeatLeaders} of these leading merchants appeared more than once.`
    : 'None of these leading merchants appeared more than once.'
  return withBasis(`Your leading merchants were ${listSentence(descriptions)}. ${habit}`, label)
}

function guidedAnomalyReply(analysis, label) {
  const facts = analysis.scopedFacts
  if (!facts.txCount) return withBasis('There are no purchases in this scope to check for anomalies.', label)
  if (facts.outliers.length) {
    const outliers = facts.outliers.slice(0, 3).map(item =>
      `${formatMoney(item.amount)} at ${item.description} on ${item.date}`
    )
    return withBasis(
      `${facts.outliers.length} statistically unusual ${plural(facts.outliers.length, 'purchase')} stood out: ${listSentence(outliers)}. Review these first if you do not recognize them or want to understand the period's largest spikes.`,
      label,
    )
  }
  const largest = facts.largestTransactions[0]
  const largestText = largest
    ? `The largest purchase was ${formatMoney(largest.amount)} at ${largest.description} on ${largest.date}.`
    : ''
  return withBasis(`No purchases crossed the statistical outlier threshold. ${largestText}`.trim(), label)
}

function guidedReply(question, analysis, storedInsights) {
  const normalized = normalizedText(question)
  const options = storedInsights?.exploreOptions?.length ? storedInsights.exploreOptions : DEFAULT_GUIDED_OPTIONS
  const match = options.find(option => [option.id, option.key, option.title, option.prompt]
    .some(value => normalizedText(value) === normalized))
  if (!match) return null
  const label = scopeLabel(analysis.scopes.insight, storedInsights?.periodLabel)
  if (match.id === '1' || match.key === 'category_patterns') return guidedCategoryReply(analysis, label)
  if (match.id === '2' || match.key === 'merchant_habits') return guidedMerchantReply(analysis, label)
  return guidedAnomalyReply(analysis, label)
}

function parseIntent(rawText) {
  const parsed = JSON.parse(stripJsonFence(rawText))
  if (parsed?.mode === 'advice') return { mode: 'advice' }
  if (parsed?.mode === 'clarify') {
    const question = validateModelPlainText(parsed.question, 'clarification', MAX_CLARIFICATION_CHARS)
    return { mode: 'clarify', question }
  }
  if (parsed?.mode !== 'fact' || !parsed.query || typeof parsed.query !== 'object') {
    throw new Error('Spend chat intent must be fact, advice, or clarify')
  }

  const query = parsed.query
  if (!FACT_METRICS.has(query.metric)) throw new Error(`Unsupported spend-chat metric: ${query.metric}`)
  if (!FACT_OPERATIONS.has(query.operation)) throw new Error(`Unsupported spend-chat operation: ${query.operation}`)
  if (query.scope && !QUERY_SCOPES.has(query.scope)) throw new Error(`Unsupported spend-chat scope: ${query.scope}`)

  const filters = {}
  for (const key of ['category', 'merchant', 'card', 'creditKind', 'from', 'to']) {
    if (typeof query.filters?.[key] === 'string' && query.filters[key].trim()) filters[key] = query.filters[key].trim()
  }
  if (filters.from && !validDate(filters.from)) throw new Error('Spend-chat from date must use YYYY-MM-DD')
  if (filters.to && !validDate(filters.to)) throw new Error('Spend-chat to date must use YYYY-MM-DD')
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new Error('Spend-chat from date must not be after the to date')
  }

  let compare = null
  if (query.operation === 'compare') {
    const { dimension, left, right } = query.compare ?? {}
    if (!COMPARISON_DIMENSIONS.has(dimension) || typeof left !== 'string' || typeof right !== 'string' || !left.trim() || !right.trim()) {
      throw new Error('Spend-chat comparison requires a supported dimension, left, and right')
    }
    compare = { dimension, left: left.trim(), right: right.trim() }
  }

  return {
    mode: 'fact',
    query: {
      metric: query.metric,
      operation: query.operation,
      scope: query.scope ?? null,
      filters,
      compare,
      averageBy: query.averageBy === 'month' ? 'month' : 'transaction',
      limit: Math.min(10, Math.max(1, Number(query.limit) || 5)),
    },
  }
}

function candidateMap(rows, kind) {
  const map = new Map()
  for (const row of rows) {
    let key
    let label
    if (kind === 'category') {
      label = row.category || 'Other'
      key = normalizedText(label)
    } else if (kind === 'merchant') {
      label = row.description || 'Unknown'
      key = normalizeDescription(label)
    } else {
      label = row.source || 'Unknown'
      key = normalizedText(label)
    }
    if (key && !map.has(key)) map.set(key, label)
  }
  return map
}

function resolveCandidate(requested, rows, kind) {
  if (!requested) return { key: null, label: null }
  const requestedKey = kind === 'merchant' ? normalizeDescription(requested) : normalizedText(requested)
  const candidates = candidateMap(rows, kind)
  if (candidates.has(requestedKey)) return { key: requestedKey, label: candidates.get(requestedKey) }
  const matches = [...candidates.entries()].filter(([key]) => key.includes(requestedKey) || requestedKey.includes(key))
  if (matches.length === 1) return { key: matches[0][0], label: matches[0][1] }
  if (!matches.length) {
    return { error: `I could not find ${kind === 'merchant' ? 'a merchant' : `a ${kind}`} matching “${requested}” in this analysis period.` }
  }
  return {
    error: `I found several ${kind} matches for “${requested}”: ${matches.slice(0, 5).map(([, label]) => label).join(', ')}. Which one did you mean?`,
  }
}

function filterCardRows(baseRows, filters) {
  const category = resolveCandidate(filters.category, baseRows, 'category')
  if (category.error) return category
  const merchant = resolveCandidate(filters.merchant, baseRows, 'merchant')
  if (merchant.error) return merchant
  const card = resolveCandidate(filters.card, baseRows, 'card')
  if (card.error) return card

  const rows = baseRows.filter(row => {
    if (filters.from && row.date < filters.from) return false
    if (filters.to && row.date > filters.to) return false
    if (category.key && normalizedText(row.category || 'Other') !== category.key) return false
    if (merchant.key && normalizeDescription(row.description) !== merchant.key) return false
    if (card.key && normalizedText(row.source || 'Unknown') !== card.key) return false
    if (filters.creditKind && normalizedText(row.creditKind || 'credit').replaceAll(' ', '') !== normalizedText(filters.creditKind).replaceAll(' ', '')) return false
    return true
  })
  return { rows, labels: { category: category.label, merchant: merchant.label, card: card.label } }
}

function filteredBasis(baseLabel, filters) {
  if (!filters.from && !filters.to) return baseLabel
  const dateText = filters.from && filters.to
    ? `${filters.from} to ${filters.to}`
    : filters.from ? `dates from ${filters.from}` : `dates through ${filters.to}`
  return `${dateText}, within ${baseLabel}`
}

function transactionList(rows, metric, operation, limit) {
  const sorted = [...rows].sort((a, b) => {
    const amountDiff = Math.abs(Number(b.amount)) - Math.abs(Number(a.amount))
    return operation === 'smallest' ? -amountDiff : amountDiff
  })
  const chosen = (operation === 'largest' || operation === 'smallest') ? sorted.slice(0, 1) : sorted.slice(0, limit)
  return chosen.map(row => `${formatMoney(Math.abs(Number(row.amount)))} at ${row.description || 'Unknown'} on ${row.date}`)
}

function monthCount(scope, filters) {
  const from = filters.from && (!scope?.from || filters.from > scope.from) ? filters.from : scope?.from
  const to = filters.to && (!scope?.to || filters.to < scope.to) ? filters.to : scope?.to
  if (!from || !to || from > to) return 0
  const [fromYear, fromMonth] = from.slice(0, 7).split('-').map(Number)
  const [toYear, toMonth] = to.slice(0, 7).split('-').map(Number)
  return Math.max(0, (toYear - fromYear) * 12 + toMonth - fromMonth + 1)
}

function answerCardQuery(query, context) {
  const baseScope = query.scope === 'profile' ? context.profileScope : context.insightScope
  const baseRows = query.scope === 'profile' ? context.profileRows : context.insightRows
  const basis = filteredBasis(scopeLabel(baseScope, context.storedInsights?.periodLabel), query.filters)

  if (query.operation === 'compare') return answerComparison(query, baseRows, basis)

  const filtered = filterCardRows(baseRows, query.filters)
  if (filtered.error) return withBasis(filtered.error, basis)
  let rows = filtered.rows
  if (query.metric === 'spend') rows = rows.filter(row => Number(row.amount) < 0)
  else if (query.metric === 'credits') rows = rows.filter(row => Number(row.amount) > 0)

  if (!rows.length) return withBasis('No matching transactions were found.', basis)
  const noun = query.metric === 'credits' ? 'credit' : query.metric === 'transactions' ? 'transaction' : 'purchase'
  const total = rows.reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0)
  if (query.operation === 'sum') {
    const verb = query.metric === 'credits' ? 'You received' : 'You spent'
    return withBasis(`${verb} ${formatMoney(total)} across ${rows.length} matching ${plural(rows.length, noun)}.`, basis)
  }
  if (query.operation === 'count') {
    return withBasis(`There ${rows.length === 1 ? 'was' : 'were'} ${rows.length} matching ${plural(rows.length, noun)}.`, basis)
  }
  if (query.operation === 'average') {
    if (query.averageBy === 'month') {
      const months = monthCount(baseScope, query.filters)
      if (!months) return withBasis('There is no complete date range available for a monthly average.', basis)
      return withBasis(`Average matching spending was ${formatMoney(total / months)} per month across ${months} ${plural(months, 'month')}.`, basis)
    }
    return withBasis(`The average matching ${noun} was ${formatMoney(total / rows.length)} across ${rows.length} ${plural(rows.length, noun)}.`, basis)
  }
  if (query.operation === 'share') {
    const denominator = filterCardRows(baseRows, { from: query.filters.from, to: query.filters.to })
    const allSpend = denominator.rows
      .filter(row => Number(row.amount) < 0)
      .reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0)
    const share = allSpend > 0 ? Math.round(total / allSpend * 100) : 0
    return withBasis(`Matching spending was ${formatMoney(total)}, or ${share}% of spending in this period.`, basis)
  }
  if (['largest', 'smallest', 'list'].includes(query.operation)) {
    const items = transactionList(rows, query.metric, query.operation, query.limit)
    const prefix = query.operation === 'largest' ? `The largest matching ${noun} was`
      : query.operation === 'smallest' ? `The smallest matching ${noun} was`
        : `The leading matching ${plural(items.length, noun)} were`
    return withBasis(`${prefix} ${listSentence(items)}.`, basis)
  }
  return withBasis(`I can calculate the total, count, average, largest, smallest, or a short list for matching ${plural(rows.length, noun)}.`, basis)
}

function answerComparison(query, baseRows, basis) {
  const { dimension, left, right } = query.compare
  if (dimension === 'period') {
    if (!/^\d{4}-\d{2}$/.test(left) || !/^\d{4}-\d{2}$/.test(right)) {
      return withBasis('Period comparisons need two months in YYYY-MM format.', basis)
    }
    const filtered = filterCardRows(baseRows, query.filters)
    if (filtered.error) return withBasis(filtered.error, basis)
    const spendForMonth = month => filtered.rows
      .filter(row => Number(row.amount) < 0 && row.date.startsWith(month))
      .reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0)
    const leftTotal = spendForMonth(left)
    const rightTotal = spendForMonth(right)
    const difference = Math.abs(leftTotal - rightTotal)
    const comparison = leftTotal === rightTotal
      ? 'They were equal.'
      : `${leftTotal > rightTotal ? left : right} was higher by ${formatMoney(difference)}.`
    return withBasis(`${left} was ${formatMoney(leftTotal)} and ${right} was ${formatMoney(rightTotal)}. ${comparison}`, basis)
  }
  const leftFilter = filterCardRows(baseRows, { ...query.filters, [dimension]: left })
  if (leftFilter.error) return withBasis(leftFilter.error, basis)
  const rightFilter = filterCardRows(baseRows, { ...query.filters, [dimension]: right })
  if (rightFilter.error) return withBasis(rightFilter.error, basis)
  const spendTotal = rows => rows
    .filter(row => Number(row.amount) < 0)
    .reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0)
  const leftTotal = spendTotal(leftFilter.rows)
  const rightTotal = spendTotal(rightFilter.rows)
  const difference = Math.abs(leftTotal - rightTotal)
  const comparison = leftTotal === rightTotal
    ? 'They were equal.'
    : `${leftTotal > rightTotal ? leftFilter.labels[dimension] : rightFilter.labels[dimension]} was higher by ${formatMoney(difference)}.`
  return withBasis(
    `${leftFilter.labels[dimension]} was ${formatMoney(leftTotal)} and ${rightFilter.labels[dimension]} was ${formatMoney(rightTotal)}. ${comparison}`,
    basis,
  )
}

function answerRecurringQuery(query, context) {
  const to = context.profileScope?.to
  const history = context.cardTransactions.filter(row => validDate(row.date) && (!to || row.date <= to))
  const recurring = detectRecurring(history, { activeTo: to })
  const basis = scopeLabel(context.profileScope, 'the Spend Style period')
  if (!recurring.count) return withBasis('No active recurring charge patterns were detected.', basis)
  if (query.operation === 'count') {
    return withBasis(`${recurring.count} active recurring ${plural(recurring.count, 'charge pattern')} were detected.`, basis)
  }
  if (query.operation === 'list') {
    const items = recurring.series.slice(0, query.limit).map(series =>
      `${series.label} at about ${formatMoney(series.monthly)} per month (${series.cadence})`
    )
    return withBasis(`The largest recurring patterns were ${listSentence(items)}.`, basis)
  }
  return withBasis(
    `Detected recurring charges total about ${formatMoney(recurring.monthlyTotal)} per month across ${recurring.count} active ${plural(recurring.count, 'pattern')}.`,
    basis,
  )
}

function answerProfileQuery(context) {
  const profile = context.storedInsights?.profile ?? context.analysis.profile
  const basis = scopeLabel(context.profileScope, 'the Spend Style period')
  if (!profile?.traits?.length) return withBasis('There is not enough card activity to explain a Spend Style yet.', basis)
  const traits = profile.traits.map(trait => `${trait.label}: ${normalizeUsdText(trait.evidence)}`)
  return withBasis(`Your Spend Style is ${profile.name}. ${listSentence(traits)}`, basis)
}

function answerFinancialQuery(query, context) {
  const pace = context.storedInsights?.financialPace ?? context.analysis.financialPace
  const basis = scopeLabel(context.financialScope, 'the Financial Pace period')
  if (pace.status === 'not_enough_data') return withBasis(normalizeUsdText(pace.evidence.join(' ')), basis)
  const facts = {
    income: ['Average monthly income', pace.income],
    expenses: ['Average monthly expenses', pace.expenses],
    headroom: ['Average monthly headroom', pace.headroom],
    savings_target: ['Monthly savings target', pace.savingsTarget],
  }
  if (query.metric === 'financial_pace') {
    return withBasis(`Your Financial Pace is ${pace.label}. ${normalizeUsdText(pace.evidence.join(' '))}`, basis)
  }
  const [label, value] = facts[query.metric]
  return withBasis(`${label} was ${formatMoney(value)}.`, basis)
}

function answerBudgetQuery(query, context) {
  const budgets = context.categoryBudgets
  const basis = 'your current budget settings'
  const requested = query.filters.category
  if (!requested) {
    return withBasis('Which category budget did you want to check? You can also ask for your savings target.', basis)
  }
  const keys = Object.keys(budgets)
  const requestedKey = normalizedText(requested)
  const matches = keys.filter(key => {
    const normalized = normalizedText(key)
    return normalized === requestedKey || normalized.includes(requestedKey) || requestedKey.includes(normalized)
  })
  if (!matches.length) return withBasis(`No monthly category budget matching “${requested}” is configured.`, basis)
  if (matches.length > 1) return withBasis(`I found several budget matches: ${matches.join(', ')}. Which one did you mean?`, basis)
  return withBasis(`The monthly ${matches[0]} budget is ${formatMoney(budgets[matches[0]])}.`, basis)
}

function executeFactQuery(query, context) {
  if (['spend', 'credits', 'transactions'].includes(query.metric)) return answerCardQuery(query, context)
  if (query.metric === 'recurring') return answerRecurringQuery(query, context)
  if (query.metric === 'profile') return answerProfileQuery(context)
  if (query.metric === 'budget') return answerBudgetQuery(query, context)
  return answerFinancialQuery(query, context)
}

function intentPrompt(context) {
  const conversation = context.messages.slice(-6).map(message => ({ role: message.role, content: message.content }))
  const categories = context.analysis.scopedFacts.categories.map(item => item.name)
  const merchants = context.analysis.scopedFacts.merchants.slice(0, 50).map(item => item.name)
  const cards = [...new Set(context.insightRows.map(row => row.source).filter(Boolean))]
  return {
    system: 'Classify a Spend Analyzer chat question into a strict deterministic query or advisory mode. Respond with valid JSON only.',
    user: `Decide whether the latest user message asks for a fact with one ledger-computable answer or for interpretation/advice.

Conversation:
${JSON.stringify(conversation, null, 2)}

Available names in the stored insight scope:
Categories: ${JSON.stringify(categories)}
Merchants: ${JSON.stringify(merchants)}
Cards: ${JSON.stringify(cards)}

For an exact question, return:
{"mode":"fact","query":{"metric":"spend|credits|transactions|recurring|income|expenses|headroom|savings_target|financial_pace|profile|budget","operation":"sum|count|average|share|largest|smallest|list|compare|get|explain","scope":"insight|profile|financial","filters":{"category":"optional","merchant":"optional","card":"optional","creditKind":"optional","from":"optional YYYY-MM-DD","to":"optional YYYY-MM-DD"},"averageBy":"transaction|month","compare":{"dimension":"category|merchant|card|period","left":"first name or YYYY-MM","right":"second name or YYYY-MM"},"limit":5}}

For advice, trade-offs, recommendations, causes, predictions, or subjective interpretation, return:
{"mode":"advice"}

If the request itself is too unclear to choose a metric, return:
{"mode":"clarify","question":"one short clarification question"}

Rules:
- Use fact mode for totals, counts, averages, spending shares, largest/smallest purchases, lists, comparisons, recurring charges, budgets, income, expenses, headroom, savings target, Financial Pace, and why the user received a Spend Style.
- Use insight scope for ordinary card-spending questions, profile scope for recurring or Spend Style questions, and financial scope for income/budget/pace questions.
- Use operation share for questions asking what percentage of spending matched a filter.
- For average monthly spending, set averageBy to month; otherwise use transaction.
- Comparisons use metric spend, operation compare, and the compare object. Normalize month comparisons to YYYY-MM and use dimension period.
- Preserve category, merchant and card names from the user's wording. The server resolves them and handles ambiguity.
- Omit unused filter and compare fields.
- Never answer the question or calculate anything.

Valid JSON only.`,
    maxTokens: 320,
  }
}

function advicePrompt(context) {
  const profile = context.storedInsights?.profile ?? context.analysis.profile
  const pace = context.storedInsights?.financialPace ?? context.analysis.financialPace
  const facts = context.analysis.scopedFacts
  const source = {
    insightPeriod: scopeLabel(context.insightScope, context.storedInsights?.periodLabel),
    profile: {
      name: profile?.name,
      traits: profile?.traits?.map(trait => ({ label: trait.label, evidence: normalizeUsdText(trait.evidence) })),
      confidence: profile?.confidence,
    },
    financialPace: {
      status: pace?.status,
      label: pace?.label,
      income: pace?.income == null ? null : formatUsd(pace.income),
      incomeSource: pace?.incomeSource,
      expenses: pace?.expenses == null ? null : formatUsd(pace.expenses),
      headroom: pace?.headroom == null ? null : formatUsd(pace.headroom),
      savingsTarget: pace?.savingsTarget == null ? null : formatUsd(pace.savingsTarget),
      monthsCovered: pace?.monthsCovered,
      evidence: pace?.evidence?.map(normalizeUsdText),
      scope: pace?.scope,
    },
    scopedSpending: {
      totalSpend: formatUsd(facts.totalSpend),
      txCount: facts.txCount,
      categories: facts.categories.slice(0, 10).map(item => ({ ...item, amount: formatUsd(item.amount) })),
      merchants: facts.merchants.slice(0, 10).map(item => ({ ...item, amount: formatUsd(item.amount) })),
      largestTransactions: facts.largestTransactions.map(item => ({ ...item, amount: formatUsd(item.amount) })),
      outliers: facts.outliers.map(item => ({ ...item, amount: formatUsd(item.amount) })),
      credits: {
        ...facts.credits,
        total: formatUsd(facts.credits.total),
        byKind: facts.credits.byKind.map(item => ({ ...item, amount: formatUsd(item.amount) })),
      },
    },
  }
  return {
    system: `You are a practical personal finance assistant answering an advisory question about a stored Spend Analyzer result.

${JSON.stringify(source, null, 2)}

Use only the supplied facts. Do not perform arithmetic or invent causes, intentions, transactions, budgets or amounts. Be constructive and non-shaming, but do not minimize Over Pace or other financial strain. Answer in 2–4 concise sentences, plain text only. State which supplied period your advice refers to when relevant.`,
    maxTokens: 512,
  }
}

/**
 * Binds a chat request to one persisted insight record. The stored scope wins over the screen's
 * current scope, and a reply may only be appended if that same generation still exists after the
 * model call finishes.
 */
export function createSpendChatBinding({ record = null, period, requestScope }) {
  const storedInsights = record?.period === period ? record : null
  const identity = storedInsights
    ? {
        period: storedInsights.period,
        generatedAt: storedInsights.generatedAt ?? null,
        analysisVersion: storedInsights.analysisVersion ?? 1,
      }
    : null

  return {
    storedInsights,
    scope: storedInsights ? (storedInsights.scope ?? storedInsights.period) : requestScope,
    canAppend(currentRecord) {
      if (!identity || currentRecord?.period !== identity.period) return false
      return (currentRecord.generatedAt ?? null) === identity.generatedAt
        && (currentRecord.analysisVersion ?? 1) === identity.analysisVersion
    },
  }
}

/**
 * Pure Spend Chat interface. Guided requests and validated fact intents return server-computed
 * replies. The caller uses `intentPrompt` only when language needs classification, and uses the
 * returned advisory prompt only for genuinely subjective questions.
 */
export function createSpendChatTurn({
  analysis,
  storedInsights = null,
  bankTransactions = [],
  cardTransactions = [],
  settings = {},
  messages = [],
}) {
  const safeMessages = validateMessages(messages)
  const latestUser = safeMessages.at(-1)
  if (latestUser?.role !== 'user') throw new Error('Spend chat requires the latest message to be from the user')

  const insightScope = analysis.scopes.insight
  const profileScope = storedInsights?.profileScope ?? analysis.scopes.profile
  const financialScope = storedInsights?.financialScope ?? analysis.scopes.financial
  const context = {
    analysis,
    storedInsights,
    bankTransactions,
    cardTransactions,
    categoryBudgets: settings?.categoryBudgets && typeof settings.categoryBudgets === 'object'
      ? settings.categoryBudgets
      : {},
    messages: safeMessages,
    insightScope,
    profileScope,
    financialScope,
    insightRows: rowsInScope(cardTransactions, insightScope),
    profileRows: rowsInScope(cardTransactions, profileScope),
  }
  const directReply = guidedReply(latestUser.content, analysis, storedInsights)

  return {
    userMessage: latestUser,
    directReply,
    intentPrompt: directReply ? null : intentPrompt(context),
    completeIntent(rawText) {
      const intent = parseIntent(rawText)
      if (intent.mode === 'clarify') return { type: 'reply', reply: intent.question }
      if (intent.mode === 'advice') {
        return { type: 'advice', prompt: { ...advicePrompt(context), messages: safeMessages } }
      }
      return { type: 'reply', reply: executeFactQuery(intent.query, context) }
    },
    completeAdvice(rawText) {
      return normalizeUsdText(validateModelPlainText(rawText, 'advisory', MAX_ADVICE_CHARS))
    },
  }
}
