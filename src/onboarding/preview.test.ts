import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ClientProfile, OnboardingSession } from '../store/types.js'
import {
  currentPreview,
  fallbackPreview,
  parsePreviewJson,
  profileFingerprint,
  registerPreviewAttempt,
} from './preview.js'

function profile(description = 'We help growing shops turn customer conversations into repeat revenue.'): ClientProfile {
  return {
    clientId: 'client-1',
    whatsappJid: '',
    createdAt: '2026-07-18T00:00:00.000Z',
    business: { name: 'Northstar', industry: 'retail', description, goals: ['generate_leads'] },
    assets: { website: 'https://northstar.example' },
  }
}

function sessionFor(clientProfile: ClientProfile): OnboardingSession {
  return {
    sessionId: 'session-1',
    step: 1,
    profile: clientProfile,
    connections: {},
    whatsappLinked: false,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  }
}

test('preview parser accepts only the constrained three-opportunity shape', () => {
  const valid = parsePreviewJson(JSON.stringify({
    headline: 'A useful opening',
    insight: 'Focus the promise before expanding channels.',
    opportunities: ['Clarify the promise', 'Test one campaign', 'Review weekly'],
    suggestedFirstBrief: 'Create a 30-day campaign plan.',
  }), '2026-07-18T01:00:00.000Z')

  assert.equal(valid?.source, 'ai')
  assert.equal(valid?.opportunities.length, 3)
  assert.equal(parsePreviewJson('{"headline":"Incomplete"}'), null)
  assert.equal(parsePreviewJson('not json'), null)
})

test('cached preview is reused only while the profile fingerprint matches', () => {
  const original = profile()
  const session = sessionFor(original)
  session.preview = fallbackPreview(original)
  session.previewProfileFingerprint = profileFingerprint(original)

  assert.equal(currentPreview(session)?.headline, session.preview.headline)
  session.profile = profile('A materially different business description that invalidates the cache.')
  assert.equal(currentPreview(session), null)
})

test('preview rate limit permits three attempts per hour and rejects the fourth', () => {
  const session = sessionFor(profile())
  const now = new Date('2026-07-18T12:00:00.000Z')
  registerPreviewAttempt(session, now)
  registerPreviewAttempt(session, new Date(now.getTime() + 1_000))
  registerPreviewAttempt(session, new Date(now.getTime() + 2_000))
  assert.throws(() => registerPreviewAttempt(session, new Date(now.getTime() + 3_000)), /Preview limit reached/)

  registerPreviewAttempt(session, new Date(now.getTime() + 60 * 60 * 1000 + 3_001))
  assert.equal(session.previewAttempts?.length, 1)
})

test('fallback preview is useful and never implies website ingestion', () => {
  const preview = fallbackPreview(profile())
  assert.equal(preview.source, 'fallback')
  assert.equal(preview.opportunities.length, 3)
  assert.doesNotMatch(JSON.stringify(preview), /visited|crawled|analysed the website/i)
})
