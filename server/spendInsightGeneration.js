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

const MAX_SUMMARY_CHARS = 600
const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

function stripJsonFence(text) {
  return String(text ?? '').trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
}

function validateSummary(value, field) {
  const summary = typeof value === 'string' ? value.trim() : ''
  if (!summary) throw new Error(`AI response must include a non-empty ${field} string`)
  if (summary.length > MAX_SUMMARY_CHARS) throw new Error(`${field} exceeds ${MAX_SUMMARY_CHARS} characters`)
  if (/[\r\n`]/.test(summary) || /<\/?[a-z][^>]*>/i.test(summary)) {
    throw new Error(`${field} must be plain text on one line`)
  }
  const sentenceCount = [...sentenceSegmenter.segment(summary)]
    .filter(segment => segment.segment.trim())
    .length
  if (sentenceCount > 2) throw new Error(`${field} must contain no more than 2 sentences`)
  return summary
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
  const profileSummary = validateSummary(parsed.profileSummary, 'profileSummary')
  const financialPaceSummary = validateSummary(parsed.financialPaceSummary, 'financialPaceSummary')
  return { profileSummary, financialPaceSummary }
}

function promptFacts(analysis) {
  const { profile, financialPace, scopes } = analysis
  return {
    profile: {
      name: profile.name,
      tagline: profile.tagline,
      traits: profile.traits.map(({ label, score, evidence }) => ({ label, score, evidence })),
      confidence: profile.confidence,
      recurring: profile.recurring ?? null,
      period: scopes.profile?.label ?? 'no card-spending history',
    },
    financialPace: {
      status: financialPace.status,
      label: financialPace.label,
      income: financialPace.income,
      incomeSource: financialPace.incomeSource,
      observedIncome: financialPace.observedIncome ?? null,
      expenses: financialPace.expenses,
      headroom: financialPace.headroom,
      savingsTarget: financialPace.savingsTarget,
      savingsTargetSource: financialPace.savingsTargetSource,
      monthsCovered: financialPace.monthsCovered,
      confidence: financialPace.confidence,
      evidence: financialPace.evidence,
      period: scopes.financial?.label ?? 'no complete bank months',
    },
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
