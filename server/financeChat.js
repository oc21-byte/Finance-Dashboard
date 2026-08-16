import { formatUsd, normalizeUsdText } from './currencyFormatting.js'
import { createChatBinding } from './chatBinding.js'
import { stripJsonFence, validatePlainText } from './modelText.js'
import { matchesFinanceScope } from './financeAnalysis.js'
import { payeeOf, accountOf } from '../src/utils/financeAggregations.js'
import { bankFlowOf } from '../src/constants/financeRules.js'
import { advisorRole, financeSystemPrompt } from './appKnowledge.js'

// The bank-side allowlist. Deliberately NOT the card-side one from `spendChat.js`: there are no
// merchants, cards or categories on this ledger, and accepting those names would let the classifier
// route a question to a filter that can never match a row.
const FACT_METRICS = new Set([
  'income', 'expenses', 'net_cash', 'savings', 'investments', 'allocation', 'transactions',
  'duplicates', 'financial_pace', 'headroom', 'savings_target', 'destinations',
])
const FACT_OPERATIONS = new Set(['sum', 'count', 'average', 'share', 'largest', 'smallest', 'list', 'compare', 'get', 'explain'])
const QUERY_SCOPES = new Set(['insight', 'financial'])
const COMPARISON_DIMENSIONS = new Set(['payee', 'account', 'period'])
const FLOW_OF_METRIC = { income: 'income', expenses: 'expense', savings: 'savings', investments: 'investments' }

const MAX_CLARIFICATION_CHARS = 300
const MAX_ADVICE_CHARS = 1200
const MAX_MESSAGE_CHARS = 2000
const MAX_CONTEXT_MESSAGES = 12

const DEFAULT_GUIDED_OPTIONS = [
  { id: '1', key: 'cash_flow', title: 'Cash flow', prompt: 'How did money in compare with money out?' },
  { id: '2', key: 'where_it_went', title: 'Where it went', prompt: 'Where did most of my money go?' },
  { id: '3', key: 'saving_and_investing', title: 'Saving & investing', prompt: 'How much am I setting aside, and is it enough?' },
]

function formatMoney(value) {
  return formatUsd(Number(value) || 0)
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm
}

function normalizedText(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) throw new Error('Finance chat messages must be an array')
  return messages.map(message => {
    if (!['user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') {
      throw new Error('Finance chat messages must use user or assistant roles with text content')
    }
    const content = message.content.trim()
    if (!content) throw new Error('Finance chat messages cannot be empty')
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new Error(`Finance chat messages cannot exceed ${MAX_MESSAGE_CHARS} characters`)
    }
    return { role: message.role, content }
  }).slice(-MAX_CONTEXT_MESSAGES)
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

function guidedCashFlowReply(analysis, label) {
  const { cashflow } = analysis
  if (!cashflow.txCount) return withBasis('There is no bank activity in this scope to summarize.', label)
  const kept = cashflow.netCash >= 0
    ? `${formatMoney(cashflow.netCash)} stayed`
    : `you were short by ${formatMoney(Math.abs(cashflow.netCash))}`
  const share = cashflow.spendShareOfIncome === null
    ? ''
    : ` Spending took ${Math.round(cashflow.spendShareOfIncome * 100)}% of what came in.`
  return withBasis(
    `${formatMoney(cashflow.countedIncome)} came in and ${formatMoney(cashflow.expenses)} went out as spending, so ${kept}.${share}`,
    label,
  )
}

function guidedOutflowReply(analysis, label) {
  const { outflows, cashflow } = analysis
  if (!outflows.length) return withBasis('There is no spending in this scope to break down.', label)
  const leaders = outflows.slice(0, 3).map(row =>
    `${row.name} at ${formatMoney(row.amount)} (${Math.round(row.share * 100)}%)`)
  return withBasis(
    `Your largest destinations were ${listSentence(leaders)}, out of ${formatMoney(cashflow.expenses)} in spending. Savings and investment transfers are counted separately as allocation.`,
    label,
  )
}

