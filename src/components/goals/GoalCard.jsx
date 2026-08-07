import { RING, goalCardModel } from '../../utils/goalsModel.js'
import { CHIPS, RING_TRACK, TONES } from './palette.js'

const CENTER = RING.size / 2

/**
 * One goal in the grid: a progress ring, the figures, and a single chip saying how it is funded.
 *
 * Deliberately small. Everything else about a goal — funds, links, AI, editing — lives in the one
 * detail panel below the grid, because the previous design put all of it on every card and three
 * goals made a wall of text you could not scan.
 *
 * Hand-built SVG, like every other chart in the app. No chart library, anywhere.
 */
export default function GoalCard({ goal, selected, onSelect }) {
  const model = goalCardModel(goal)
  const tone = TONES[model.tone]

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col gap-2.5 rounded-xl border bg-white p-4 text-left shadow-sm transition-all ${
        selected
          ? 'border-blue-500 ring-[3px] ring-blue-500/15'
          : 'border-gray-200 hover:border-gray-300 hover:shadow'
      }`}
    >
      <div className="flex items-center gap-3">
        <svg
          width={RING.size} height={RING.size} viewBox={`0 0 ${RING.size} ${RING.size}`}
          className="flex-none" aria-hidden="true"
        >
          <circle cx={CENTER} cy={CENTER} r={RING.r} fill="none" stroke={RING_TRACK} strokeWidth={RING.stroke} />
          <circle
            cx={CENTER} cy={CENTER} r={RING.r} fill="none"
            stroke={tone.ring} strokeWidth={RING.stroke}
            strokeDasharray={model.dash}
            // A round cap on a zero-length arc still paints a dot, which reads as progress.
            strokeLinecap={model.pct > 0 ? 'round' : 'butt'}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
        </svg>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-gray-800">{model.name}</p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            {model.pctLabel} · {model.currentLabel}/{model.targetLabel}
          </p>
        </div>
      </div>
      <span className={`w-fit rounded-md px-2 py-1 text-[10.5px] font-medium ${CHIPS[model.chip.kind]}`}>
        {model.chip.label}
      </span>
    </button>
  )
}

/**
 * The last tile in the grid. Doubles as the empty state — a page with no goals shows this alone,
 * which says what to do next better than a centred "No goals yet" ever did.
 */
export function NewGoalTile({ onClick, disabled, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex min-h-[104px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 p-4 text-gray-400 transition-colors hover:border-gray-400 hover:text-gray-500 disabled:cursor-default disabled:opacity-50 disabled:hover:border-gray-300"
    >
      <span className="text-xl leading-none text-gray-300">+</span>
      <span className="text-xs font-medium">New Goal</span>
    </button>
  )
}
