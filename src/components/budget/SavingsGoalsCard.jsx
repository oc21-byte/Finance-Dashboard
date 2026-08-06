import InlineAmountInput from './InlineAmountInput.jsx'
import { money } from './format.js'

function Row({ label, badge, note, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {label}
          {badge && (
            <span className="rounded-full bg-teal-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-teal-700">
              {badge}
            </span>
          )}
        </div>
        {note && <p className="mt-0.5 text-[11px] text-gray-400">{note}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Amount({ value, suffix = '/mo', pending, auto, onEdit, readOnly, label }) {
  return (
    <button
      onClick={onEdit}
      disabled={readOnly}
      title={readOnly ? 'Unavailable in Demo Mode' : 'Click to edit'}
      aria-label={`Edit ${label}`}
      className={`text-[13px] font-semibold transition-colors disabled:cursor-default disabled:no-underline enabled:hover:underline ${
        pending ? 'text-violet-700' : 'text-teal-600'
      }`}
    >
      {money(value)}{suffix}
      {pending && (
        <span className="ml-1.5 rounded bg-violet-100 px-1 py-0.5 text-[9.5px] font-semibold text-violet-700">AI</span>
      )}
      {auto && <span className="ml-1 text-[10px] font-normal text-gray-400">auto</span>}
    </button>
  )
}

/**
 * Everything the plan sets aside, in one place: savings-category caps, per-goal funding, and the
 * general savings target.
 *
 * These three used to be interleaved into the spending-caps table AND restated in a second
 * "Savings Allocation" card below it, whose own footer told the user to go edit them in the table
 * above. One editable home each.
 *
 * A goal shows "auto" when its amount is inferred from bank activity rather than typed — money
 * already moving to a category of the same name. Editing replaces the inference; it does not add
 * to it, which is why the total never double-counts an automated transfer.
 */
export default function SavingsGoalsCard({
  plan, editingCap, editingCapValue, editingGoalId, editingGoalValue,
  editingTarget, targetValue,
  onStartEditCap, onEditCapValue, onCommitCap, onCancelCap,
  onStartEditGoal, onEditGoalValue, onCommitGoal, onCancelGoal,
  onStartEditTarget, onEditTargetValue, onCommitTarget, onCancelTarget,
  onOpenGoals, readOnly,
}) {
  const { savingsCategories, goalRows, savingsTarget, totalSavingsPlanned } = plan

  const targetNote = savingsTarget.isPending
    ? `AI suggested ${savingsTarget.pctOfIncome}% of income`
    : savingsTarget.isAuto
      ? `${savingsTarget.rate}% of income · default`
      : `${savingsTarget.pctOfIncome}% of income · manual`

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h2 className="text-[15px] font-semibold text-gray-900">Savings &amp; goals</h2>
        <p className="mt-1 text-[12.5px] text-gray-400">
          Monthly amounts set aside{!readOnly && ' · click to edit'}
        </p>
      </div>

      <div className="flex-1 divide-y divide-gray-100 px-5 py-1">
        {savingsCategories.map(row => (
          <Row
            key={row.name}
            label={<span className="text-[13px] font-medium text-gray-800">{row.name}</span>}
            badge={row.kind}
            note={row.avg > 0 ? `${money(row.avg)}/mo detected in bank activity` : undefined}
          >
            {editingCap === row.name ? (
              <InlineAmountInput
                ariaLabel={`Monthly amount for ${row.name}`}
                width="w-20"
                tone="teal"
                value={editingCapValue}
                onChange={onEditCapValue}
                onCommit={onCommitCap}
                onCancel={onCancelCap}
              />
            ) : row.cap != null ? (
              <Amount
                label={row.name}
                value={row.cap}
                pending={row.isPending}
                readOnly={readOnly}
                onEdit={() => onStartEditCap(row.name, row.cap)}
              />
            ) : (
              <button
                onClick={() => onStartEditCap(row.name, '')}
                disabled={readOnly}
                className="text-xs text-gray-400 underline transition-colors disabled:no-underline enabled:hover:text-teal-600"
              >
                {readOnly ? '—' : 'Set amount'}
              </button>
            )}
          </Row>
        ))}

        {goalRows.length === 0 ? (
          <Row label={<span className="text-[13px] text-gray-400">No active goals</span>}>
            <button
              onClick={onOpenGoals}
              className="text-xs font-medium text-violet-600 transition-colors hover:text-violet-800"
            >
              Add a goal →
            </button>
          </Row>
        ) : (
          goalRows.map(row => (
            <Row
              key={row.id}
              badge="Goal"
              label={
                <button
                  onClick={onOpenGoals}
                  className="text-left text-[13px] font-medium text-gray-800 transition-colors hover:text-violet-600"
                >
                  {row.name}
                </button>
              }
              note={row.isAuto ? `${money(row.bankAvg)}/mo detected in bank activity` : undefined}
            >
              {editingGoalId === row.id ? (
                <InlineAmountInput
                  ariaLabel={`Monthly amount for ${row.name}`}
                  width="w-20"
                  tone="teal"
                  value={editingGoalValue}
                  onChange={onEditGoalValue}
                  onCommit={onCommitGoal}
                  onCancel={onCancelGoal}
                />
              ) : (
                <Amount
                  label={row.name}
                  value={row.amount}
                  auto={row.isAuto}
                  readOnly={readOnly}
                  onEdit={() => onStartEditGoal(row.id, row.manual)}
                />
              )}
            </Row>
          ))
        )}

        <Row
          label={<span className="text-[13px] font-medium text-gray-800">General savings target</span>}
          note={targetNote}
        >
          {editingTarget ? (
            <InlineAmountInput
              ariaLabel="General savings target"
              width="w-20"
              tone="teal"
              value={targetValue}
              onChange={onEditTargetValue}
              onCommit={onCommitTarget}
              onCancel={onCancelTarget}
            />
          ) : (
            <Amount
              label="general savings target"
              value={savingsTarget.effective}
              pending={savingsTarget.isPending}
              auto={savingsTarget.isAuto}
              readOnly={readOnly}
              onEdit={onStartEditTarget}
            />
          )}
        </Row>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
        <p className="text-xs text-gray-400">
          {readOnly ? 'Read-only in Demo Mode' : 'Blank the target to revert to the default rate'}
        </p>
        <span className="text-xs text-gray-500">
          Total <span className="font-semibold text-teal-600">{money(totalSavingsPlanned)}/mo</span>
        </span>
      </div>
    </div>
  )
}