function guidedAllocationReply(analysis, label) {
  const { cashflow, pace, destinations } = analysis
  if (cashflow.saved + cashflow.invested === 0) {
    return withBasis('No transfers to savings or investments appear in this scope.', label)
  }
  const share = cashflow.savedShareOfIncome === null
    ? ''
    : ` That is ${Math.round((cashflow.saved + cashflow.invested) / cashflow.countedIncome * 100)}% of income set aside.`
  const target = pace.status === 'not_enough_data' || !pace.savingsTarget
    ? ''
    : ` Against a ${formatMoney(pace.savingsTarget)} monthly target, savings transfers averaged ${formatMoney(pace.savingsContributions)}.`
  const unlinked = destinations.unassigned > 0
    ? ` ${formatMoney(destinations.unassigned)} of it is not linked to an account yet.`
    : ''
  return withBasis(
    `${formatMoney(cashflow.saved)} went to savings and ${formatMoney(cashflow.invested)} to investments.${share}${target}${unlinked}`,
    label,
  )
}

function guidedReply(question, analysis, storedInsights) {
  const normalized = normalizedText(question)
  const options = storedInsights?.exploreOptions?.length ? storedInsights.exploreOptions : DEFAULT_GUIDED_OPTIONS
  const match = options.find(option => [option.id, option.key, option.title, option.prompt]
    .some(value => normalizedText(value) === normalized))
  if (!match) return null
  const label = scopeLabel(analysis.scopes.insight, storedInsights?.periodLabel)
  if (match.id === '1' || match.key === 'cash_flow') return guidedCashFlowReply(analysis, label)
  if (match.id === '2' || match.key === 'where_it_went') return guidedOutflowReply(analysis, label)
  return guidedAllocationReply(analysis, label)
}

function parseIntent(rawText) {
  const parsed = JSON.parse(stripJsonFence(rawText))
  if (parsed?.mode === 'advice') return { mode: 'advice' }
  if (parsed?.mode === 'clarify') {
    const question = validatePlainText(parsed.question, 'clarification', MAX_CLARIFICATION_CHARS)
    return { mode: 'clarify', question }
  }
  if (parsed?.mode !== 'fact' || !parsed.query || typeof parsed.query !== 'object') {
    throw new Error('Finance chat intent must be fact, advice, or clarify')
  }

  const query = parsed.query
  if (!FACT_METRICS.has(query.metric)) throw new Error(`Unsupported finance-chat metric: ${query.metric}`)
  if (!FACT_OPERATIONS.has(query.operation)) throw new Error(`Unsupported finance-chat operation: ${query.operation}`)
  if (query.scope && !QUERY_SCOPES.has(query.scope)) throw new Error(`Unsupported finance-chat scope: ${query.scope}`)

  const filters = {}
  for (const key of ['payee', 'account', 'from', 'to']) {
    if (typeof query.filters?.[key] === 'string' && query.filters[key].trim()) filters[key] = query.filters[key].trim()
  }
  if (filters.from && !validDate(filters.from)) throw new Error('Finance-chat from date must use YYYY-MM-DD')
  if (filters.to && !validDate(filters.to)) throw new Error('Finance-chat to date must use YYYY-MM-DD')
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new Error('Finance-chat from date must not be after the to date')
  }

  let compare = null
  if (query.operation === 'compare') {
    const { dimension, left, right } = query.compare ?? {}
    if (!COMPARISON_DIMENSIONS.has(dimension) || typeof left !== 'string' || typeof right !== 'string' || !left.trim() || !right.trim()) {
      throw new Error('Finance-chat comparison requires a supported dimension, left, and right')
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
    const label = kind === 'payee' ? payeeOf(row) : accountOf(row)
    const key = normalizedText(label)
    if (key && !map.has(key)) map.set(key, label)
  }
  return map
}

function resolveCandidate(requested, rows, kind) {
  if (!requested) return { key: null, label: null }
  const requestedKey = normalizedText(requested)
  const candidates = candidateMap(rows, kind)
  if (candidates.has(requestedKey)) return { key: requestedKey, label: candidates.get(requestedKey) }
  const matches = [...candidates.entries()].filter(([key]) => key.includes(requestedKey) || requestedKey.includes(key))
  if (matches.length === 1) return { key: matches[0][0], label: matches[0][1] }
  if (!matches.length) {
    return { error: `I could not find ${kind === 'payee' ? 'a payee' : 'an account'} matching “${requested}” in this analysis period.` }
  }
  return {
    error: `I found several ${kind} matches for “${requested}”: ${matches.slice(0, 5).map(([, label]) => label).join(', ')}. Which one did you mean?`,
  }
}

