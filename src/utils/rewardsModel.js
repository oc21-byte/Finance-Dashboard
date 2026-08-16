/**
 * The Rewards view's whole derivation. Pure — no React, no clock, no network.
 *
 * THREE figures live here and none of them is a synonym for another:
 *
 *   `earned.period`   What your cards actually paid you over the window on screen — 7 days, 6
 *                     months, all of it. An OBSERVATION, scored month by month against the rates
 *                     that applied in each month. Never annualized.
 *   `optimal.period`  What that same window would have paid with every category on its best card.
 *                     Its distance from `earned.period` is money left behind, and is the spending
 *                     audit's whole subject.
 *   `projection.*`    A forward-looking yearly estimate: average monthly spend per category at
 *                     today's rates, ×12. The only figure here that extrapolates, and the only one
 *                     the short-window caution applies to.
 *
 * Quoting any of the three under another's label is a bug. The period figures answer "what did I
 * earn"; the projection answers "what is this wallet worth a year".
 *
 * Nothing here reads `creditKind` rows. Cash back in this app's ledger is a REDEMPTION posted as a
 * statement credit, not an earning, so mixing the two would double-count. Every figure below is
 * derived from published rates and is labelled an estimate wherever it renders.
 */

import { catalogCard, CARD_CATALOG } from '../constants/cardCatalog.js'
import { categoryOf, cardOf } from './spendAggregations.js'

/**
 * Below this many months, an annualized PROJECTION says more about the window than about the
 * wallet — one heavy week in a 7-day view becomes a $40k-a-year habit. The observed period figure
 * is unaffected: "you earned $12 this week" is true however short the week.
 */
export const SHORT_WINDOW_MONTHS = 3

function round2(n) {
  return Math.round(n * 100) / 100
}

/** Income and Transfer are not purchases; a rate on either would score money that earns nothing. */
export function isRateableCategory(category) {
  return category !== 'Income' && category !== 'Transfer'
}

/** `'2026-08'` → `'2026-Q3'`. Rotating-category cards are recorded and scored by quarter. */
export function quarterKeyOf(month) {
  const [year, mm] = String(month ?? '').split('-')
  const n = Number(mm)
  if (!year || !Number.isFinite(n) || n < 1 || n > 12) return null
  return `${year}-Q${Math.ceil(n / 3)}`
}

/**
 * The quarters a range touches, with how many of the range's months fall in each. Used by the view
 * to list which quarters a window depends on, and which of them are still unrecorded.
 */
export function quartersInRange(range) {
  const counts = new Map()
  for (const month of range?.months ?? []) {
    const key = quarterKeyOf(month)
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()].map(([key, months]) => ({ key, months }))
}

/** A rate's cap expressed as monthly spend. Absent cap → Infinity. */
export function monthlyCapOf(rate) {
  if (!rate) return Infinity
  if (rate.capMo != null) return rate.capMo
  // A quarterly cap is spendable in any distribution across its three months; a third per month is
  // the standard approximation, and the only one available from monthly buckets.
  if (rate.capQtr != null) return rate.capQtr / 3
  if (rate.capYr != null) return rate.capYr / 12
  return Infinity
}

/**
 * One linked card, resolved for a single quarter.
 *
 * Resolving per quarter rather than per window is what lets a rotating card be scored with the
 * rate that actually applied in each month, instead of one quarter's category smeared across six.
 *
 * `entry` is `settings.cardRewards.wallet[sourceName]`. A source with no entry, or one pointing at
 * a catalog id that no longer exists, resolves to `null` — a stored id is allowed to outlive its
 * catalog row, and the view re-links those rather than scoring them wrong.
 */
/**
 * How a ledger source name relates to the catalog. Stored on the wallet entry as `kind`.
 *
 * `unlisted` and `none` are deliberately NOT the same thing. A store card nobody earns on should
 * vanish from the page; a rewards card we simply cannot score has to stay counted, or the earned
 * total quietly understates itself and reads as though those purchases earned nothing.
 */
export const LINK_KINDS = ['catalog', 'unlisted', 'none']

