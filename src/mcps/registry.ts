import type { PlatformId } from '../store/types.js'
import type { McpDefinition } from './types.js'
import { metaAdsMcp } from './meta-ads.js'
import { higgsfieldMcp } from './higgsfield.js'
import { instagramGraphMcp } from './instagram-graph.js'
import { tiktokMcp } from './tiktok.js'
import { googleMcp } from './google.js'

const mcps: McpDefinition[] = [metaAdsMcp, higgsfieldMcp, instagramGraphMcp, tiktokMcp, googleMcp]

const mcpMap = new Map<PlatformId, McpDefinition>(mcps.map((m) => [m.id, m]))

export function getMcp(id: PlatformId): McpDefinition {
  const mcp = mcpMap.get(id)
  if (!mcp) throw new Error(`Unknown MCP platform: ${id}`)
  return mcp
}

export function getAllMcps(): McpDefinition[] {
  return mcps
}
