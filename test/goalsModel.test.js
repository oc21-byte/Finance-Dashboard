import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RING, allocationSegments, emergencyFund, goalCardModel, goalChip, goalPct,
  progressTone, ringDash, timelineText,
} from '../src/utils/goalsModel.js'

const CIRCUMFERENCE = 2 * Math.PI * RING.r

// The shape `/api/goals` returns: currentAmount already resolved, links + linkedBreakdown alongside.
const goal = (over = {}) => ({
  id: 'g1', name: 'Japan Trip', targetAmount: 10000, currentAmount: 2400,
  targetDate: '2027-06-15', monthlySavings: 200, isLinked: false, links: [], linkedBreakdown: [],
  ...over,
})

test('the ring arc is the filled length then the gap, and they sum to the circumference', () => {
  for (const pct of [0, 25, 50, 100]) {
    const [filled, gap] = ringDash(pct).split(' ').map(Number)
    assert.ok(Math.abs(filled + gap - CIRCUMFERENCE) < 0.15, `${pct}% should span the circle`)
    assert.ok(Math.abs(filled - (pct / 100) * CIRCUMFERENCE) < 0.05)
  }
})

test('an over-funded goal fills the ring rather than overdrawing it', () => {
  // A linked goal's value can pass its target between renders; a dasharray longer than the
  // circumference wraps and draws a second arc over the first.
  const [filled, gap] = ringDash(180).split(' ').map(Number)
  assert.ok(Math.abs(filled - CIRCUMFERENCE) < 0.05)
  assert.equal(gap, 0)
})

test('progress bands break at 60 and 30', () => {
  assert.equal(progressTone(60), 'good')
  assert.equal(progressTone(59.9), 'mid')
  assert.equal(progressTone(30), 'mid')
  assert.equal(progressTone(29.9), 'low')
  assert.equal(progressTone(0), 'low')
})

test('a reached goal is its own band whatever its percentage', () => {
  assert.equal(progressTone(100, true), 'reached')
  assert.equal(progressTone(12, true), 'reached')
})

test('percentage is capped at 100 and a zero target does not divide by zero', () => {
  assert.equal(goalPct(goal({ currentAmount: 25000 })), 100)
  assert.equal(goalPct(goal({ targetAmount: 0, currentAmount: 500 })), 0)
  assert.equal(goalPct(goal()), 24)
})

test('the chip names whichever way the goal is funded', () => {
  assert.deepEqual(goalChip(goal({ monthlySavings: 200 })), { kind: 'rate', label: '$200.00/mo' })
  assert.deepEqual(
    goalChip(goal({ isLinked: true, links: [{ percent: 40 }, { percent: 100 }], monthlySavings: 200 })),
    { kind: 'linked', label: '🔗 2 linked accounts' },
  )
  assert.equal(goalChip(goal({ isLinked: true, links: [{ percent: 40 }] })).label, '🔗 1 linked account')
  assert.equal(goalChip(goal({ monthlySavings: 0 })).kind, 'none')
})

test('a card model reports reached only against a real target', () => {
  assert.equal(goalCardModel(goal({ currentAmount: 10000 })).reached, true)
  // 0 >= 0 is true, but a goal with no target has not been reached — it has not been set.
  assert.equal(goalCardModel(goal({ targetAmount: 0, currentAmount: 0 })).reached, false)
})

test('the timeline quotes the stated rate, and stays silent without one', () => {
  const text = timelineText(goal({ monthlySavings: 200 }), '2026-01-01')
  assert.equal(text, 'At $200.00/mo — ~38 months to go (est. Mar 2029)')
  assert.equal(timelineText(goal({ monthlySavings: 0 })), null)
  assert.equal(timelineText(goal({ currentAmount: 10000 })), null)
  assert.match(timelineText(goal({ currentAmount: 9900, monthlySavings: 200 }), '2026-01-01'), /~1 month to go/)
})

test('an allocation splits into this goal, other goals, and free capacity', () => {
  // allocatedPct is the total across ALL goals including this one: 65 − 40 = 25 for others.
  const source = { name: 'TFSA holdings', currentValue: 35500, allocatedPct: 65 }
  const alloc = allocationSegments(source, 40)
  assert.deepEqual(alloc.segments.map(s => [s.kind, s.pct]), [['this', 40], ['other', 25], ['free', 35]])
  assert.equal(alloc.freePct, 35)
  assert.equal(alloc.freeValue, 12425)
  assert.equal(alloc.mineValue, 14200)
})

test('segments always sum to 100 and zero-width ones are dropped', () => {
  const sole = allocationSegments({ currentValue: 4000, allocatedPct: 100 }, 100)
  assert.deepEqual(sole.segments.map(s => s.kind), ['this'])
  assert.equal(sole.freePct, 0)

  const untouched = allocationSegments({ currentValue: 4000, allocatedPct: 0 }, 0)
  assert.deepEqual(untouched.segments.map(s => s.kind), ['free'])

  for (const [allocated, mine] of [[65, 40], [100, 100], [0, 0], [12.5, 12.5], [99.99, 0.01]]) {
    const { segments } = allocationSegments({ currentValue: 100, allocatedPct: allocated }, mine)
    const total = segments.reduce((sum, s) => sum + s.pct, 0)
    assert.ok(Math.abs(total - 100) < 0.001, `${allocated}/${mine} summed to ${total}`)
  }
})

