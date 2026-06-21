import { McpClient } from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpDefinition } from './types.js'
import type { ConnectionRecord } from '../store/types.js'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

export const metaAdsMcp: McpDefinition = {
  id: 'meta-ads',
  displayName: 'Meta Ads',
  oauthFlow: 'redirect',
  scopes: ['ads_management', 'ads_read'],
  authUrl: (_sessionId, redirectBase) => {
    const appId = requireEnv('META_APP_ID')
    const redirect = encodeURIComponent(`${redirectBase}/oauth/meta-ads/callback`)
    return `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirect}&scope=ads_management,ads_read`
  },
  createClient: (credentials: ConnectionRecord): McpClient | null => {
    if (!credentials.accessToken) return null
    const enableWrites = process.env.META_ADS_ENABLE_WRITE_TOOLS === 'true'
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['meta-ads-mcp-server'],
      env: {
        ...process.env,
        META_ADS_ACCESS_TOKEN: credentials.accessToken,
        ...(enableWrites ? { META_ADS_ENABLE_WRITE_TOOLS: 'true' } : {}),
      },
    })
    return new McpClient({
      transport,
      applicationName: 'ahrness-agent',
      applicationVersion: '0.1.0',
    })
  },
  roles: ['marketing-manager', 'ads-analyst'],
}
