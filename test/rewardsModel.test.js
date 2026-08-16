import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePeriod } from '../src/utils/period.js'
import {
  quarterKeyOf, quartersInRange, monthlyCapOf, isRateableCategory, resolveCard, resolveWallet,
  monthlyGrid, monthlySpendByCategory, averageMonthlyByCard, optionsFor, fillCategory,
  topCatCategoryFor, bestFor, secondRateFor, earnedActual, earnedOptimal, projectAnnual,
  compareCandidate, buildRewardsModel, classifySources, linkKindOf, SHORT_WINDOW_MONTHS,
  withSlot, withoutSlotFor, withQuarter, buildCandidates, rotatingQuarterFor, calendarRangeOf,
} from '../src/utils/rewardsModel.js'
import { catalogCard, CARD_CATALOG } from '../src/constants/cardCatalog.js'

// Every test here defends one claim the Rewards view makes out loud. The three that matter most:
//
//   - what you EARNED is an observation over the window on screen, never annualized;
//   - spend past a cap falls back onto the same card rather than vanishing;
//   - an unrecorded rotating quarter scores NOTHING rather than being guessed.

const tx = (date, amount, category, source) => ({
  date, amount: -amount, description: 'x', category, source,
})

// Six months, 2026-02 through 2026-07, so `resolvePeriod('6M')` covers exactly the rows below.
const months = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']

function ledger(perMonth) {
  return months.flatMap(m =>
    perMonth.map(([amount, category, source]) => tx(`${m}-10`, amount, category, source)))
}

const rangeOf = txs => resolvePeriod('6M', txs)
const round = n => Math.round(n * 100) / 100

// activeCash: flat 2%, no caps. amexBcp: 6% Grocery to $6k/yr (= $500/mo), 1% base.
const wallet = (over = {}) => ({
  wallet: {
    'Active Cash': { catalogId: 'activeCash' },
    'Blue Cash': { catalogId: 'amexBcp' },
    ...over,
  },
  overrides: {},
})

// ------------------------------------------------------------------ quarters and caps

test('quarterKeyOf maps months to calendar quarters, and rejects nonsense', () => {
  assert.equal(quarterKeyOf('2026-01'), '2026-Q1')
  assert.equal(quarterKeyOf('2026-03'), '2026-Q1')
  assert.equal(quarterKeyOf('2026-04'), '2026-Q2')
  assert.equal(quarterKeyOf('2026-12'), '2026-Q4')
  assert.equal(quarterKeyOf('2026-13'), null)
  assert.equal(quarterKeyOf(''), null)
  assert.equal(quarterKeyOf(undefined), null)
})

test('quartersInRange counts how many of the window months fall in each quarter', () => {
  assert.deepEqual(quartersInRange({ months }), [
    { key: '2026-Q1', months: 2 },
    { key: '2026-Q2', months: 3 },
    { key: '2026-Q3', months: 1 },
  ])
  assert.deepEqual(quartersInRange({ months: [] }), [])
  assert.deepEqual(quartersInRange(undefined), [])
})

test('caps normalize to monthly spend whatever period they are published over', () => {
  assert.equal(monthlyCapOf({ pct: 5, capMo: 500 }), 500)
  assert.equal(monthlyCapOf({ pct: 5, capQtr: 1500 }), 500)
  assert.equal(monthlyCapOf({ pct: 6, capYr: 6000 }), 500)
  assert.equal(monthlyCapOf({ pct: 2 }), Infinity)
  assert.equal(monthlyCapOf(null), Infinity)
})

test('only Income and Transfer are unrateable — a custom category still earns', () => {
  assert.equal(isRateableCategory('Income'), false)
  assert.equal(isRateableCategory('Transfer'), false)
  assert.equal(isRateableCategory('Other'), true)
  assert.equal(isRateableCategory('Pet Care'), true)
})

// ------------------------------------------------------------------ resolving a card

test('an unlinked source, or one pointing at a card the catalog dropped, resolves to null', () => {
  assert.equal(resolveCard('Some Card', undefined), null)
  assert.equal(resolveCard('Some Card', {}), null)
  assert.equal(resolveCard('Some Card', { catalogId: 'goneInV2' }), null)
})

test('chooser slots become real rates, and the higher rate wins a collision', () => {
  const card = resolveCard('TD', {
    catalogId: 'tangerine',
    slots: { 0: 'Grocery', 1: 'Grocery' },
  })
  // tangerine publishes [2, 2]; both slots on one category must not stack to 4%.
  assert.equal(card.rates.Grocery.pct, 2)
  assert.ok(card.rates.Grocery.chooser)

  const split = resolveCard('TD', {
    catalogId: 'tangerine',
    slots: { 0: 'Grocery', 1: 'Food & Dining' },
  })
  assert.equal(split.rates.Grocery.pct, 2)
  assert.equal(split.rates['Food & Dining'].pct, 2)
  assert.equal(split.base, 0.5)
})

test('a user correction wins over the catalog and is marked as one', () => {
  const card = resolveCard('Blue Cash', { catalogId: 'amexBcp' }, {
    overrides: { amexBcp: { Grocery: { pct: 4, capYr: 6000 } } },
  })
  assert.equal(card.rates.Grocery.pct, 4)
  assert.equal(card.rates.Grocery.corrected, true)
})

test('resolveWallet skips unlinked sources rather than inventing cards for them', () => {
  const cards = resolveWallet(['Active Cash', 'Blue Cash', 'Some Debit Card'], wallet())
  assert.deepEqual(cards.map(c => c.sourceName), ['Active Cash', 'Blue Cash'])
})

// ------------------------------------------------------------------ the greedy fill

