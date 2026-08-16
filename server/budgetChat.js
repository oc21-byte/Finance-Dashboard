import { formatUsd, normalizeUsdText } from './currencyFormatting.js'
import { createChatBinding } from './chatBinding.js'
import { stripJsonFence, validatePlainText } from './modelText.js'
import { advisorRole, financeSystemPrompt } from './appKnowledge.js'

// The plan-side allowlist. Deliberately NOT the bank one from `financeChat.js`, the card one from
// `spendChat.js`, or the balance one from `dashboardChat.js`. This tab has no rows to slice: it has
// a set of decisions and the averages they are measured against, so the honest query language over
// it is a lookup, not a filter engine.
//
// `merchant`, `payee` and `transaction` are absent on purpose. Accepting one would let the
// classifier route a question to a dimension no answer here can use, and produce a confident reply
// about a merchant from a plan that has never heard of merchants.
const FACT_METRICS = new Set([
  'income', 'spending_caps', 'cap', 'over_caps', 'uncapped',
  'savings_planned', 'planned_rate', 'savings_target', 'goal_funding',
  'left_to_allocate', 'allocation', 'detected_contributions',
])
const FACT_OPERATIONS = new Set(['get', 'list', 'share', 'explain'])

const MAX_CLARIFICATION_CHARS = 300
const MAX_ADVICE_CHARS = 1200
const MAX_MESSAGE_CHARS = 2000
const MAX_CONTEXT_MESSAGES = 12

const DEFAULT_GUIDED_OPTIONS = [
  { id: '1', key: 'where_the_plan_strains', title: 'Where the plan strains', prompt: 'Which of my caps are below what I actually spend?' },
  { id: '2', key: 'the_split', title: 'How income divides', prompt: 'How does my income divide between caps, savings and what is left?' },
  { id: '3', key: 'reaching_the_target', title: 'Reaching the target', prompt: 'Is my plan on track for my savings target?' },
]

const money = value => formatUsd(Number(value) || 0)

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm
}

function normalizedText(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function listSentence(items) {
  if (!items.length) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) throw new Error('Budget chat messages must be an array')
  return messages.map(message => {
    if (!['user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') {
      throw new Error('Budget chat messages must use user or assistant roles with text content')
    }
    const content = message.content.trim()
    if (!content) throw new Error('Budget chat messages cannot be empty')
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new Error(`Budget chat messages cannot exceed ${MAX_MESSAGE_CHARS} characters`)
    }
    return { role: message.role, content }
  }).slice(-MAX_CONTEXT_MESSAGES)
}

// The plan is a monthly statement of intent; the averages it is measured against come from a fixed
// window of complete bank months. Every answer states that window, because a cap is a per-month
// decision and quoting it against an unstated period invites reading it as a total.
const basisOf = context => `your plan against ${context.analysis.scope.label} averages`

function withBasis(answer, context) {
  return `${answer} Based on ${basisOf(context)}.`
}

function resolveCap(requested, rows) {
  const requestedKey = normalizedText(requested)
  const matches = rows.filter(row => {
    const key = normalizedText(row.name)
    return key === requestedKey || key.includes(requestedKey) || requestedKey.includes(key)
  })
  const exact = matches.find(row => normalizedText(row.name) === requestedKey)
  if (exact) return { row: exact }
  if (matches.length === 1) return { row: matches[0] }
  if (!matches.length) return { error: `I could not find a category matching “${requested}” in your plan.` }
  return { error: `I found several categories matching “${requested}”: ${matches.map(row => row.name).join(', ')}. Which one did you mean?` }
}

function capSentence(row) {
  if (row.cap == null) {
    return row.average > 0
      ? `${row.name} has no cap set and averages ${money(row.average)} a month`
      : `${row.name} has no cap set and no recorded spending`
  }
  if (row.average <= 0) return `${row.name} is capped at ${money(row.cap)} with no recorded spending against it`
  const comparison = row.over
    ? `${money(row.average)} actually goes out, ${money(row.average - row.cap)} over`
    : `${money(row.average)} actually goes out, ${money(row.cap - row.average)} under`
  return `${row.name} is capped at ${money(row.cap)} and ${comparison} (${row.pct}% of the cap)`
}

