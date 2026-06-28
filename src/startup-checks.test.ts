import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCallbackUrl } from './startup-checks.js'

test('allows https callback URLs', () => {
  assert.doesNotThrow(() => validateCallbackUrl('https://app.example.com', false))
})

test('allows http on localhost for dev', () => {
  assert.doesNotThrow(() => validateCallbackUrl('http://localhost:3000', false))
  assert.doesNotThrow(() => validateCallbackUrl('http://127.0.0.1:3000', false))
})

test('rejects http on a public host unless explicitly allowed', () => {
  assert.throws(() => validateCallbackUrl('http://app.example.com', false), /https/i)
  assert.doesNotThrow(() => validateCallbackUrl('http://app.example.com', true))
})

test('undefined is allowed (falls back to localhost default)', () => {
  assert.doesNotThrow(() => validateCallbackUrl(undefined, false))
})
