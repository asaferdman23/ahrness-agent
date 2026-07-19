import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAllRoles, getRole } from './registry.js'

test('Pipeline Builder is available as an onboarding role', () => {
  const role = getRole('gtm-operator')

  assert.equal(role.displayName, 'Pipeline Builder')
  assert.equal(role.requiredMcps.length, 0)
  assert.ok(role.skills.includes('gtm-operator'))
  assert.ok(getAllRoles().some((item) => item.id === 'gtm-operator'))
})

test('roles use outcome-led customer names while runtime ids stay stable', () => {
  const namesById = Object.fromEntries(getAllRoles().map((role) => [role.id, role.displayName]))

  assert.deepEqual(namesById, {
    'marketing-manager': 'Growth Planner',
    'creative-director': 'Creative Producer',
    'ads-analyst': 'Ad Spend Optimizer',
    'social-media-manager': 'Audience Builder',
    'gtm-operator': 'Pipeline Builder',
    'personal-assistant-dev': 'Business Assistant',
  })
})
