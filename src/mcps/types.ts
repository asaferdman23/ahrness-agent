import type { McpClient } from '@strands-agents/sdk'
import type { ConnectionRecord, PlatformId, RoleId } from '../store/types.js'

export type OAuthFlow = 'redirect' | 'api-key' | 'none'

export interface McpDefinition {
  id: PlatformId
  displayName: string
  oauthFlow: OAuthFlow
  scopes: string[]
  /** Generate the OAuth authorization URL for this platform */
  authUrl?: (sessionId: string, redirectBase: string) => string
  /** Create an McpClient from stored credentials */
  createClient: (credentials: ConnectionRecord) => McpClient | null
  /** Which roles this MCP can be used with */
  roles: RoleId[]
}