function answerCap(query, context) {
  const rows = context.analysis.caps.rows
  if (!rows.length) return withBasis('No spending categories are recorded yet.', context)
  if (query.filters.category) {
    const resolved = resolveCap(query.filters.category, rows)
    if (resolved.error) return resolved.error
    return withBasis(`${capSentence(resolved.row)}.`, context)
  }
  const shown = rows.slice(0, query.limit)
  const suffix = rows.length > shown.length ? ` ${rows.length - shown.length} more are tracked.` : ''
  return withBasis(`${listSentence(shown.map(capSentence))}.${suffix}`, context)
}

function answerOverCaps(context) {
  const { pressure, rows } = context.analysis.caps
  if (!pressure.capped) return withBasis('No spending caps are set yet, so nothing can be over one.', context)
  if (!pressure.overCount) {
    return withBasis(`All ${pressure.capped} ${plural(pressure.capped, 'cap')} sit at or above average spending.`, context)
  }
  const over = rows.filter(row => row.over).map(row =>
    `${row.name} at ${money(row.average)} against a ${money(row.cap)} cap`)
  return withBasis(
    `${pressure.overCount} of ${pressure.capped} ${plural(pressure.capped, 'cap')} ${plural(pressure.overCount, 'sits', 'sit')} below average spending, by ${money(pressure.overBy)} a month combined: ${listSentence(over)}.`,
    context,
  )
}

function answerUncapped(context) {
  const uncapped = context.analysis.caps.rows.filter(row => row.cap == null && row.average > 0)
  if (!uncapped.length) return withBasis('Every category with recorded spending has a cap.', context)
  const items = uncapped.slice(0, 6).map(row => `${row.name} at ${money(row.average)} a month`)
  const total = uncapped.reduce((sum, row) => sum + row.average, 0)
  return withBasis(
    `${uncapped.length} ${plural(uncapped.length, 'category', 'categories')} ${plural(uncapped.length, 'has', 'have')} no cap, totalling ${money(total)} a month: ${listSentence(items)}.`,
    context,
  )
}

function answerIncome(context) {
  const { income } = context.analysis
  const source = income.isConfirmed
    ? 'This is the take-home pay you confirmed.'
    : `This is the average across ${income.monthsCovered} complete ${plural(income.monthsCovered, 'month')} of bank activity — confirm it on the Budget tab to set it yourself.`
  return withBasis(`The plan is built on ${money(income.display)} of monthly income. ${source}`, context)
}

function answerSpendingCaps(context) {
  const { caps } = context.analysis
  return withBasis(
    `Your spending caps total ${money(caps.spendingTotal)} a month against ${money(caps.averageSpend)} of average card spending, across ${caps.pressure.capped} capped and ${caps.pressure.uncapped} uncapped ${plural(caps.pressure.capped + caps.pressure.uncapped, 'category', 'categories')}.`,
    context,
  )
}

// Every one of these says "plans to set aside", never "saves". The achieved figure lives on the
// Spend Analyzer, and a reply here that dropped the qualifier would put two different numbers
// under one name across two tabs.
function plannedSentence(context) {
  const { savings } = context.analysis
  const parts = [`${money(savings.goals)} to goals`, `${money(savings.target)} as a general target`]
  if (savings.categoryCaps > 0) parts.push(`${money(savings.categoryCaps)} in savings categories`)
  return `The plan sets aside ${money(savings.planned)} a month — ${listSentence(parts)}.`
}

function answerSavingsPlanned(context) {
  return withBasis(plannedSentence(context), context)
}

function answerPlannedRate(context) {
  const { rate } = context.analysis.savings
  const verdict = rate.shortfall > 0
    ? `${money(rate.shortfall)} a month short of the ${rate.targetPct}% target of ${money(rate.targetDollars)}`
    : `${money(-rate.shortfall)} a month clear of the ${rate.targetPct}% target of ${money(rate.targetDollars)}`
  return withBasis(
    `The plan intends to set aside ${rate.plannedPct}% of income, which is ${verdict}. This is what the plan intends; the Spend Analyzer shows what you actually saved.`,
    context,
  )
}

