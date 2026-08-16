import dayjs from 'dayjs'
import { formatUsd, normalizeUsdText } from './currencyFormatting.js'
import { createChatBinding } from './chatBinding.js'
import { stripJsonFence, validatePlainText } from './modelText.js'
import { BUCKET_LABELS } from '../src/utils/liquidNetWorth.js'
import { advisorRole, financeSystemPrompt } from './appKnowledge.js'

// The balance-side allowlist. Deliberately NOT the bank one from `financeChat.js` or the card one
// from `spendChat.js`: this tab has no rows to slice. It has a small, fixed set of computed figures,
// and the honest query language over that is a lookup, not a filter engine. Accepting `merchant` or
// `payee` here would let the classifier route a question to a dimension no answer can use.
const FACT_METRICS = new Set([
  'liquid_net_worth', 'cash', 'savings', 'portfolio', 'composition',
  'change', 'money_in', 'money_out', 'market', 'unexplained', 'runway', 'goals',
])
const FACT_OPERATIONS = new Set(['get', 'list', 'share', 'explain'])

const MAX_CLARIFICATION_CHARS = 300
const MAX_ADVICE_CHARS = 1200
const MAX_MESSAGE_CHARS = 2000
const MAX_CONTEXT_MESSAGES = 12

const DEFAULT_GUIDED_OPTIONS = [
  { id: '1', key: 'what_changed', title: 'What moved it', prompt: 'What moved my liquid net worth?' },
  { id: '2', key: 'whats_it_in', title: "What it's sitting in", prompt: 'What is my money sitting in?' },
  { id: '3', key: 'runway_and_goals', title: 'Runway & goals', prompt: 'How long would my cash last, and are my goals on pace?' },
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

function validateMessages(messages) {
  if (!Array.isArray(messages)) throw new Error('Dashboard chat messages must be an array')
  return messages.map(message => {
    if (!['user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') {
      throw new Error('Dashboard chat messages must use user or assistant roles with text content')
    }
    const content = message.content.trim()
    if (!content) throw new Error('Dashboard chat messages cannot be empty')
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new Error(`Dashboard chat messages cannot exceed ${MAX_MESSAGE_CHARS} characters`)
    }
    return { role: message.role, content }
  }).slice(-MAX_CONTEXT_MESSAGES)
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

// Balances are current as of today; the change decomposition covers the selected period. Quoting
// one basis for both would misdate half of every answer, so each answer states its own.
const TODAY_BASIS = 'your balances as they stand today'
const changeBasis = context => context.storedInsights?.periodLabel ?? context.analysis.scope.label

function answerBalance(metric, context) {
  const { kpis } = context.analysis
  const value = metric === 'liquid_net_worth' ? kpis.liquid : kpis[metric]
  const name = metric === 'liquid_net_worth' ? 'Liquid net worth' : BUCKET_LABELS[metric]
  const delta = kpis.deltas?.[metric === 'liquid_net_worth' ? 'liquid' : metric]
  const move = delta && kpis.since
    ? ` That is ${formatMoney(delta.abs)} against ${dayjs(kpis.since).format('MMM D, YYYY')}.`
    : ''
  const definition = metric === 'liquid_net_worth'
    ? ' It counts cash, savings and investment accounts, and excludes property, vehicles, private shares and debts.'
    : ''
  return withBasis(`${name} is ${formatMoney(value)}.${move}${definition}`, TODAY_BASIS)
}

function answerComposition(query, context) {
  const { composition } = context.analysis
  if (!composition.rows.length) return withBasis('There are no balances recorded yet.', TODAY_BASIS)
  const rows = query.filters.bucket
    ? composition.rows.filter(row => row.bucket === query.filters.bucket)
    : composition.rows
  if (!rows.length) {
    return withBasis(`Nothing is currently held in ${BUCKET_LABELS[query.filters.bucket] ?? query.filters.bucket}.`, TODAY_BASIS)
  }
  const items = rows.slice(0, query.limit).map(row => `${row.name} at ${formatMoney(row.value)} (${row.pct}%)`)
  return withBasis(
    `Your ${formatMoney(composition.total)} is held as ${listSentence(items)}.`,
    TODAY_BASIS,
  )
}

function answerChange(context) {
  const { attribution } = context.analysis
  const basis = changeBasis(context)
  if (!attribution.from) return withBasis('There is not enough recorded history to decompose a change.', basis)

  const gap = Math.abs(attribution.unexplained) >= 1
    ? ` ${formatMoney(attribution.unexplained)} is cash the imported statements could not account for.`
    : ''
  const lag = Math.abs(attribution.lag) >= 1
    ? ` A further ${formatMoney(attribution.lag)} is spending that happened after the last statement landed.`
    : ''
  return withBasis(
    `Liquid net worth moved ${formatMoney(attribution.change)}, from ${formatMoney(attribution.start)} to ${formatMoney(attribution.end)}. ${formatMoney(attribution.saved)} of that came from money in against money out, and ${formatMoney(attribution.market)} from investment prices.${gap}${lag}`,
    basis,
  )
}

function answerFlow(metric, context) {
  const { attribution } = context.analysis
  const basis = changeBasis(context)
  if (metric === 'money_in') {
    return withBasis(`${formatMoney(attribution.moneyIn)} came into your accounts.`, basis)
  }
  if (metric === 'money_out') {
    return withBasis(
      `${formatMoney(attribution.moneyOut)} went out. Transfers to savings and investments are not counted here — that money stayed inside your liquid net worth.`,
      basis,
    )
  }
  const caveat = attribution.basis === 'market'
    ? ''
    : ' One endpoint had no market price available, so this figure is partial.'
  return withBasis(
    `Investment prices moved ${formatMoney(attribution.market)}. This is the change in unrealised gain, so money you paid into an investment account is not counted as return.${caveat}`,
    basis,
  )
}

function answerUnexplained(context) {
  const { attribution } = context.analysis
  const basis = changeBasis(context)
  const named = attribution.rows.filter(row => row.kind === 'unexplained')
  if (!named.length && Math.abs(attribution.unexplained) < 1) {
    return withBasis('Every dollar of the change is accounted for over dates your statements cover.', basis)
  }
  const items = named.slice(0, 4).map(row =>
    `${formatMoney(row.amount)} on ${dayjs(row.date).format('MMM D, YYYY')}, where the ledger expected ${formatMoney(row.expected)} and the real balance was ${formatMoney(row.balance)}`)
  const residual = Math.abs(attribution.other) >= 1
    ? ` A residual of ${formatMoney(attribution.other)} is left after every named gap.`
    : ''
  if (!items.length) {
    return withBasis(`${formatMoney(attribution.unexplained)} is unaccounted for, with no single dated discrepancy behind it.${residual}`, basis)
  }
  return withBasis(
    `${formatMoney(attribution.unexplained)} is unaccounted for over dates your statements already cover: ${listSentence(items)}.${residual}`,
    basis,
  )
}

// The runway and goal answers exist unwrapped so the guided prompt can join them under ONE basis
// line. Both are dated to today, and a reply that says "Based on your balances as they stand today"
// twice in four sentences reads as two answers stapled together rather than as one.
function runwaySentence(context) {
  const { runway } = context.analysis
  if (runway.months === null) {
    return 'There is not yet a complete month of spending to measure a runway against.'
  }
  return `${formatMoney(runway.cash)} in checking covers about ${runway.months} ${plural(runway.months, 'month')} of ordinary spending, against ${formatMoney(runway.averageMonthlySpend)} a month across ${runway.monthsCounted} complete ${plural(runway.monthsCounted, 'month')}. Savings and investments are not counted, because reaching them means moving money first.`
}

function answerRunway(context) {
  return withBasis(runwaySentence(context), TODAY_BASIS)
}

function resolveGoal(requested, goals) {
  if (!requested) return { goal: null }
  const requestedKey = normalizedText(requested)
  const matches = goals.filter(goal => {
    const key = normalizedText(goal.name)
    return key === requestedKey || key.includes(requestedKey) || requestedKey.includes(key)
  })
  const exact = matches.find(goal => normalizedText(goal.name) === requestedKey)
  if (exact) return { goal: exact }
  if (matches.length === 1) return { goal: matches[0] }
  if (!matches.length) return { error: `I could not find a goal matching “${requested}”.` }
  return { error: `I found several goals matching “${requested}”: ${matches.map(goal => goal.name).join(', ')}. Which one did you mean?` }
}

function goalSentence(goal) {
  if (goal.reached) return `${goal.name} is fully funded at ${formatMoney(goal.currentAmount)}`
  if (!(goal.pace.perMonth > 0)) {
    return `${goal.name} is ${goal.pct}% funded with ${formatMoney(goal.remaining)} to go and no funding rate set`
  }
  const rate = goal.pace.source === 'derived'
    ? `${formatMoney(goal.pace.perMonth)} a month from your last ${goal.pace.months} months of transfers`
    : `${formatMoney(goal.pace.perMonth)} a month from your plan`
  const timing = goal.slipMonths === null
    ? ''
    : goal.slipMonths > 0
      ? `, about ${goal.slipMonths} ${plural(goal.slipMonths, 'month')} past its ${dayjs(goal.targetDate).format('MMM YYYY')} target`
      : `, ahead of its ${dayjs(goal.targetDate).format('MMM YYYY')} target`
  return `${goal.name} is ${goal.pct}% funded and reaches ${formatMoney(goal.targetAmount)} around ${dayjs(goal.eta).format('MMM YYYY')} at ${rate}${timing}`
}

function goalsSentence(query, context) {
  const { goals } = context.analysis
  if (!goals.length) return 'No goals are set yet.'

  if (query.filters.goal) {
    const resolved = resolveGoal(query.filters.goal, goals)
    if (resolved.error) return resolved.error
    return `${goalSentence(resolved.goal)}.`
  }
  const shown = goals.slice(0, query.limit)
  const suffix = goals.length > shown.length ? ` ${goals.length - shown.length} more are set.` : ''
  return `${listSentence(shown.map(goalSentence))}.${suffix}`
}

function answerGoals(query, context) {
  return withBasis(goalsSentence(query, context), TODAY_BASIS)
}

function executeFactQuery(query, context) {
  const { metric } = query
  if (['liquid_net_worth', 'cash', 'savings', 'portfolio'].includes(metric)) {
    // "What share is cash?" is a composition question wearing a balance's name.
    if (query.operation === 'share' && metric !== 'liquid_net_worth') {
      return answerComposition({ ...query, filters: { ...query.filters, bucket: metric } }, context)
    }
    return answerBalance(metric, context)
  }
  if (metric === 'composition') return answerComposition(query, context)
  if (metric === 'change') return answerChange(context)
  if (['money_in', 'money_out', 'market'].includes(metric)) return answerFlow(metric, context)
  if (metric === 'unexplained') return answerUnexplained(context)
  if (metric === 'runway') return answerRunway(context)
  return answerGoals(query, context)
}

function guidedReply(question, analysis, storedInsights, context) {
  const normalized = normalizedText(question)
  const options = storedInsights?.exploreOptions?.length ? storedInsights.exploreOptions : DEFAULT_GUIDED_OPTIONS
  const match = options.find(option => [option.id, option.key, option.title, option.prompt]
    .some(value => normalizedText(value) === normalized))
  if (!match) return null
  if (match.id === '1' || match.key === 'what_changed') return answerChange(context)
  if (match.id === '2' || match.key === 'whats_it_in') {
    return answerComposition({ filters: {}, limit: 6 }, context)
  }
  const goals = analysis.goals.length ? ` ${goalsSentence({ filters: {}, limit: 3 }, context)}` : ''
  return withBasis(`${runwaySentence(context)}${goals}`, TODAY_BASIS)
}

function parseIntent(rawText) {
  const parsed = JSON.parse(stripJsonFence(rawText))
  if (parsed?.mode === 'advice') return { mode: 'advice' }
  if (parsed?.mode === 'clarify') {
    const question = validatePlainText(parsed.question, 'clarification', MAX_CLARIFICATION_CHARS)
    return { mode: 'clarify', question }
  }
  if (parsed?.mode !== 'fact' || !parsed.query || typeof parsed.query !== 'object') {
    throw new Error('Dashboard chat intent must be fact, advice, or clarify')
  }

  const query = parsed.query
  if (!FACT_METRICS.has(query.metric)) throw new Error(`Unsupported dashboard-chat metric: ${query.metric}`)
  if (!FACT_OPERATIONS.has(query.operation)) throw new Error(`Unsupported dashboard-chat operation: ${query.operation}`)

  const filters = {}
  if (typeof query.filters?.bucket === 'string' && BUCKET_LABELS[query.filters.bucket]) {
    filters.bucket = query.filters.bucket
  }
  if (typeof query.filters?.goal === 'string' && query.filters.goal.trim()) {
    filters.goal = query.filters.goal.trim()
  }

  return {
    mode: 'fact',
    query: {
      metric: query.metric,
      operation: query.operation,
      filters,
      limit: Math.min(10, Math.max(1, Number(query.limit) || 5)),
    },
  }
}

function intentPrompt(context) {
  const conversation = context.messages.slice(-6).map(message => ({ role: message.role, content: message.content }))
  return {
    system: 'Classify a Dashboard chat question into a strict deterministic query or advisory mode. Respond with valid JSON only.',
    user: `Decide whether the latest user message asks for a fact with one computable answer or for interpretation/advice.

Conversation:
${JSON.stringify(conversation, null, 2)}

Available names:
Buckets: ${JSON.stringify(Object.keys(BUCKET_LABELS))}
Accounts held: ${JSON.stringify(context.analysis.composition.rows.map(row => row.name))}
Goals: ${JSON.stringify(context.analysis.goals.map(goal => goal.name))}

For an exact question, return:
{"mode":"fact","query":{"metric":"liquid_net_worth|cash|savings|portfolio|composition|change|money_in|money_out|market|unexplained|runway|goals","operation":"get|list|share|explain","filters":{"bucket":"optional cash|savings|portfolio","goal":"optional goal name"},"limit":5}}

For advice, trade-offs, recommendations, causes, predictions, or subjective interpretation, return:
{"mode":"advice"}

If the request itself is too unclear to choose a metric, return:
{"mode":"clarify","question":"one short clarification question"}

Rules:
- This tab answers questions about BALANCES: what the liquid net worth is, what it is held in, what moved it over the selected period, how long cash would last, and goal progress.
- Questions about individual transactions, merchants, categories, payees or a monthly spending breakdown cannot be answered here. Use mode clarify and say the Finances or Spend Analyzer tab covers that.
- Use metric change for what drove the period's movement, money_in / money_out for the flows behind it, and market for investment price movement.
- Use metric unexplained for questions about missing, unaccounted or unreconciled cash.
- Use metric runway for how long cash would last, emergency funds, or months of expenses covered.
- Use metric composition for how the total splits across cash, savings and investment accounts.
- Preserve goal names from the user's wording. The server resolves them and handles ambiguity.
- Omit unused filter fields.
- Never answer the question or calculate anything.

Valid JSON only.`,
    maxTokens: 320,
  }
}

function advicePrompt(context) {
  const { analysis } = context
  const money = value => (value == null ? null : formatUsd(value))
  const source = {
    asOf: analysis.asOf,
    changePeriod: changeBasis(context),
    liquidNetWorth: {
      total: money(analysis.kpis.liquid),
      cash: money(analysis.kpis.cash),
      savings: money(analysis.kpis.savings),
      portfolio: money(analysis.kpis.portfolio),
      excludes: 'property, vehicles, private or corporate shares, and debts',
    },
    composition: analysis.composition.rows.map(row => ({
      name: row.name, bucket: row.bucket, amount: money(row.value), percent: row.pct,
    })),
    change: {
      total: money(analysis.attribution.change),
      savedNet: money(analysis.attribution.saved),
      moneyIn: money(analysis.attribution.moneyIn),
      moneyOut: money(analysis.attribution.moneyOut),
      market: money(analysis.attribution.market),
      statementLag: money(analysis.attribution.lag),
      unexplained: money(analysis.attribution.unexplained),
      basis: analysis.attribution.basis,
    },
    runway: {
      months: analysis.runway.months,
      cash: money(analysis.runway.cash),
      averageMonthlySpend: money(analysis.runway.averageMonthlySpend),
      completeMonthsMeasured: analysis.runway.monthsCounted,
    },
    goals: analysis.goals.map(goal => ({
      name: goal.name,
      percentComplete: goal.pct,
      remaining: money(goal.remaining),
      fundingRatePerMonth: money(goal.pace.perMonth),
      fundingRateSource: goal.pace.source,
      estimatedCompletion: goal.eta,
      targetDate: goal.targetDate,
      monthsLate: goal.slipMonths,
    })),
    observations: (context.storedInsights?.observations ?? analysis.observations).map(item => ({
      title: item.title,
      status: item.status,
      evidence: normalizeUsdText(item.evidence),
    })),
  }
  return {
    system: financeSystemPrompt(advisorRole('Dashboard'), {
      extra: `${JSON.stringify(source, null, 2)}

Use only the supplied facts. Do not perform arithmetic or invent causes, intentions, transactions, budgets or amounts. Unexplained cash is a bookkeeping discrepancy to reconcile, not spending. Be constructive and non-shaming, but do not minimize a thin runway or a goal that is off pace. Answer in 2–4 concise sentences, plain text only. State which supplied period your advice refers to when relevant.`,
    }),
    maxTokens: 512,
  }
}

/**
 * Binds a chat request to one persisted dashboard insight record. Identical rules to the other two
 * triads, and deliberately the same implementation — see `chatBinding.js`.
 */
export function createDashboardChatBinding(options) {
  return createChatBinding(options)
}

/**
 * Pure Dashboard Chat interface, the balance-side sibling of `createFinanceChatTurn`.
 *
 * Same three tiers in the same order: a guided prompt answered entirely from computed facts; a
 * classified fact query answered the same way; and only for genuinely subjective questions, an
 * advisory model call handed pre-formatted numbers it is forbidden to recompute.
 *
 * The difference from the ledger triads is the fact tier. There are no rows to filter here, so the
 * query language is a lookup over the figures `buildDashboardAnalysis` already computed rather than
 * a second aggregation engine that could drift from the cards on screen.
 */
export function createDashboardChatTurn({ analysis, storedInsights = null, messages = [] }) {
  const safeMessages = validateMessages(messages)
  const latestUser = safeMessages.at(-1)
  if (latestUser?.role !== 'user') throw new Error('Dashboard chat requires the latest message to be from the user')

  const context = { analysis, storedInsights, messages: safeMessages }
  const directReply = guidedReply(latestUser.content, analysis, storedInsights, context)

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
