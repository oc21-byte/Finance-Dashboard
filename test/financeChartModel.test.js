import test from 'node:test'
import assert from 'node:assert/strict'
import { buildInOutModel, PLOT_H } from '../src/utils/financeChartModel.js'

const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']

const bank = (date, amount, category, type) => ({
  id: `${date}-${amount}`, date, description: 'ROW', amount, category, type, source: 'TD',
})

/** Income and expense rows for each month, from two parallel arrays. */
function ledger(incomes, expenses) {
  const rows = []
  MONTHS.forEach((m, i) => {
    if (incomes[i]) rows.push(bank(`${m}-05`, incomes[i], 'Income', 'income'))
    if (expenses[i]) rows.push(bank(`${m}-15`, -expenses[i], 'Expense', 'expense'))
  })
  return rows
}

const STEADY = ledger(
  [6919, 6919, 6919, 6919, 6919, 6919],
  [3941, 3941, 3941, 3941, 3941, 3941],
)

test('one pixels-per-dollar scale governs both directions', () => {
  const model = buildInOutModel(STEADY, MONTHS)
  const bar = model.bars[0]

  // $6,919 of income against $3,941 of expenses must be 1.7556x taller in pixels. Compared with a
  // tolerance because the two heights are separate products of the same scale, so the ratio can
  // land a single ULP off the exact quotient.
  assert.ok(Math.abs(bar.upHeight / bar.downHeight - 6919 / 3941) < 1e-12)

  // Every bar in every month resolves through the same constant.
  for (const b of model.bars) {
    assert.ok(Math.abs(b.upHeight - b.income * model.pxPerDollar) < 1e-9)
    assert.ok(Math.abs(b.downHeight - b.expenses * model.pxPerDollar) < 1e-9)
  }
})

test('the baseline is derived from the data, not fixed', () => {
  // Income-heavy: the baseline sits low, leaving room above.
  const incomeHeavy = buildInOutModel(ledger([9000, 9000, 9000, 9000, 9000, 9000], [1000, 1000, 1000, 1000, 1000, 1000]), MONTHS)
  // Expense-heavy: the same period inverted pushes the baseline high.
  const expenseHeavy = buildInOutModel(ledger([1000, 1000, 1000, 1000, 1000, 1000], [9000, 9000, 9000, 9000, 9000, 9000]), MONTHS)

  assert.ok(incomeHeavy.baselineY > expenseHeavy.baselineY)
  // Neither may be pinned to an edge — a clamped ratio keeps both directions legible.
  for (const model of [incomeHeavy, expenseHeavy]) {
    assert.ok(model.baselineY > 0 && model.baselineY < PLOT_H)
    assert.ok(model.baselineY / PLOT_H >= 0.3 && model.baselineY / PLOT_H <= 0.82)
  }
})

test('bars and the net line always stay inside the plot', () => {
  const cases = [
    STEADY,
    ledger([9000, 100, 5000, 0, 12000, 700], [200, 8000, 400, 6000, 300, 9500]),
    ledger([5000, 5000, 5000, 5000, 5000, 5000], [0, 0, 0, 0, 0, 0]),   // income only
    ledger([0, 0, 0, 0, 0, 0], [5000, 5000, 5000, 5000, 5000, 5000]),   // expenses only
  ]
  for (const rows of cases) {
    const model = buildInOutModel(rows, MONTHS)
    for (const b of model.bars) {
      assert.ok(model.baselineY - b.upHeight >= -1e-9, 'income bar overflows the top')
      assert.ok(model.baselineY + b.downHeight <= PLOT_H + 1e-9, 'expense bar overflows the bottom')
    }
    for (const p of model.netPoints) {
      assert.ok(p.y >= -1e-9 && p.y <= PLOT_H + 1e-9, `net point escaped the plot at y=${p.y}`)
    }
  }
})

test('the thinnest month ignores months with no activity', () => {
  // May is empty; every other month nets positive. A zero net would win on value alone.
  const rows = ledger([6000, 6000, 6000, 0, 6000, 6000], [4000, 4000, 4000, 0, 5500, 4000])
  const model = buildInOutModel(rows, MONTHS)

  assert.equal(model.worst.month, '2026-06')
  assert.equal(model.worst.net, 500)
  assert.equal(model.bars[3].hasActivity, false)
})