/** `catalog` is implied by a bare `catalogId`, so pre-`kind` entries keep working untouched. */
export function linkKindOf(entry) {
  if (!entry) return null
  if (entry.kind && LINK_KINDS.includes(entry.kind)) return entry.kind
  return entry.catalogId ? 'catalog' : null
}

/**
 * Translate a card picker's value into a stored wallet entry. The write-side counterpart of
 * `linkKindOf`, kept beside it because the two together define the stored shape.
 *
 * `null` — not "linked to nothing" but "no answer yet", which callers store as the ABSENCE of a
 * key. A stored empty entry would be an answer, and the setup screen would stop asking.
 */
export function walletEntryFor(value, previous = {}) {
  if (!value) return null
  if (value === 'unlisted' || value === 'none') return { kind: value }
  // Slots and quarters are answers about one specific card — which categories its chooser points
  // at, what its rotating quarter was. Carrying them onto a different card would invent history.
  const sameCard = previous.catalogId === value
  return {
    kind: 'catalog',
    catalogId: value,
    slots: sameCard ? (previous.slots ?? {}) : {},
    quarters: sameCard ? (previous.quarters ?? {}) : {},
  }
}

/** The picker value for a stored wallet entry. */
export function pickerValueFor(entry) {
  if (!entry) return ''
  if (entry.kind === 'unlisted' || entry.kind === 'none') return entry.kind
  return entry.catalogId ?? ''
}

/**
 * Point one chooser slot at a category, returning a new entry.
 *
 * A category never holds two slots. On a card paying 3% and 2%, putting both on Grocery does not
 * pay 5% — the lower slot simply earns nothing, and storing it that way would show a user a choice
 * they did not make and cannot see. Reassigning a slot therefore MOVES it: whatever it pointed at
 * before drops to the base rate, which is what the issuer would do too.
 *
 * `category` falsy clears the slot outright.
 */
export function withSlot(entry, slotIndex, category) {
  const key = String(slotIndex)
  const slots = {}
  for (const [slot, held] of Object.entries(entry?.slots ?? {})) {
    if (slot === key) continue                       // being reassigned
    if (category && held === category) continue      // moving to the new slot
    slots[slot] = held
  }
  if (category) slots[key] = category
  return { ...entry, kind: 'catalog', slots }
}

/** Drop whichever slot points at `category`, sending it back to the card's base rate. */
export function withoutSlotFor(entry, category) {
  const slots = {}
  for (const [slot, held] of Object.entries(entry?.slots ?? {})) {
    if (held !== category) slots[slot] = held
  }
  return { ...entry, kind: 'catalog', slots }
}

/**
 * Record what a rotating card's bonus category was in one quarter.
 *
 * Clearing it DELETES the key rather than storing an empty one, for the same reason an unlinked
 * card stores no entry: an unrecorded quarter is a question outstanding, and it scores at base
 * until someone answers it. A stored blank would look like an answer meaning "nothing".
 */
export function withQuarter(entry, quarterKey, category) {
  const quarters = { ...(entry?.quarters ?? {}) }
  if (category) quarters[quarterKey] = category
  else delete quarters[quarterKey]
  return { ...entry, kind: 'catalog', quarters }
}

/**
 * Where a rotating card's bonus categories for one quarter come from, and what they are.
 *
 * Three answers, and they are not interchangeable:
 *
 *   `catalog`     The published calendar has this quarter. Read-only; the user has nothing to add.
 *   `user`        The calendar does not cover it and the user recorded it themselves — the gap
 *                 between an issuer announcing a quarter and this catalog shipping it.
 *   `unpublished` Later than anything the calendar knows: the issuer has not announced it. A fact
 *                 about the world rather than a question for the user.
 *   `missing`     Absent, but not later than the calendar's newest quarter — so it DID happen and
 *                 this catalog simply does not have it. Told apart from `unpublished` by comparing
 *                 quarter keys rather than by looking at a clock, which this module never does.
 *                 Calling a quarter that already happened "not announced yet" is a plain untruth,
 *                 and a 1Y window reaches back past the calendar every time.
 *
 * @returns {{ source: string, entries: Array<[string, object]> }}
 */