test('spend past a cap falls back onto the SAME card, it does not vanish', () => {
  const cards = resolveWallet(['Blue Cash'], wallet())
  // $800 of grocery in a month against a 6% cap of $500, then 1% base on the remaining $300.
  const { earned, byCard } = fillCategory(optionsFor(cards, 'Grocery'), 800)
  assert.equal(earned, 500 * 0.06 + 300 * 0.01)
  assert.equal(byCard.get('Blue Cash'), earned, 'all of it earned on the one card')
})

test('overflow past one card\'s cap lands on the next best card, not on its own base', () => {
  const cards = resolveWallet(['Active Cash', 'Blue Cash'], wallet())
  // 6% to $500 on Blue Cash, then Active Cash's flat 2% beats Blue Cash's own 1%.
  assert.equal(fillCategory(optionsFor(cards, 'Grocery'), 800).earned, 500 * 0.06 + 300 * 0.02)
})

test('options are sorted best-rate first and every card offers its base as a fallback', () => {
  const options = optionsFor(resolveWallet(['Active Cash', 'Blue Cash'], wallet()), 'Grocery')
  assert.deepEqual(options.map(o => o.rate), [6, 2, 1])
  assert.equal(options.at(-1).base, true)
})

// ------------------------------------------------------------------ picking a winner

test('bestFor names the winner, its cap, and the next rate down', () => {
  const cards = resolveWallet(['Active Cash', 'Blue Cash'], wallet())
  const best = bestFor(cards, 'Grocery')
  assert.equal(best.rate, 6)
  assert.equal(best.card.sourceName, 'Blue Cash')
  assert.equal(best.capMo, 500)
  assert.equal(best.tie, false)
  assert.equal(secondRateFor(cards, 'Grocery'), 2)
})

test('when no card beats another the answer is a tie, not an arbitrary winner', () => {
  const twoSame = { wallet: { A: { catalogId: 'amexBcp' }, B: { catalogId: 'amexBcp' } }, overrides: {} }
  assert.equal(bestFor(resolveWallet(['A'], twoSame), 'Shopping').tie, false)
  assert.equal(bestFor(resolveWallet(['A', 'B'], twoSame), 'Shopping').tie, true)
})

test('bestFor returns null when the wallet is empty', () => {
  assert.equal(bestFor([], 'Grocery'), null)
})

test('a top-category card is pointed at the category where it gains the most', () => {
  const cards = resolveWallet(['Custom Cash', 'Blue Cash'], {
    wallet: { 'Custom Cash': { catalogId: 'customCash' }, 'Blue Cash': { catalogId: 'amexBcp' } },
    overrides: {},
  })
  // Grocery already earns 6%, so Custom Cash's 5% is worth nothing there. Shopping earns 1%.
  assert.equal(topCatCategoryFor(cards, [
    { category: 'Grocery', monthly: 400 },
    { category: 'Shopping', monthly: 400 },
  ]), 'Shopping')
})

test('a wallet with no top-category card has no category to point one at', () => {
  const cards = resolveWallet(['Active Cash'], wallet())
  assert.equal(topCatCategoryFor(cards, [{ category: 'Grocery', monthly: 400 }]), null)
})

// ------------------------------------------------------------------ spend shaping

test('the monthly grid buckets by month, then card, then category', () => {
  const grid = monthlyGrid([
    tx('2026-07-02', 100, 'Grocery', 'Blue Cash'),
    tx('2026-07-20', 50, 'Grocery', 'Blue Cash'),
    tx('2026-07-20', 25, 'Shopping', 'Active Cash'),
    tx('2026-06-01', 10, 'Grocery', 'Blue Cash'),
  ])
  assert.deepEqual([...grid.keys()].sort(), ['2026-06', '2026-07'])
  assert.equal(grid.get('2026-07').get('Blue Cash').get('Grocery'), 150)
  assert.equal(grid.get('2026-07').get('Active Cash').get('Shopping'), 25)
})

test('Income and Transfer never reach the grid — they are not purchases', () => {
  const grid = monthlyGrid([
    tx('2026-07-02', 100, 'Income', 'Blue Cash'),
    tx('2026-07-02', 100, 'Transfer', 'Blue Cash'),
  ])
  assert.equal(grid.size, 0)
})

test('average monthly spend divides by the window, and drops what cannot earn', () => {
  const txs = ledger([[600, 'Grocery', 'Blue Cash'], [300, 'Income', 'Blue Cash']])
  assert.deepEqual(monthlySpendByCategory(txs, rangeOf(txs)), [
    { category: 'Grocery', monthly: 600 },
  ])
})

test('a sub-month window divides by one rather than by zero', () => {
  const monthly = monthlySpendByCategory(
    [tx('2026-07-10', 300, 'Grocery', 'Blue Cash')],
    { monthCount: 0, months: [] },
  )
  assert.equal(monthly[0].monthly, 300)
})

test('averageMonthlyByCard splits the habit per card', () => {
  const txs = ledger([[600, 'Grocery', 'Blue Cash'], [300, 'Shopping', 'Active Cash']])
  const avg = averageMonthlyByCard(txs, rangeOf(txs))
  assert.equal(avg.get('Blue Cash').get('Grocery'), 600)
  assert.equal(avg.get('Active Cash').get('Shopping'), 300)
})

// ------------------------------------------------------------------ what you EARNED

test('earned is the window total, not an annualized one', () => {
  const txs = ledger([[400, 'Grocery', 'Blue Cash']])
  const range = rangeOf(txs)
  const earned = earnedActual(txs, ['Blue Cash'], wallet(), range)
  // Six months at $400/mo × 6% — the six months on screen, and nothing more.
  assert.equal(range.monthCount, 6)
  assert.equal(earned.period, 400 * 0.06 * 6)
})

