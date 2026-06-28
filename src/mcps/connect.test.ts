import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { buildConnectResponse } from './connect.js'

const JID = '15551234567@s.whatsapp.net'

beforeEach(() => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(32)
})
afterEach(() => {
  delete process.env.MEDIA_SIGNING_SECRET
})

test('returns a signed deep link carrying the platform for an allowed platform', () => {
  const out = buildConnectResponse(JID, ['meta-ads', 'google'], 'meta-ads', 'https://app.example.com')
  assert.match(out, /https:\/\/app\.example\.com\/onboarding\?c=/)
  assert.match(out, /platform=meta-ads/)
})

test('throws when the platform is not in the role allowed set', () => {
  assert.throws(() => buildConnectResponse(JID, ['google'], 'tiktok', 'https://app.example.com'), /not available|allowed/i)
})

test('falls back to an admin message when no callback base is configured', () => {
  const out = buildConnectResponse(JID, ['meta-ads'], 'meta-ads', undefined)
  assert.doesNotMatch(out, /https?:\/\//)
  assert.match(out, /admin|setup link/i)
})
