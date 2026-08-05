import dayjs from 'dayjs'
import { normalizeDescription } from '../src/utils/duplicates.js'
import { detectRecurring } from '../src/utils/recurring.js'
import { formatUsd } from './currencyFormatting.js'
import { isBankIncome, isBankExpense } from '../src/constants/financeRules.js'

const PROFILE_MONTHS = 6
const FINANCIAL_MONTHS = 6
const DEFAULT_SAVINGS_RATE = 15

const ARCHETYPES = {
  'loyal|focused|steady': {
    name: 'The Steady Regular',
    tagline: 'Your spending stays consistent and close to familiar priorities.',
  },
  'loyal|focused|event_driven': {
    name: 'The Focused Loyalist',
    tagline: 'You return to familiar places, with occasional periods of heavier spending.',
  },
  'loyal|eclectic|steady': {
    name: 'The Familiar Explorer',
    tagline: 'You spend across varied priorities while returning to merchants you know.',
  },
  'loyal|eclectic|event_driven': {
    name: 'The Occasion Curator',
    tagline: 'Your familiar favourites are punctuated by larger spending moments.',
  },
  'exploring|focused|steady': {
    name: 'The Category Curator',
    tagline: 'Your merchants change, but your spending priorities remain clear.',
  },
  'exploring|focused|event_driven': {
    name: 'The Selective Specialist',
    tagline: 'You concentrate on a few priorities and spend more around particular moments.',
  },
  'exploring|eclectic|steady': {
    name: 'The Everyday Explorer',
    tagline: 'Your spending is varied while maintaining a relatively even rhythm.',
  },
  'exploring|eclectic|event_driven': {
    name: 'The Variety Seeker',
    tagline: 'Your spending moves across merchants, categories and higher-activity moments.',
  },
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function round4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).isValid()
}

function dateBounds(transactions) {
  let from = null
  let to = null
  for (const tx of transactions) {
    if (!validDate(tx.date)) continue
    if (from === null || tx.date < from) from = tx.date
    if (to === null || tx.date > to) to = tx.date
  }
  return { from, to }
}

function monthsBetween(from, to) {
  if (!from || !to) return []
  const months = []
  let cursor = dayjs(from).startOf('month')
  const last = dayjs(to).startOf('month')
  while (cursor.isBefore(last) || cursor.isSame(last)) {
    months.push(cursor.format('YYYY-MM'))
    cursor = cursor.add(1, 'month')
  }
  return months
}

function formatRange(from, to) {
  if (!from || !to) return 'no data'
  return `${dayjs(from).format('MMM D, YYYY')} – ${dayjs(to).format('MMM D, YYYY')}`
}

function percentile(values, fraction) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function coefficientOfVariation(values) {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (mean === 0) return null
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length
  return Math.sqrt(variance) / mean
}