function answerSavingsTarget(context) {
  const { savings } = context.analysis
  const source = savings.targetSource === 'explicit_monthly_target'
    ? 'You set this amount directly.'
    : `This is ${savings.rate.targetPct}% of income, the default rate.`
  return withBasis(`Your general savings target is ${money(savings.target)} a month. ${source}`, context)
}

function answerGoalFunding(query, context) {
  const rows = context.analysis.savings.goalRows
  if (!rows.length) return withBasis('No active goals are set.', context)
  const chosen = query.filters.goal
    ? rows.filter(row => normalizedText(row.name).includes(normalizedText(query.filters.goal)))
    : rows
  if (!chosen.length) return `I could not find a goal matching “${query.filters.goal}”.`
  const items = chosen.slice(0, query.limit).map(row => {
    if (row.planned <= 0) return `${row.name} has no funding planned`
    return row.isAuto
      ? `${row.name} at ${money(row.planned)} a month, inferred from bank activity rather than set`
      : `${row.name} at ${money(row.planned)} a month`
  })
  return withBasis(`${listSentence(items)}.`, context)
}

function answerLeftToAllocate(context) {
  const { allocation } = context.analysis
  if (allocation.budgetedLeft < 0) {
    return withBasis(
      `The plan commits ${money(Math.abs(allocation.budgetedLeft))} a month more than comes in. Against average spending rather than the caps, it is ${money(Math.abs(allocation.avgLeft))} ${allocation.avgLeft < 0 ? 'over' : 'under'}.`,
      context,
    )
  }
  return withBasis(
    `${money(allocation.budgetedLeft)} a month is left after every cap and every savings commitment. Measured against what actually gets spent rather than the caps, it is ${money(allocation.avgLeft)}.`,
    context,
  )
}

function allocationSentence(context) {
  const { allocation, caps, savings, income } = context.analysis
  return `Of ${money(income.display)} a month, ${money(caps.spendingTotal)} is capped for spending (${Math.round(allocation.spendPct)}%), ${money(savings.planned)} is planned savings (${Math.round(allocation.savePct)}%), and ${money(Math.abs(allocation.budgetedLeft))} is ${allocation.budgetedLeft < 0 ? 'over-committed' : 'uncommitted'} (${Math.round(allocation.unallocatedPct)}%).`
}

function answerAllocation(context) {
  return withBasis(allocationSentence(context), context)
}

function answerDetected(context) {
  const { savingsContrib, investContrib } = context.analysis.detectedFromBank
  if (savingsContrib <= 0 && investContrib <= 0) {
    return withBasis('No savings or investment transfers are showing in your bank activity.', context)
  }
  return withBasis(
    `Your bank activity shows ${money(savingsContrib)} a month to savings and ${money(investContrib)} a month to investments. These are observations, not plan amounts.`,
    context,
  )
}

function executeFactQuery(query, context) {
  const { metric } = query
  if (metric === 'income') return answerIncome(context)
  if (metric === 'spending_caps') return answerSpendingCaps(context)
  if (metric === 'cap') return answerCap(query, context)
  if (metric === 'over_caps') return answerOverCaps(context)
  if (metric === 'uncapped') return answerUncapped(context)
  if (metric === 'savings_planned') return answerSavingsPlanned(context)
  if (metric === 'planned_rate') return answerPlannedRate(context)
  if (metric === 'savings_target') return answerSavingsTarget(context)
  if (metric === 'goal_funding') return answerGoalFunding(query, context)
  if (metric === 'left_to_allocate') return answerLeftToAllocate(context)
  if (metric === 'allocation') return answerAllocation(context)
  return answerDetected(context)
}

