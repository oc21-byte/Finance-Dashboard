import InlineAmountInput from './InlineAmountInput.jsx'
import { money, signedMoney } from './format.js'

function Tile({ label, children, sub, lead }) {
  return (
    <div className={`min-w-0 border-r border-gray-100 px-5 py-4 last:border-r-0 ${lead ? 'bg-white' : 'bg-gray-50/40'}`}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</div>
      {children}
      <div className="mt-1 truncate text-xs text-gray-400">{sub}</div>
    </div>
  )
}

/** Two figures side by side in one tile. Budgeted is the plan; avg actual is what really happens. */
function VersusValue({ leftLabel, leftValue, leftClass, rightLabel, rightValue, rightClass }) {
  return (
    <div className="mt-2 flex items-end gap-3">
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wide text-gray-400">{leftLabel}</div>
        <div className={`truncate text-[19px] font-semibold leading-tight tracking-tight ${leftClass}`}>{leftValue}</div>
      </div>
      <span className="pb-1 text-[11px] text-gray-300">vs</span>
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wide text-gray-400">{rightLabel}</div>
        <div className={`truncate text-[19px] font-semibold leading-tight tracking-tight ${rightClass}`}>{rightValue}</div>
      </div>
    </div>
  )
}

/**
 * The four headline figures, in one joined strip.
 *
 * These were four detached cards plus a fifth full-width card for income alone. Income belongs
 * here: everything to its right is a share of it, and separating them made the plan read as four
 * unrelated totals rather than one division of one number.
 *
 * Two tiles show budgeted against average actual, because a plan is only meaningful next to what
 * the ledger says actually happens — a comfortable-looking cap total means nothing if average
 * spend is well above it.
 */
export default function BudgetKpiRow({
  plan, editingIncome, incomeValue,
  onIncomeChange, onStartEditIncome, onCommitIncome, onCancelIncome,
  readOnly,
}) {
  const {
    income, totalSpendingCaps, totalAvgSpend, totalSavingsPlanned,
    totalGoalSavings, totalSavingsCaps, savingsTarget, budgetedLeft, avgLeft, spread,
  } = plan

  const savingsParts = [
    `goals ${money(totalGoalSavings)}`,
    `target ${money(savingsTarget.effective)}`,
    ...(totalSavingsCaps > 0 ? [`caps ${money(totalSavingsCaps)}`] : []),
  ]

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        lead
        label="Monthly income"
        sub={income.isConfirmed
          ? 'Confirmed take-home pay'
          : income.windowLabel
            ? `Bank average, ${income.windowLabel}`
            : 'No bank data yet'}
      >
        {editingIncome ? (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-gray-400">$</span>
            <InlineAmountInput
              ariaLabel="Monthly take-home income"
              width="w-28"
              value={incomeValue}
              onChange={onIncomeChange}
              onCommit={onCommitIncome}
              onCancel={onCancelIncome}
            />
          </div>
        ) : (
          <div className="mt-2 flex items-baseline gap-2">
            <span className="truncate text-[27px] font-semibold leading-tight tracking-tight text-gray-900">
              {money(income.display)}
            </span>
            {!readOnly && (
              <button
                onClick={onStartEditIncome}
                className="shrink-0 text-xs font-medium text-violet-600 transition-colors hover:text-violet-800"
              >
                Edit
              </button>
            )}
          </div>
        )}
      </Tile>

      <Tile
        label="Spending caps"
        sub={totalSpendingCaps === 0 ? 'No caps set yet' : 'Caps set vs average card spend'}
      >
        <VersusValue
          leftLabel="Budgeted"
          leftValue={money(totalSpendingCaps)}
          leftClass="text-gray-900"
          rightLabel="Avg actual"
          rightValue={money(totalAvgSpend)}
          rightClass={totalAvgSpend > totalSpendingCaps && totalSpendingCaps > 0 ? 'text-red-500' : 'text-gray-600'}
        />
      </Tile>

      <Tile label="Savings planned" sub={savingsParts.join(' · ')}>
        <div className="mt-2 truncate text-[27px] font-semibold leading-tight tracking-tight text-teal-600">
          {money(totalSavingsPlanned)}
        </div>
      </Tile>

      <Tile
        label="Left to allocate"
        sub={totalSpendingCaps > 0 && totalAvgSpend > 0
          ? `Spending ${money(spread)} / mo ${spread >= 0 ? 'under' : 'over'} plan on average`
          : 'Income − spending caps − savings planned'}
      >
        <VersusValue
          leftLabel="Budgeted"
          leftValue={signedMoney(budgetedLeft)}
          leftClass={budgetedLeft >= 0 ? 'text-green-600' : 'text-red-500'}
          rightLabel="Avg actual"
          rightValue={signedMoney(avgLeft)}
          rightClass={avgLeft >= 0 ? 'text-gray-600' : 'text-red-500'}
        />
      </Tile>
    </div>
  )
}
