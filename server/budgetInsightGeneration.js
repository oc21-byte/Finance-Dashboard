import { formatUsd, normalizeUsdText } from './currencyFormatting.js'
import { stripJsonFence, validateSummary } from './modelText.js'

const EXPLORE_OPTIONS = [
  {
    id: '1',
    key: 'where_the_plan_strains',
    title: 'Where the plan strains',
    description: 'See which caps sit below what actually gets spent.',
    prompt: 'Which of my caps are below what I actually spend?',
  },
  {
    id: '2',
    key: 'the_split',
    title: 'How income divides',
    description: 'Break income into caps, savings, and what is left.',
    prompt: 'How does my income divide between caps, savings and what is left?',
  },
  {
    id: '3',
    key: 'reaching_the_target',
    title: 'Reaching the target',
    description: 'Check the planned savings rate against your target.',
    prompt: 'Is my plan on track for my savings target?',
  },
]

const EXPLORE_PROMPT = {
  title: 'Explore your plan',
  body: 'Choose a deeper look, or ask your own question.',
  footer: 'Reply with 1, 2, or 3—or ask anything about your budget.',
}

/**
 * The model returns wording for exactly the observations that were already selected.
 *
 * Identical discipline to the other three triads, and identical failure mode on violation: a body
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
  const money = value => (value == null ? null : formatUsd(value))
  const { income, caps, savings, allocation, observations, scope } = analysis
  return {
    window: scope.label,
    monthlyIncome: {
      amount: money(income.display),
      source: income.isConfirmed ? 'confirmed_take_home_pay' : 'observed_bank_average',
      completeMonthsMeasured: income.monthsCovered,
    },
    spendingCaps: {
      totalCapped: money(caps.spendingTotal),
      totalAverageSpend: money(caps.averageSpend),
      categoriesCapped: caps.pressure.capped,
      categoriesUncapped: caps.pressure.uncapped,
      categoriesOverCap: caps.pressure.overCount,
      // Self-describing on purpose. Named as a bare "combined overspend" it reads as the
      // difference between the two totals above, which it is not — under-cap categories are
      // excluded, so the two figures cannot be related by subtraction.
      overspendAcrossOverCapCategoriesOnlyPerMonth: money(caps.pressure.overBy),
      note: 'totalCapped and totalAverageSpend cover ALL categories. overspendAcrossOverCapCategoriesOnlyPerMonth covers only the categories that are over their cap, so it is not the difference between those two totals.',
      rows: caps.rows.slice(0, 8).map(row => ({
        category: row.name,
        cap: money(row.cap),
        averageSpend: money(row.average),
        percentOfCap: row.pct,
        overCap: row.over,
        overCapBy: money(row.overBy),
      })),
    },
    savingsPlan: {
      // Named "planned" everywhere on purpose. Spend's Financial Pace owns the achieved rate, and
      // a model handed an unqualified "savings rate" here would write about the wrong one.
      plannedPerMonth: money(savings.planned),
      plannedRatePercentOfIncome: savings.rate.plannedPct,
      targetRatePercentOfIncome: savings.rate.targetPct,
      targetPerMonth: money(savings.rate.targetDollars),
      // The comparison, already made. Positive is short of target, negative is ahead of it.
      shortfallPerMonth: money(savings.rate.shortfall),
      clearsTarget: savings.rate.onTrack,
      goalFundingPerMonth: money(savings.goals),
      savingsCategoryCapsPerMonth: money(savings.categoryCaps),
      goals: savings.goalRows.map(row => ({
        name: row.name,
        plannedPerMonth: money(row.planned),
        inferredFromBankActivity: row.isAuto,
      })),
    },
    leftToAllocate: {
      againstCaps: money(allocation.budgetedLeft),
      againstAverageSpend: money(allocation.avgLeft),
      planFitsInsideIncome: allocation.budgetedLeft >= 0,
    },
    detectedInBankActivity: {
      savingsContributionsPerMonth: money(analysis.detectedFromBank.savingsContrib),
      investmentContributionsPerMonth: money(analysis.detectedFromBank.investContrib),
    },
    // Titles, statuses and evidence are final. The model writes only the body under each.
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
export function normalizeBudgetInsightRecord(record) {
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
 * Pure generation interface, the plan-side sibling of `createFinanceInsightGeneration`.
 *
 * The caller sends `prompt` to the configured model and passes the raw response to `complete`.
 * Selection, ranking, titles, statuses and every number come exclusively from `analysis`; the
 * model supplies short wording and nothing else.
 */
export function createBudgetInsightGeneration({ analysis, period, periodLabel = null, scope = null }) {
  const facts = promptFacts(analysis)
  const expectedKeys = analysis.observations.map(item => item.key)

  const prompt = {
    system: `You write concise copy for a personal finance dashboard. The facts, selections, titles and arithmetic are already final. Never recalculate, alter or contradict them. Respond with valid JSON only.`,
    user: `Write the short copy displayed on a user's deterministic Budget insights.

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
- Never use shaming labels such as reckless, irresponsible, bad with money or impulsive.
- This is a PLAN, not a record of what happened. Every savings figure here is what the plan intends to set aside, never what was actually saved. Never call it an achieved or actual savings rate.
- A cap sitting below average spending means the cap is unrealistic or the spending needs to come down. Present it as a choice between those two, never as a failure.
- Money planned for savings, investments or a goal is allocation, not spending — never describe it as an expense or as money lost.
- Do not invent causes, intentions, transactions, amounts or recommendations unsupported by the source facts.
- Do not perform arithmetic. Copy exact monetary values only when they appear in the source facts.
- Never present one supplied figure as the difference between two others. In particular, the overspend across over-cap categories is not the gap between the capped total and the average-spend total.

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
        analysisVersion: analysis.analysisVersion,
        // `period` remains the opaque scope key used for stale checks and chat matching.
        period,
        periodLabel: periodLabel ?? analysis.scope.label,
        scope: scope && typeof scope !== 'string' ? scope : null,
        // Budget has no period chips, so the scope key alone cannot detect a stale generation —
        // the window is fixed and the numbers move when a cap is edited. The fingerprint is what
        // stops the rail asserting a rate the KPI strip above it no longer shows.
        fingerprint: analysis.fingerprint,
        headline: copy.headline,
        income: analysis.income,
        caps: analysis.caps,
        savings: analysis.savings,
        allocation: analysis.allocation,
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