function guidedReply(question, storedInsights, context) {
  const normalized = normalizedText(question)
  const options = storedInsights?.exploreOptions?.length ? storedInsights.exploreOptions : DEFAULT_GUIDED_OPTIONS
  const match = options.find(option => [option.id, option.key, option.title, option.prompt]
    .some(value => normalizedText(value) === normalized))
  if (!match) return null
  if (match.id === '1' || match.key === 'where_the_plan_strains') return answerOverCaps(context)
  if (match.id === '2' || match.key === 'the_split') return answerAllocation(context)
  return answerPlannedRate(context)
}

function parseIntent(rawText) {
  const parsed = JSON.parse(stripJsonFence(rawText))
  if (parsed?.mode === 'advice') return { mode: 'advice' }
  if (parsed?.mode === 'clarify') {
    const question = validatePlainText(parsed.question, 'clarification', MAX_CLARIFICATION_CHARS)
    return { mode: 'clarify', question }
  }
  if (parsed?.mode !== 'fact' || !parsed.query || typeof parsed.query !== 'object') {
    throw new Error('Budget chat intent must be fact, advice, or clarify')
  }

  const query = parsed.query
  if (!FACT_METRICS.has(query.metric)) throw new Error(`Unsupported budget-chat metric: ${query.metric}`)
  if (!FACT_OPERATIONS.has(query.operation)) throw new Error(`Unsupported budget-chat operation: ${query.operation}`)

  const filters = {}
  if (typeof query.filters?.category === 'string' && query.filters.category.trim()) {
    filters.category = query.filters.category.trim()
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
    system: 'Classify a Budget chat question into a strict deterministic query or advisory mode. Respond with valid JSON only.',
    user: `Decide whether the latest user message asks for a fact with one computable answer or for interpretation/advice.

Conversation:
${JSON.stringify(conversation, null, 2)}

Available names:
Categories in the plan: ${JSON.stringify(context.analysis.caps.rows.map(row => row.name))}
Goals: ${JSON.stringify(context.analysis.savings.goalRows.map(row => row.name))}

For an exact question, return:
{"mode":"fact","query":{"metric":"income|spending_caps|cap|over_caps|uncapped|savings_planned|planned_rate|savings_target|goal_funding|left_to_allocate|allocation|detected_contributions","operation":"get|list|share|explain","filters":{"category":"optional category name","goal":"optional goal name"},"limit":5}}

For advice, trade-offs, recommendations, causes, predictions, or subjective interpretation, return:
{"mode":"advice"}

If the request itself is too unclear to choose a metric, return:
{"mode":"clarify","question":"one short clarification question"}

Rules:
- This tab answers questions about the PLAN: what income is, what each spending cap is, which caps sit below average spending, what the plan sets aside each month, and what is left over.
- Questions about individual transactions, merchants or payees cannot be answered here. Use mode clarify and say the Spend Analyzer covers card activity and the Finances tab covers bank activity.
- Questions about account balances, net worth or investment performance cannot be answered here either. Use mode clarify and point at the Dashboard.
- Every savings figure here is PLANNED, not achieved. If the user asks what they actually saved, use mode clarify and say the Spend Analyzer's Financial Pace shows the achieved rate.
- Use metric cap with a category filter for one category, and over_caps for which caps are exceeded.
- Use metric planned_rate for the planned savings rate against the target, and savings_target for the target amount itself.
- Use metric left_to_allocate for what is uncommitted, and allocation for how income divides across all three.
- Preserve category and goal names from the user's wording. The server resolves them and handles ambiguity.
- Omit unused filter fields.
- Never answer the question or calculate anything.

Valid JSON only.`,
    maxTokens: 320,
  }
}