test('a one-month window earns one month, and a one-week window earns that week', () => {
  const oneMonth = [tx('2026-07-10', 400, 'Grocery', 'Blue Cash')]
  assert.equal(
    earnedActual(oneMonth, ['Blue Cash'], wallet(), resolvePeriod('1M', oneMonth)).period,
    400 * 0.06,
  )
  const oneWeek = [tx('2026-07-10', 90, 'Grocery', 'Blue Cash')]
  assert.equal(
    earnedActual(oneWeek, ['Blue Cash'], wallet(), resolvePeriod('7D', oneWeek)).period,
    round(90 * 0.06),
  )
})

test('earned uses the card really swiped; optimal routes to the best card', () => {
  // All grocery went on the flat-2% card, though the 6% card was in the wallet.
  const txs = ledger([[400, 'Grocery', 'Active Cash']])
  const range = rangeOf(txs)
  const sources = ['Active Cash', 'Blue Cash']

  assert.equal(earnedActual(txs, sources, wallet(), range).period, 400 * 0.02 * 6)
  assert.equal(earnedOptimal(txs, sources, wallet(), range).period, 400 * 0.06 * 6)
})

test('earned attributes each card only what was actually spent on it', () => {
  const txs = ledger([[400, 'Grocery', 'Blue Cash'], [200, 'Shopping', 'Active Cash']])
  const range = rangeOf(txs)
  const earned = earnedActual(txs, ['Active Cash', 'Blue Cash'], wallet(), range)

  const byName = Object.fromEntries(earned.byCard.map(c => [c.sourceName, c.period]))
  assert.equal(byName['Blue Cash'], 400 * 0.06 * 6)
  assert.equal(byName['Active Cash'], 200 * 0.02 * 6)
  assert.equal(earned.period, byName['Blue Cash'] + byName['Active Cash'])
})

test('caps bite month by month, so a lumpy month cannot be averaged out of its overflow', () => {
  // $3600 of grocery in ONE month, against a $500/mo cap. Averaged over six months it would look
  // like $600/mo and earn far more; scored per month it does not.
  const lumpy = [tx('2026-07-10', 3600, 'Grocery', 'Blue Cash')]
  const range = { months, monthCount: 6, to: '2026-07-31' }
  assert.equal(
    earnedActual(lumpy, ['Blue Cash'], wallet(), range).period,
    500 * 0.06 + 3100 * 0.01,
  )
})

test('spend on a source that is not linked earns nothing, and is reported as unattributed', () => {
  const txs = ledger([[400, 'Grocery', 'Unlinked Card']])
  const range = rangeOf(txs)
  const earned = earnedActual(txs, ['Active Cash'], wallet(), range)
  assert.equal(earned.period, 0)
  assert.equal(earned.unattributedSpend, 400 * 6)
})

// ------------------------------------------------------------------ rotating quarters

const discoverWallet = quarters => ({
  wallet: { Discover: { catalogId: 'discoverIt', quarters } },
  overrides: {},
})

// Discover's published 2026 calendar, which the catalog now ships:
//   Q1 Grocery · Shopping (wholesale clubs) · Subscription (streaming)
//   Q2 Food & Dining · Shopping (home improvement)
//   Q3 Transport (gas, EV, transit, flights) · Health (drug stores)
//   Q4 not yet announced
// The test ledger runs Feb–Jul 2026, so it straddles all three published quarters.

test('the published calendar is the authority, and covers every category in the quarter', () => {
  const card = resolveCard('Discover', { catalogId: 'discoverIt' }, { quarterKey: '2026-Q1' })
  assert.equal(card.rotatingSource, 'catalog')
  assert.deepEqual(Object.keys(card.rates).sort(), ['Grocery', 'Shopping', 'Subscription'])
  for (const rate of Object.values(card.rates)) {
    assert.equal(rate.pct, 5)
    assert.equal(rate.rotating, true)
    assert.equal(rate.capMo, 500, 'the per-category ceiling; the shared budget is enforced on fill')
  }
  // The coverage note travels with it, so the grid can mark it an over-estimate.
  assert.equal(card.rates.Shopping.coverage, 'partial')
  assert.match(card.rates.Shopping.note, /wholesale clubs/)
})

test('each quarter resolves to its own categories, with no user input at all', () => {
  const entry = { catalogId: 'discoverIt' }
  const at = q => Object.keys(resolveCard('Discover', entry, { quarterKey: q }).rates).sort()
  assert.deepEqual(at('2026-Q2'), ['Food & Dining', 'Shopping'])
  assert.deepEqual(at('2026-Q3'), ['Health', 'Transport'])
  assert.deepEqual(at('2026-Q1'), ['Grocery', 'Shopping', 'Subscription'])
})

test('a quarter the issuer has not announced scores at base, and says which it is', () => {
  const card = resolveCard('Discover', { catalogId: 'discoverIt' }, { quarterKey: '2026-Q4' })
  assert.equal(card.rotatingSource, 'unpublished', 'not the same as the user failing to answer')
  assert.deepEqual(card.rates, {})
  assert.equal(bestFor([card], 'Transport').rate, 1)
})

test('a hand-recorded quarter fills a gap the calendar does not cover, and never overrides it', () => {
  const entry = { catalogId: 'discoverIt', quarters: { '2026-Q4': 'Health', '2026-Q1': 'Transport' } }

  // Q4 has no published entry, so the user's record is used.
  const q4 = resolveCard('Discover', entry, { quarterKey: '2026-Q4' })
  assert.equal(q4.rotatingSource, 'user')
  assert.equal(q4.rates.Health.pct, 5)

  // Q1 is published. The user's guess loses — the calendar is a fact, not a preference.
  const q1 = resolveCard('Discover', entry, { quarterKey: '2026-Q1' })
  assert.equal(q1.rotatingSource, 'catalog')
  assert.equal(q1.rates.Transport, undefined)
  assert.deepEqual(Object.keys(q1.rates).sort(), ['Grocery', 'Shopping', 'Subscription'])
})

