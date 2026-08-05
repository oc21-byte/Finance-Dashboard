// Validation for the small amount of prose the model is allowed to write.
//
// Both insight triads (spend and finance) follow the same discipline: every number, ranking,
// status and title is computed in JS, and the model contributes only short plain-text summaries.
// These validators are what make that a guarantee rather than a hope — they run on the model's
// output before it is ever persisted, so a response carrying markup, a code fence, or an essay
// is rejected rather than stored and rendered.
//
// Shared so the finance triad cannot quietly adopt a laxer rule than the spend triad.

const MAX_SUMMARY_CHARS = 600
const MAX_SUMMARY_SENTENCES = 2

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

/** Models fence JSON often enough that stripping it is cheaper than re-prompting. */
export function stripJsonFence(text) {
  return String(text ?? '').trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
}

/**
 * A short summary destined for a card: one line, no markup, at most two sentences.
 *
 * The line and sentence limits are layout contracts, not stylistic preferences — these strings
 * render into fixed-height cards where a third sentence overflows.
 */
export function validateSummary(value, field) {
  const summary = typeof value === 'string' ? value.trim() : ''
  if (!summary) throw new Error(`AI response must include a non-empty ${field} string`)
  if (summary.length > MAX_SUMMARY_CHARS) throw new Error(`${field} exceeds ${MAX_SUMMARY_CHARS} characters`)
  if (/[\r\n`]/.test(summary) || /<\/?[a-z][^>]*>/i.test(summary)) {
    throw new Error(`${field} must be plain text on one line`)
  }
  const sentenceCount = [...sentenceSegmenter.segment(summary)]
    .filter(segment => segment.segment.trim())
    .length
  if (sentenceCount > MAX_SUMMARY_SENTENCES) {
    throw new Error(`${field} must contain no more than ${MAX_SUMMARY_SENTENCES} sentences`)
  }
  return summary
}

/**
 * Chat prose. Looser than `validateSummary` — newlines and length are the caller's call, since a
 * chat reply is free to be a short paragraph — but markup is still refused.
 */
export function validatePlainText(value, label, maxChars) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`AI ${label} response was empty`)
  if (text.length > maxChars) throw new Error(`AI ${label} response exceeds ${maxChars} characters`)
  if (/`/.test(text) || /<\/?[a-z][^>]*>/i.test(text)) throw new Error(`AI ${label} response must be plain text`)
  return text
}
