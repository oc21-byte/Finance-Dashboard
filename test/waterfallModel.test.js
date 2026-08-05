import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWaterfall, PLOT_H } from '../src/utils/waterfallModel.js'
import { buildChangeAttribution, buildUnaccountedRows } from '../src/utils/liquidNetWorth.js'

// The waterfall's entire claim is that the change is FULLY explained. Every test below exists to
// stop that claim being quietly false — a bar dropped for being small, a step folded into the
// wrong neighbour, or a truncated axis that never announces itself.

const entry = (date, cash, savings, portfolio, portfolioCost, basis = 'market') => ({
  date,
  netWorth: Math.round((cash + savings + portfolio) * 100) / 100,
  breakdown: { cash, savings, portfolio },
  portfolioCost,
  basis,
})

const attribution = over => ({
  from: '2026-02-28', to: '2026-06-30',
  start: 0, end: 0, change: 0,
  moneyIn: 0, moneyOut: 0, saved: 0, market: 0, other: 0,
  reconciliation: 0, lag: 0, unexplained: 0, adjustments: [],
  savedShare: null, marketShare: null, basis: 'market',
  hasOther: false, hasReconciliation: false,
  ...over,
})

const sumOfSteps = model =>
  Math.round(model.bars.filter(b => b.delta !== null).reduce((s, b) => s + b.delta, 0) * 100) / 100

test('the bars close: start plus every step lands exactly on today', () => {
  const model = buildWaterfall(attribution({
    start: 60000, end: 69574, change: 9574,
    moneyIn: 41500, moneyOut: 38900, saved: 2600, market: 1610,
    reconciliation: 5300, unexplained: 5300, other: 64,
  }))

  assert.equal(model.closes, true)
  assert.equal(sumOfSteps(model), 9574)
  assert.equal(model.bars[0].value, 60000)
  assert.equal(model.bars[model.bars.length - 1].value, 69574)
})

test('a step too small to draw is folded forward, never dropped', () => {
  // A $0.20 market move is sub-cent noise on a five-figure balance and gets no column. If it were
  // simply discarded the running total would stop landing on Today, and the card would be lying
  // about the one thing it promises.
  const model = buildWaterfall(attribution({
    start: 50000, end: 52000.2, change: 2000.2,
    moneyIn: 5000, moneyOut: 3000, saved: 2000, market: 0.2,
  }))

  assert.equal(model.bars.some(b => b.key === 'market'), false, 'no column for 20 cents')
  assert.equal(model.closes, true)
  assert.equal(sumOfSteps(model), 2000.2)
})

test('every remainder reaches the last surviving step', () => {
  // Two sub-threshold steps in a row must accumulate rather than each vanishing on its own.
  const model = buildWaterfall(attribution({
    start: 50000, end: 50000.6, change: 0.6,
    moneyIn: 0.2, moneyOut: 0, saved: 0.2, market: 0.2, other: 0.2,
  }))
  assert.equal(model.closes, true)
  assert.equal(sumOfSteps(model), 0.6)
})

test('the unaccounted bar carries the reconciliation and the residual together', () => {
  const model = buildWaterfall(attribution({
    start: 60000, end: 64000, change: 4000,
    moneyIn: 1000, moneyOut: 0, saved: 1000,
    reconciliation: 2900, unexplained: 2900, other: 100,
  }))
  const bar = model.bars.find(b => b.key === 'unaccounted')
  assert.equal(bar.delta, 3000)
})

test('a big balance truncates the axis and says so; a small one does not', () => {
  const big = buildWaterfall(attribution({
    start: 69000, end: 72000, change: 3000,
    moneyIn: 3000, moneyOut: 0, saved: 3000,
  }))
  assert.equal(big.truncated, true)
  assert.ok(big.floor > 0, 'the floor is a real number the card can print')

  const small = buildWaterfall(attribution({
    start: 1000, end: 5000, change: 4000,
    moneyIn: 4000, moneyOut: 0, saved: 4000,
  }))
  assert.equal(small.truncated, false)
  assert.equal(small.floor, 0)
})

test('a step that dips below both totals still fits inside the plot', () => {
  // Spend first, earn it back later: the running total goes under the starting balance even
  // though the period ends flat. Scaling to the totals alone would push that bar off the bottom.
  const model = buildWaterfall(attribution({
    start: 60000, end: 60000, change: 0,
    moneyIn: 0, moneyOut: 8000, saved: -8000, market: 8000,
  }))
  for (const bar of model.bars) {
    assert.ok(bar.y >= -0.01, `${bar.key} starts above the plot`)
    assert.ok(bar.y + bar.h <= PLOT_H + 0.01, `${bar.key} runs past the plot floor`)
  }
})