test('a rotating card with no calendar at all stays entirely on the hand-entry path', () => {
  // Every rotating card in the catalog now ships a calendar, so this path is exercised against a
  // synthetic card. It still matters: it is what a newly added rotating card falls back to before
  // anyone has sourced its quarters.
  const bare = { rotating: { pct: 5, capQtr: 1500 } }
  assert.equal(rotatingQuarterFor(bare, {}, '2026-Q1').source, 'none')
  assert.equal(
    rotatingQuarterFor(bare, { quarters: { '2026-Q1': 'Grocery' } }, '2026-Q1').source, 'user',
  )
  // Never 'unpublished' — with no calendar there is no horizon to be past.
  assert.equal(rotatingQuarterFor(bare, {}, '2099-Q4').source, 'none')

  for (const card of CARD_CATALOG) {
    if (!card.rotating) continue
    assert.ok(card.rotating.calendar, `${card.id} rotates but ships no calendar`)
  }
})

test('the quarterly cap is SHARED across everything the quarter covers', () => {
  // The bug this guards: $1,500/quarter is $500/month for the whole bonus, not $500 for each of
  // Q1's three categories. Scoring them independently would pay 5% on all $900 below.
  const txs = [
    tx('2026-02-10', 400, 'Grocery', 'Discover'),
    tx('2026-02-11', 400, 'Shopping', 'Discover'),
    tx('2026-02-12', 100, 'Subscription', 'Discover'),
  ]
  const range = { months: ['2026-02'], monthCount: 1, to: '2026-02-28' }
  const earned = earnedActual(txs, ['Discover'], discoverWallet({}), range).period

  // $500 of the $900 earns 5%; the remaining $400 falls back to the same card at 1%.
  assert.equal(earned, round(500 * 0.05 + 400 * 0.01))
  assert.notEqual(earned, round(900 * 0.05), 'three categories must not get three caps')
})

test('the shared cap gives the same total whichever category consumes it first', () => {
  // Every category in a quarter earns the same rate and falls back to the same base, so the fill
  // order cannot change the money. Worth pinning: it is what makes the greedy fill safe here.
  const range = { months: ['2026-02'], monthCount: 1, to: '2026-02-28' }
  const one = earnedActual([
    tx('2026-02-10', 700, 'Grocery', 'Discover'),
    tx('2026-02-11', 200, 'Shopping', 'Discover'),
  ], ['Discover'], discoverWallet({}), range).period
  const other = earnedActual([
    tx('2026-02-10', 200, 'Grocery', 'Discover'),
    tx('2026-02-11', 700, 'Shopping', 'Discover'),
  ], ['Discover'], discoverWallet({}), range).period
  assert.equal(one, other)
  assert.equal(one, round(500 * 0.05 + 400 * 0.01))
})

test('a window spanning a rotation is scored month by month, each with its own quarter', () => {
  // $300/mo of Transport across Feb–Jul. Transport is only a bonus category in Q3, which this
  // window touches for July alone, so exactly one month earns 5% and the other five earn base.
  const txs = ledger([[300, 'Transport', 'Discover']])
  assert.equal(
    earnedActual(txs, ['Discover'], discoverWallet({}), rangeOf(txs)).period,
    round(300 * 0.05 * 1 + 300 * 0.01 * 5),
  )
})

test('spending that follows the calendar earns the bonus in every month of the window', () => {
  // Shopping is a bonus category in Q1 (wholesale clubs) and Q2 (home improvement) — Feb through
  // Jun here — but not in Q3, so July drops to base.
  const txs = ledger([[300, 'Shopping', 'Discover']])
  assert.equal(
    earnedActual(txs, ['Discover'], discoverWallet({}), rangeOf(txs)).period,
    round(300 * 0.05 * 5 + 300 * 0.01 * 1),
  )
})

test('the rotating cap bites within a month, and the overflow drops to the base rate', () => {
  const txs = [tx('2026-07-10', 800, 'Transport', 'Discover')]
  const range = { months: ['2026-07'], monthCount: 1, to: '2026-07-31' }
  assert.equal(
    earnedActual(txs, ['Discover'], discoverWallet({}), range).period,
    round(500 * 0.05 + 300 * 0.01),
  )
})

// ------------------------------------------------------------------ the yearly projection

test('the projection annualizes average monthly spend, separately from what was earned', () => {
  const txs = ledger([[400, 'Grocery', 'Active Cash']])
  const range = rangeOf(txs)
  const cards = resolveWallet(['Active Cash', 'Blue Cash'], wallet())
  const monthly = monthlySpendByCategory(txs, range)
  const projection = projectAnnual(cards, monthly, averageMonthlyByCard(txs, range))

  // Optimal routing: grocery onto the 6% card. Current habit: all of it on the 2% card.
  assert.equal(projection.annualOptimal, 400 * 0.06 * 12)
  assert.equal(projection.annualCurrent, 400 * 0.02 * 12)
})

test('the projection reports no current figure when no per-card habit is supplied', () => {
  const cards = resolveWallet(['Blue Cash'], wallet())
  assert.equal(projectAnnual(cards, [{ category: 'Grocery', monthly: 400 }]).annualCurrent, null)
})

// ------------------------------------------------------------------ comparing a candidate

