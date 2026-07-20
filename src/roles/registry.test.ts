import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAllRoles, getRole } from './registry.js'

test('the sales-conversations goal is available as an onboarding role', () => {
  const role = getRole('gtm-operator')

  assert.equal(role.displayName, 'Start more sales conversations')
  assert.equal(role.requiredMcps.length, 0)
  assert.ok(role.skills.includes('gtm-operator'))
  assert.ok(getAllRoles().some((item) => item.id === 'gtm-operator'))
})

test('roles use outcome-led customer names while runtime ids stay stable', () => {
  const namesById = Object.fromEntries(getAllRoles().map((role) => [role.id, role.displayName]))

  assert.deepEqual(namesById, {
    'marketing-manager': 'Grow predictable demand',
    'creative-director': 'Create campaign-ready work',
    'ads-analyst': 'Get more from ad spend',
    'social-media-manager': 'Build an audience on social',
    'gtm-operator': 'Start more sales conversations',
    'personal-assistant-dev': 'Stay on top of the work',
  })
})
