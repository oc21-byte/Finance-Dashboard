/**
 * The one click-to-edit dollar field on the Budget tab.
 *
 * This existed four times in `Budget.jsx` — for income, a spending cap, a savings cap, a goal, and
 * the general target — as the same eight lines pasted with a different border colour. Each copy
 * had to independently remember that Enter commits, Escape abandons, and blur commits, and one of
 * them committing on Escape would be a silent data loss the user never asked for.
 *
 * Commit-on-blur is deliberate: a user who clicks away from a half-typed cap onto another cap
 * expects the first one saved, not discarded. Escape is the explicit abandon.
 */
export default function InlineAmountInput({
  value, onChange, onCommit, onCancel,
  width = 'w-24', tone = 'violet', ariaLabel,
}) {
  const ring = tone === 'teal'
    ? 'border-teal-300 focus:border-teal-500 focus:ring-teal-500'
    : 'border-violet-300 focus:border-violet-500 focus:ring-violet-500'

  return (
    <input
      type="number"
      min="0"
      autoFocus
      value={value}
      aria-label={ariaLabel}
      onChange={event => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={event => {
        if (event.key === 'Enter') event.target.blur()
        // Escape clears the parent's editing state, which unmounts this input before its blur
        // handler can run — abandoning rather than committing. Do not add a blur() call here.
        if (event.key === 'Escape') onCancel()
      }}
      className={`${width} rounded-md border px-2 py-1 text-right text-sm transition-colors focus:outline-none focus:ring-2 ${ring}`}
    />
  )
}