export function rotatingQuarterFor(card, entry, quarterKey) {
  if (!card?.rotating || !quarterKey) return { source: 'none', entries: [] }

  const published = card.rotating.calendar?.[quarterKey]
  if (published) return { source: 'catalog', entries: Object.entries(published) }

  const recorded = entry?.quarters?.[quarterKey]
  if (recorded) return { source: 'user', entries: [[recorded, {}]] }

  const keys = Object.keys(card.rotating.calendar ?? {})
  if (!keys.length) return { source: 'none', entries: [] }
  const newest = keys.reduce((max, k) => (k > max ? k : max), '')
  return { source: quarterKey > newest ? 'unpublished' : 'missing', entries: [] }
}

function rotatingCategoriesFor(card, entry, quarterKey) {
  return rotatingQuarterFor(card, entry, quarterKey).entries
}

/**
 * The span a card's published calendar covers, as `{ from, to }` quarter keys, or null.
 *
 * The view states this outright. A user loading several years of statements needs to know the
 * calendar stops before their oldest one, rather than reading a row of base rates as the card
 * having genuinely earned nothing back then.
 */
export function calendarRangeOf(card) {
  const keys = Object.keys(card?.rotating?.calendar ?? {})
  if (!keys.length) return null
  const sorted = [...keys].sort()
  return { from: sorted[0], to: sorted[sorted.length - 1] }
}

/** The shared-cap pool key for one card's rotating bonus. */
const rotatingPoolKey = card => `${card.sourceName} rotating`

/**
 * A fresh set of shared rotating budgets, one per rotating card, for ONE month.
 *
 * Discover's $1,500 a quarter is a combined allowance across everything the quarter covers, not
 * $1,500 for each. Without this, a quarter covering three categories would score three times the
 * bonus the card can actually pay.
 */
export function rotatingPools(cards) {
  const pools = new Map()
  for (const card of cards) {
    if (card.rotating) pools.set(rotatingPoolKey(card), monthlyCapOf(card.rotating))
  }
  return pools
}

export function resolveCard(sourceName, entry, { quarterKey = null, overrides = {} } = {}) {
  if (linkKindOf(entry) !== 'catalog') return null
  const card = catalogCard(entry.catalogId)
  if (!card) return null

  const rates = {}
  for (const [category, rate] of Object.entries(card.rates ?? {})) rates[category] = { ...rate }

  // Chooser cards (TD Visa, Tangerine): the user picks which categories get which published rate.
  // A higher rate wins if two slots are ever pointed at the same category.
  const pcts = card.chooser?.pcts ?? []
  const slots = entry.slots ?? {}
  pcts.forEach((pct, i) => {
    const category = slots[i] ?? slots[String(i)]
    if (!category) return
    if (rates[category] && rates[category].pct >= pct) return
    rates[category] = { pct, chooser: true, slot: i }
  })

  // Rotating cards (Discover, Freedom Flex). The published calendar is the authority — it is the
  // same for every holder and announced a quarter ahead, so making a user retype it would be asking
  // them to supply a fact we already have. A hand-recorded quarter only fills a gap the calendar
  // does not cover: a quarter the issuer has announced but this catalog has not caught up with.
  //
  // One quarter covers SEVERAL app categories, and they all share one quarterly cap. `capMo` here is
  // the per-category ceiling; the shared pool is enforced in `fillCategory`.
  for (const [category, meta] of rotatingCategoriesFor(card, entry, quarterKey)) {
    if (rates[category]?.pct >= card.rotating.pct) continue
    rates[category] = {
      ...meta,
      pct: card.rotating.pct,
      capMo: monthlyCapOf(card.rotating),
      rotating: true,
    }
  }

  // A user correction wins over everything above it, and survives replacing the catalog wholesale.
  for (const [category, rate] of Object.entries(overrides[card.id] ?? {})) {
    rates[category] = { ...rate, corrected: true }
  }

  return {
    sourceName,
    id: card.id,
    name: card.name,
    short: card.short,
    issuer: card.issuer,
    region: card.region,
    fee: card.fee ?? 0,
    summary: card.summary,
    verified: card.verified,
    base: card.base ?? 0,
    rates,
    topCat: card.topCat ?? null,
    chooser: card.chooser ?? null,
    rotating: card.rotating ?? null,
    // Only meaningful for rotating cards: where this quarter's categories came from —
    // 'catalog', 'user', 'unpublished', or 'none'. See `rotatingQuarterFor`.
    rotatingSource: card.rotating ? rotatingQuarterFor(card, entry, quarterKey).source : null,
  }
}