test('a candidate is scored net of its annual fee, on the projection', () => {
  const txs = ledger([[400, 'Grocery', 'Active Cash']])
  const range = rangeOf(txs)
  const cards = resolveWallet(['Active Cash'], wallet())
  const monthly = monthlySpendByCategory(txs, range)

  const result = compareCandidate(cards, {
    id: 'amexBcp', short: 'BCP', fee: 95, base: 1, rates: { Grocery: { pct: 6, capYr: 6000 } },
  }, monthly)

  assert.equal(result.baseAnnual, 400 * 0.02 * 12)
  assert.equal(result.candidateAnnual, 400 * 0.06 * 12)
  assert.equal(result.fee, 95)
  assert.equal(result.net, result.candidateAnnual - result.baseAnnual - 95)
})

test('a fee that outweighs the gain reads as a loss, not as a smaller win', () => {
  const txs = ledger([[50, 'Grocery', 'Active Cash']])
  const cards = resolveWallet(['Active Cash'], wallet())
  const monthly = monthlySpendByCategory(txs, rangeOf(txs))
  const result = compareCandidate(cards, {
    id: 'amexBcp', short: 'BCP', fee: 95, base: 1, rates: { Grocery: { pct: 6, capYr: 6000 } },
  }, monthly)
  assert.ok(result.net < 0, `expected a loss, got ${result.net}`)
})

test('"what changes" lists only categories the candidate actually improves', () => {
  const txs = ledger([[400, 'Grocery', 'Active Cash'], [300, 'Shopping', 'Active Cash']])
  const cards = resolveWallet(['Active Cash'], wallet())
  const monthly = monthlySpendByCategory(txs, rangeOf(txs))
  const result = compareCandidate(cards, {
    id: 'amexBcp', short: 'BCP', fee: 95, base: 1, rates: { Grocery: { pct: 6, capYr: 6000 } },
  }, monthly)

  // Shopping is unchanged — the candidate's 1% base is worse than the flat 2% already held.
  assert.deepEqual(result.changes.map(c => c.category), ['Grocery'])
  const [change] = result.changes
  assert.equal(change.fromRate, 2)
  assert.equal(change.toRate, 6)
  assert.equal(change.capMo, 500)
  assert.equal(change.gain, (400 * 0.06 - 400 * 0.02) * 12)
})

// ------------------------------------------------------------------ link states

test('a bare catalogId still means "linked" — entries written before `kind` keep working', () => {
  assert.equal(linkKindOf({ catalogId: 'amexBcp' }), 'catalog')
  assert.equal(linkKindOf({ kind: 'catalog', catalogId: 'amexBcp' }), 'catalog')
  assert.equal(linkKindOf({ kind: 'unlisted' }), 'unlisted')
  assert.equal(linkKindOf({ kind: 'none' }), 'none')
  assert.equal(linkKindOf({}), null)
  assert.equal(linkKindOf(undefined), null)
})

test('an unlisted card is never scored, and never resolves to a card', () => {
  assert.equal(resolveCard('Store Card', { kind: 'unlisted' }), null)
  assert.equal(resolveCard('Debit', { kind: 'none' }), null)
})

test('classifySources sorts every source into what the page can do about it', () => {
  const txs = ledger([
    [400, 'Grocery', 'Blue Cash'],
    [200, 'Shopping', 'Store Card'],
    [100, 'Grocery', 'Debit'],
    [50, 'Shopping', 'Mystery Card'],
  ])
  const states = classifySources(
    ['Blue Cash', 'Store Card', 'Debit', 'Mystery Card'],
    {
      wallet: {
        'Blue Cash': { catalogId: 'amexBcp' },
        'Store Card': { kind: 'unlisted' },
        'Debit': { kind: 'none' },
      },
    },
    txs,
  )

  assert.deepEqual(states.catalog.map(s => s.sourceName), ['Blue Cash'])
  assert.deepEqual(states.unlisted.map(s => s.sourceName), ['Store Card'])
  assert.deepEqual(states.none.map(s => s.sourceName), ['Debit'])
  assert.deepEqual(states.unlinked.map(s => s.sourceName), ['Mystery Card'])
  // Spend travels with the row, so the setup screen can lead with the card that matters most.
  assert.equal(states.catalog[0].spend, 400 * 6)
})

test('a link to a card the catalog dropped counts as unlinked, and says so', () => {
  const states = classifySources(['Old Card'], {
    wallet: { 'Old Card': { kind: 'catalog', catalogId: 'goneInV2' } },
  })
  assert.deepEqual(states.catalog, [])
  assert.equal(states.unlinked[0].sourceName, 'Old Card')
  assert.equal(states.unlinked[0].stale, true)
})

test('coverage counts what could be scored, and excludes what was never going to be', () => {
  const txs = ledger([[400, 'Grocery', 'Blue Cash'], [200, 'Shopping', 'Store Card']])
  const model = buildRewardsModel({
    spendTxs: txs,
    allSources: ['Blue Cash', 'Store Card', 'Debit', 'Mystery Card'],
    range: rangeOf(txs),
    settings: {
      cardRewards: {
        wallet: {
          'Blue Cash': { catalogId: 'amexBcp' },
          'Store Card': { kind: 'unlisted' },
          'Debit': { kind: 'none' },
        },
      },
    },
  })
  // 'Debit' is not in the denominator: a card that earns nothing is not a gap in coverage.
  assert.deepEqual(model.coverage, { scored: 1, scorable: 3 })
  assert.deepEqual(model.unlinkedSources, ['Mystery Card'])
})

// ------------------------------------------------------------------ the whole model

