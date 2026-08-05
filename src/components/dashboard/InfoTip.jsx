import { useId, useState } from 'react'

/**
 * The small ⓘ next to a metric, with its definition on hover or focus.
 *
 * Keyboard and screen readers get the same content as the mouse: it is a real `<button>` with
 * `aria-describedby`, not a `title` attribute or a hover-only div. Definitions like "liquid net
 * worth excludes property and debts" are the kind of thing a user needs exactly once, and losing
 * them to a pointer-only affordance means some users never see them at all.
 */
export default function InfoTip({ label, children, align = 'left' }) {
  const id = useId()
  const [open, setOpen] = useState(false)

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label ? `About ${label}` : 'More information'}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 text-[9px] font-semibold text-gray-400 hover:border-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-5 z-20 w-60 rounded-lg border border-gray-200 bg-white p-2.5 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-gray-600 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </span>
      )}
    </span>
  )
}
