import dayjs from 'dayjs'
import { formatUsd, normalizeUsdText } from './currencyFormatting.js'
import { stripJsonFence, validateSummary } from './modelText.js'
import { COPYWRITER_ROLE, financeSystemPrompt } from './appKnowledge.js'

const EXPLORE_OPTIONS = [
  {
    id: '1',
    key: 'what_changed',
    title: 'What moved it',
    description: 'Split the change into what you saved and what the markets did.',
    prompt: 'What moved my liquid net worth?',
  },
  {
    id: '2',
    key: 'whats_it_in',
    title: "What it's sitting in",
    description: 'Break the total down by cash, savings and each investment account.',
    prompt: 'What is my money sitting in?',
  },
  {
    id: '3',
    key: 'runway_and_goals',
    title: 'Runway & goals',
    description: 'Check how long cash would last and whether your goals are on pace.',
    prompt: 'How long would my cash last, and are my goals on pace?',
  },
]

const EXPLORE_PROMPT = {
  title: 'Explore your liquid net worth',
  body: 'Choose a deeper look, or ask your own question.',
  footer: 'Reply with 1, 2, or 3—or ask anything about your balances.',
}

/**
 * The model returns wording for exactly the observations that were already selected.
 *
 * Identical discipline to the two ledger triads, and identical failure mode on violation: a body
 * for a key that was not selected means the model treated the catalogue as a suggestion, so the
 * whole generation is rejected rather than half of it persisted.
 */
function parseCopy(text, expectedKeys) {
  const parsed = JSON.parse(stripJsonFence(text))
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('AI response must be a JSON object')
  }
  const keys = Object.keys(parsed).sort()
  if (keys.length !== 2 || keys[0] !== 'headline' || keys[1] !== 'observations') {
    throw new Error('AI response must include exactly headline and observations')
  }
  const headline = normalizeUsdText(validateSummary(parsed.headline, 'headline'))

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
  return { headline, bodies }
}

function promptFacts(analysis) {
  const { kpis, composition, attribution, runway, goals, observations, scope } = analysis
  const money = value => (value == null ? null : formatUsd(value))
  return {
    asOf: analysis.asOf,
    changePeriod: scope.label,
    liquidNetWorth: {
      total: money(kpis.liquid),
      cash: money(kpis.cash),
      savings: money(kpis.savings),
      portfolio: money(kpis.portfolio),
      // Dated by the comparison point, never by a nominal day count — history younger than the
      // window is compared against its earliest entry, which can be months rather than days back.
      changeSince: kpis.deltas ? money(kpis.deltas.liquid.abs) : null,
      comparedWith: kpis.since,
      // The definition, stated so the model never widens the claim to "net worth".
      excludes: 'property, vehicles, private or corporate shares, and debts',
    },
    composition: composition.rows.map(row => ({
      name: row.name,
      bucket: row.bucket,
      amount: money(row.value),
      percent: row.pct,
    })),
    change: {
      period: scope.label,
      window: `${attribution.from} to ${attribution.to}`,
      start: money(attribution.start),
      end: money(attribution.end),
      total: money(attribution.change),
      moneyIn: money(attribution.moneyIn),
      moneyOut: money(attribution.moneyOut),
      savedNet: money(attribution.saved),
      market: money(attribution.market),
      statementLag: money(attribution.lag),
      unexplained: money(attribution.unexplained),
      residual: money(attribution.other),
      basis: attribution.basis,
    },
    runway: {
      months: runway.months,
      cash: money(runway.cash),
      averageMonthlySpend: money(runway.averageMonthlySpend),
      completeMonthsMeasured: runway.monthsCounted,
    },
    goals: goals.slice(0, 5).map(goal => ({
      name: goal.name,
      target: money(goal.targetAmount),
      current: money(goal.currentAmount),
      percentComplete: goal.pct,
      remaining: money(goal.remaining),
      fundingRatePerMonth: money(goal.pace.perMonth),
      fundingRateSource: goal.pace.source,
      estimatedCompletion: goal.eta,
      targetDate: goal.targetDate,
      monthsLate: goal.slipMonths,
    })),
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
export function normalizeDashboardInsightRecord(record) {
  if (!record || Array.isArray(record) || typeof record !== 'object') return record
  const normalizeField = value => typeof value === 'string' ? normalizeUsdText(value) : value
  return {
    ...record,
    headline: normalizeField(record.headline),
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
 * Pure two-stage generation interface, the balance-side sibling of the spend and finance ones.
 *
 * The caller sends `prompt` to the configured model and passes the raw response to `complete`.
 * Selection, ranking, titles, statuses and every number come exclusively from `analysis`; the model
 * supplies short wording and nothing else.
 */
export function createDashboardInsightGeneration({ analysis, period, periodLabel = null, scope = null }) {
  const facts = promptFacts(analysis)
  const expectedKeys = analysis.observations.map(item => item.key)

  const prompt = {
    system: financeSystemPrompt(COPYWRITER_ROLE),
    user: `Write the short copy displayed on a user's deterministic Dashboard insights.

SOURCE FACTS — use only these values:
${JSON.stringify(facts, null, 2)}

Return exactly this JSON shape:
{"headline":"...","observations":[${expectedKeys.map(key => `{"key":"${key}","body":"..."}`).join(',')}]}

Writing rules:
- Return one observation for each key listed above, in that order, and no others.
- The headline and each body must be no more than 2 sentences.
- Plain text only: no markdown, headings, bullets or emoji.
- A body explains what its title already states; never restate the title verbatim and never contradict it.
- Sound positive, polished and human, but do not flatter or minimize a financial problem.
- Unexplained cash is a bookkeeping discrepancy between the imported statements and the real balance. Describe it as something to reconcile, never as spending or as a loss.
- The headline should state, in plain language, what the liquid net worth is now and what the period's change was driven by. Do not give advice in it.
- Do not invent causes, intentions, budgets, transactions, amounts or recommendations unsupported by the source facts.
- Never compare a figure to a benchmark, target, norm or rule of thumb that is not stated in the source facts, and never assert that a figure meets one.
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
      if (!dayjs(analysis.asOf).isValid()) throw new Error('analysis.asOf must be a valid date')
      const copy = parseCopy(rawText, expectedKeys)
      return {
        analysisVersion: 1,
        // `period` remains the opaque selected-scope key used for stale checks and chat matching.
        period,
        periodLabel: periodLabel ?? analysis.scope.label ?? null,
        scope: scope && typeof scope !== 'string' ? scope : null,
        asOf: analysis.asOf,
        headline: copy.headline,
        kpis: analysis.kpis,
        composition: analysis.composition,
        attribution: analysis.attribution,
        runway: analysis.runway,
        goals: analysis.goals,
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
