import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_VISION_MODEL, FALLBACK_MODELS,
  normalizeAnthropicModels, normalizeOpenAiModels, withSelected,
} from '../src/utils/modelCatalog.js'

// Trimmed from a real GET https://api.anthropic.com/v1/models response.
const ANTHROPIC_PAYLOAD = {
  data: [
    { type: 'model', id: 'claude-opus-5', display_name: 'Claude Opus 5' },
    { type: 'model', id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
    { type: 'model', id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
    { type: 'model', id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
  ],
}

// The shape OpenAI returns: the whole account catalogue, unlabelled by capability.
const OPENAI_PAYLOAD = {
  data: [
    { id: 'gpt-4o', object: 'model' },
    { id: 'gpt-4o-mini', object: 'model' },
    { id: 'gpt-4o-realtime-preview', object: 'model' },
    { id: 'gpt-4o-audio-preview', object: 'model' },
    { id: 'gpt-4o-transcribe', object: 'model' },
    { id: 'gpt-3.5-turbo-instruct', object: 'model' },
    { id: 'gpt-image-1', object: 'model' },
    { id: 'text-embedding-3-small', object: 'model' },
    { id: 'omni-moderation-latest', object: 'model' },
    { id: 'dall-e-3', object: 'model' },
    { id: 'whisper-1', object: 'model' },
    { id: 'tts-1', object: 'model' },
    { id: 'babbage-002', object: 'model' },
    { id: 'o3-mini', object: 'model' },
  ],
}

test('an Anthropic model keeps its display name and the API order', () => {
  const models = normalizeAnthropicModels(ANTHROPIC_PAYLOAD)
  assert.deepEqual(models.map(m => m.id), [
    'claude-opus-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
  ])
  assert.equal(models[2].label, 'Claude Sonnet 4.6')
})

test('an Anthropic model with no display name falls back to its id', () => {
  const models = normalizeAnthropicModels({ data: [{ id: 'claude-opus-4-8' }] })
  assert.deepEqual(models, [{ id: 'claude-opus-4-8', label: 'claude-opus-4-8' }])
})

test('everything that cannot read a statement is filtered out of the OpenAI list', () => {
  const ids = normalizeOpenAiModels(OPENAI_PAYLOAD).map(m => m.id)
  assert.deepEqual(ids, ['gpt-4o', 'gpt-4o-mini', 'o3-mini'])
})

test('the OpenAI list drops each excluded family for its own reason', () => {
  const ids = normalizeOpenAiModels(OPENAI_PAYLOAD).map(m => m.id)
  // Speech, images, embeddings and moderation are not chat models at all.
  for (const id of ['whisper-1', 'tts-1', 'dall-e-3', 'text-embedding-3-small', 'omni-moderation-latest', 'babbage-002']) {
    assert.ok(!ids.includes(id), `${id} should not be offered`)
  }
  // These are gpt-* but cannot take an image, or cannot hold a chat turn.
  for (const id of ['gpt-4o-realtime-preview', 'gpt-4o-audio-preview', 'gpt-4o-transcribe', 'gpt-3.5-turbo-instruct', 'gpt-image-1']) {
    assert.ok(!ids.includes(id), `${id} should not be offered`)
  }
})

test('a malformed payload yields the fallback list rather than throwing', () => {
  for (const bad of [null, undefined, {}, { data: 'nope' }, { error: { type: 'authentication_error' } }]) {
    assert.deepEqual(normalizeAnthropicModels(bad), FALLBACK_MODELS.claude)
    assert.deepEqual(normalizeOpenAiModels(bad), FALLBACK_MODELS.openai)
  }
})

test('a payload of only unusable entries yields the fallback rather than an empty dropdown', () => {
  assert.deepEqual(normalizeAnthropicModels({ data: [{ id: '' }, { id: null }] }), FALLBACK_MODELS.claude)
  // Every id here is filtered out, which would otherwise leave nothing to select.
  assert.deepEqual(normalizeOpenAiModels({ data: [{ id: 'whisper-1' }, { id: 'dall-e-3' }] }), FALLBACK_MODELS.openai)
})

test('a stored model the provider no longer lists is still offered', () => {
  const models = [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }]
  const withOld = withSelected(models, 'claude-3-opus-20240229')
  // Prepended, not dropped: the select must show what is actually configured, or the first
  // interaction silently rewrites a working setting.
  assert.equal(withOld[0].id, 'claude-3-opus-20240229')
  assert.equal(withOld.length, 2)
})

test('a stored model already in the list is not duplicated', () => {
  const models = normalizeAnthropicModels(ANTHROPIC_PAYLOAD)
  assert.deepEqual(withSelected(models, 'claude-sonnet-4-6'), models)
})

test('no stored model leaves the list untouched', () => {
  const models = normalizeAnthropicModels(ANTHROPIC_PAYLOAD)
  for (const empty of [null, undefined, '', '   ']) {
    assert.deepEqual(withSelected(models, empty), models)
  }
})

test('each provider default is offered by its own fallback list', () => {
  // Otherwise a keyless install shows a "— default" marker against nothing.
  assert.ok(FALLBACK_MODELS.claude.some(m => m.id === DEFAULT_VISION_MODEL.claude))
  assert.ok(FALLBACK_MODELS.openai.some(m => m.id === DEFAULT_VISION_MODEL.openai))
})