test('a source over-allocated by stale data reads as full, never as negative free space', () => {
  const alloc = allocationSegments({ currentValue: 1000, allocatedPct: 130 }, 40)
  assert.equal(alloc.otherPct, 90)
  assert.equal(alloc.freePct, 0)
  assert.ok(alloc.segments.every(s => s.pct >= 0))
})

const fin = { expenses: 2000, monthsCovered: 6, windowLabel: 'Feb–Jul 2026' }

test('the emergency fund target is average spend times the chosen coverage', () => {
  const ef = emergencyFund({ goals: [], fin, cashBalance: 3240, months: 6 })
  assert.equal(ef.target, 12000)
  assert.equal(ef.current, 3240)
  assert.equal(ef.gap, 8760)
  // The label has to say where the figure came from, not just what window it covers.
  assert.equal(
    ef.basisLabel,
    '6 × $2,000.00/mo average spending — from your bank transactions, complete months only (Feb–Jul 2026)',
  )
})

test('goal balance and cash both count toward the emergency fund', () => {
  const goals = [goal({ name: 'Emergency Fund', targetAmount: 12000, currentAmount: 4200 })]
  const ef = emergencyFund({ goals, fin, cashBalance: 3240, months: 6 })
  assert.equal(ef.current, 7440)
  assert.equal(ef.pct, 62)
  assert.equal(ef.efGoal.name, 'Emergency Fund')
})

test('cash a goal already links is not counted twice', () => {
  // The bug this replaces: an EF goal linked to 100% of cash derives currentAmount FROM the cash
  // balance, so adding the balance again reported $6,480 of a $3,240 position.
  const linked = goal({
    name: 'Emergency Fund', targetAmount: 12000, currentAmount: 3240, isLinked: true,
    links: [{ sourceType: 'cash', sourceId: 'cash', percent: 100 }],
    linkedBreakdown: [{ sourceType: 'cash', sourceId: 'cash', percent: 100, value: 3240 }],
  })
  const ef = emergencyFund({ goals: [linked], fin, cashBalance: 3240, months: 6 })
  assert.equal(ef.current, 3240)
  assert.equal(ef.cashCounted, 0)
})

test('a partial cash link still counts every dollar of cash exactly once', () => {
  const half = goal({
    name: 'Emergency Fund', targetAmount: 12000, currentAmount: 1620, isLinked: true,
    links: [{ sourceType: 'cash', sourceId: 'cash', percent: 50 }],
    linkedBreakdown: [{ sourceType: 'cash', sourceId: 'cash', percent: 50, value: 1620 }],
  })
  const ef = emergencyFund({ goals: [half], fin, cashBalance: 3240, months: 6 })
  assert.equal(ef.cashCounted, 1620)
  assert.equal(ef.current, 3240)
})

test('a savings link is not mistaken for cash', () => {
  const savingsLinked = goal({
    name: 'Emergency Fund', targetAmount: 12000, currentAmount: 4000, isLinked: true,
    linkedBreakdown: [{ sourceType: 'savings', sourceId: 's1', percent: 100, value: 4000 }],
  })
  const ef = emergencyFund({ goals: [savingsLinked], fin, cashBalance: 3240, months: 6 })
  assert.equal(ef.current, 7240)
})

test('with no transactions there is no basis to state and no sync to offer', () => {
  const empty = { expenses: 0, monthsCovered: 0, windowLabel: 'no data' }
  const ef = emergencyFund({ goals: [goal({ name: 'Emergency Fund' })], fin: empty, cashBalance: 0, months: 6 })
  assert.equal(ef.hasBasis, false)
  assert.equal(ef.basisLabel, null)
  assert.equal(ef.target, 0)
  assert.equal(ef.pct, 0)
  // Nothing to sync a target to, so the button must not appear offering to zero it.
  assert.equal(ef.targetMismatch, false)
})

test('coverage months change the target, and the mismatch prompt follows', () => {
  const goals = [goal({ name: 'Emergency Fund', targetAmount: 12000, currentAmount: 4200 })]
  assert.equal(emergencyFund({ goals, fin, cashBalance: 0, months: 3 }).target, 6000)
  assert.equal(emergencyFund({ goals, fin, cashBalance: 0, months: 12 }).target, 24000)
  assert.equal(emergencyFund({ goals, fin, cashBalance: 0, months: 6 }).targetMismatch, false)
  assert.equal(emergencyFund({ goals, fin, cashBalance: 0, months: 9 }).targetMismatch, true)
})

test('the emergency fund is found by name, case-insensitively', () => {
  const goals = [goal({ name: 'my emergency fund', targetAmount: 12000, currentAmount: 100 })]
  assert.ok(emergencyFund({ goals, fin, cashBalance: 0, months: 6 }).efGoal)
  assert.equal(emergencyFund({ goals: [goal()], fin, cashBalance: 0, months: 6 }).efGoal, null)
})