/** Every linked card in the wallet, resolved for one quarter. Unlinked sources are skipped. */
export function resolveWallet(sourceNames, cardRewards = {}, quarterKey = null) {
  const { wallet = {}, overrides = {} } = cardRewards
  return sourceNames
    .map(name => resolveCard(name, wallet[name], { quarterKey, overrides }))
    .filter(Boolean)
}

/**
 * Every ledger source name, sorted into what the page can do about it.
 *
 * `unlisted` and `unlinked` both earn nothing here, and the difference matters: an unlinked source
 * is a question the user has not been asked yet, while an unlisted one is an answer we have to
 * respect. Only `unlinked` should nag.
 */
export function classifySources(sourceNames, cardRewards = {}, spendTxs = []) {
  const { wallet = {} } = cardRewards
  const spend = new Map()
  for (const tx of spendTxs) {
    const category = categoryOf(tx)
    if (!isRateableCategory(category)) continue
    const source = cardOf(tx)
    spend.set(source, (spend.get(source) || 0) + Math.abs(Number(tx.amount) || 0))
  }

  const out = { catalog: [], unlisted: [], none: [], unlinked: [] }
  for (const sourceName of sourceNames) {
    const entry = wallet[sourceName]
    const kind = linkKindOf(entry)
    const row = {
      sourceName,
      catalogId: entry?.catalogId ?? null,
      spend: round2(spend.get(sourceName) || 0),
    }
    // A `catalog` link whose id has since left the catalog is unlinked again, not silently scored.
    if (kind === 'catalog' && !catalogCard(entry.catalogId)) out.unlinked.push({ ...row, stale: true })
    else if (kind) out[kind].push(row)
    else out.unlinked.push(row)
  }
  return out
}

/**
 * Real spend bucketed by month, then card, then category:
 * `Map<'YYYY-MM', Map<sourceName, Map<category, dollars>>>`.
 *
 * Nested rather than keyed on a joined string — both inner keys are free text ('Food & Dining', and
 * a user's own source name), so any separator character is one category name away from being wrong.
 */
export function monthlyGrid(spendTxs) {
  const grid = new Map()
  for (const tx of spendTxs) {
    const month = tx.date?.slice(0, 7)
    if (!month) continue
    const category = categoryOf(tx)
    if (!isRateableCategory(category)) continue
    let byCard = grid.get(month)
    if (!byCard) grid.set(month, (byCard = new Map()))
    const source = cardOf(tx)
    let byCategory = byCard.get(source)
    if (!byCategory) byCard.set(source, (byCategory = new Map()))
    byCategory.set(category, (byCategory.get(category) || 0) + Math.abs(Number(tx.amount) || 0))
  }
  return grid
}

/**
 * Average monthly spend per category over the window — the basis of the yearly projection.
 *
 * Divided by `range.monthCount` clamped to at least 1, exactly as `buildKpis` does; a sub-month
 * window would otherwise divide by zero and report an infinite habit.
 */
export function monthlySpendByCategory(spendTxs, range) {
  const months = Math.max(range?.monthCount ?? 0, 1)
  const totals = new Map()
  for (const tx of spendTxs) {
    const category = categoryOf(tx)
    if (!isRateableCategory(category)) continue
    totals.set(category, (totals.get(category) || 0) + Math.abs(Number(tx.amount) || 0))
  }
  return [...totals.entries()]
    .map(([category, amount]) => ({ category, monthly: round2(amount / months) }))
    .sort((a, b) => b.monthly - a.monthly)
}

/** Average monthly spend per card per category — the projection's view of current habits. */
export function averageMonthlyByCard(spendTxs, range) {
  const months = Math.max(range?.monthCount ?? 0, 1)
  const out = new Map()
  for (const tx of spendTxs) {
    const category = categoryOf(tx)
    if (!isRateableCategory(category)) continue
    const source = cardOf(tx)
    let byCategory = out.get(source)
    if (!byCategory) out.set(source, (byCategory = new Map()))
    byCategory.set(category, (byCategory.get(category) || 0) + Math.abs(Number(tx.amount) || 0))
  }
  for (const byCategory of out.values()) {
    for (const [category, amount] of byCategory) byCategory.set(category, amount / months)
  }
  return out
}