function filterBankRows(baseRows, filters) {
  const payee = resolveCandidate(filters.payee, baseRows, 'payee')
  if (payee.error) return payee
  const account = resolveCandidate(filters.account, baseRows, 'account')
  if (account.error) return account

  const rows = baseRows.filter(row => {
    if (filters.from && row.date < filters.from) return false
    if (filters.to && row.date > filters.to) return false
    if (payee.key && normalizedText(payeeOf(row)) !== payee.key) return false
    if (account.key && normalizedText(accountOf(row)) !== account.key) return false
    return true
  })
  return { rows, labels: { payee: payee.label, account: account.label } }
}

function filteredBasis(baseLabel, filters) {
  if (!filters.from && !filters.to) return baseLabel
  const dateText = filters.from && filters.to
    ? `${filters.from} to ${filters.to}`
    : filters.from ? `dates from ${filters.from}` : `dates through ${filters.to}`
  return `${dateText}, within ${baseLabel}`
}

function transactionList(rows, operation, limit, noun) {
  const sorted = [...rows].sort((a, b) => {
    const amountDiff = Math.abs(Number(b.amount)) - Math.abs(Number(a.amount))
    return operation === 'smallest' ? -amountDiff : amountDiff
  })
  const chosen = (operation === 'largest' || operation === 'smallest') ? sorted.slice(0, 1) : sorted.slice(0, limit)
  return chosen.map(row => `${formatMoney(Math.abs(Number(row.amount)))} ${noun === 'deposit' ? 'from' : 'to'} ${payeeOf(row)} on ${row.date}`)
}

function monthCount(scope, filters) {
  const from = filters.from && (!scope?.from || filters.from > scope.from) ? filters.from : scope?.from
  const to = filters.to && (!scope?.to || filters.to < scope.to) ? filters.to : scope?.to
  if (!from || !to || from > to) return 0
  const [fromYear, fromMonth] = from.slice(0, 7).split('-').map(Number)
  const [toYear, toMonth] = to.slice(0, 7).split('-').map(Number)
  return Math.max(0, (toYear - fromYear) * 12 + toMonth - fromMonth + 1)
}

function nounFor(metric) {
  if (metric === 'income') return 'deposit'
  if (metric === 'savings' || metric === 'investments' || metric === 'allocation') return 'transfer'
  if (metric === 'transactions') return 'transaction'
  return 'payment'
}

function answerLedgerQuery(query, context) {
  const baseScope = context.insightScope
  const basis = filteredBasis(scopeLabel(baseScope, context.storedInsights?.periodLabel), query.filters)

  if (query.operation === 'compare') return answerComparison(query, context.insightRows, basis)

  const filtered = filterBankRows(context.insightRows, query.filters)
  if (filtered.error) return withBasis(filtered.error, basis)

  let rows = filtered.rows
  const flow = FLOW_OF_METRIC[query.metric]
  if (query.metric === 'allocation') {
    rows = rows.filter(row => ['savings', 'investments'].includes(bankFlowOf(row)))
  } else if (flow) {
    rows = rows.filter(row => bankFlowOf(row) === flow)
  }

  const noun = nounFor(query.metric)
  if (!rows.length) return withBasis('No matching transactions were found.', basis)

  const total = rows.reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0)
  if (query.operation === 'sum') {
    const verb = query.metric === 'income' ? 'You received'
      : query.metric === 'savings' || query.metric === 'investments' || query.metric === 'allocation' ? 'You set aside'
        : 'You spent'
    return withBasis(`${verb} ${formatMoney(total)} across ${rows.length} matching ${plural(rows.length, noun)}.`, basis)
  }
  if (query.operation === 'count') {
    return withBasis(`There ${rows.length === 1 ? 'was' : 'were'} ${rows.length} matching ${plural(rows.length, noun)}.`, basis)
  }
  if (query.operation === 'average') {
    if (query.averageBy === 'month') {
      const months = monthCount(baseScope, query.filters)
      if (!months) return withBasis('There is no complete date range available for a monthly average.', basis)
      return withBasis(`That averaged ${formatMoney(total / months)} per month across ${months} ${plural(months, 'month')}.`, basis)
    }
    return withBasis(`The average matching ${noun} was ${formatMoney(total / rows.length)} across ${rows.length} ${plural(rows.length, noun)}.`, basis)
  }
  if (query.operation === 'share') {
    // Always a share of what LEFT the account for an outflow metric, and of what came in for
    // income — a share of "all rows" would divide by income plus expenses and mean nothing.
    const denominatorRows = filterBankRows(context.insightRows, { from: query.filters.from, to: query.filters.to }).rows
    const wanted = query.metric === 'income' ? ['income'] : ['expense', 'savings', 'investments']
    const denominator = denominatorRows
      .filter(row => wanted.includes(bankFlowOf(row)))
      .reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0)
    const share = denominator > 0 ? Math.round(total / denominator * 100) : 0
    const ofWhat = query.metric === 'income' ? 'money in' : 'money out'
    return withBasis(`That was ${formatMoney(total)}, or ${share}% of ${ofWhat} in this period.`, basis)
  }
  if (['largest', 'smallest', 'list'].includes(query.operation)) {
    const items = transactionList(rows, query.operation, query.limit, noun)
    const prefix = query.operation === 'largest' ? `The largest matching ${noun} was`
      : query.operation === 'smallest' ? `The smallest matching ${noun} was`
        : `The leading matching ${plural(items.length, noun)} were`
    return withBasis(`${prefix} ${listSentence(items)}.`, basis)
  }
  return withBasis(`I can calculate the total, count, average, largest, smallest, or a short list for matching ${plural(rows.length, noun)}.`, basis)
}

