import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import path from 'node:path'
import { Skill } from '@strands-agents/sdk/vended-plugins/skills'
import { runtimeSkillPath, runtimeSkillsDir } from './runtime-skill-path.js'

test('runtime skills resolve from the deployed src/skills tree', () => {
  assert.equal(runtimeSkillsDir('/opt/ahrness'), path.join('/opt/ahrness', 'src/skills'))
  assert.ok(existsSync(path.join(runtimeSkillPath('business-context'), 'SKILL.md')))
})

test('runtime skill names cannot escape the skills directory', () => {
  assert.throws(() => runtimeSkillPath('../secrets'), /Invalid runtime skill name/)
})

test('runtime skills parse on the host before agent sandbox initialization', () => {
  const skill = Skill.fromFile(runtimeSkillPath('business-context'))
  assert.equal(skill.name, 'business-context')
  assert.match(skill.instructions, /business profile/i)
})