/**
 * Every way a category's spend could earn, best rate first.
 *
 * Each card contributes its bonus rate AND its base rate, so spend past a cap correctly falls back
 * onto the same card rather than vanishing.
 */
export function optionsFor(cards, category, topCatCategory = null) {
  const out = []
  for (const card of cards) {
    const rate = card.rates[category]
    if (rate) {
      // A rotating rate draws on a budget shared with every other category the quarter covers.
      const pool = rate.rotating ? rotatingPoolKey(card) : null
      out.push({ card, rate: rate.pct, capMo: monthlyCapOf(rate), detail: rate, pool })
    } else if (card.topCat && topCatCategory === category) {
      out.push({ card, rate: card.topCat.pct, capMo: monthlyCapOf(card.topCat), topCat: true })
    }
    out.push({ card, rate: card.base, capMo: Infinity, base: true })
  }
  return out.sort((a, b) => b.rate - a.rate)
}

/**
 * Greedy-fill one month's spend down the sorted options.
 *
 * `pools` carries budgets shared ACROSS categories — currently only the rotating quarterly cap,
 * which one quarter spreads over several categories. Pass the same Map to every category in a month
 * and it is consumed as it is spent; pass none and each option is bounded by its own cap alone.
 *
 * The order categories are filled in does not change the total: every category drawing on one pool
 * does so at the same rate and falls back to the same card's base, so whichever consumes the budget
 * first, the money earned is identical.
 *
 * @returns {{ earned: number, byCard: Map<string, number> }} reward, and its split by card.
 */
export function fillCategory(options, spend, pools = null) {
  let remaining = spend
  let earned = 0
  const byCard = new Map()
  for (const option of options) {
    if (remaining <= 0) break
    const budget = option.pool && pools ? (pools.get(option.pool) ?? Infinity) : Infinity
    const take = Math.min(remaining, option.capMo, budget)
    if (take <= 0) continue
    const reward = take * (option.rate / 100)
    earned += reward
    byCard.set(option.card.sourceName, (byCard.get(option.card.sourceName) || 0) + reward)
    if (option.pool && pools) pools.set(option.pool, budget - take)
    remaining -= take
  }
  return { earned, byCard }
}

/**
 * Which single category a top-category card (Citi Custom Cash) should be pointed at: the one where
 * its bonus beats the rest of the wallet by the most, capped spend included.
 */
export function topCatCategoryFor(cards, monthly) {
  const card = cards.find(c => c.topCat)
  if (!card) return null
  let best = null
  let bestGain = 0
  for (const { category, monthly: spend } of monthly) {
    const eligible = Math.min(spend, monthlyCapOf(card.topCat))
    const rival = cards
      .filter(c => c !== card)
      .reduce((max, c) => Math.max(max, c.rates[category]?.pct ?? c.base), 0)
    const gain = eligible * ((card.topCat.pct - rival) / 100)
    if (gain > bestGain) {
      bestGain = gain
      best = category
    }
  }
  return best
}

/**
 * Where a top-category card's bonus actually landed in one month. The issuer applies it to your
 * top eligible category automatically, so on real spend it follows the money rather than a choice.
 */
function topCatCategoryActual(card, spendByCategory) {
  if (!card?.topCat) return null
  const cap = monthlyCapOf(card.topCat)
  let best = null
  let bestEligible = 0
  for (const [category, spend] of spendByCategory) {
    const eligible = Math.min(spend, cap)
    if (eligible > bestEligible) {
      bestEligible = eligible
      best = category
    }
  }
  return best
}

/**
 * The best card for a category. `tie` means no card beats another here — the honest answer is
 * "any card", not an arbitrary winner.
 */
