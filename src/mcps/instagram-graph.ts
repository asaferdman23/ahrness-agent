import { McpClient } from '@strands-agents/sdk'
import { tool } from '@strands-agents/sdk'
import type { McpDefinition } from './types.js'
import type { ConnectionRecord } from '../store/types.js'

const GRAPH_BASE = 'https://graph.instagram.com/v21.0'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

/**
 * Instagram Graph API does not have an official MCP server yet.
 * We expose it as a set of typed tools wrapping the REST API directly.
 * The McpClient slot is null; tools are returned separately via createTools().
 */
export const instagramGraphMcp: McpDefinition = {
  id: 'instagram-graph',
  displayName: 'Instagram (organic)',
  oauthFlow: 'redirect',
  scopes: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'pages_read_engagement'],
  authUrl: (_sessionId, redirectBase) => {
    const appId = requireEnv('META_APP_ID')
    const redirect = encodeURIComponent(`${redirectBase}/oauth/instagram-graph/callback`)
    const scopes = 'instagram_basic,instagram_content_publish,instagram_manage_insights,pages_read_engagement'
    return `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirect}&scope=${scopes}`
  },
  createClient: (_credentials: ConnectionRecord): McpClient | null => null,
  roles: ['marketing-manager', 'creative-director', 'social-media-manager'],
}

export function createInstagramTools(credentials: ConnectionRecord) {
  if (!credentials.accessToken) return []
  const token = credentials.accessToken
  const userId = credentials.userId

  async function graphGet(path: string, params: Record<string, string> = {}): Promise<string> {
    const url = new URL(`${GRAPH_BASE}${path}`)
    url.searchParams.set('access_token', token)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    const data = await res.json()
    if (!res.ok) throw new Error(`Instagram API error: ${JSON.stringify(data)}`)
    return JSON.stringify(data)
  }

  return [
    tool({
      name: 'instagram_get_profile',
      description: "Fetch the client's Instagram business profile (followers, media count, biography).",
      inputSchema: { type: 'object', properties: {}, required: [] },
      callback: async (_input: unknown) => {
        const id = userId ?? 'me'
        return graphGet(`/${id}`, { fields: 'id,name,biography,followers_count,media_count,profile_picture_url,website' })
      },
    }),
    tool({
      name: 'instagram_get_recent_media',
      description: "Get the client's recent Instagram posts with engagement data.",
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of posts (1-20, default 10)' },
        },
        required: [],
      },
      callback: async (rawInput: unknown) => {
        const input = rawInput as { limit?: number }
        const id = userId ?? 'me'
        const limit = Math.min(input.limit ?? 10, 20)
        return graphGet(`/${id}/media`, {
          fields: 'id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink',
          limit: String(limit),
        })
      },
    }),
    tool({
      name: 'instagram_get_insights',
      description: 'Get account-level insights: reach, impressions, profile views, follower demographics.',
      inputSchema: {
        type: 'object',
        properties: {
          period: { type: 'string', description: "'day', 'week', or 'month' (default: week)" },
        },
        required: [],
      },
      callback: async (rawInput: unknown) => {
        const input = rawInput as { period?: string }
        const id = userId ?? 'me'
        const period = input.period ?? 'week'
        return graphGet(`/${id}/insights`, {
          metric: 'reach,impressions,profile_views,follower_count',
          period,
        })
      },
    }),
    tool({
      name: 'instagram_create_post',
      description: 'Publish a photo or video post to Instagram. Image/video must be a public HTTPS URL.',
      inputSchema: {
        type: 'object',
        properties: {
          imageUrl: { type: 'string', description: 'Public HTTPS URL of the image to post' },
          caption: { type: 'string', description: 'Post caption (can include hashtags and emojis)' },
        },
        required: ['imageUrl', 'caption'],
      },
      callback: async (rawInput: unknown) => {
        const input = rawInput as { imageUrl: string; caption: string }
        const id = userId ?? 'me'
        // Step 1: create container
        const containerUrl = new URL(`${GRAPH_BASE}/${id}/media`)
        containerUrl.searchParams.set('access_token', token)
        const containerRes = await fetch(containerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: input.imageUrl, caption: input.caption }),
          signal: AbortSignal.timeout(30_000),
        })
        const container = (await containerRes.json()) as { id?: string; error?: unknown }
        if (!containerRes.ok || !container.id) throw new Error(`Failed to create media container: ${JSON.stringify(container)}`)
        // Step 2: publish
        const publishUrl = new URL(`${GRAPH_BASE}/${id}/media_publish`)
        publishUrl.searchParams.set('access_token', token)
        const publishRes = await fetch(publishUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: container.id }),
          signal: AbortSignal.timeout(30_000),
        })
        return publishRes.json()
      },
    }),
  ]
}
