import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateTokens, contextWindowFor, shouldCompact } from './tokens.js'

test('estimateTokens approximates 4 chars per token', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('a'.repeat(40)), 10)
})

test('estimateTokens rounds up partial tokens', () => {
  assert.equal(estimateTokens('a'), 1)
  assert.equal(estimateTokens('abcde'), 2)
})

test('contextWindowFor returns known window or a conservative default', () => {
  assert.equal(contextWindowFor('claude-opus-4-8'), 200_000)
  assert.equal(contextWindowFor('totally-unknown-model'), 128_000)
})

test('shouldCompact triggers above the configured fraction of the window', () => {
  // default fraction 0.70 of a 200k window = 140k
  assert.equal(shouldCompact(139_000, 'claude-opus-4-8'), false)
  assert.equal(shouldCompact(141_000, 'claude-opus-4-8'), true)
})

test('shouldCompact respects an explicit fraction override', () => {
  assert.equal(shouldCompact(60_000, 'claude-opus-4-8', 0.25), true)
  assert.equal(shouldCompact(40_000, 'claude-opus-4-8', 0.25), false)
})