function advicePrompt(context) {
  const { analysis } = context
  const format = value => (value == null ? null : formatUsd(value))
  const source = {
    window: analysis.scope.label,
    monthlyIncome: format(analysis.income.display),
    incomeSource: analysis.income.isConfirmed ? 'confirmed_take_home_pay' : 'observed_bank_average',
    spendingCaps: {
      total: format(analysis.caps.spendingTotal),
      averageActualSpend: format(analysis.caps.averageSpend),
      overCapCount: analysis.caps.pressure.overCount,
      cappedCount: analysis.caps.pressure.capped,
      // Named and noted exactly as in the generation prompt: it excludes under-cap categories, so
      // it is not the difference between `total` and `averageActualSpend`.
      overspendAcrossOverCapCategoriesOnlyPerMonth: format(analysis.caps.pressure.overBy),
      note: 'total and averageActualSpend cover ALL categories. overspendAcrossOverCapCategoriesOnlyPerMonth covers only over-cap categories, so it is not the difference between those two totals. Each row carries its own overCapBy — never subtract a cap from an average yourself.',
      rows: analysis.caps.rows.map(row => ({
        category: row.name,
        cap: format(row.cap),
        averageSpend: format(row.average),
        percentOfCap: row.pct,
        overCap: row.over,
        overCapBy: format(row.overBy),
      })),
    },
    savingsPlan: {
      plannedPerMonth: format(analysis.savings.planned),
      plannedRatePercent: analysis.savings.rate.plannedPct,
      targetRatePercent: analysis.savings.rate.targetPct,
      targetPerMonth: format(analysis.savings.rate.targetDollars),
      shortfallPerMonth: format(analysis.savings.rate.shortfall),
      clearsTarget: analysis.savings.rate.onTrack,
      goals: analysis.savings.goalRows.map(row => ({
        name: row.name,
        plannedPerMonth: format(row.planned),
        inferredFromBankActivity: row.isAuto,
      })),
    },
    leftToAllocate: {
      againstCaps: format(analysis.allocation.budgetedLeft),
      againstAverageSpend: format(analysis.allocation.avgLeft),
      planFitsInsideIncome: analysis.allocation.budgetedLeft >= 0,
    },
    detectedInBankActivity: {
      savingsPerMonth: format(analysis.detectedFromBank.savingsContrib),
      investmentsPerMonth: format(analysis.detectedFromBank.investContrib),
    },
    observations: (context.storedInsights?.observations ?? analysis.observations).map(item => ({
      title: item.title,
      status: item.status,
      evidence: normalizeUsdText(item.evidence),
    })),
  }
  return {
    system: financeSystemPrompt(advisorRole('Budget'), {
      extra: `${JSON.stringify(source, null, 2)}

Use only the supplied facts. Do not perform arithmetic or invent causes, intentions, transactions or amounts. Every savings figure here is what the plan INTENDS to set aside, never what was actually saved — never call it an achieved savings rate, and if asked what was actually saved, say the Spend Analyzer's Financial Pace covers that. A cap sitting below average spending means either the cap is unrealistic or the spending needs to come down; present it as that choice rather than as a failure. Be constructive and non-shaming, but do not minimize a plan that commits more than comes in. Answer in 2–4 concise sentences, plain text only.`,
    }),
    maxTokens: 512,
  }
}

/**
 * Binds a chat request to one persisted budget insight record. Identical rules to the other three
 * triads, and deliberately the same implementation — see `chatBinding.js`.
 */
export function createBudgetChatBinding(options) {
  return createChatBinding(options)
}

/**
 * Pure Budget Chat interface, the plan-side sibling of `createDashboardChatTurn`.
 *
 * Same three tiers in the same order: a guided prompt answered entirely from computed facts; a
 * classified fact query answered the same way; and only for genuinely subjective questions, an
 * advisory model call handed pre-formatted numbers it is forbidden to recompute.
 *
 * Like the Dashboard's, the fact tier is a lookup over figures `buildBudgetAnalysis` already
 * computed rather than a second aggregation engine that could drift from the cards on screen.
 */
export function createBudgetChatTurn({ analysis, storedInsights = null, messages = [] }) {
  const safeMessages = validateMessages(messages)
  const latestUser = safeMessages.at(-1)
  if (latestUser?.role !== 'user') throw new Error('Budget chat requires the latest message to be from the user')

  const context = { analysis, storedInsights, messages: safeMessages }
  const directReply = guidedReply(latestUser.content, storedInsights, context)

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