export function bestFor(cards, category, topCatCategory = null) {
  const options = optionsFor(cards, category, topCatCategory)
  if (!options.length) return null
  const top = options[0]
  const winners = new Set(options.filter(o => o.rate === top.rate).map(o => o.card.sourceName))
  return {
    rate: top.rate,
    card: top.card,
    capMo: top.capMo,
    detail: top.detail ?? null,
    topCat: !!top.topCat,
    tie: winners.size > 1,
  }
}

/** The next rate down, for "to $X/mo, then Y%". */
export function secondRateFor(cards, category, topCatCategory = null) {
  const options = optionsFor(cards, category, topCatCategory)
  const top = options[0]?.rate
  return options.find(o => o.rate < top)?.rate ?? top ?? 0
}

/** The months to score: the range's explicit month list, else whatever the ledger actually holds. */
function monthsOf(range, grid) {
  return range?.months?.length ? range.months : [...grid.keys()].sort()
}

/**
 * What your cards ACTUALLY paid you over the window — the headline "estimated earned".
 *
 * Scored month by month, because that is the granularity every cap and every rotating category is
 * published at. A window spanning a rotation is therefore counted with each month's own quarter,
 * not with one quarter's category applied to all of them.
 *
 * Spend on a source that is not linked to a card earns nothing, and is reported separately as
 * `unattributedSpend` rather than silently folded in at 0%.
 */
export function earnedActual(spendTxs, sourceNames, cardRewards, range) {
  const grid = monthlyGrid(spendTxs)
  const byCard = new Map()
  let total = 0
  let unattributed = 0

  for (const month of monthsOf(range, grid)) {
    const rows = grid.get(month)
    if (!rows) continue
    const cards = resolveWallet(sourceNames, cardRewards, quarterKeyOf(month))
    const bySource = new Map(cards.map(c => [c.sourceName, c]))

    for (const [source, spendByCategory] of rows) {
      const card = bySource.get(source)
      if (!card) {
        for (const spend of spendByCategory.values()) unattributed += spend
        continue
      }
      const topCat = topCatCategoryActual(card, spendByCategory)
      // One budget for this card for this month, spent down across every category it covers.
      const pools = rotatingPools([card])
      for (const [category, spend] of spendByCategory) {
        // Only this one card's options — the spend is already committed to it.
        const { earned } = fillCategory(optionsFor([card], category, topCat), spend, pools)
        total += earned
        byCard.set(source, (byCard.get(source) || 0) + earned)
      }
    }
  }

  const linked = resolveWallet(sourceNames, cardRewards, quarterKeyOf(range?.to?.slice(0, 7)))
  return {
    period: round2(total),
    unattributedSpend: round2(unattributed),
    byCard: linked
      .map(c => ({
        sourceName: c.sourceName,
        short: c.short,
        period: round2(byCard.get(c.sourceName) || 0),
      }))
      .sort((a, b) => b.period - a.period),
  }
}

/**
 * What the same window WOULD have paid with every category on its best card. Scored month by month
 * for the same reason `earnedActual` is. The gap between the two is money left behind.
 */
export function earnedOptimal(spendTxs, sourceNames, cardRewards, range) {
  const grid = monthlyGrid(spendTxs)
  const byCard = new Map()
  let total = 0

  for (const month of monthsOf(range, grid)) {
    const rows = grid.get(month)
    if (!rows) continue
    const cards = resolveWallet(sourceNames, cardRewards, quarterKeyOf(month))
    if (!cards.length) continue

    // The month's spend per category, regardless of which card it landed on.
    const spendByCategory = new Map()
    for (const byCategory of rows.values()) {
      for (const [category, spend] of byCategory) {
        spendByCategory.set(category, (spendByCategory.get(category) || 0) + spend)
      }
    }

    const monthly = [...spendByCategory.entries()].map(([category, spend]) => ({
      category, monthly: spend,
    }))
    const topCat = topCatCategoryFor(cards, monthly)
    const pools = rotatingPools(cards)
    for (const [category, spend] of spendByCategory) {
      const { earned, byCard: split } = fillCategory(optionsFor(cards, category, topCat), spend, pools)
      total += earned
      for (const [source, reward] of split) byCard.set(source, (byCard.get(source) || 0) + reward)
    }
  }

  return {
    period: round2(total),
    byCard: [...byCard.entries()]
      .map(([sourceName, reward]) => ({ sourceName, period: round2(reward) }))
      .sort((a, b) => b.period - a.period),
  }
}

