import { formatUsd, normalizeUsdText } from './currencyFormatting.js'
import { stripJsonFence, validateSummary } from './modelText.js'

const EXPLORE_OPTIONS = [
  {
    id: '1',
    key: 'cash_flow',
    title: 'Cash flow',
    description: 'See how much of what came in actually stayed.',
    prompt: 'How did money in compare with money out?',
  },
  {
    id: '2',
    key: 'where_it_went',
    title: 'Where it went',
    description: 'Break down the largest destinations for money leaving the account.',
    prompt: 'Where did most of my money go?',
  },
  {
    id: '3',
    key: 'saving_and_investing',
    title: 'Saving & investing',
    description: 'Check what was set aside against the pace target.',
    prompt: 'How much am I setting aside, and is it enough?',
  },
]

const EXPLORE_PROMPT = {
  title: 'Explore your finances',
  body: 'Choose a deeper look, or ask your own question.',
  footer: 'Reply with 1, 2, or 3—or ask anything about your accounts.',
}

/**
 * The model returns wording for exactly the observations that were already selected.
 *
 * A body for a key that was not selected is rejected rather than dropped: a response inventing a
 * fourth finding, or renaming one, means the model treated the catalogue as a suggestion, and the
 * safe reading of that is to fail the generation rather than to persist the half of it that parsed.
 */
function parseCopy(text, expectedKeys) {
  const parsed = JSON.parse(stripJsonFence(text))
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('AI response must be a JSON object')
  }
  const keys = Object.keys(parsed).sort()
  if (keys.length !== 2 || keys[0] !== 'observations' || keys[1] !== 'paceSummary') {
    throw new Error('AI response must include exactly paceSummary and observations')
  }
  const paceSummary = normalizeUsdText(validateSummary(parsed.paceSummary, 'paceSummary'))

  if (!Array.isArray(parsed.observations) || parsed.observations.length !== expectedKeys.length) {
    throw new Error(`AI response must include exactly ${expectedKeys.length} observations`)
  }
  const bodies = new Map()
  for (const entry of parsed.observations) {
    if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string') {
      throw new Error('Each observation must be an object with a key and a body')
    }
    if (!expectedKeys.includes(entry.key)) {
      throw new Error(`Unexpected observation key: ${entry.key}`)
    }
    if (bodies.has(entry.key)) throw new Error(`Duplicate observation key: ${entry.key}`)
    bodies.set(entry.key, normalizeUsdText(validateSummary(entry.body, `observation ${entry.key}`)))
  }
  if (bodies.size !== expectedKeys.length) {
    throw new Error('AI response must include one observation per selected key')
  }
  return { paceSummary, bodies }
}

function promptFacts(analysis) {
  const { pace, cashflow, inflows, outflows, destinations, observations, scopes } = analysis
  const money = value => (value == null ? null : formatUsd(value))
  return {
    period: scopes.insight?.label ?? 'no bank activity',
    cashflow: {
      income: money(cashflow.countedIncome),
      expenses: money(cashflow.expenses),
      netCash: money(cashflow.netCash),
      saved: money(cashflow.saved),
      invested: money(cashflow.invested),
      unallocated: money(cashflow.unallocated),
      monthsWithActivity: cashflow.monthsWithActivity,
      transactions: cashflow.txCount,
    },
    topInflows: inflows.slice(0, 5).map(row => ({ name: row.name, amount: money(row.amount) })),
    topOutflows: outflows.slice(0, 5).map(row => ({ name: row.name, amount: money(row.amount) })),
    destinations: destinations.destinations.slice(0, 5).map(row => ({
      name: row.name,
      kind: row.kind,
      amount: money(row.amount),
    })),
    financialPace: {
      status: pace.status,
      label: pace.label,
      income: money(pace.income),
      incomeSource: pace.incomeSource,
      expenses: money(pace.expenses),
      headroom: money(pace.headroom),
      savingsTarget: money(pace.savingsTarget),
      savingsContributions: money(pace.savingsContributions),
      monthsCovered: pace.monthsCovered,
      confidence: pace.confidence,
      evidence: pace.evidence.map(normalizeUsdText),
      period: scopes.financial?.label ?? 'no complete bank months',
    },
    // Titles and evidence are final. The model writes only the body under each.
    observations: observations.map(item => ({
      key: item.key,
      title: item.title,
      status: item.status,
      evidence: normalizeUsdText(item.evidence),
    })),
  }
}

