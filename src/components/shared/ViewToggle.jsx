/**
 * A segmented control for switching between two views of the same scoped data.
 *
 * First of its kind in this app, and deliberately generic. It switches what you are LOOKING at,
 * never what is in scope: the period chips, filter chips and the derivation chain they feed sit
 * above it and apply to every option equally. Anything that changes scope belongs in the scope
 * bar, not here — two controls that both narrow the data, in different places, is how a page
 * starts disagreeing with itself.
 */
export default function ViewToggle({ value, onChange, options, className = '' }) {
  return (
    <div
      role="tablist"
      className={`inline-flex gap-0.5 p-0.5 bg-white border border-gray-200 rounded-lg ${className}`}
    >
      {options.map(option => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`px-4 py-1.5 rounded-md text-[13px] transition-colors ${
              active
                ? 'bg-gray-900 text-white font-semibold'
                : 'text-gray-500 font-medium hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