/**
 * The forward-looking yearly estimate: average monthly spend per category at today's rates, ×12.
 *
 * `annualCurrent` keeps your existing habits — each category earning what it earns on the card you
 * actually reach for. `annualOptimal` routes everything to its best card. The pair is what turns
 * "you'd gain $X a year by changing nothing but which card you tap" into a statement rather than a
 * guess. `annualCurrent` is null when no per-card habit was supplied.
 */
export function projectAnnual(cards, monthly, byCardMonthly = null) {
  const topCat = topCatCategoryFor(cards, monthly)
  const optimalPools = rotatingPools(cards)
  let optimal = 0
  for (const { category, monthly: spend } of monthly) {
    optimal += fillCategory(optionsFor(cards, category, topCat), spend, optimalPools).earned
  }

  let current = null
  if (byCardMonthly) {
    current = 0
    for (const [source, byCategory] of byCardMonthly) {
      const card = cards.find(c => c.sourceName === source)
      if (!card) continue
      const cardTopCat = topCatCategoryActual(card, byCategory)
      const cardPools = rotatingPools([card])
      for (const [category, spend] of byCategory) {
        current += fillCategory(optionsFor([card], category, cardTopCat), spend, cardPools).earned
      }
    }
    current = round2(current * 12)
  }

  return { annualOptimal: round2(optimal * 12), annualCurrent: current }
}

/**
 * What adding `candidate` would change, on the yearly projection — comparing cards is inherently
 * forward-looking, so this is the one place an annualized figure is the right basis.
 *
 * `net` is after the candidate's annual fee. Ongoing earn rates only: welcome bonuses, sign-up
 * offers and intro APRs are deliberately absent, and every caller says so out loud.
 */
export function compareCandidate(cards, candidateCard, monthly) {
  const candidate = {
    ...candidateCard,
    sourceName: `candidate:${candidateCard.id}`,
    base: candidateCard.base ?? 0,
    rates: candidateCard.rates ?? {},
    fee: candidateCard.fee ?? 0,
    topCat: candidateCard.topCat ?? null,
  }
  const withCandidate = [...cards, candidate]
  const before = projectAnnual(cards, monthly).annualOptimal
  const after = projectAnnual(withCandidate, monthly).annualOptimal

  const topBefore = topCatCategoryFor(cards, monthly)
  const topAfter = topCatCategoryFor(withCandidate, monthly)

  const changes = []
  for (const { category, monthly: spend } of monthly) {
    const from = bestFor(cards, category, topBefore)
    const to = bestFor(withCandidate, category, topAfter)
    if (!from || !to || to.rate <= from.rate) continue
    const gain =
      fillCategory(optionsFor(withCandidate, category, topAfter), spend).earned -
      fillCategory(optionsFor(cards, category, topBefore), spend).earned
    changes.push({
      category,
      fromRate: from.rate,
      fromCard: from.tie ? null : from.card.short,
      toRate: to.rate,
      toCard: to.card.short,
      capMo: to.capMo === Infinity ? null : round2(to.capMo),
      gain: round2(gain * 12),
      // Carried through so the comparison can qualify the gain the way the grid qualifies the rate.
      // Without it, a card paying 5% on flights-booked-via-a-portal reads as 5% on all of Transport
      // and its whole case is built on a number that only applies to a slice of the category.
      partial: to.detail?.coverage === 'partial',
      note: to.detail?.note ?? null,
    })
  }

  return {
    baseAnnual: before,
    candidateAnnual: after,
    fee: candidate.fee,
    net: round2(after - before - candidate.fee),
    changes: changes.sort((a, b) => b.gain - a.gain),
  }
}

/**
 * Every catalog card you don't already hold, scored against your real spending, best first.
 *
 * "Best" is `net` — the yearly gain AFTER the annual fee — not the headline earn rate. A 5% card
 * with a $120 fee is worth less than a 2% card with none unless you actually spend enough in its
 * categories, and ranking on rate would put it first anyway.
 *
 * Cards already in the wallet are excluded rather than shown at zero: you cannot add a card twice,
 * and a row reading "+$0" invites the reading "this card is worthless" rather than "you have it".
 *
 * Every figure is annualized, because comparing cards is inherently forward-looking. That makes the
 * whole of this subject to the short-window caution — a candidate ranked on seven days of spending
 * is ranked on noise, and the caller must say so rather than print the number.
 */