function answerComparison(query, baseRows, basis) {
  const { dimension, left, right } = query.compare
  const outflowTotal = rows => rows
    .filter(row => bankFlowOf(row) === 'expense')
    .reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0)

  if (dimension === 'period') {
    if (!/^\d{4}-\d{2}$/.test(left) || !/^\d{4}-\d{2}$/.test(right)) {
      return withBasis('Period comparisons need two months in YYYY-MM format.', basis)
    }
    const filtered = filterBankRows(baseRows, query.filters)
    if (filtered.error) return withBasis(filtered.error, basis)
    const forMonth = month => outflowTotal(filtered.rows.filter(row => row.date.startsWith(month)))
    const leftTotal = forMonth(left)
    const rightTotal = forMonth(right)
    const comparison = leftTotal === rightTotal
      ? 'They were equal.'
      : `${leftTotal > rightTotal ? left : right} was higher by ${formatMoney(Math.abs(leftTotal - rightTotal))}.`
    return withBasis(`${left} was ${formatMoney(leftTotal)} and ${right} was ${formatMoney(rightTotal)}. ${comparison}`, basis)
  }

  const leftFilter = filterBankRows(baseRows, { ...query.filters, [dimension]: left })
  if (leftFilter.error) return withBasis(leftFilter.error, basis)
  const rightFilter = filterBankRows(baseRows, { ...query.filters, [dimension]: right })
  if (rightFilter.error) return withBasis(rightFilter.error, basis)
  const leftTotal = outflowTotal(leftFilter.rows)
  const rightTotal = outflowTotal(rightFilter.rows)
  const comparison = leftTotal === rightTotal
    ? 'They were equal.'
    : `${leftTotal > rightTotal ? leftFilter.labels[dimension] : rightFilter.labels[dimension]} was higher by ${formatMoney(Math.abs(leftTotal - rightTotal))}.`
  return withBasis(
    `${leftFilter.labels[dimension]} was ${formatMoney(leftTotal)} and ${rightFilter.labels[dimension]} was ${formatMoney(rightTotal)}. ${comparison}`,
    basis,
  )
}

function answerDestinationsQuery(query, context) {
  const { destinations } = context.analysis
  const basis = scopeLabel(context.insightScope, context.storedInsights?.periodLabel)
  if (!destinations.total) return withBasis('No savings or investment transfers appear in this scope.', basis)
  const items = destinations.destinations.slice(0, query.limit).map(row =>
    `${row.name} at ${formatMoney(row.amount)} across ${row.transfers} ${plural(row.transfers, 'transfer')}`)
  return withBasis(`Allocation went to ${listSentence(items)}.`, basis)
}

function answerDuplicatesQuery(context) {
  const { duplicates } = context.analysis
  const basis = 'your whole bank ledger, not just this period'
  if (!duplicates.groupCount) return withBasis('No possible duplicate transactions were detected.', basis)
  return withBasis(
    `${duplicates.groupCount} ${plural(duplicates.groupCount, 'set')} of transactions look like repeats, worth ${formatMoney(duplicates.dollarExposure)} in extra copies. They are flagged rather than removed, because a genuine repeat charge is indistinguishable from a re-import.`,
    basis,
  )
}

