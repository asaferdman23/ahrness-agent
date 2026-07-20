import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Skill } from '@strands-agents/sdk/vended-plugins/skills'
import type { RoleId, RoleRecord } from '../store/types.js'
import { runtimeSkillPath } from '../runtime-skill-path.js'
import { getAllRoles } from './registry.js'
import { resolveRoleHarness } from './harness.js'

function record(roleId: RoleId): RoleRecord {
  return {
    roleId,
    assignedAt: '2026-07-20T00:00:00.000Z',
    skillOverrides: { disabled: [], extra: [] },
    mcpOverrides: { disabled: [], extra: [] },
  }
}

test('every onboarding employee resolves to a distinct runtime harness', () => {
  const harnesses = getAllRoles().map((role) => resolveRoleHarness(record(role.id)))

  assert.equal(new Set(harnesses.map((item) => item.role.systemPromptAddition.trim())).size, harnesses.length)
  assert.equal(new Set(harnesses.map((item) => [...item.skillNames].sort().join(','))).size, harnesses.length)
  assert.equal(new Set(harnesses.map((item) => JSON.stringify({
    skills: [...item.skillNames].sort(),
    platforms: [...item.supportedPlatforms].sort(),
  }))).size, harnesses.length)
  assert.equal(new Set(harnesses.map((item) => JSON.stringify({
    prompt: item.role.systemPromptAddition,
    skills: [...item.skillNames].sort(),
    platforms: [...item.supportedPlatforms].sort(),
  }))).size, harnesses.length)
})

test('every configured runtime skill exists and parses as the registered skill', () => {
  for (const role of getAllRoles()) {
    for (const skillName of role.skills) {
      const skill = Skill.fromFile(runtimeSkillPath(skillName), { strict: true })
      assert.equal(skill.name, skillName, `${role.id} must load ${skillName}`)
      assert.ok(skill.instructions.length > 80, `${skillName} must contain a useful operating manual`)
    }
  }
})

test('tenant skill and platform overrides change the effective harness without duplicates', () => {
  const harness = resolveRoleHarness({
    ...record('gtm-operator'),
    skillOverrides: { disabled: ['business-context'], extra: ['software-developer', 'software-developer'] },
    mcpOverrides: { disabled: ['tiktok'], extra: ['meta-ads', 'meta-ads'] },
  })

  assert.equal(harness.skillNames.includes('business-context'), false)
  assert.equal(harness.skillNames.filter((name) => name === 'software-developer').length, 1)
  assert.equal(harness.supportedPlatforms.includes('tiktok'), false)
  assert.equal(harness.supportedPlatforms.filter((name) => name === 'meta-ads').length, 1)
})
