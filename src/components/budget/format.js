// Every figure on the Budget tab is a whole-dollar monthly amount, so the formatting is shared
// here rather than redefined per component the way the other tab directories do it — eight
// components rounding independently is eight chances for the KPI strip and a row to disagree by a
// dollar on the same number.

export const money = value => '$' + Math.round(Math.abs(Number(value) || 0)).toLocaleString()

/** Explicit sign, because "left to allocate" is meaningless without one. */
export const signedMoney = value => (Number(value) < 0 ? '−' : '+') + money(value)

/** Share of income, or null when there is no income to take a share of. */
export const pctOfIncome = (value, income) =>
  income > 0 && value > 0 ? Math.round(value / income * 100) : null
