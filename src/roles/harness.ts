import type { PlatformId, RoleRecord } from '../store/types.js'
import { getRole } from './registry.js'
import type { RoleDefinition } from './types.js'

export type RoleHarness = {
  role: RoleDefinition
  skillNames: string[]
  supportedPlatforms: PlatformId[]
}

/**
 * Resolve the effective employee harness from the saved onboarding choice.
 *
 * This is the single source of truth used by agent construction: the role's
 * system prompt comes from `role`, while skills and connectable platforms are
 * resolved with the tenant's explicit overrides. Keeping this pure makes it
 * possible to prove that onboarding choices produce genuinely different
 * runtime harnesses without starting Docker or calling a model.
 */
export function resolveRoleHarness(roleRecord: RoleRecord | null): RoleHarness {
  const role = getRole(roleRecord?.roleId ?? 'personal-assistant-dev')
  const disabledSkills = new Set(roleRecord?.skillOverrides.disabled ?? [])
  const disabledPlatforms = new Set(roleRecord?.mcpOverrides.disabled ?? [])

  return {
    role,
    skillNames: unique([
      ...role.skills,
      ...(roleRecord?.skillOverrides.extra ?? []),
    ]).filter((skill) => !disabledSkills.has(skill)),
    supportedPlatforms: unique<PlatformId>([
      ...role.requiredMcps,
      ...role.optionalMcps,
      ...(roleRecord?.mcpOverrides.extra ?? []),
    ]).filter((platform) => !disabledPlatforms.has(platform)),
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