// Older persisted insights may predate a formatting change. Keep those records readable
// immediately without rewriting db.json or requiring another model call.
export function normalizeFinanceInsightRecord(record) {
  if (!record || Array.isArray(record) || typeof record !== 'object') return record
  const normalizeField = value => typeof value === 'string' ? normalizeUsdText(value) : value
  return {
    ...record,
    pace: record.pace ? {
      ...record.pace,
      summary: normalizeField(record.pace.summary),
      evidence: Array.isArray(record.pace.evidence)
        ? record.pace.evidence.map(normalizeField)
        : record.pace.evidence,
    } : record.pace,
    observations: Array.isArray(record.observations)
      ? record.observations.map(item => ({
        ...item,
        evidence: normalizeField(item.evidence),
        body: normalizeField(item.body),
      }))
      : record.observations,
    messages: Array.isArray(record.messages)
      ? record.messages.map(message => message?.role === 'assistant'
        ? { ...message, content: normalizeField(message.content) }
        : message)
      : record.messages,
  }
}

/**
 * Pure two-stage generation interface, the finance sibling of `createSpendInsightGeneration`.
 *
 * The caller sends `prompt` to the configured model and passes the raw response to `complete`.
 * Selection, ranking, titles, statuses and every number come exclusively from `analysis`; the model
 * supplies short wording and nothing else.
 */
export function createFinanceInsightGeneration({ analysis, period, periodLabel = null, scope = null }) {
  const facts = promptFacts(analysis)
  const expectedKeys = analysis.observations.map(item => item.key)

  const prompt = {
    system: `You write concise copy for a personal finance dashboard. The facts, selections, titles and arithmetic are already final. Never recalculate, alter or contradict them. Respond with valid JSON only.`,
    user: `Write the short copy displayed on a user's deterministic Finances insights.

SOURCE FACTS — use only these values:
${JSON.stringify(facts, null, 2)}

Return exactly this JSON shape:
{"paceSummary":"...","observations":[${expectedKeys.map(key => `{"key":"${key}","body":"..."}`).join(',')}]}

Writing rules:
- Return one observation for each key listed above, in that order, and no others.
- Each summary and each body must be no more than 2 sentences.
- Plain text only: no markdown, headings, bullets or emoji.
- A body explains what its title already states; never restate the title verbatim and never contradict it.
- Sound positive, polished and human, but do not flatter or minimize a financial problem.
- Never use shaming labels such as reckless, irresponsible, bad with money or impulsive.
- Money moved to savings or investments is allocation, not spending — never describe it as an expense or as money lost.
- Do not invent causes, intentions, budgets, transactions, amounts or recommendations unsupported by the source facts.
- The pace summary should state its basis plainly. For Over Pace, state the supplied monthly gap and give one calm next step. For Little Room, explain the savings-target shortfall without calling it overspending. For On Track, acknowledge the available room without promising future results. For Not Enough Data, say what information is missing.
- Do not perform arithmetic. Copy exact monetary values only when they appear in the source facts.

Valid JSON only.`,
    maxTokens: 640,
  }

  return {
    prompt,
    complete(rawText, generatedAt) {
      if (typeof generatedAt !== 'string' || !generatedAt.trim() || Number.isNaN(Date.parse(generatedAt))) {
        throw new Error('generatedAt must be a valid ISO timestamp string')
      }
      const copy = parseCopy(rawText, expectedKeys)
      return {
        analysisVersion: 1,
        // `period` remains the opaque selected-scope key used for stale checks and chat matching.
        period,
        periodLabel: periodLabel ?? analysis.scopes.insight?.label ?? null,
        scope: scope && typeof scope !== 'string' ? scope : null,
        financialScope: analysis.scopes.financial,
        pace: { ...analysis.pace, summary: copy.paceSummary },
        cashflow: analysis.cashflow,
        destinations: analysis.destinations,
        duplicates: analysis.duplicates,
        // Order is the deterministic ranking, never the order the model replied in.
        observations: analysis.observations.map(item => ({
          key: item.key,
          title: item.title,
          status: item.status,
          evidence: item.evidence,
          facts: item.facts,
          body: copy.bodies.get(item.key),
        })),
        explorePrompt: { ...EXPLORE_PROMPT },
        exploreOptions: EXPLORE_OPTIONS.map(option => ({ ...option })),
        messages: [],
        generatedAt: generatedAt.trim(),
      }
    },
  }
}