test('buildRewardsModel separates what was earned from what a year would look like', () => {
  const txs = ledger([[400, 'Grocery', 'Active Cash'], [200, 'Shopping', 'Blue Cash']])
  const range = rangeOf(txs)
  const model = buildRewardsModel({
    spendTxs: txs,
    allSources: ['Active Cash', 'Blue Cash', 'Store Card'],
    range,
    settings: { cardRewards: wallet() },
  })

  assert.deepEqual(model.unlinkedSources, ['Store Card'])
  assert.deepEqual(model.rows.map(r => r.category), ['Grocery', 'Shopping'])
  assert.equal(model.rows[0].best.card.sourceName, 'Blue Cash')

  // Observed over six months — grocery sat on the 2% card, shopping on the 1% card.
  assert.equal(model.earned.period, (400 * 0.02 + 200 * 0.01) * 6)
  assert.equal(model.optimal.period, (400 * 0.06 + 200 * 0.02) * 6)
  assert.equal(model.leftBehind, round(model.optimal.period - model.earned.period))
  assert.ok(model.leftBehind > 0, 'grocery is on the wrong card')

  // Projected forward — a different question, a different number.
  assert.equal(model.projection.annualOptimal, (400 * 0.06 + 200 * 0.02) * 12)
  assert.equal(model.projection.shortWindow, false)
})

test('the earned figure tracks the period chip', () => {
  const txs = ledger([[400, 'Grocery', 'Blue Cash']])
  const build = key => buildRewardsModel({
    spendTxs: txs.filter(t => {
      const range = resolvePeriod(key, txs)
      return t.date >= range.from && t.date <= range.to
    }),
    allSources: ['Blue Cash'],
    range: resolvePeriod(key, txs),
    settings: { cardRewards: wallet() },
  })

  assert.equal(build('6M').earned.period, 400 * 0.06 * 6)
  assert.equal(build('1M').earned.period, 400 * 0.06 * 1)
  // The projection is the same either way: it annualizes a rate, not a total.
  assert.equal(build('6M').projection.annualOptimal, build('1M').projection.annualOptimal)
})

test('a cell knows when it is the winner, and when its rate only partly covers the category', () => {
  const txs = ledger([[300, 'Transport', 'Blue Cash']])
  const model = buildRewardsModel({
    spendTxs: txs,
    allSources: ['Active Cash', 'Blue Cash'],
    range: rangeOf(txs),
    settings: { cardRewards: wallet() },
  })
  const row = model.rows.find(r => r.category === 'Transport')
  const blueCash = row.cells.find(c => c.sourceName === 'Blue Cash')
  // amexBcp pays 3% on gas and transit only — flagged, because Transport also holds flights.
  assert.equal(blueCash.pct, 3)
  assert.equal(blueCash.partial, true)
  assert.equal(blueCash.isBest, true)
})

test('a short window flags only the projection, never the observed figure', () => {
  const txs = [tx('2026-07-10', 300, 'Grocery', 'Blue Cash')]
  const model = buildRewardsModel({
    spendTxs: txs,
    allSources: ['Blue Cash'],
    range: resolvePeriod('7D', txs),
    settings: { cardRewards: wallet() },
  })
  assert.ok(model.monthCount < SHORT_WINDOW_MONTHS)
  assert.equal(model.projection.shortWindow, true)
  // The week's earnings are a fact regardless of how short the week is.
  assert.equal(model.earned.period, round(300 * 0.06))
})

test('an empty wallet produces an empty model rather than throwing', () => {
  const txs = ledger([[400, 'Grocery', 'Active Cash']])
  const model = buildRewardsModel({
    spendTxs: txs,
    allSources: ['Active Cash'],
    range: rangeOf(txs),
    settings: {},
  })
  assert.deepEqual(model.cards, [])
  assert.deepEqual(model.unlinkedSources, ['Active Cash'])
  assert.equal(model.earned.period, 0)
  assert.equal(model.earned.unattributedSpend, 400 * 6)
  assert.equal(model.optimal.period, 0)
  assert.equal(model.leftBehind, 0)
  assert.equal(model.rows[0].best, null)
})

// ------------------------------------------------------------------ the cell editors

// `withSlot`, `withoutSlotFor` and `withQuarter` are the only things that write a chooser choice or
// a rotating quarter. They are pure transforms on a wallet entry, so the grid cell that calls one
// can be a plain `<select>` with no state of its own.

test('a chooser slot moves rather than duplicating, since one category cannot hold two', () => {
  const entry = { kind: 'catalog', catalogId: 'tdCash', slots: { 0: 'Grocery', 1: 'Transport' } }
  // Putting the 3% slot on Transport takes it off Grocery AND frees the 2% slot it displaced.
  const moved = withSlot(entry, 0, 'Transport')
  assert.deepEqual(moved.slots, { 0: 'Transport' }, 'the 2% slot was on Transport and gave it up')
  assert.equal(moved.catalogId, 'tdCash', 'the link itself is untouched')
})

test('assigning a free slot leaves the others where they were', () => {
  const entry = { kind: 'catalog', catalogId: 'tdCash', slots: { 0: 'Grocery' } }
  assert.deepEqual(withSlot(entry, 1, 'Transport').slots, { 0: 'Grocery', 1: 'Transport' })
})

test('clearing a category sends it back to the base rate', () => {
  const entry = { kind: 'catalog', catalogId: 'tdCash', slots: { 0: 'Grocery', 1: 'Transport' } }
  assert.deepEqual(withoutSlotFor(entry, 'Grocery').slots, { 1: 'Transport' })
  assert.deepEqual(withSlot(entry, 0, '').slots, { 1: 'Transport' })
  // A category that holds no slot is not an error; nothing moves.
  assert.deepEqual(withoutSlotFor(entry, 'Health').slots, { 0: 'Grocery', 1: 'Transport' })
})

