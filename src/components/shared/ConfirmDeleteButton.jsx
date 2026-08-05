/**
 * Two-step delete for a table row.
 *
 * A delete here is immediate and has no undo, so a stray click on a several-hundred-row list would
 * otherwise silently drop a transaction.
 *
 * Which row is confirming is owned by the table, not by this button: the row itself tints red while
 * confirming, and paging away has to cancel it.
 */
export default function ConfirmDeleteButton({
  confirming, onRequest, onCancel, onConfirm, disabled, title,
}) {
  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <button
          onClick={onConfirm}
          disabled={disabled}
          className="px-2 py-0.5 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors"
        >
          Delete
        </button>
        <button
          onClick={onCancel}
          className="px-1.5 py-0.5 rounded-md text-gray-500 hover:text-gray-900 transition-colors"
        >
          No
        </button>
      </span>
    )
  }
  return (
    <button
      onClick={onRequest}
      disabled={disabled}
      className="px-2 text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-300 transition-colors text-lg leading-none"
      title={title ?? 'Delete this transaction'}
    >
      ×
    </button>
  )
}
