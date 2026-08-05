import { formatUsd, normalizeUsdText } from './currencyFormatting.js'
import { stripJsonFence, validateSummary } from './modelText.js'

const EXPLORE_OPTIONS = [
  {
    id: '1',
    key: 'category_patterns',
    title: 'Category patterns',
    description: 'See where your spending is concentrated.',
    prompt: 'What patterns stand out across my spending categories?',
  },
  {
    id: '2',
    key: 'merchant_habits',
    title: 'Merchant habits',
    description: 'Explore repeat merchants and purchasing routines.',
    prompt: 'What do my merchant habits reveal?',
  },
  {
    id: '3',
    key: 'anomalies_opportunities',
    title: 'Anomalies & opportunities',
    description: 'Find unusual activity and practical ways to create more room.',
    prompt: 'Show me unusual spending and realistic opportunities to improve.',
  },
]

const EXPLORE_PROMPT = {
  title: 'Explore your spending',
  body: 'Choose a deeper look, or ask your own question.',
  footer: 'Reply with 1, 2, or 3—or ask anything about your spending.',
}

function parseCopy(text) {
  const parsed = JSON.parse(stripJsonFence(text))
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('AI response must be a JSON object')
  }
  const keys = Object.keys(parsed).sort()
  if (keys.length !== 2 || keys[0] !== 'financialPaceSummary' || keys[1] !== 'profileSummary') {
    throw new Error('AI response must include exactly profileSummary and financialPaceSummary')
  }
  const profileSummary = normalizeUsdText(validateSummary(parsed.profileSummary, 'profileSummary'))
  const financialPaceSummary = normalizeUsdText(validateSummary(parsed.financialPaceSummary, 'financialPaceSummary'))
  return { profileSummary, financialPaceSummary }
}

function promptFacts(analysis) {
  const { profile, financialPace, scopes } = analysis
  return {
    profile: {
      name: profile.name,
      tagline: profile.tagline,
      traits: profile.traits.map(({ label, score, evidence }) => ({
        label,
        score,
        evidence: normalizeUsdText(evidence),
      })),
      confidence: profile.confidence,
      recurring: profile.recurring
        ? { ...profile.recurring, monthlyTotal: formatUsd(profile.recurring.monthlyTotal) }
        : null,
      period: scopes.profile?.label ?? 'no card-spending history',
    },
    financialPace: {
      status: financialPace.status,
      label: financialPace.label,
      income: financialPace.income == null ? null : formatUsd(financialPace.income),
      incomeSource: financialPace.incomeSource,
      observedIncome: financialPace.observedIncome == null ? null : formatUsd(financialPace.observedIncome),
      expenses: financialPace.expenses == null ? null : formatUsd(financialPace.expenses),
      headroom: financialPace.headroom == null ? null : formatUsd(financialPace.headroom),
      savingsTarget: financialPace.savingsTarget == null ? null : formatUsd(financialPace.savingsTarget),
      savingsTargetSource: financialPace.savingsTargetSource,
      monthsCovered: financialPace.monthsCovered,
      confidence: financialPace.confidence,
      evidence: financialPace.evidence.map(normalizeUsdText),
      period: scopes.financial?.label ?? 'no complete bank months',
    },
  }
}

// Older persisted insights may have been generated before prompt amounts were formatted. Keep
// those records readable immediately without rewriting db.json or requiring another model call.
export function normalizeSpendInsightRecord(record) {
  if (!record || Array.isArray(record) || typeof record !== 'object') return record
  const normalizeField = value => typeof value === 'string' ? normalizeUsdText(value) : value
  return {
    ...record,
    profile: record.profile ? {
      ...record.profile,
      summary: normalizeField(record.profile.summary),
      traits: Array.isArray(record.profile.traits)
        ? record.profile.traits.map(trait => ({ ...trait, evidence: normalizeField(trait.evidence) }))
        : record.profile.traits,
    } : record.profile,
    financialPace: record.financialPace ? {
      ...record.financialPace,
      summary: normalizeField(record.financialPace.summary),
      evidence: Array.isArray(record.financialPace.evidence)
        ? record.financialPace.evidence.map(normalizeField)
        : record.financialPace.evidence,
    } : record.financialPace,
    messages: Array.isArray(record.messages)
      ? record.messages.map(message => message?.role === 'assistant'
        ? { ...message, content: normalizeField(message.content) }
        : message)
      : record.messages,
  }
}

/**
 * Pure two-stage generation interface. The caller sends `prompt` to the configured model, then
 * passes the raw response to `complete`. Classification, arithmetic and scopes come exclusively
 * from `analysis`; the model supplies concise wording only.
 */
export function createSpendInsightGeneration({ analysis, period, periodLabel = null, scope = null }) {
  const facts = promptFacts(analysis)
  const prompt = {
    system: `You write concise copy for a personal finance dashboard. The facts, classifications, scores and arithmetic are already final. Never recalculate, alter or contradict them. Respond with valid JSON only.`,
    user: `Write the two short summaries displayed beneath a user's deterministic Spend Style and Financial Pace.

SOURCE FACTS — use only these values:
${JSON.stringify(facts, null, 2)}

Return exactly this JSON shape:
{"profileSummary":"...","financialPaceSummary":"..."}

Writing rules:
- Each summary must be no more than 2 sentences.
- Plain text only: no markdown, headings, bullets or emoji.
- Sound positive, polished and human, but do not flatter or minimize a financial problem.
- Treat Spend Style as a description of recent behaviour, never a permanent personality or psychological diagnosis.
- Never use shaming labels such as reckless, irresponsible, bad with money or impulsive.
- Never call the distribution healthy or unhealthy.
- Do not invent causes, intentions, budgets, transactions, amounts or recommendations unsupported by the source facts.
- The profile summary should explain the assigned style using its evidence.
- The Financial Pace summary should state its basis plainly. For Over Pace, state the supplied monthly gap and give one calm next step. For Little Room, explain the savings-target shortfall without calling it overspending. For On Track, acknowledge the available room without promising future results. For Not Enough Data, say what information is missing.
- Do not offer the category, merchant or anomaly analyses here; those are optional follow-ups.
- Do not perform arithmetic. Copy exact monetary values only when they appear in the source facts.

Valid JSON only.`,
    maxTokens: 384,
  }

  return {
    prompt,
    complete(rawText, generatedAt) {
      if (typeof generatedAt !== 'string' || !generatedAt.trim() || Number.isNaN(Date.parse(generatedAt))) {
        throw new Error('generatedAt must be a valid ISO timestamp string')
      }
      const copy = parseCopy(rawText)
      return {
        analysisVersion: 2,
        // `period` remains the opaque selected-scope key used for stale checks and chat matching.
        period,
        periodLabel: periodLabel ?? analysis.scopes.insight?.label ?? null,
        scope: scope && typeof scope !== 'string' ? scope : null,
        profileScope: analysis.scopes.profile,
        financialScope: analysis.scopes.financial,
        profile: { ...analysis.profile, summary: copy.profileSummary },
        financialPace: { ...analysis.financialPace, summary: copy.financialPaceSummary },
        explorePrompt: { ...EXPLORE_PROMPT },
        exploreOptions: EXPLORE_OPTIONS.map(option => ({ ...option })),
        messages: [],
        generatedAt: generatedAt.trim(),
      }
    },
  }
}
