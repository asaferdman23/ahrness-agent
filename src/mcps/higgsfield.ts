import { McpClient } from '@strands-agents/sdk'
import { getHiggsfieldOAuthProvider, HIGGSFIELD_MCP_URL } from '../higgsfield-auth.js'
import type { McpDefinition } from './types.js'
import type { ConnectionRecord } from '../store/types.js'

export const higgsfieldMcp: McpDefinition = {
  id: 'higgsfield',
  displayName: 'Higgsfield AI',
  oauthFlow: 'redirect',
  scopes: ['openid', 'email', 'offline_access'],
  // Higgsfield is a shared account with its own OAuth flow (higgsfield-auth.ts),
  // so it doesn't use the per-client state.
  authUrl: (_state, redirectBase) =>
    `${redirectBase}/oauth/higgsfield/start`,
  createClient: (_credentials: ConnectionRecord): McpClient => {
    const staticToken = process.env.HIGGSFIELD_MCP_ACCESS_TOKEN
    const configuredTimeout = Number(process.env.HIGGSFIELD_JOB_TIMEOUT_MS)
    const pollTimeout =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 10 * 60_000
    return new McpClient({
      url: HIGGSFIELD_MCP_URL,
      ...(staticToken
        ? { headers: { Authorization: `Bearer ${staticToken}` } }
        : { authProvider: getHiggsfieldOAuthProvider() }),
      applicationName: 'ahrness-agent',
      applicationVersion: '0.1.0',
      tasksConfig: { ttl: 60_000, pollTimeout },
    })
  },
  roles: ['marketing-manager', 'creative-director', 'social-media-manager', 'personal-assistant-dev'],
}