function answerPaceQuery(query, context) {
  const pace = context.storedInsights?.pace ?? context.analysis.pace
  const basis = scopeLabel(context.financialScope, 'the Financial Pace period')
  if (pace.status === 'not_enough_data') return withBasis(normalizeUsdText(pace.evidence.join(' ')), basis)
  if (query.metric === 'financial_pace') {
    return withBasis(`Your Financial Pace is ${pace.label}. ${normalizeUsdText(pace.evidence.join(' '))}`, basis)
  }
  const facts = {
    income: ['Average monthly income', pace.income],
    expenses: ['Average monthly expenses', pace.expenses],
    headroom: ['Average monthly headroom', pace.headroom],
    savings_target: ['Monthly savings target', pace.savingsTarget],
    net_cash: ['Average monthly headroom', pace.headroom],
  }
  const [label, value] = facts[query.metric] ?? facts.headroom
  return withBasis(`${label} was ${formatMoney(value)}.`, basis)
}

function answerNetCashQuery(context) {
  const { cashflow } = context.analysis
  const basis = scopeLabel(context.insightScope, context.storedInsights?.periodLabel)
  if (!cashflow.txCount) return withBasis('There is no bank activity in this scope.', basis)
  const verdict = cashflow.netCash >= 0
    ? `${formatMoney(cashflow.netCash)} more came in than went out`
    : `${formatMoney(Math.abs(cashflow.netCash))} more went out than came in`
  return withBasis(
    `${verdict}, from ${formatMoney(cashflow.countedIncome)} in against ${formatMoney(cashflow.expenses)} of spending. Savings and investment transfers are not subtracted, because that money is allocated rather than spent.`,
    basis,
  )
}

function executeFactQuery(query, context) {
  if (query.metric === 'duplicates') return answerDuplicatesQuery(context)
  if (query.metric === 'destinations') return answerDestinationsQuery(query, context)
  if (query.metric === 'financial_pace' || query.metric === 'headroom' || query.metric === 'savings_target') {
    return answerPaceQuery(query, context)
  }
  if (query.metric === 'net_cash') {
    return query.scope === 'financial' ? answerPaceQuery(query, context) : answerNetCashQuery(context)
  }
  if (query.scope === 'financial' && ['income', 'expenses'].includes(query.metric)) {
    return answerPaceQuery(query, context)
  }
  return answerLedgerQuery(query, context)
}

function intentPrompt(context) {
  const conversation = context.messages.slice(-6).map(message => ({ role: message.role, content: message.content }))
  const payees = context.analysis.outflows.concat(context.analysis.inflows).map(item => item.name)
  const accounts = [...new Set(context.insightRows.map(accountOf))]
  return {
    system: 'Classify a Finances chat question into a strict deterministic query or advisory mode. Respond with valid JSON only.',
    user: `Decide whether the latest user message asks for a fact with one ledger-computable answer or for interpretation/advice.

Conversation:
${JSON.stringify(conversation, null, 2)}

Available names in the stored insight scope:
Payees: ${JSON.stringify(payees)}
Accounts: ${JSON.stringify(accounts)}

For an exact question, return:
{"mode":"fact","query":{"metric":"income|expenses|net_cash|savings|investments|allocation|transactions|duplicates|financial_pace|headroom|savings_target|destinations","operation":"sum|count|average|share|largest|smallest|list|compare|get|explain","scope":"insight|financial","filters":{"payee":"optional","account":"optional","from":"optional YYYY-MM-DD","to":"optional YYYY-MM-DD"},"averageBy":"transaction|month","compare":{"dimension":"payee|account|period","left":"first name or YYYY-MM","right":"second name or YYYY-MM"},"limit":5}}

For advice, trade-offs, recommendations, causes, predictions, or subjective interpretation, return:
{"mode":"advice"}

If the request itself is too unclear to choose a metric, return:
{"mode":"clarify","question":"one short clarification question"}

Rules:
- Use fact mode for totals, counts, averages, shares, largest/smallest transactions, lists, comparisons, duplicates, savings and investment destinations, income, expenses, net cash, headroom, savings target and Financial Pace.
- Use insight scope for questions about the period on screen, and financial scope for per-month pace figures.
- Money moved to savings or investments is allocation: use metric savings, investments or allocation, never expenses.
- Use operation share for questions asking what percentage of money in or out matched a filter.
- For a monthly average within the on-screen period, set averageBy to month; otherwise use transaction.
- Comparisons use operation compare and the compare object. Normalize month comparisons to YYYY-MM and use dimension period.
- Preserve payee and account names from the user's wording. The server resolves them and handles ambiguity.
- Omit unused filter and compare fields.
- Never answer the question or calculate anything.

Valid JSON only.`,
    maxTokens: 320,
  }
}