function rankTransactions(transactions, keyOf, labelOf = keyOf) {
  const groups = new Map()
  let total = 0
  for (const tx of transactions) {
    const amount = Math.abs(Number(tx.amount) || 0)
    const key = keyOf(tx) || 'Unknown'
    const label = labelOf(tx) || 'Unknown'
    const current = groups.get(key) ?? { name: label, amount: 0, visits: 0 }
    current.amount += amount
    current.visits++
    if (label.localeCompare(current.name) < 0) current.name = label
    groups.set(key, current)
    total += amount
  }
  return [...groups.values()]
    .map(group => ({
      ...group,
      amount: round2(group.amount),
      share: total > 0 ? round4(group.amount / total) : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
}

function compareTransactionMagnitude(a, b) {
  return Math.abs(Number(b.amount)) - Math.abs(Number(a.amount))
    || String(a.date ?? '').localeCompare(String(b.date ?? ''))
    || String(a.description ?? '').localeCompare(String(b.description ?? ''))
    || String(a.category ?? '').localeCompare(String(b.category ?? ''))
}

function categoryOf(tx) {
  return tx.category || 'Other'
}

function merchantKey(tx) {
  return normalizeDescription(tx.description) || 'unknown'
}

function merchantLabel(tx) {
  return tx.description || 'Unknown'
}

function creditFacts(transactions) {
  const credits = transactions.filter(tx => Number(tx.amount) > 0)
  const byKind = new Map()
  for (const tx of credits) {
    const kind = tx.creditKind || 'credit'
    byKind.set(kind, (byKind.get(kind) || 0) + Number(tx.amount))
  }
  return {
    count: credits.length,
    total: round2(credits.reduce((sum, tx) => sum + Number(tx.amount), 0)),
    byKind: [...byKind.entries()]
      .map(([kind, amount]) => ({ kind, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount || a.kind.localeCompare(b.kind)),
  }
}

function outlierFacts(spend) {
  if (!spend.length) return []
  const amounts = spend.map(tx => Math.abs(Number(tx.amount) || 0))
  const median = percentile(amounts, 0.5)
  const q1 = percentile(amounts, 0.25)
  const q3 = percentile(amounts, 0.75)
  const threshold = Math.max(q3 + 1.5 * (q3 - q1), median * 2.5)
  return spend
    .filter(tx => Math.abs(Number(tx.amount) || 0) >= threshold)
    .sort(compareTransactionMagnitude)
    .slice(0, 10)
    .map(tx => ({
      description: tx.description || 'Unknown',
      amount: round2(Math.abs(Number(tx.amount))),
      date: tx.date,
      category: categoryOf(tx),
    }))
}

function summarizeSpend(transactions, scope) {
  const spend = transactions.filter(tx => Number(tx.amount) < 0 && validDate(tx.date))
  const amounts = spend.map(tx => Math.abs(Number(tx.amount)))
  const descendingAmounts = [...amounts].sort((a, b) => b - a)
  const totalSpend = amounts.reduce((sum, amount) => sum + amount, 0)
  const categories = rankTransactions(spend, categoryOf)
  const merchants = rankTransactions(spend, merchantKey, merchantLabel)
  const { from, to } = dateBounds(spend)
  const months = scope?.months?.length ? scope.months : monthsBetween(from, to)
  const monthTotals = new Map(months.map(month => [month, 0]))
  for (const tx of spend) {
    const month = tx.date.slice(0, 7)
    if (monthTotals.has(month)) monthTotals.set(month, monthTotals.get(month) + Math.abs(Number(tx.amount)))
  }

  return {
    scope,
    totalSpend: round2(totalSpend),
    txCount: spend.length,
    averageTransaction: spend.length ? round2(totalSpend / spend.length) : 0,
    medianTransaction: round2(percentile(amounts, 0.5)),
    topTenPercentShare: totalSpend > 0
      ? round4(descendingAmounts
        .slice(0, Math.max(1, Math.ceil(spend.length * 0.1)))
        .reduce((sum, amount) => sum + amount, 0) / totalSpend)
      : 0,
    categories,
    merchants,
    monthlyTotals: [...monthTotals.entries()].map(([month, amount]) => ({ month, amount: round2(amount) })),
    largestTransactions: [...spend]
      .sort(compareTransactionMagnitude)
      .slice(0, 10)
      .map(tx => ({
        description: tx.description || 'Unknown',
        amount: round2(Math.abs(Number(tx.amount))),
        date: tx.date,
        category: categoryOf(tx),
      })),
    outliers: outlierFacts(spend),
    credits: creditFacts(transactions.filter(tx => validDate(tx.date))),
  }
}

function profileScope(cardTransactions) {
  const spend = cardTransactions.filter(tx => Number(tx.amount) < 0 && validDate(tx.date))
  const spendBounds = dateBounds(spend)
  const activityBounds = dateBounds(cardTransactions)
  if (!spendBounds.to || !activityBounds.to) return null
  const requestedFrom = dayjs(activityBounds.to).startOf('month').subtract(PROFILE_MONTHS - 1, 'month').format('YYYY-MM-DD')
  const from = spendBounds.from > requestedFrom ? spendBounds.from : requestedFrom
  const months = monthsBetween(from, activityBounds.to)
  return {
    from,
    to: activityBounds.to,
    months,
    filters: {},
    label: formatRange(from, activityBounds.to),
    basis: 'latest_unfiltered_card_spend',
  }
}

function matchesInsightScope(tx, scope) {
  if (!scope || scope === 'all') return true
  if (typeof scope === 'string') return tx.date?.startsWith(scope)
  const { from, to, filters = {} } = scope
  if (!validDate(tx.date)) return false
  if (from && tx.date < from) return false
  if (to && tx.date > to) return false
  if (filters.categories?.length && !filters.categories.includes(categoryOf(tx))) return false
  if (filters.cards?.length && !filters.cards.includes(tx.source)) return false
  if (filters.merchants?.length && !filters.merchants.includes(tx.description)) return false
  return true
}

function resolvedInsightScope(cardTransactions, requestedScope) {
  const matching = cardTransactions.filter(tx => matchesInsightScope(tx, requestedScope) && validDate(tx.date))
  const bounds = dateBounds(matching)
  if (requestedScope && typeof requestedScope === 'object') {
    const from = requestedScope.from ?? bounds.from
    const to = requestedScope.to ?? bounds.to
    return {
      from,
      to,
      months: from && to ? monthsBetween(from, to) : [],
      filters: requestedScope.filters ?? {},
      label: requestedScope.label ?? formatRange(from, to),
      basis: 'selected_spend_analyzer_scope',
    }
  }
  return {
    from: bounds.from,
    to: bounds.to,
    months: monthsBetween(bounds.from, bounds.to),
    filters: {},
    label: formatRange(bounds.from, bounds.to),
    basis: requestedScope && requestedScope !== 'all' ? 'legacy_period_scope' : 'all_card_activity',
  }
}

function trait(dimension, key, label, opposite, score, evidence) {
  return { dimension, key, label, opposite, score: Math.round(clamp(score)), evidence }
}

function buildProfile(profileFacts, recurring) {
  const txCount = profileFacts.txCount
  const monthsWithSpend = profileFacts.monthlyTotals.filter(month => month.amount > 0).length
  if (!txCount) {
    return {
      name: 'Not enough data',
      tagline: 'Import card activity to discover your Spend Style.',
      traits: [],
      confidence: { level: 'early_read', reason: 'No card purchases are available.' },
      evidence: [],
    }
  }

  const topMerchantShare = profileFacts.merchants[0]?.share ?? 0
  const repeatPurchaseCount = profileFacts.merchants
    .filter(merchant => merchant.visits > 1)
    .reduce((sum, merchant) => sum + merchant.visits, 0)
  const repeatPurchaseRate = repeatPurchaseCount / txCount
  const loyaltyScore = (repeatPurchaseRate * 0.65 + topMerchantShare * 0.35) * 100
  const merchantKeyName = loyaltyScore >= 45 ? 'loyal' : 'exploring'

  const topCategoryShare = profileFacts.categories[0]?.share ?? 0
  const topThreeCategoryShare = profileFacts.categories.slice(0, 3).reduce((sum, category) => sum + category.share, 0)
  const focusScore = (topThreeCategoryShare * 0.7 + topCategoryShare * 0.3) * 100
  const categoryKey = focusScore >= 65 ? 'focused' : 'eclectic'

  const monthlyAmounts = profileFacts.monthlyTotals.map(month => month.amount)
  const monthlyCv = coefficientOfVariation(monthlyAmounts)
  const largestShare = profileFacts.totalSpend > 0
    ? (profileFacts.largestTransactions[0]?.amount ?? 0) / profileFacts.totalSpend
    : 0
  const steadinessScore = monthlyCv === null
    ? 50
    : 100 - Math.min(monthlyCv, 1) * 70 - Math.min(largestShare / 0.4, 1) * 30
  const cadenceKey = steadinessScore >= 55 ? 'steady' : 'event_driven'

  const topTenShare = profileFacts.topTenPercentShare
  const mean = profileFacts.averageTransaction
  const medianToMean = mean > 0 ? profileFacts.medianTransaction / mean : 0
  const everydayScore = (1 - Math.min(topTenShare, 1)) * 65 + Math.min(medianToMean, 1) * 35
  const purchaseKey = everydayScore >= 55 ? 'everyday' : 'big_ticket'

  const merchantTrait = merchantKeyName === 'loyal'
    ? trait('merchant_pattern', 'loyal', 'Loyal', 'Exploring', loyaltyScore,
      `${Math.round(repeatPurchaseRate * 100)}% of purchases were with repeat merchants.`)
    : trait('merchant_pattern', 'exploring', 'Exploring', 'Loyal', 100 - loyaltyScore,
      `${profileFacts.merchants.length} different merchants appear across ${txCount} purchases.`)
  const categoryTrait = categoryKey === 'focused'
    ? trait('category_pattern', 'focused', 'Focused', 'Eclectic', focusScore,
      `The top three categories made up ${Math.round(topThreeCategoryShare * 100)}% of spending.`)
    : trait('category_pattern', 'eclectic', 'Eclectic', 'Focused', 100 - focusScore,
      `Spending was distributed across ${profileFacts.categories.length} categories.`)
  const cadenceTrait = cadenceKey === 'steady'
    ? trait('spending_cadence', 'steady', 'Steady', 'Event-driven', steadinessScore,
      `Monthly spending varied by ${monthlyCv === null ? 'an unknown amount' : `${Math.round(monthlyCv * 100)}%`} around its average.`)
    : trait('spending_cadence', 'event_driven', 'Event-driven', 'Steady', 100 - steadinessScore,
      `Monthly spending varied by ${monthlyCv === null ? 'an unknown amount' : `${Math.round(monthlyCv * 100)}%`} around its average.`)
  const purchaseTrait = purchaseKey === 'everyday'
    ? trait('purchase_style', 'everyday', 'Everyday', 'Big-ticket', everydayScore,
      `The median purchase was ${formatUsd(profileFacts.medianTransaction)}.`)
    : trait('purchase_style', 'big_ticket', 'Big-ticket', 'Everyday', 100 - everydayScore,
      `The largest purchases accounted for ${Math.round(topTenShare * 100)}% of spending.`)

  const archetype = ARCHETYPES[`${merchantKeyName}|${categoryKey}|${cadenceKey}`]
  const confidence = txCount >= 60 && monthsWithSpend >= 6
    ? { level: 'high', reason: `Based on ${txCount} purchases across ${monthsWithSpend} months.` }
    : txCount >= 30 && monthsWithSpend >= 3
      ? { level: 'medium', reason: `Based on ${txCount} purchases across ${monthsWithSpend} months.` }
      : { level: 'early_read', reason: `Only ${txCount} purchase${txCount === 1 ? '' : 's'} across ${monthsWithSpend} month${monthsWithSpend === 1 ? '' : 's'} are available.` }

  const recurringShare = profileFacts.totalSpend > 0
    ? round2(Math.min(1, (recurring.monthlyTotal * Math.max(profileFacts.scope?.months?.length ?? 1, 1)) / profileFacts.totalSpend))
    : 0

  return {
    ...archetype,
    traits: [merchantTrait, categoryTrait, cadenceTrait, purchaseTrait],
    confidence,
    evidence: [
      merchantTrait.evidence,
      categoryTrait.evidence,
      cadenceTrait.evidence,
      purchaseTrait.evidence,
    ],
    recurring: {
      count: recurring.count,
      monthlyTotal: recurring.monthlyTotal,
      estimatedShare: recurringShare,
    },
  }
}

/**
 * Calendar months the data FULLY spans — the overall date range covers the 1st through the last
 * day. Excludes leading/trailing partial months and the current incomplete one, so a monthly
 * average is never dragged down by a half-month of statements.
 *
 * Exported because the Finances rail reports the same pace over the same window; two
 * implementations of "complete month" would eventually disagree by a day.
 */
export function fullMonthsWithData(transactions) {
  const dates = transactions.map(tx => tx.date).filter(validDate).sort()
  if (!dates.length) return []
  const min = dates[0]
  const max = dates[dates.length - 1]
  const present = [...new Set(dates.map(date => date.slice(0, 7)))].sort()
  return present.filter(month => {
    const [year, monthNumber] = month.split('-').map(Number)
    const lastDay = new Date(year, monthNumber, 0).getDate()
    return min <= `${month}-01` && max >= `${month}-${String(lastDay).padStart(2, '0')}`
  })
}

/**
 * Financial Pace: average monthly income, bank expenses, headroom, and the savings target,
 * over the latest complete bank months. Card rows can never influence it — bank expenses
 * already include the card bill, so adding card spending would count the same money twice.
 *
 * Exported because the Finances rail surfaces this same computation. Reusing it is what makes
 * the two tabs show one number rather than two that happen to agree today.
 */
export function buildFinancialPace(bankTransactions, settings) {
  const months = fullMonthsWithData(bankTransactions).slice(-FINANCIAL_MONTHS)
  const monthSet = new Set(months)
  const inWindow = tx => validDate(tx.date) && monthSet.has(tx.date.slice(0, 7))
  const windowRows = bankTransactions.filter(inWindow)
  const divisor = months.length
  const scope = months.length
    ? {
        from: `${months[0]}-01`,
        to: dayjs(`${months[months.length - 1]}-01`).endOf('month').format('YYYY-MM-DD'),
        months,
        filters: {},
        label: `${dayjs(`${months[0]}-01`).format('MMM YYYY')} – ${dayjs(`${months[months.length - 1]}-01`).format('MMM YYYY')}`,
        basis: 'latest_complete_bank_months',
      }
    : null

  const average = predicate => divisor
    ? round2(windowRows.filter(predicate).reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0) / divisor)
    : 0
  const observedIncome = average(isBankIncome)
  const expenses = average(isBankExpense)
  const savingsContributions = average(tx => tx.category === 'Savings' && Number(tx.amount) < 0)
  const investmentContributions = average(tx => tx.category === 'Investments' && Number(tx.amount) < 0)
  const confirmedIncome = Number(settings?.confirmedMonthlyIncome)
  const hasConfirmedIncome = Number.isFinite(confirmedIncome) && confirmedIncome > 0
  const income = hasConfirmedIncome ? round2(confirmedIncome) : observedIncome
  const incomeSource = hasConfirmedIncome ? 'confirmed_monthly_income' : observedIncome > 0 ? 'observed_bank_income' : null

  const explicitTarget = Number(settings?.budgetSavingsTarget)
  const hasExplicitTarget = settings?.budgetSavingsTarget !== null
    && settings?.budgetSavingsTarget !== undefined
    && Number.isFinite(explicitTarget)
    && explicitTarget >= 0
  const savingsRate = Number.isFinite(Number(settings?.budgetSavingsRate))
    ? clamp(Number(settings.budgetSavingsRate), 0, 100)
    : DEFAULT_SAVINGS_RATE
  const savingsTarget = hasExplicitTarget ? round2(explicitTarget) : round2(income * savingsRate / 100)
  const savingsTargetSource = hasExplicitTarget ? 'explicit_monthly_target' : 'income_rate'

  if (!months.length || !incomeSource) {
    return {
      status: 'not_enough_data',
      label: 'Not Enough Data',
      income: income || null,
      incomeSource,
      expenses: months.length ? expenses : null,
      headroom: null,
      savingsTarget: incomeSource ? savingsTarget : null,
      savingsTargetSource: incomeSource ? savingsTargetSource : null,
      savingsContributions: months.length ? savingsContributions : null,
      investmentContributions: months.length ? investmentContributions : null,
      monthsCovered: months.length,
      confidence: 'not_available',
      evidence: months.length
        ? ['No reliable monthly income is available for comparison.']
        : ['No complete month of bank activity is available for comparison.'],
      scope,
    }
  }

  const headroom = round2(income - expenses)
  const status = headroom < 0 ? 'over_pace' : headroom < savingsTarget ? 'little_room' : 'on_track'
  const labels = { over_pace: 'Over Pace', little_room: 'Little Room', on_track: 'On Track' }
  const evidence = [
    `Average monthly expenses were ${formatUsd(expenses)} against ${formatUsd(income)} of ${hasConfirmedIncome ? 'confirmed' : 'observed'} income.`,
  ]
  if (status === 'over_pace') evidence.push(`Expenses exceeded income by ${formatUsd(Math.abs(headroom))} per month.`)
  else evidence.push(`Average monthly headroom was ${formatUsd(headroom)} before the ${formatUsd(savingsTarget)} savings target.`)

  return {
    status,
    label: labels[status],
    income,
    incomeSource,
    observedIncome,
    expenses,
    headroom,
    savingsTarget,
    savingsTargetSource,
    savingsRate: hasExplicitTarget ? null : savingsRate,
    savingsContributions,
    investmentContributions,
    monthsCovered: months.length,
    confidence: months.length >= 3 ? 'high' : 'early_read',
    evidence,
    scope,
  }
}

/**
 * Pure Spend Analysis interface. It reads no files, clocks, settings stores or remote systems.
 * Callers provide ledger snapshots and receive all deterministic facts needed by generation and
 * chat. Positive card rows are credits; bank expenses already include card payments.
 */
export function buildSpendAnalysis({
  bankTransactions = [],
  cardTransactions = [],
  settings = {},
  insightScope = null,
} = {}) {
  const resolvedProfileScope = profileScope(cardTransactions)
  const profileRows = resolvedProfileScope
    ? cardTransactions.filter(tx => validDate(tx.date) && tx.date >= resolvedProfileScope.from && tx.date <= resolvedProfileScope.to)
    : []
  const profileFacts = summarizeSpend(profileRows, resolvedProfileScope)
  const recurring = resolvedProfileScope
    ? detectRecurring(cardTransactions, { activeTo: resolvedProfileScope.to })
    : { series: [], monthlyTotal: 0, count: 0, byCadence: {} }
  const profile = buildProfile(profileFacts, recurring)

  const resolvedScope = resolvedInsightScope(cardTransactions, insightScope)
  const scopedRows = cardTransactions.filter(tx => matchesInsightScope(tx, insightScope))
  const scopedFacts = summarizeSpend(scopedRows, resolvedScope)
  const financialPace = buildFinancialPace(bankTransactions, settings)

  return {
    profile,
    financialPace,
    profileFacts,
    scopedFacts,
    scopes: {
      profile: resolvedProfileScope,
      financial: financialPace.scope,
      insight: resolvedScope,
    },
  }
}