test('a slot choice is what the resolved card actually pays', () => {
  const entry = withSlot({ kind: 'catalog', catalogId: 'tdCash' }, 0, 'Grocery')
  const card = resolveCard('TD', entry)
  assert.equal(card.rates['Grocery'].pct, 3)
  assert.equal(card.rates['Grocery'].slot, 0, 'the cell reads this back to show which slot it is')
  assert.equal(card.rates['Transport'], undefined, 'everything else is still base')
})

test('recording a quarter is per quarter, and clearing it removes the key', () => {
  const entry = withQuarter({ kind: 'catalog', catalogId: 'discoverIt' }, '2026-Q3', 'Grocery')
  assert.deepEqual(entry.quarters, { '2026-Q3': 'Grocery' })

  const both = withQuarter(entry, '2026-Q2', 'Transport')
  assert.deepEqual(both.quarters, { '2026-Q3': 'Grocery', '2026-Q2': 'Transport' })

  // Cleared, not blanked: an unrecorded quarter is an open question, and a stored '' would read as
  // an answer meaning "the bonus was on nothing".
  assert.deepEqual(withQuarter(both, '2026-Q3', '').quarters, { '2026-Q2': 'Transport' })
  assert.ok(!('2026-Q3' in withQuarter(both, '2026-Q3', null).quarters))
})

test('recording a quarter changes what that quarter earned, and only that quarter', () => {
  // The hand-entry path, reached the way it is reached in practice: a quarter past the end of the
  // calendar. Sep 2026 is Q3 (published as Transport and Entertainment, so grocery earns base);
  // Oct and Nov are Q4, which Chase had not announced when this catalog shipped.
  const txs = ['2026-09', '2026-10', '2026-11'].map(m => tx(`${m}-10`, 1000, 'Grocery', 'Chase'))
  const range = { months: ['2026-09', '2026-10', '2026-11'], monthCount: 3, to: '2026-11-30' }
  const linked = quarters => ({
    wallet: { Chase: { kind: 'catalog', catalogId: 'freedomFlex', quarters } },
    overrides: {},
  })

  const none = buildRewardsModel({
    spendTxs: txs, allSources: ['Chase'], range, settings: { cardRewards: linked({}) },
  })
  assert.equal(none.earned.period, round(3 * 1000 * 0.01), 'grocery is in no published quarter')

  const entry = withQuarter({ kind: 'catalog', catalogId: 'freedomFlex' }, '2026-Q4', 'Grocery')
  const q4 = buildRewardsModel({
    spendTxs: txs, allSources: ['Chase'], range, settings: { cardRewards: linked(entry.quarters) },
  })
  // The $1,500/quarter cap is $500/mo, so half of each Q4 month earns 5% and the rest falls back
  // onto the same card at 1%. September, being Q3, is untouched.
  const bonusMonth = 500 * 0.05 + 500 * 0.01
  assert.equal(q4.earned.period, round(1000 * 0.01 + 2 * bonusMonth))
})

// ------------------------------------------------------------------ candidates

// `buildCandidates` ranks cards you do NOT hold against your real spending. Everything it returns
// is annualized, so it carries the same short-window caution the projection does.

test('candidates rank on the yearly gain after the fee, not on the headline rate', () => {
  const txs = ledger([[400, 'Grocery', 'Active Cash']])
  const range = rangeOf(txs)
  const monthly = monthlySpendByCategory(txs, range)
  const cards = resolveWallet(['Active Cash'], wallet(), null)

  const fake = [
    // 6% grocery, but $400/mo of grocery only earns $288/yr — a $400 fee buries it.
    { id: 'pricey', name: 'Pricey', short: 'Pricey', issuer: 'X', region: 'us', fee: 400, base: 1, rates: { Grocery: { pct: 6 } } },
    // A plain 3% grocery card with no fee wins on net despite the lower rate.
    { id: 'plain', name: 'Plain', short: 'Plain', issuer: 'X', region: 'us', fee: 0, base: 1, rates: { Grocery: { pct: 3 } } },
  ]
  const ranked = buildCandidates({ cards, monthly, catalog: fake })
  assert.deepEqual(ranked.map(r => r.card.id), ['plain', 'pricey'])
  assert.ok(ranked[0].net > 0)
  assert.ok(ranked[1].net < 0, 'the fee outruns the gain')

  // net is exactly candidate − base − fee, the identity the panel prints line by line.
  for (const row of ranked) {
    assert.equal(row.net, round(row.candidateAnnual - row.baseAnnual - row.fee))
  }
})

test('a card already in the wallet is not offered again', () => {
  const txs = ledger([[400, 'Grocery', 'Blue Cash']])
  const monthly = monthlySpendByCategory(txs, rangeOf(txs))
  const cards = resolveWallet(['Blue Cash'], wallet(), null)
  const ids = buildCandidates({ cards, monthly, ownedIds: ['amexBcp'] }).map(r => r.card.id)
  assert.ok(!ids.includes('amexBcp'))
  assert.ok(ids.length > 0, 'the rest of the catalog is still offered')
})

test('the region filter narrows to one country, and no filter keeps both', () => {
  const txs = ledger([[400, 'Grocery', 'Blue Cash']])
  const monthly = monthlySpendByCategory(txs, rangeOf(txs))
  const cards = resolveWallet(['Blue Cash'], wallet(), null)

  for (const region of ['us', 'ca']) {
    const rows = buildCandidates({ cards, monthly, region })
    assert.ok(rows.length > 0, `${region} has candidates`)
    assert.ok(rows.every(r => r.card.region === region))
  }
  const all = buildCandidates({ cards, monthly })
  assert.ok(all.length > buildCandidates({ cards, monthly, region: 'us' }).length)
})

