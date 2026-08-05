import { paceStyle } from '../shared/paceStyles.js'

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const moneyValue = value => (value == null ? '—' : money.format(value))

// Whole percents above 10, one decimal below it. A rate of 8% and a rate of 8.4% are a materially
// different distance from a target; at 15% vs 15.4% they are not.
function percent(rate) {
  const value = rate * 100
  return `${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`
}

function Metric({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-white/80 bg-white/75 px-2.5 py-2">
      <p className="text-[9.5px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-0.5 text-[12.5px] font-bold ${tone ?? 'text-gray-800'}`}>{moneyValue(value)}</p>
    </div>
  )
}

/**
 * The Finances rail's Financial Pace card. Same `buildFinancialPace` result the Spend Analyzer's
 * `FinancialPaceCard` renders, led with the savings rate rather than the four figures.
 *
 * The hero number is the ACHIEVED rate — what actually reached savings, over income. `pace.savingsRate`
 * is the *target* rate from settings, so leading with it would print the target twice and claim an
 * accomplishment that hasn't happened. Both are shown, but only one of them is the headline.
 */
export default function SavingsRateCard({ pace, scope }) {
  const styles = paceStyle(pace?.status)

  const income = Number(pace?.income) || 0
  const contributions = pace?.savingsContributions
  const target = pace?.savingsTarget

  // Rates only exist against a known monthly income. With no income source there is no denominator,
  // and a 0% savings rate would read as a finding rather than as missing information.
  const achievedRate = income > 0 && contributions != null ? contributions / income : null
  const targetRate = income > 0 && target != null ? target / income : null

  // The bar is scaled to the larger of the two rates, not to 100% of income — a 15% target on a
  // full-income scale is a sliver, and the gap being read here is the one between the fill and the
  // tick. Headroom for overshoot keeps the tick off the right edge when the target is met.
  const barMax = Math.max(achievedRate ?? 0, targetRate ?? 0) * 1.25
  const fillWidth = barMax > 0 && achievedRate != null
    ? `${Math.min(100, (achievedRate / barMax) * 100)}%`
    : '0%'
  const tickLeft = barMax > 0 && targetRate != null
    ? `${Math.min(100, (targetRate / barMax) * 100)}%`
    : null

  const shortfall = target != null && contributions != null ? target - contributions : null
  const metTarget = shortfall != null && shortfall <= 0
  const headroomTone = pace?.headroom == null
    ? undefined
    : pace.headroom < 0 ? 'text-rose-700' : 'text-emerald-700'

  return (
    <section className={`rounded-xl border p-4 ${styles.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-gray-500">
            Financial Pace
          </p>
          <p className="mt-0.5 text-[10.5px] text-gray-400">What you set aside each month</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10.5px] font-semibold ${styles.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
          {pace?.label ?? 'Not Enough Data'}
        </span>
      </div>

      {achievedRate == null ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-gray-500">
          A savings rate needs a monthly income to measure against. Add income to Settings, or import
          more bank history.
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold leading-none tracking-tight text-gray-900">
              {percent(achievedRate)}
            </span>
            <span className="text-[11px] leading-snug text-gray-500">
              of income
              <span className="block text-gray-400">set aside</span>
            </span>
          </div>

          <div className="mt-3">
            <div className="relative h-2 rounded-full bg-white/80">
              <div
                className={`h-2 rounded-full ${metTarget ? 'bg-emerald-500' : 'bg-teal-500'}`}
                style={{ width: fillWidth }}
              />
              {tickLeft && (
                <span
                  // -translate-x-1/2 keeps the tick centred on its value rather than starting there,
                  // so the fill edge meeting the tick genuinely means the target was met.
                  className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-gray-700"
                  style={{ left: tickLeft }}
                  title={`Target ${percent(targetRate)}`}
                />
              )}
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[10.5px] text-gray-400">
              <span>{moneyValue(contributions)}/mo to savings</span>
              {targetRate != null && <span>Target {percent(targetRate)} · {moneyValue(target)}</span>}
            </div>
          </div>

          {shortfall != null && (
            <p className={`mt-2.5 text-[11.5px] leading-relaxed ${metTarget ? 'text-emerald-700' : 'text-gray-600'}`}>
              {metTarget
                ? `Meeting the target, with ${moneyValue(Math.abs(shortfall))} a month over it.`
                : `${moneyValue(shortfall)} a month short of the target.`}
            </p>
          )}
        </>
      )}

      {pace?.summary && (
        <p className="mt-3 border-t border-white/80 pt-3 text-[12.5px] leading-relaxed text-gray-700">
          {pace.summary}
        </p>
      )}

      {(pace?.income != null || pace?.expenses != null) && (
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <Metric label="Monthly income" value={pace.income} />
          <Metric label="Monthly expenses" value={pace.expenses} />
          <Metric label="Headroom" value={pace.headroom} tone={headroomTone} />
          <Metric label="Savings target" value={pace.savingsTarget} />
        </div>
      )}

      {/* The page's own period is not complete-months-only — `resolvePeriod` takes whatever range is
          asked for. This card is the one place the phrase is true, because it reads
          `fullMonthsWithData`. */}
      <div className="mt-3 text-[10.5px] leading-relaxed text-gray-400">
        {scope?.label && <p>Based on complete bank months only: {scope.label}.</p>}
        {pace?.incomeSource === 'confirmed_monthly_income' && <p>Uses your confirmed monthly income.</p>}
        {pace?.incomeSource === 'observed_bank_income' && <p>Uses average income found in your bank activity.</p>}
        {pace?.confidence === 'early_read' && <p>An early read — fewer than three complete months.</p>}
      </div>
    </section>
  )
}
