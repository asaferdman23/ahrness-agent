import { McpClient } from '@strands-agents/sdk'
import { tool } from '@strands-agents/sdk'
import type { McpDefinition } from './types.js'
import type { ConnectionRecord } from '../store/types.js'

const GA4_BASE = 'https://analyticsdata.googleapis.com/v1beta'
const GSC_BASE = 'https://searchconsole.googleapis.com/v1'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

async function refreshGoogleToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = (await res.json()) as { access_token?: string; error?: string }
  if (!res.ok || !data.access_token) throw new Error(`Google token refresh failed: ${data.error ?? 'unknown'}`)
  return data.access_token
}

export const googleMcp: McpDefinition = {
  id: 'google',
  displayName: 'Google Analytics & Search Console',
  oauthFlow: 'redirect',
  scopes: [
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/webmasters.readonly',
  ],
  authUrl: (_sessionId, redirectBase) => {
    const clientId = requireEnv('GOOGLE_CLIENT_ID')
    const redirect = encodeURIComponent(`${redirectBase}/oauth/google/callback`)
    const scopes = encodeURIComponent(
      'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly',
    )
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirect}&response_type=code&scope=${scopes}&access_type=offline&prompt=consent`
  },
  createClient: (_credentials: ConnectionRecord): McpClient | null => null,
  roles: ['marketing-manager', 'ads-analyst'],
}

export function createGoogleTools(credentials: ConnectionRecord) {
  if (!credentials.accessToken) return []

  async function getToken(): Promise<string> {
    const expiry = credentials.tokenExpiresAt ? new Date(credentials.tokenExpiresAt) : null
    const isExpired = !expiry || expiry.getTime() - Date.now() < 60_000
    if (isExpired && credentials.refreshToken) {
      return refreshGoogleToken(credentials.refreshToken)
    }
    return credentials.accessToken!
  }

  async function gaPost(propertyId: string, body: unknown): Promise<string> {
    const token = await getToken()
    const res = await fetch(`${GA4_BASE}/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`Google Analytics error: ${JSON.stringify(data)}`)
    return JSON.stringify(data)
  }

  async function gscGet(url: string): Promise<string> {
    const token = await getToken()
    const res = await fetch(`${GSC_BASE}${url}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`Search Console error: ${JSON.stringify(data)}`)
    return JSON.stringify(data)
  }

  return [
    tool({
      name: 'google_analytics_report',
      description:
        "Run a Google Analytics 4 report for the client's property. Returns sessions, users, conversions, and revenue by date range.",
      inputSchema: {
        type: 'object',
        properties: {
          propertyId: { type: 'string', description: 'GA4 property ID (e.g. "123456789")' },
          startDate: { type: 'string', description: 'Start date in YYYY-MM-DD or relative (e.g. "30daysAgo")' },
          endDate: { type: 'string', description: 'End date in YYYY-MM-DD or "today"' },
          dimensions: {
            type: 'array',
            items: { type: 'string' },
            description: 'GA4 dimension names (e.g. ["date", "sessionDefaultChannelGroup"])',
          },
        },
        required: ['propertyId', 'startDate', 'endDate'],
      },
      callback: async (rawInput: unknown) => {
        const input = rawInput as { propertyId: string; startDate: string; endDate: string; dimensions?: string[] }
        return gaPost(input.propertyId, {
          dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
          dimensions: (input.dimensions ?? ['date']).map((n) => ({ name: n })),
          metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'conversions' },
            { name: 'purchaseRevenue' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' },
          ],
          limit: 100,
        })
      },
    }),
    tool({
      name: 'google_search_console_performance',
      description:
        "Query Search Console data for the client's site — top queries, pages, countries, and click/impression/CTR/position data.",
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'Site URL exactly as registered in Search Console (e.g. "https://example.com/")' },
          startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
          endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
          dimensions: {
            type: 'array',
            items: { type: 'string' },
            description: "Dimensions to group by: 'query', 'page', 'country', 'device' (default: ['query'])",
          },
          rowLimit: { type: 'number', description: 'Max rows (default 25, max 100)' },
        },
        required: ['siteUrl', 'startDate', 'endDate'],
      },
      callback: async (rawInput: unknown) => {
        const input = rawInput as {
          siteUrl: string
          startDate: string
          endDate: string
          dimensions?: string[]
          rowLimit?: number
        }
        const encodedSite = encodeURIComponent(input.siteUrl)
        const token = await getToken()
        const res = await fetch(`${GSC_BASE}/sites/${encodedSite}/searchAnalytics/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startDate: input.startDate,
            endDate: input.endDate,
            dimensions: input.dimensions ?? ['query'],
            rowLimit: Math.min(input.rowLimit ?? 25, 100),
          }),
          signal: AbortSignal.timeout(30_000),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(`Search Console error: ${JSON.stringify(data)}`)
        return JSON.stringify(data)
      },
    }),
  ]
}