export function buildCandidates({
  cards = [],
  monthly = [],
  catalog = CARD_CATALOG,
  ownedIds = [],
  region = null,
}) {
  const owned = new Set(ownedIds)
  return catalog
    .filter(card => !owned.has(card.id))
    .filter(card => !region || card.region === region)
    .map(card => ({ card, ...compareCandidate(cards, card, monthly) }))
    .sort((a, b) => b.net - a.net || a.card.name.localeCompare(b.card.name))
}

/**
 * Everything the Rewards view renders, from one call.
 *
 * `spendTxs` is already period- and filter-scoped by the page, which is what makes a filter chip
 * rescope this view the way it rescopes the charts: a category chip drops rows from the grid, a
 * card chip drops columns.
 *
 * The rate grid is resolved at the window's LAST quarter — it answers "which card should I reach
 * for", which is a question about now. The earned figures are scored month by month against each
 * month's own quarter, so a window spanning a rotation is still counted correctly.
 */
export function buildRewardsModel({ spendTxs = [], allSources = [], range, settings = {} }) {
  const cardRewards = settings.cardRewards ?? {}
  const currentQuarter = quarterKeyOf(range?.to?.slice(0, 7))
  const linked = resolveWallet(allSources, cardRewards, currentQuarter)
  const monthly = monthlySpendByCategory(spendTxs, range)

  // Columns follow the filter chips: a card chip that removes every row for a card removes its
  // column too. With no card chips active this is the whole linked wallet.
  const scopedSources = new Set(spendTxs.map(cardOf))
  const scoped = linked.filter(c => scopedSources.has(c.sourceName))
  const cards = scoped.length ? scoped : linked
  const topCatCategory = topCatCategoryFor(cards, monthly)

  const rows = monthly.map(({ category, monthly: spend }) => {
    const best = bestFor(cards, category, topCatCategory)
    return {
      category,
      monthly: spend,
      best,
      secondRate: secondRateFor(cards, category, topCatCategory),
      cells: cards.map(card => {
        const rate = card.rates[category]
        const pct = rate
          ? rate.pct
          : card.topCat && topCatCategory === category
            ? card.topCat.pct
            : card.base
        return {
          sourceName: card.sourceName,
          pct,
          detail: rate ?? null,
          partial: rate?.coverage === 'partial',
          corrected: !!rate?.corrected,
          rotating: !!rate?.rotating,
          isBest: !!best && !best.tie && best.card.sourceName === card.sourceName && pct === best.rate,
        }
      }),
    }
  })

  const sources = cards.map(c => c.sourceName)
  const earned = earnedActual(spendTxs, sources, cardRewards, range)
  const optimal = earnedOptimal(spendTxs, sources, cardRewards, range)
  const projection = projectAnnual(cards, monthly, averageMonthlyByCard(spendTxs, range))
  const monthCount = range?.monthCount ?? 0
  const sourceStates = classifySources(allSources, cardRewards, spendTxs)

  // What the earned total does and does not cover. `none` sources are excluded on purpose and are
  // not part of the denominator — a debit card was never going to earn anything.
  const scorable = sourceStates.catalog.length + sourceStates.unlisted.length
    + sourceStates.unlinked.length

  return {
    cards,
    sourceStates,
    coverage: { scored: sourceStates.catalog.length, scorable },
    unlinkedSources: sourceStates.unlinked.map(s => s.sourceName),
    monthly,
    rows,
    topCatCategory,
    currentQuarter,
    // Observed, over the window on screen. Never annualized.
    earned,
    optimal,
    leftBehind: round2(optimal.period - earned.period),
    // Extrapolated. The short-window caution applies to this and to nothing else on the page.
    projection: {
      ...projection,
      shortWindow: monthCount > 0 && monthCount < SHORT_WINDOW_MONTHS,
    },
    monthCount,
  }
}
