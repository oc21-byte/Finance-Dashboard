export default function ExploreChoices({ prompt, options = [], disabled, onChoose }) {
  if (!options.length) return null

  return (
    <section className="border-t border-gray-100 pt-4">
      <h3 className="text-[12.5px] font-semibold text-gray-900">{prompt?.title ?? 'Explore your spending'}</h3>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-400">
        {prompt?.body ?? 'Choose a deeper look, or ask your own question.'}
      </p>

      <div className="mt-2.5 space-y-1.5">
        {options.map(option => (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => onChoose(option)}
              aria-label={`${option.id}: ${option.title}. ${option.description}`}
              className="group flex w-full items-start gap-2.5 rounded-lg border border-gray-200 bg-white px-2.5 py-2.5 text-left transition-colors hover:border-violet-200 hover:bg-violet-50/40 disabled:opacity-60"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10.5px] font-bold text-violet-700 group-hover:bg-violet-200">
                {option.id}
              </span>
              <span className="min-w-0">
                <span className="block text-[11.5px] font-semibold text-gray-800">{option.title}</span>
                <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-400">{option.description}</span>
              </span>
            </button>
        ))}
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-gray-400">
        {prompt?.footer ?? 'Reply with 1, 2, or 3—or ask anything about your spending.'}
      </p>
    </section>
  )
}
