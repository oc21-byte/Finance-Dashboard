import { money } from '../../utils/goalsModel.js'

/**
 * Confirmation before a goal is deleted.
 *
 * Deleting used to fire straight from the button with nothing between the click and the write.
 * There is no undo — the row is spliced out of `db.goals` and written — and the two things worth
 * knowing before that happens are how much progress goes with it and, for a linked goal, that the
 * accounts themselves are untouched. Both are stated here rather than left to be assumed.
 */
export default function DeleteGoalModal({ goal, onCancel, onConfirm, pending, error }) {
  if (!goal) return null
  const linkCount = goal.links?.length ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">Delete this goal?</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          This will permanently delete <span className="font-medium">{goal.name}</span>, including
          the ${money(goal.currentAmount)} of progress recorded against it. This cannot be undone.
        </p>
        {linkCount > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            Its {linkCount} linked account{linkCount === 1 ? '' : 's'} {linkCount === 1 ? 'is' : 'are'} not
            affected — deleting the goal only releases the share of {linkCount === 1 ? 'it' : 'them'} this
            goal had claimed, freeing that capacity for other goals.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
