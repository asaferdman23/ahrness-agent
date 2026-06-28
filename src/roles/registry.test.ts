import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAllRoles, getRole } from './registry.js'

test('GTM Operator is available as an onboarding role', () => {
  const role = getRole('gtm-operator')

  assert.equal(role.displayName, 'GTM Operator')
  assert.equal(role.requiredMcps.length, 0)
  assert.ok(role.skills.includes('gtm-operator'))
  assert.ok(getAllRoles().some((item) => item.id === 'gtm-operator'))
})
