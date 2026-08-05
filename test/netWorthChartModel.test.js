import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTrendModel, buildDonutModel, arcPath, PLOT_H } from '../src/utils/netWorthChartModel.js'
import { buildTrendSeries, buildComposition } from '../src/utils/liquidNetWorth.js'

// A stacked area encodes quantity as THICKNESS. That makes two things load-bearing: the axis must
// start at zero, and the top edge of the stack must be the total — not a separately computed line
// that happens to look close. Both are checked below, because either failing produces a chart that
// is wrong in a way no one notices.

const point = (label, cash, savings, portfolio) => ({
  date: `2026-0${label}-28`,
  label: `M${label}`,
  cash, savings, portfolio,
  liquid: cash + savings + portfolio,
  basis: 'market',
})

const POINTS = [
  point(1, 5000, 20000, 10000),
  point(2, 5200, 21000, 10800),
  point(3, 5400, 22000, 11500),
  point(4, 5600, 23000, 12400),
]

const yToValue = (y, ceiling) => ((PLOT_H - y) / PLOT_H) * ceiling
const lastPair = path => path.split(' ').filter(Boolean)

test('the axis starts at zero, always', () => {
  const model = buildTrendModel(POINTS)
  assert.equal(model.ticks[0].value, 0)
  assert.equal(model.ticks[0].y, PLOT_H)
})

test('the top of the stack is the liquid net worth at every point', () => {
  // This is the promise the card makes to the KPI strip above it. If the bands and the line are
  // computed from different places they will drift apart the moment one of them gains a rounding
  // rule, and the drift will be invisible.
  const model = buildTrendModel(POINTS)
  const top = model.bands.find(b => b.key === 'portfolio')
  const coords = lastPair(top.path).slice(0, POINTS.length)

  coords.forEach((coord, i) => {
    const [, y] = coord.split(',').map(Number)
    assert.ok(
      Math.abs(yToValue(y, model.ceiling) - POINTS[i].liquid) < 1,
      `band top at point ${i} should equal ${POINTS[i].liquid}`,
    )
  })

  const lineCoords = model.line.split(' ')
  assert.equal(lineCoords.length, POINTS.length)
  lineCoords.forEach((coord, i) => {
    const [, y] = coord.split(',').map(Number)
    assert.ok(Math.abs(yToValue(y, model.ceiling) - POINTS[i].liquid) < 1)
  })
})

test('the ceiling is a round number at or above the peak', () => {
  const model = buildTrendModel(POINTS)
  const peak = Math.max(...POINTS.map(p => p.liquid))
  assert.ok(model.ceiling >= peak)
  assert.ok(model.ceiling < peak * 2, 'not so generous the data is squashed flat')
  assert.equal(String(model.ceiling).replace(/0+$/, '').replace('.', '').length <= 2, true)
})

test('total mode draws one band, stacked draws three', () => {
  assert.equal(buildTrendModel(POINTS, 'stacked').bands.length, 3)
  assert.equal(buildTrendModel(POINTS, 'total').bands.length, 1)
  // Both modes keep the same total line, so toggling never moves the headline.
  assert.equal(buildTrendModel(POINTS, 'total').line, buildTrendModel(POINTS, 'stacked').line)
})

test('a single point cannot draw a line, and says so rather than rendering a stub', () => {
  assert.equal(buildTrendModel([POINTS[0]]).empty, true)
  assert.equal(buildTrendModel([]).empty, true)
})

test('a negative bucket is floored rather than inverting the stack', () => {
  // Cash can go negative on an overdraft. A stacked area has no coherent way to draw that, and
  // letting it through would flip a band inside out and silently misplace the two above it.
  const model = buildTrendModel([
    { ...point(1, -500, 20000, 10000), liquid: 29500 },
    point(2, 5200, 21000, 10800),
  ])
  const cash = model.bands.find(b => b.key === 'cash')
  const [, y] = cash.path.split(' ')[0].split(',').map(Number)
  assert.ok(yToValue(y, model.ceiling) >= -0.01, 'the cash band never dips below the axis')
})

test('x labels thin out rather than shrinking to unreadable', () => {
  const many = Array.from({ length: 24 }, (_, i) => ({
    ...point(1, 1000 + i, 2000, 3000), date: `2026-01-${String(i + 1).padStart(2, '0')}`, label: `d${i}`,
  }))
  const model = buildTrendModel(many)
  const shown = model.columns.filter(c => c.showLabel)
  assert.ok(shown.length < many.length)
  assert.equal(model.columns[0].showLabel, true, 'the first point is always labelled')
  assert.equal(model.columns[many.length - 1].showLabel, true, 'and so is the last')
})

test('the trend series feeds the model without reshaping', () => {
  const history = [
    { date: '2026-03-31', netWorth: 100, breakdown: { cash: 40, savings: 30, portfolio: 30 }, portfolioCost: 25, basis: 'market' },
    { date: '2026-04-30', netWorth: 120, breakdown: { cash: 50, savings: 30, portfolio: 40 }, portfolioCost: 25, basis: 'market' },
  ]
  const model = buildTrendModel(buildTrendSeries(history, 'All'))
  assert.equal(model.empty, false)
  assert.equal(model.columns.length, 2)
})

// --- Donut -----------------------------------------------------------------------------------

test('segments cover the full circle in proportion', () => {
  const rows = buildComposition({ cash: 2500, savings: 5000, holdings: [], prices: {} })
  const model = buildDonutModel(rows)
  assert.equal(model.total, 7500)
  assert.equal(Math.round(model.segments.reduce((s, x) => s + x.sweep, 0)), 360)
  assert.equal(Math.round(model.segments[0].sweep), 120)
})

test('a lone holding fills the ring instead of disappearing', () => {
  // An arc whose start and end coincide renders as nothing. A user with only cash would see an
  // empty donut with the right number in the middle — the worst kind of wrong.
  const model = buildDonutModel([{ key: 'cash', name: 'Cash', bucket: 'cash', value: 100, pct: 100 }])
  assert.equal(model.segments.length, 1)
  assert.ok(model.segments[0].path.length > 0)
  assert.equal((model.segments[0].path.match(/A /g) ?? []).length, 4, 'drawn as two half-arcs')
})

test('an empty composition reports empty rather than dividing by zero', () => {
  assert.equal(buildDonutModel([]).empty, true)
  assert.equal(buildDonutModel([{ key: 'cash', value: 0 }]).empty, true)
})

test('every slice carries the parent bucket the trend can filter by', () => {
  const holdings = [
    { ticker: 'AAA', shares: 10, purchasePrice: 10, accountType: 'TFSA' },
    { ticker: 'BBB', shares: 10, purchasePrice: 10, accountType: 'RRSP' },
  ]
  const rows = buildComposition({ cash: 100, savings: 100, holdings, prices: {} })
  const model = buildDonutModel(rows)
  assert.deepEqual(
    model.segments.map(s => s.bucket),
    ['cash', 'savings', 'portfolio', 'portfolio'],
  )
})

test('arcPath produces nothing for a zero sweep', () => {
  assert.equal(arcPath(100, 100, 90, 60, 45, 45), '')
})
