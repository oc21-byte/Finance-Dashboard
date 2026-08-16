import test from 'node:test'
import assert from 'node:assert/strict'

import {
  goalTimeline, goalAgeDays, monthsUntil, monthYearLabel, dateAfterMonths,
  blendGrowthRate, projectWithGrowth, goalFundingLine, NEW_GOAL_DAYS,
} from '../server/goalAnalysis.js'

// Every test pins `asOf`. The module reads no clock, which is the whole reason it could be lifted
// out of `server/index.js` and tested at all.
//
// Built as a LOCAL calendar date, and `daysBefore` counts back in local days, because that is the
// unit the module works in — stored dates are bare `YYYY-MM-DD` days with no zone. An `asOf` fixed
// at a UTC instant would sit on a different calendar day east of Greenwich and shift every age by
// one, which is a bug in the test rather than in the code under it.
const ASOF = new Date(2026, 7, 16)

const daysBefore = n => {
  const d = new Date(ASOF.getFullYear(), ASOF.getMonth(), ASOF.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function goal(overrides = {}) {
  return {
    name: 'Italy Trip',
    targetAmount: 10000,
    currentAmount: 0,
    monthlySavings: 0,
    targetDate: '2027-08-16',
    ...overrides,
  }
}

const timeline = (g, opts = {}) => goalTimeline(g, { asOf: ASOF, ...opts })

// --- the reported bug ---------------------------------------------------------------------------

test('a goal created today is too early to judge, not behind', () => {
  const tl = timeline(goal({ createdAt: daysBefore(0) }))

  assert.equal(tl.status, 'too_early')
  assert.match(tl.verdict, /TOO EARLY TO JUDGE/)
  assert.match(tl.verdict, /created today/)
  // The word that started this: it must not appear for a goal one minute old.
  assert.doesNotMatch(tl.verdict, /BEHIND/)
})

test('a new goal whose stated plan misses the date says so without calling it behind', () => {
  // $500/mo against $10,000 needs 20 months; the target is 12 months out. Arithmetically short,
  // but the goal form pre-fills that one-year date, so this is a planning gap and not a slippage.
  const tl = timeline(goal({ createdAt: daysBefore(3), monthlySavings: 500, targetDate: '2027-08-16' }))

  assert.equal(tl.status, 'too_early')
  assert.match(tl.verdict, /created 3 days ago/)
  assert.match(tl.verdict, /rate or the date may simply need setting/)
  assert.equal(tl.requiredMonthly, 834)
  assert.doesNotMatch(tl.verdict, /BEHIND/)
})

test('age unknown is never treated as old', () => {
  // Goals written before `createdAt` existed carry none. Inventing one would repeat the bug.
  const tl = timeline(goal())

  assert.equal(tl.ageDays, null)
  assert.notEqual(tl.status, 'too_early')
  assert.equal(tl.status, 'no_rate')
})

test('a goal past the new-goal window is judged on its rate again', () => {
  const tl = timeline(goal({ createdAt: daysBefore(NEW_GOAL_DAYS + 1), monthlySavings: 500 }))

  assert.equal(tl.status, 'behind')
  assert.match(tl.verdict, /BEHIND/)
  assert.match(tl.verdict, /\$834\/month/)
})

// --- the statuses that previously had no home ---------------------------------------------------

test('a linked goal with no stated rate is funded by links, not rateless', () => {
  // db.json's real "Italy Trip": monthlySavings 0 with a holdings link. The old verdict reported
  // "no savings rate is set" while the Dashboard showed a derived pace from the same data.
  const tl = timeline(
    goal({ createdAt: daysBefore(200), currentAmount: 2500 }),
    { linkCount: 1, linkedValue: 2500 },
  )

  assert.equal(tl.status, 'funded_by_links')
  assert.match(tl.verdict, /1 linked account\b/)
  assert.doesNotMatch(tl.verdict, /BEHIND/)
})

test('no rate and no links is unprojectable, and says only that', () => {
  const tl = timeline(goal({ createdAt: daysBefore(200) }))

  assert.equal(tl.status, 'no_rate')
  assert.match(tl.verdict, /cannot be projected/)
  assert.equal(tl.monthsAtCurrent, null)
})

test('a funded goal reads as reached rather than as ahead of schedule', () => {
  const tl = timeline(goal({ createdAt: daysBefore(0), currentAmount: 10000 }))

  assert.equal(tl.status, 'reached')
  assert.equal(tl.remaining, 0)
})

test('a goal with no target date is projected but never graded', () => {
  const tl = timeline(goal({ createdAt: daysBefore(200), monthlySavings: 500, targetDate: null }))

  assert.equal(tl.status, 'no_target_date')
  assert.equal(tl.monthsToTarget, null)
  assert.equal(tl.monthsAtCurrent, 20)
})

// --- the rounding fix ---------------------------------------------------------------------------

test('an exactly on-pace goal cannot round its way into behind', () => {
  // 12 months of runway at a rate that clears the remainder in exactly 12. `monthsAtCurrent` is
  // ceil-ed and `monthsToTarget` is rounded, so comparing the two rounded figures could report
  // this as a month late. The comparison is made on the unrounded values instead.
  const tl = timeline(goal({
    createdAt: daysBefore(200),
    targetAmount: 12000,
    currentAmount: 0,
    monthlySavings: 1000,
    targetDate: '2027-08-16',
  }))

  assert.equal(tl.status, 'on_track')
  assert.match(tl.verdict, /ON TRACK/)
})

test('a comfortably early goal is on track and says how early', () => {
  const tl = timeline(goal({
    createdAt: daysBefore(200), targetAmount: 12000, monthlySavings: 3000,
  }))

  assert.equal(tl.status, 'on_track')
  assert.equal(tl.monthsAtCurrent, 4)
  assert.match(tl.verdict, /BEFORE the Aug 2027 target/)
})

// --- purity -------------------------------------------------------------------------------------

test('the same goal and asOf always produce the same timeline', () => {
  const g = goal({ createdAt: daysBefore(5), monthlySavings: 250 })

  assert.deepEqual(timeline(g), timeline(g))
})

test('a goal is judged against the supplied date, not today', () => {
  const g = goal({ createdAt: '2026-08-16', monthlySavings: 500 })

  // Same goal, read a year later: no longer new, and the target date has passed.
  const later = goalTimeline(g, { asOf: new Date(2027, 8, 16) })
  assert.equal(later.status, 'behind')
  assert.equal(goalTimeline(g, { asOf: ASOF }).status, 'too_early')
})

// --- the supporting date and growth helpers -----------------------------------------------------

test('months until a date come back rounded and exact, and a missing date yields neither', () => {
  const { months, exact } = monthsUntil('2027-08-16', ASOF)
  assert.equal(months, 12)
  assert.ok(Math.abs(exact - 12) < 0.05)

  assert.deepEqual(monthsUntil(null, ASOF), { months: null, exact: null })
  assert.deepEqual(monthsUntil('not-a-date', ASOF), { months: null, exact: null })
})

test('a past target date reads as negative months rather than zero', () => {
  const { months } = monthsUntil('2026-02-16', ASOF)
  assert.ok(months < 0)
})

test('dates are labelled and shifted without the model doing arithmetic', () => {
  assert.equal(monthYearLabel('2028-08-01'), 'Aug 2028')
  assert.equal(monthYearLabel('nonsense'), 'unknown')
  assert.equal(dateAfterMonths(0, ASOF), 'Aug 2026')
  assert.equal(dateAfterMonths(29, ASOF), 'Jan 2029')
})

test('goal age is whole days, floors at zero, and is null without a creation date', () => {
  assert.equal(goalAgeDays(daysBefore(0), ASOF), 0)
  assert.equal(goalAgeDays(daysBefore(45), ASOF), 45)
  assert.equal(goalAgeDays(null, ASOF), null)
  // A creation date in the future is nonsense, but it must not read as a negative age.
  assert.equal(goalAgeDays('2027-01-01', ASOF), 0)
})

test('growth blends by value behind each link, and ignores links worth nothing', () => {
  const blend = blendGrowthRate([
    { sourceType: 'savings', value: 10000, apy: 4 },
    { sourceType: 'holdingsAccountType', value: 10000 },
    { sourceType: 'savings', value: 0, apy: 99 },
  ], 0.06)

  assert.ok(Math.abs(blend.blendedAnnualRate - 0.05) < 1e-9)
  assert.equal(blend.hasYield, true)
  assert.equal(blend.hasInvestments, true)
})

test('an unlinked goal earns nothing rather than the assumed return', () => {
  assert.deepEqual(blendGrowthRate([], 0.06), {
    blendedAnnualRate: 0, hasInvestments: false, hasYield: false, assumedReturn: 0.06,
  })
})

test('a balance already at target needs no months to compound', () => {
  const proj = projectWithGrowth({ balance: 100, monthly: 0, target: 100, annualRate: 0.06, asOf: ASOF })
  assert.equal(proj.months, 0)
})

test('a target unreachable without contributions or growth returns null', () => {
  assert.equal(
    projectWithGrowth({ balance: 100, monthly: 0, target: 10000, annualRate: 0, asOf: ASOF }),
    null,
  )
})

test('the growth projection is offered only when it beats the plain estimate', () => {
  const growth = blendGrowthRate([{ sourceType: 'savings', value: 5000, apy: 4 }], 0.06)
  const tl = timeline(
    goal({ createdAt: daysBefore(200), currentAmount: 5000, monthlySavings: 200 }),
    { growth },
  )

  assert.ok(tl.growthMonths < tl.monthsAtCurrent)
  assert.match(tl.growthVerdict, /Optimistic — assumes returns hold/)
  assert.match(tl.growthVerdict, /savings APY/)
})

test('the funding line names each account, its share, and which values are live', () => {
  const line = goalFundingLine([
    { sourceType: 'savings', name: 'Capital One HYSA', percent: 50, value: 30000 },
    { sourceType: 'holdingsAccountType', name: 'TFSA holdings', percent: 50, value: 25300 },
  ])

  assert.match(line, /Capital One HYSA \(50% = \$30000\.00\)/)
  assert.match(line, /TFSA holdings \(50% = \$25300\.00, live market value\)/)
  assert.equal(goalFundingLine([]), null)
})