test('the thinnest month breaks ties on the earliest month', () => {
  const rows = ledger([6000, 6000, 6000, 6000, 6000, 6000], [5000, 4000, 5000, 4000, 4000, 4000])
  const model = buildInOutModel(rows, MONTHS)
  assert.equal(model.worst.month, '2026-02')
})

test('net only and cumulative derive from the same monthly net', () => {
  const rows = ledger([6000, 6000, 6000, 6000, 6000, 6000], [4000, 5000, 3000, 4000, 4000, 4000])
  const perMonth = [2000, 1000, 3000, 2000, 2000, 2000]

  const netOnly = buildInOutModel(rows, MONTHS, { mode: 'net_only' })
  assert.deepEqual(netOnly.bars.map(b => b.value), perMonth)
  assert.equal(netOnly.netPoints.length, 0, 'the bars already are the net; no overlay')

  const cum = buildInOutModel(rows, MONTHS, { mode: 'cumulative' })
  assert.deepEqual(cum.bars.map(b => b.value), [2000, 3000, 6000, 8000, 10000, 12000])
  assert.equal(cum.bars.at(-1).value, netOnly.bars.reduce((s, b) => s + b.value, 0))
})

test('a negative running total draws below the baseline in cumulative view', () => {
  const rows = ledger([1000, 1000, 1000, 1000, 1000, 1000], [3000, 3000, 3000, 3000, 3000, 3000])
  const model = buildInOutModel(rows, MONTHS, { mode: 'cumulative' })

  assert.deepEqual(model.bars.map(b => b.value), [-2000, -4000, -6000, -8000, -10000, -12000])
  for (const b of model.bars) {
    assert.equal(b.upHeight, 0)
    assert.ok(b.downHeight > 0)
  }
})

test('card credits reach income only when the setting is on', () => {
  const credits = [{ id: 'c', date: '2026-02-20', amount: 150, creditKind: 'cashback' }]

  const off = buildInOutModel(STEADY, MONTHS, { cardCredits: credits })
  const on = buildInOutModel(STEADY, MONTHS, { cardCredits: credits, countCredits: true })

  assert.equal(off.bars[0].income, 6919)
  assert.equal(on.bars[0].income, 7069)
  assert.equal(on.bars[1].income, 6919, 'only the credit’s own month moves')
  assert.equal(off.totals.expenses, on.totals.expenses)
})

test('an empty scope reports empty rather than dividing by zero', () => {
  const model = buildInOutModel([], MONTHS)
  assert.equal(model.empty, true)
  assert.equal(model.worst, null)
  assert.equal(model.pxPerDollar, 0)
  assert.equal(model.bars.length, MONTHS.length, 'every month still draws')
  assert.ok(Number.isFinite(model.baselineY))
})

test('months with no rows still produce bars, so a 6M view draws 6 columns', () => {
  const model = buildInOutModel(ledger([6000, 0, 0, 0, 0, 0], [4000, 0, 0, 0, 0, 0]), MONTHS)
  assert.equal(model.bars.length, 6)
  assert.deepEqual(model.bars.map(b => b.hasActivity), [true, false, false, false, false, false])
})

test('the model is deterministic regardless of row order', () => {
  const rows = ledger([6000, 5000, 7000, 4000, 6000, 6000], [4000, 5000, 3000, 4000, 4000, 4000])
  const forward = buildInOutModel(rows, MONTHS)
  const reversed = buildInOutModel([...rows].reverse(), MONTHS)
  assert.deepEqual(forward, reversed)
})

test('savings and investment transfers never count as expenses', () => {
  const rows = [
    bank('2026-02-05', 6000, 'Income', 'income'),
    bank('2026-02-10', -4000, 'Expense', 'expense'),
    bank('2026-02-15', -700, 'Savings', 'expense'),
    bank('2026-02-20', -600, 'Investments', 'expense'),
  ]
  const model = buildInOutModel(rows, MONTHS)
  assert.equal(model.bars[0].expenses, 4000)
  assert.equal(model.bars[0].net, 2000, 'allocation is not subtracted from net')
})
