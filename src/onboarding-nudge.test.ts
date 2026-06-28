import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdtempSync } from 'node:fs'
import { maybeOnboardingNudge } from './onboarding-nudge.js'

let root: string
const CLIENT = 'b'.repeat(64)
const JID = '15551234567@s.whatsapp.net'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahrness-nudge-'))
  process.env.AGENT_STORE_DIR = root
  process.env.CALLBACK_BASE_URL = 'https://app.example.com'
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(32)
})
afterEach(() => {
  rmSync(root, { force: true, recursive: true })
  delete process.env.AGENT_STORE_DIR
  delete process.env.CALLBACK_BASE_URL
  delete process.env.MEDIA_SIGNING_SECRET
})

test('returns an onboarding nudge the first time, then null (once only)', async () => {
  const first = await maybeOnboardingNudge(CLIENT, JID)
  assert.ok(first, 'first call should produce a nudge')
  assert.match(first!, /app\.example\.com\/onboarding/)

  const second = await maybeOnboardingNudge(CLIENT, JID)
  assert.equal(second, null, 'second call should not nudge again')
})