test('an empty attribution renders nothing rather than throwing', () => {
  const model = buildWaterfall(null)
  assert.equal(model.empty, true)
  assert.deepEqual(model.bars, [])
  assert.equal(buildWaterfall({ from: null, to: null }).empty, true)
})

test('a period where nothing moved draws two totals and no steps', () => {
  const model = buildWaterfall(attribution({ start: 5000, end: 5000, change: 0 }))
  assert.equal(model.empty, false)
  assert.equal(model.bars.length, 2)
  assert.ok(model.bars.every(b => b.h > 0), 'both totals are still visible')
})

// --- The drill-down --------------------------------------------------------------------------

const HISTORY = [
  entry('2026-05-31', 8300, 20000, 10000, 9000),
  entry('2026-07-13', 7000, 20000, 10000, 9000),
]

// As `statementChecks` returns them: `from` is the previous statement close, so each gap already
// knows the stretch it accumulated over rather than the card having to look it up.
const CHECKS = [
  { date: '2026-05-15', balance: 8300, expected: 8300, discrepancy: 0, from: null, beyondLedger: false },
  { date: '2026-06-07', balance: 11300, expected: 8808.09, discrepancy: 2491.91, from: '2026-05-15', beyondLedger: false },
  { date: '2026-06-29', balance: 9091.05, expected: 15115.82, discrepancy: -6024.77, from: '2026-06-07', beyondLedger: false },
  { date: '2026-08-05', balance: 3500, expected: 5690.13, discrepancy: -2190.13, from: '2026-06-29', beyondLedger: true },
]

test('each gap is dated and bounded by the last time the ledger agreed', () => {
  const a = buildChangeAttribution(HISTORY, [], { from: '2026-05-31', to: '2026-07-13' }, CHECKS)
  const rows = buildUnaccountedRows(a)

  const june29 = rows.find(r => r.date === '2026-06-29')
  assert.equal(june29.from, '2026-06-07', 'bounded by the previous statement close, not by the range')
  assert.equal(june29.to, '2026-06-29')
  assert.equal(june29.amount, -6024.77)
  assert.equal(june29.kind, 'unexplained')
})

test('the window falls back to the range start when nothing earlier agreed', () => {
  const recs = [{ ...CHECKS[1], from: null }]
  const a = buildChangeAttribution(HISTORY, [], { from: '2026-05-31', to: '2026-07-13' }, recs)
  const rows = buildUnaccountedRows(a)
  assert.equal(rows[0].from, '2026-05-31')
})

test('rows are ordered by size, because the user wants the big one first', () => {
  const a = buildChangeAttribution(HISTORY, [], { from: '2026-05-31', to: '2026-07-13' }, CHECKS)
  const rows = buildUnaccountedRows(a)
  // Dated rows by magnitude, and the undateable residual after them.
  assert.deepEqual(rows.map(r => r.date), ['2026-06-29', '2026-06-07', null])
})

test('a zero-dollar check is not itemised', () => {
  // May 15 confirmed the ledger was right. There is nothing to explain, so listing it would pad
  // the breakdown with a row that has no content.
  const a = buildChangeAttribution(HISTORY, [], { from: '2026-05-01', to: '2026-07-13' }, CHECKS)
  const rows = buildUnaccountedRows(a)
  assert.equal(rows.some(r => r.date === '2026-05-15'), false)
})

test('the residual is listed last even when it is the largest', () => {
  const a = { ...attribution({ from: '2026-01-01', to: '2026-06-30', other: 9000 }) }
  const rows = buildUnaccountedRows(a, [])
  assert.equal(rows[rows.length - 1].kind, 'residual')
  assert.equal(rows[rows.length - 1].date, null)
})

test('an out-of-coverage adjustment is labelled lag, not a discrepancy', () => {
  const history = [...HISTORY, entry('2026-08-05', 3500, 20000, 10000, 9000)]
  const a = buildChangeAttribution(history, [], { from: '2026-07-13', to: '2026-08-05' }, CHECKS)
  const rows = buildUnaccountedRows(a)
  assert.equal(rows.find(r => r.date === '2026-08-05').kind, 'lag')
})
