/**
 * Which models the statement-extraction dropdown may offer.
 *
 * The list is fetched from the provider's own `/v1/models` rather than hardcoded, because a
 * hardcoded list is how a dropdown ends up offering a model the API rejects. The wireframe this
 * page was built from proposed `claude-haiku-4-6`, which does not exist — picking it would have
 * 404'd every vision pass with no hint as to why.
 *
 * Pure on purpose: `server/index.js` does the fetching (keys never leave the server) and hands the
 * raw payload here, so the filtering and labelling can be tested without a network call.
 */

/** Per-provider default. `visionModel` is Claude's; `openaiVisionModel` is ChatGPT's. */
export const DEFAULT_VISION_MODEL = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
}

/**
 * Shown when there is no key to list with, or the provider could not be reached. Deliberately
 * short: it exists so the dropdown is never empty, not to mirror the provider's catalogue.
 */
export const FALLBACK_MODELS = {
  claude: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'gpt-4o' },
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
  ],
}

/** A model id must be a non-empty string; anything else in the payload is skipped, not thrown on. */
const usableId = value => typeof value === 'string' && value.trim() !== ''

function dataArray(payload) {
  return Array.isArray(payload?.data) ? payload.data : null
}

/**
 * Anthropic returns `{ id, display_name }` and every entry is chat- and vision-capable, so there is
 * nothing to filter — only the display name to prefer over the raw id. Order is preserved: the API
 * returns newest first, which is the order a user scanning the list expects.
 */
export function normalizeAnthropicModels(payload) {
  const rows = dataArray(payload)
  if (!rows) return FALLBACK_MODELS.claude
  const models = rows
    .filter(m => usableId(m?.id))
    .map(m => ({ id: m.id, label: usableId(m.display_name) ? m.display_name : m.id }))
  return models.length ? models : FALLBACK_MODELS.claude
}

/**
 * OpenAI's `/v1/models` is the whole account catalogue — embeddings, speech, images, moderation and
 * legacy completion models sit alongside the chat ones, and none of it is labelled by capability.
 * So the filter is a name heuristic in two parts: keep the chat families, then drop the variants
 * within them that cannot take an image or cannot hold a chat turn at all.
 */
const OPENAI_CHAT_FAMILY = /^(gpt-|o[1-9])/
const OPENAI_NOT_VISION_CHAT = /audio|realtime|transcribe|tts|image|search|instruct|moderation|embedding|dall-e|whisper|babbage|davinci|codex/

export function normalizeOpenAiModels(payload) {
  const rows = dataArray(payload)
  if (!rows) return FALLBACK_MODELS.openai
  const models = rows
    .filter(m => usableId(m?.id))
    .filter(m => OPENAI_CHAT_FAMILY.test(m.id) && !OPENAI_NOT_VISION_CHAT.test(m.id))
    // No display name is supplied, so the id is the label.
    .map(m => ({ id: m.id, label: m.id }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return models.length ? models : FALLBACK_MODELS.openai
}

/**
 * Guarantee the configured model is one of the options.
 *
 * A `<select>` whose `value` matches no `<option>` renders blank, and the first interaction then
 * silently rewrites a working setting to whatever happened to be first. A stored id can fall out of
 * the list legitimately — the model was deprecated, or the key was swapped for one with different
 * access — so it is prepended rather than dropped, and the user sees what is actually configured.
 */
export function withSelected(models = [], selectedId) {
  if (!usableId(selectedId)) return models
  if (models.some(m => m.id === selectedId)) return models
  return [{ id: selectedId, label: selectedId }, ...models]
}