function advicePrompt(context) {
  const { analysis } = context
  const pace = context.storedInsights?.pace ?? analysis.pace
  const { cashflow } = analysis
  const money = value => (value == null ? null : formatUsd(value))
  const source = {
    period: scopeLabel(context.insightScope, context.storedInsights?.periodLabel),
    cashflow: {
      income: money(cashflow.countedIncome),
      expenses: money(cashflow.expenses),
      netCash: money(cashflow.netCash),
      saved: money(cashflow.saved),
      invested: money(cashflow.invested),
      unallocated: money(cashflow.unallocated),
      monthsWithActivity: cashflow.monthsWithActivity,
      monthly: cashflow.monthly.map(month => ({
        month: month.month,
        income: money(month.income),
        expenses: money(month.expenses),
        net: money(month.net),
      })),
    },
    topInflows: analysis.inflows.map(row => ({ name: row.name, amount: money(row.amount) })),
    topOutflows: analysis.outflows.map(row => ({ name: row.name, amount: money(row.amount) })),
    destinations: analysis.destinations.destinations.map(row => ({
      name: row.name,
      kind: row.kind,
      amount: money(row.amount),
    })),
    duplicates: { ...analysis.duplicates, dollarExposure: money(analysis.duplicates.dollarExposure) },
    financialPace: {
      status: pace?.status,
      label: pace?.label,
      income: money(pace?.income),
      incomeSource: pace?.incomeSource,
      expenses: money(pace?.expenses),
      headroom: money(pace?.headroom),
      savingsTarget: money(pace?.savingsTarget),
      savingsContributions: money(pace?.savingsContributions),
      monthsCovered: pace?.monthsCovered,
      evidence: pace?.evidence?.map(normalizeUsdText),
      period: scopeLabel(context.financialScope, 'the Financial Pace period'),
    },
    observations: (context.storedInsights?.observations ?? analysis.observations).map(item => ({
      title: item.title,
      status: item.status,
      evidence: normalizeUsdText(item.evidence),
    })),
  }
  return {
    system: financeSystemPrompt(advisorRole('Finances'), {
      extra: `${JSON.stringify(source, null, 2)}

Use only the supplied facts. Do not perform arithmetic or invent causes, intentions, transactions, budgets or amounts. Be constructive and non-shaming, but do not minimize Over Pace or other financial strain. Answer in 2–4 concise sentences, plain text only. State which supplied period your advice refers to when relevant.`,
    }),
    maxTokens: 512,
  }
}

/**
 * Binds a chat request to one persisted finance insight record. Identical rules to the spend side,
 * and deliberately the same implementation — see `chatBinding.js`.
 */
export function createFinanceChatBinding(options) {
  return createChatBinding(options)
}

/**
 * Pure Finance Chat interface, the bank-side sibling of `createSpendChatTurn`.
 *
 * Three tiers, in order of preference: a guided prompt answered entirely from computed facts; a
 * classified fact query answered the same way; and only for genuinely subjective questions, an
 * advisory model call handed pre-formatted numbers it is forbidden to recompute.
 */
export function createFinanceChatTurn({
  analysis,
  storedInsights = null,
  bankTransactions = [],
  settings = {},
  messages = [],
}) {
  const safeMessages = validateMessages(messages)
  const latestUser = safeMessages.at(-1)
  if (latestUser?.role !== 'user') throw new Error('Finance chat requires the latest message to be from the user')

  const insightScope = analysis.scopes.insight
  const financialScope = storedInsights?.financialScope ?? analysis.scopes.financial
  const context = {
    analysis,
    storedInsights,
    settings,
    messages: safeMessages,
    insightScope,
    financialScope,
    insightRows: bankTransactions.filter(row => matchesFinanceScope(row, insightScope)),
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
      return normalizeUsdText(validatePlainText(rawText, 'advisory', MAX_ADVICE_CHARS))
    },
  }
}
