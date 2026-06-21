import { McpClient } from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { getHiggsfieldOAuthProvider, HIGGSFIELD_MCP_URL } from './higgsfield-auth.js'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

/**
 * Meta Ads MCP — spawns `meta-ads-mcp-server` locally via stdio using the given client token.
 * Each client has their own token (obtained via OAuth flow); we create one McpClient per request.
 */
export function createMetaAdsMcpClient(clientToken: string): McpClient {
  const enableWrites = process.env.META_ADS_ENABLE_WRITE_TOOLS === 'true'

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['meta-ads-mcp-server'],
    env: {
      ...process.env,
      META_ADS_ACCESS_TOKEN: clientToken,
      ...(enableWrites ? { META_ADS_ENABLE_WRITE_TOOLS: 'true' } : {}),
    },
  })

  return new McpClient({
    transport,
    applicationName: 'ahrness-agent',
    applicationVersion: '0.1.0',
  })
}

/**
 * Higgsfield MCP — image / video / 3D generation tools via HTTP.
 * Shared across all clients (your API key, not theirs).
 */
export function createHiggsFieldMcpClient(): McpClient {
  const staticToken = process.env.HIGGSFIELD_MCP_ACCESS_TOKEN
  const configuredTimeout = Number(process.env.HIGGSFIELD_JOB_TIMEOUT_MS)
  const pollTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 10 * 60_000
  return new McpClient({
    url: HIGGSFIELD_MCP_URL,
    ...(staticToken
      ? { headers: { Authorization: `Bearer ${staticToken}` } }
      : { authProvider: getHiggsfieldOAuthProvider() }),
    applicationName: 'ahrness-agent',
    applicationVersion: '0.1.0',
    tasksConfig: {
      ttl: 60_000,
      pollTimeout,
    },
  })
}
