// What the app is, in the form a model needs — the single home for prompt persona and vocabulary.
//
// Every prompt in this server used to state its own persona inline, and the two that matter were
// copy-pasted rather than imported: the copywriter line appeared verbatim in all four
// `*InsightGeneration.js` files, the advisory line in all four `*Chat.js` files. Domain invariants
// were re-stated by hand on top of that — "allocation, not spending", "never call it net worth",
// "planned, not achieved" each lived in two to four separate strings. Nothing enforced that a new
// surface got any of them, and nothing made a drift in one tab's persona visible.
//
// The Goals prompts are what that cost. Their whole system message was "You are a practical
// personal finance advisor", so the model reasoned about a generic finance app and filled the gaps
// itself — which is how a goal created a minute ago came to be reported as behind schedule.
//
// Two hard rules for anything added here:
//
//   1. **No figures.** This module states vocabulary and ownership; it never carries a total, a
//      threshold or a benchmark. Deterministic analysis owns every number, and a number that
//      reached a model from here would be one no JS had computed. `test/appKnowledge.test.js`
//      pins it, and `test/financeChat.test.js` already refuses a bare amount in a system prompt.
//   2. **Knowledge, not instructions.** Tab-specific writing rules stay at their call site, next
//      to the facts they govern. What belongs here is what is true of the app on every tab.
//
// Derived from `CONTEXT.md` (the ubiquitous-language glossary) and the Ledger-semantics and
// Insight-contracts sections of `AGENTS.md`. Those stay the source of truth — when a rule changes
// there, change it here too, and nowhere else.

/**
 * What the app is and which tab owns which subject.
 *
 * The tab-ownership paragraph is not padding. The four insight catalogues are disjoint by subject
 * on purpose (`AGENTS.md` — Insight contracts), so a user reading two tabs never meets one finding
 * under two headings. A model that does not know Spend is the card ledger and Finances the bank
 * ledger will happily answer a card question on the bank tab and break that guarantee.
 */
export const APP_MODEL = `About this app:
- It is a local-only personal finance dashboard over five stored things: a bank ledger, a credit-card ledger, investment holdings (purchase lots), savings accounts, and savings goals.
- Six tabs, each owning a different subject. Dashboard: the balance — liquid net worth, what it is made of, and what changed it. Finances: the bank ledger — income, expenses and allocation. Spend Analyzer: the card ledger — purchases, categories, merchants and card rewards. Budget: the plan — spending caps, how income divides, and goal funding. Investments: holdings and savings accounts. Goals: what the person is saving toward.
- Those subjects are deliberately disjoint. Answer from the tab you are on, and send a question that belongs to another tab there rather than answering it twice.
- Ledger semantics: expenses and outflows are negative, income and credits positive. A bank row is typed income or expense only — Savings and Investments are categories on an expense row, not types of their own. Card rows carry no type; a positive card row is a credit and names its kind.
- A credit-card payment is never stored in the card ledger. The bank-side settlement already records it, so counting both would double the expense.
- Every figure shown to the user is computed in JavaScript before it reaches you. You are writing prose about numbers that are already final — never recompute, adjust or contradict one, and never introduce a number that was not supplied.`

/**
 * The distinctions this app's language depends on, stated once.
 *
 * Each of these is a mistake a model makes by default, because the plain-English reading is the
 * wrong one: money leaving an account looks like spending, a portfolio going up looks like a
 * return, "savings rate" looks like one number. Each was previously prevented by a sentence
 * hand-copied into whichever prompts someone remembered.
 */
export const VOCABULARY = `Vocabulary — these distinctions matter, and the everyday reading of each is the wrong one:
- Money moved to savings or investments is allocation, not spending — never describe it as an expense or as money lost. A savings transfer or an investment contribution is still an outflow, so total money out is expenses plus allocation, while net cash is income minus expenses only.
- Liquid net worth counts cash, savings and investment accounts only. It excludes property, vehicles, private or corporate shares, and debts — so never call it net worth and never imply it covers assets it does not.
- Market movement is the change in unrealised gain, not a return on contributions. Money moved into an investment account is never investment performance.
- A savings rate is either planned or achieved and the two are routinely far apart. The planned rate is what a budget sets aside; the achieved rate is what actually reached savings. Always say which one you mean.
- A card credit — cashback, a refund, a rebate — reduces what is owed. It is not income and not negative spending.
- Estimated rewards are what a card's published rates would have paid on spending that happened. They are an estimate about a period, never what an issuer actually credited, and never added to card credits.
- A goal linked to accounts derives its balance from those accounts. It is not a figure the person typed, and it moves when the linked balances move.
- Describe a shortfall plainly and without shaming. Never use labels such as reckless, irresponsible, bad with money or impulsive.`

/**
 * The persona the four deterministic insight generations share.
 *
 * The list is the union of what the four used to say separately — Spend named "classifications,
 * scores" where the others named "selections, titles", and a copywriter who may not alter a title
 * may not alter a trait score either.
 */
export const COPYWRITER_ROLE = 'You write concise copy for a personal finance dashboard. The facts, selections, classifications, scores, titles and arithmetic are already final. Never recalculate, alter or contradict them. Respond with valid JSON only.'

/** The persona the four insight chats share. `tab` names the stored result under discussion. */
export function advisorRole(tab) {
  return `You are a practical personal finance assistant answering an advisory question about a stored ${tab} result.`
}

/**
 * The date, stated because a model has no access to one.
 *
 * `asOf` is injected rather than read from a clock so that a prompt built from it is reproducible
 * and testable — the same purity rule `buildDashboardAnalysis` follows. It reaches only the
 * surfaces that reason about calendar time (goal target dates, "months from now").
 */
export function todayLine(asOf) {
  const date = asOf instanceof Date ? asOf : new Date(asOf ?? Date.now())
  if (Number.isNaN(date.getTime())) throw new Error('todayLine requires a valid date')
  return `Today's date is ${date.toISOString().slice(0, 10)}.`
}

/**
 * Composes a system prompt: who you are, what this app is, what its words mean, then whatever the
 * call site needs to add.
 *
 * `extra` is where a surface puts its own material — the fact bundle a chat embeds, the writing
 * rules a generation attaches. It goes last so the tab-specific instruction is the closest thing
 * to the question.
 */
export function financeSystemPrompt(role, { today = false, asOf = null, extra = null } = {}) {
  const sections = [role, APP_MODEL, VOCABULARY]
  if (today) sections.push(todayLine(asOf))
  if (extra) sections.push(extra)
  return sections.filter(Boolean).join('\n\n')
}
