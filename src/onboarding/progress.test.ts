import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deriveOnboardingProgress } from './progress.js'

const completeInput = {
  hasProfile: true,
  hasRole: true,
  automationsConfigured: true,
  requiredPlatformIds: ['meta-ads'],
  connections: { 'meta-ads': 'connected' },
  whatsappLinked: true,
}

test('onboarding progress reports live when core setup is complete', () => {
  const progress = deriveOnboardingProgress(completeInput)

  assert.equal(progress.allowedStep, 6)
  assert.equal(progress.readiness, 'live')
  assert.deepEqual(progress.missingRequiredPlatforms, [])
  assert.deepEqual(progress.checks, {
    profile: true,
    role: true,
    automations: true,
    requiredConnections: true,
    whatsapp: true,
  })
})

test('onboarding progress stops at the first incomplete core prerequisite', () => {
  const cases = [
    [{ ...completeInput, hasProfile: false }, 1, 'needs_profile'],
    [{ ...completeInput, hasRole: false }, 2, 'needs_role'],
    [{ ...completeInput, automationsConfigured: false }, 3, 'needs_automations'],
    [{ ...completeInput, whatsappLinked: false }, 5, 'needs_whatsapp'],
  ] as const

  for (const [input, allowedStep, readiness] of cases) {
    const progress = deriveOnboardingProgress(input)
    assert.equal(progress.allowedStep, allowedStep)
    assert.equal(progress.readiness, readiness)
  }
})

test('onboarding progress names every missing required platform and ignores optional ones', () => {
  const progress = deriveOnboardingProgress({
    ...completeInput,
    requiredPlatformIds: ['meta-ads', 'google'],
    connections: {
      'meta-ads': 'connected',
      google: 'pending',
      instagram: 'error',
    },
  })

  assert.equal(progress.allowedStep, 6)
  assert.equal(progress.readiness, 'live')
  assert.equal(progress.checks.requiredConnections, false)
  assert.deepEqual(progress.missingRequiredPlatforms, ['google'])
})

test('missing required integrations do not block WhatsApp activation', () => {
  const progress = deriveOnboardingProgress({
    ...completeInput,
    connections: { 'meta-ads': 'pending' },
    whatsappLinked: false,
  })

  assert.equal(progress.allowedStep, 5)
  assert.equal(progress.readiness, 'needs_whatsapp')
  assert.equal(progress.checks.requiredConnections, false)
  assert.deepEqual(progress.missingRequiredPlatforms, ['meta-ads'])
})

test('legacy rollout cohort retains the hard integration gate', () => {
  const progress = deriveOnboardingProgress({
    ...completeInput,
    connections: { 'meta-ads': 'pending' },
    requireConnectionsForLaunch: true,
  })

  assert.equal(progress.allowedStep, 4)
  assert.equal(progress.readiness, 'needs_connections')
})

test('an explicit empty automation selection counts as configured', () => {
  const progress = deriveOnboardingProgress({
    ...completeInput,
    automationsConfigured: true,
  })

  assert.equal(progress.allowedStep, 6)
})