test('with an empty wallet a candidate is scored as if it were the only card', () => {
  const txs = ledger([[400, 'Grocery', 'Nothing']])
  const monthly = monthlySpendByCategory(txs, rangeOf(txs))
  const only = buildCandidates({ cards: [], monthly }).find(r => r.card.id === 'amexBcp')
  assert.equal(only.baseAnnual, 0, 'nothing linked earns nothing')
  // $400/mo grocery is under the $500/mo cap, so all of it earns 6%.
  assert.equal(only.candidateAnnual, round(400 * 0.06 * 12))
  assert.equal(only.net, round(400 * 0.06 * 12 - only.card.fee))
})

test('what changes names the category, both cards and the gain', () => {
  const txs = ledger([[400, 'Grocery', 'Active Cash']])
  const monthly = monthlySpendByCategory(txs, rangeOf(txs))
  const cards = resolveWallet(['Active Cash'], wallet(), null)   // flat 2%
  const row = buildCandidates({ cards, monthly }).find(r => r.card.id === 'amexBcp')

  const grocery = row.changes.find(c => c.category === 'Grocery')
  assert.equal(grocery.fromRate, 2)
  assert.equal(grocery.fromCard, 'Active Cash')
  assert.equal(grocery.toRate, 6)
  assert.equal(grocery.toCard, 'Blue Cash Preferred')
  assert.equal(grocery.gain, round(400 * 0.04 * 12), '4 points of gain on $400/mo')
  // Only improvements are listed; a category the candidate would not win never appears.
  assert.ok(row.changes.every(c => c.toRate > c.fromRate))
})

test('a partial-coverage bonus is flagged on the change it drives', () => {
  // Amex Platinum pays 5% on Transport, but only on flights booked through a portal. The gain is
  // real arithmetic on a rate that covers a slice of the category, and the panel has to say so —
  // an unqualified "+$216 a year on Transport" is the whole case for a $895 card.
  const txs = ledger([[500, 'Transport', 'Active Cash']])
  const monthly = monthlySpendByCategory(txs, rangeOf(txs))
  const cards = resolveWallet(['Active Cash'], wallet(), null)
  const row = buildCandidates({ cards, monthly }).find(r => r.card.id === 'amexPlat')

  const transport = row.changes.find(c => c.category === 'Transport')
  assert.equal(transport.partial, true)
  assert.match(transport.note, /Amex Travel/)

  // A bonus that covers its whole category carries no flag and no note to print.
  const grocery = buildCandidates({ cards, monthly: [{ category: 'Grocery', monthly: 400 }] })
    .find(r => r.card.id === 'amexBcp').changes.find(c => c.category === 'Grocery')
  assert.equal(grocery.partial, false)
  assert.equal(grocery.note, null)
})

test('a quarter before the calendar is a gap in our data, not an unannounced one', () => {
  // Calendars reach back to 2025. Anything older is a quarter that happened and that we simply do
  // not hold — telling a user it is "not announced yet" would be false. The difference is decided
  // by comparing quarter keys; this module never looks at a clock.
  const card = catalogCard('discoverIt')
  const entry = { catalogId: 'discoverIt' }
  assert.equal(rotatingQuarterFor(card, entry, '2024-Q4').source, 'missing')
  assert.equal(rotatingQuarterFor(card, entry, '2025-Q4').source, 'catalog', 'now published')
  assert.equal(rotatingQuarterFor(card, entry, '2026-Q4').source, 'unpublished')
  assert.equal(rotatingQuarterFor(card, entry, '2027-Q1').source, 'unpublished')

  // Both unknown states score at base, and both stay recordable by hand.
  for (const q of ['2024-Q4', '2026-Q4']) {
    assert.deepEqual(resolveCard('D', entry, { quarterKey: q }).rates, {})
    assert.equal(
      resolveCard('D', { ...entry, quarters: { [q]: 'Grocery' } }, { quarterKey: q }).rates.Grocery.pct,
      5,
    )
  }
})

test('the calendar span is reported so the view can say how far back it reaches', () => {
  // Every rotating card carries one, and it is what the rail card prints. A window older than
  // `from` is a gap in our data rather than a card that earned nothing.
  for (const card of CARD_CATALOG) {
    if (!card.rotating) continue
    const span = calendarRangeOf(card)
    assert.ok(span, `${card.id} has a calendar but no reportable span`)
    assert.match(span.from, /^\d{4}-Q[1-4]$/)
    assert.ok(span.from <= span.to)
    assert.equal(span.from, '2025-Q1', `${card.id} should reach back to 2025`)
  }
  assert.equal(calendarRangeOf({ rotating: { pct: 5 } }), null, 'no calendar, no span')
  assert.equal(calendarRangeOf(null), null)
})

test('a rotating quarter beats a standing rate on the same category, but never a higher one', () => {
  // Freedom Flex pays a standing 3% on dining, and its Q1 2026 rotation is dining at 5%. The
  // higher rate has to win, or a quarter would silently downgrade a rate the card always pays.
  const q1 = resolveCard('Chase', { catalogId: 'freedomFlex' }, { quarterKey: '2026-Q1' })
  assert.equal(q1.rates['Food & Dining'].pct, 5)
  assert.equal(q1.rates['Food & Dining'].rotating, true)

  // Outside that quarter the standing rate is what remains.
  const q2 = resolveCard('Chase', { catalogId: 'freedomFlex' }, { quarterKey: '2026-Q2' })
  assert.equal(q2.rates['Food & Dining'].pct, 3)
  assert.equal(q2.rates['Food & Dining'].rotating, undefined)
  // And the quarter's own categories are there alongside it.
  assert.equal(q2.rates.Shopping.pct, 5)
  assert.equal(q2.rates.Grocery.pct, 5)
})
