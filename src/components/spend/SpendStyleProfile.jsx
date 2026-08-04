function confidenceLabel(level) {
  if (level === 'high') return 'High confidence'
  if (level === 'medium') return 'Medium confidence'
  return 'Early read'
}

export default function SpendStyleProfile({ profile, scope }) {
  const traits = profile?.traits ?? []
  const evidence = profile?.evidence ?? []

  return (
    <section className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-violet-600">
            Your Spend Style
          </p>
          <h3 className="mt-1 text-[17px] font-bold leading-tight text-gray-950">
            {profile?.name ?? 'Not enough data'}
          </h3>
        </div>
        <span className="shrink-0 rounded-full border border-violet-200 bg-white/80 px-2 py-1 text-[10px] font-semibold text-violet-700">
          {confidenceLabel(profile?.confidence?.level)}
        </span>
      </div>

      {profile?.tagline && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-gray-600">{profile.tagline}</p>
      )}

      {traits.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Spend Style traits">
          {traits.map(trait => (
            <span
              key={trait.dimension ?? trait.key}
              title={trait.evidence}
              className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 shadow-sm shadow-violet-100/40"
            >
              {trait.label}
            </span>
          ))}
        </div>
      )}

      {profile?.summary && (
        <p className="mt-3 border-t border-violet-100 pt-3 text-[12.5px] leading-relaxed text-gray-700">
          {profile.summary}
        </p>
      )}

      <div className="mt-3 text-[10.5px] leading-relaxed text-gray-400">
        {scope?.label && <p>Based on {scope.label}.</p>}
        {profile?.confidence?.reason && <p>{profile.confidence.reason}</p>}
      </div>

      {evidence.length > 0 && (
        <details className="group mt-3 border-t border-violet-100 pt-2.5">
          <summary className="cursor-pointer list-none text-[11px] font-semibold text-violet-700 outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded">
            <span className="group-open:hidden">Why this style</span>
            <span className="hidden group-open:inline">Hide supporting details</span>
          </summary>
          <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-gray-600">
            {evidence.map((item, index) => (
              <li key={index} className="flex gap-2">
                <span className="mt-[0.4rem] h-1 w-1 shrink-0 rounded-full bg-violet-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
