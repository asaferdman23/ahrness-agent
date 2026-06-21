import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractTurnMessages, toSeedMessages } from './agent-bridge.js'
import type { WorkingContext } from './types.js'

// ── extractTurnMessages ──────────────────────────────────────────────────────
// The Strands result exposes the full transcript on `result.messages`. Because we
// seed the agent with prior context, only the messages AFTER the seeded count are
// new this turn.

test('extracts only the messages produced after the seeded prefix', () => {
  const result = {
    messages: [
      { role: 'user', content: 'old' }, // seeded
      { role: 'assistant', content: 'old reply' }, // seeded
      { role: 'user', content: 'new prompt' }, // new
      { role: 'assistant', content: [{ type: 'textBlock', text: 'new reply' }] }, // new
    ],
  }
  const turn = extractTurnMessages(result, { prompt: 'new prompt', priorMessageCount: 2 })
  assert.deepEqual(turn, [
    { role: 'user', content: 'new prompt' },
    { role: 'assistant', content: [{ type: 'textBlock', text: 'new reply' }] },
  ])
})

test('preserves interleaved tool messages in the new turn', () => {
  const result = {
    messages: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'toolUse', name: 'bash' }] },
      { role: 'tool', content: [{ type: 'toolResult', text: 'done' }] },
      { role: 'assistant', content: [{ type: 'textBlock', text: 'finished' }] },
    ],
  }
  const turn = extractTurnMessages(result, { prompt: 'go', priorMessageCount: 0 })
  assert.deepEqual(turn.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant'])
})

test('falls back to user prompt + assistant text when no full transcript is exposed', () => {
  const result = { lastMessage: { content: [{ type: 'textBlock', text: 'hi' }] } }
  const turn = extractTurnMessages(result, { prompt: 'hello', priorMessageCount: 5 })
  assert.deepEqual(turn, [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: [{ type: 'textBlock', text: 'hi' }] },
  ])
})

// ── toSeedMessages ───────────────────────────────────────────────────────────

test('empty context seeds nothing', () => {
  const ctx: WorkingContext = { summary: null, messages: [], estimatedTokens: 0 }
  assert.deepEqual(toSeedMessages(ctx), [])
})

test('seeds a leading summary note followed by verbatim messages', () => {
  const ctx: WorkingContext = {
    summary: 'we discussed pricing',
    messages: [
      { seq: 3, role: 'user', content: 'and budget?', tokenEstimate: 3, createdAt: 't' },
      { seq: 4, role: 'assistant', content: [{ type: 'textBlock', text: 'sure' }], tokenEstimate: 5, createdAt: 't' },
    ],
    estimatedTokens: 10,
  }
  const seed = toSeedMessages(ctx)
  assert.equal(seed.length, 3)
  assert.equal(seed[0].role, 'user')
  assert.match(seed[0].content as string, /summary/i)
  assert.match(seed[0].content as string, /we discussed pricing/)
  assert.deepEqual(seed[1], { role: 'user', content: 'and budget?' })
  assert.deepEqual(seed[2], { role: 'assistant', content: [{ type: 'textBlock', text: 'sure' }] })
})

test('caps seeded verbatim messages to the most recent maxSeedMessages', () => {
  const messages = Array.from({ length: 50 }, (_, i) => ({
    seq: i + 1,
    role: 'user' as const,
    content: `m${i + 1}`,
    tokenEstimate: 1,
    createdAt: 't',
  }))
  const ctx: WorkingContext = { summary: null, messages, estimatedTokens: 50 }
  const seed = toSeedMessages(ctx, { maxSeedMessages: 10 })
  assert.equal(seed.length, 10)
  assert.deepEqual(seed[0], { role: 'user', content: 'm41' }) // last 10
  assert.deepEqual(seed[9], { role: 'user', content: 'm50' })
})
