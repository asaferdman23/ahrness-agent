import type { PlatformId, RoleId } from '../store/types.js'

export interface RoleDefinition {
  id: RoleId
  displayName: string
  description: string
  emoji: string
  skills: string[]
  requiredMcps: PlatformId[]
  optionalMcps: PlatformId[]
  systemPromptAddition: string
}
