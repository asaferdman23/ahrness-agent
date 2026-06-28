import { McpClient } from '@strands-agents/sdk'
import { tool } from '@strands-agents/sdk'
import type { McpDefinition } from './types.js'
import type { ConnectionRecord } from '../store/types.js'
import { stageOrExecute, fileConfirmationStore } from '../confirmations.js'

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

/**
 * TikTok does not have an official MCP server.
 * Wrapped as typed tools over TikTok's Content Posting API + Research API.
 */
export const tiktokMcp: McpDefinition = {
  id: 'tiktok',
  displayName: 'TikTok',
  oauthFlow: 'redirect',
  scopes: ['user.info.basic', 'video.list', 'video.publish', 'video.upload'],
  authUrl: (state, redirectBase) => {
    const clientKey = requireEnv('TIKTOK_CLIENT_KEY')
    const redirect = encodeURIComponent(`${redirectBase}/oauth/tiktok/callback`)
    const scopes = encodeURIComponent('user.info.basic,video.list,video.publish,video.upload')
    return `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&redirect_uri=${redirect}&response_type=code&scope=${scopes}&state=${encodeURIComponent(state)}`
  },
  createClient: (_credentials: ConnectionRecord): McpClient | null => null,
  roles: ['marketing-manager', 'social-media-manager'],
}

export function createTikTokTools(credentials: ConnectionRecord, clientId?: string) {
  if (!credentials.accessToken) return []
  const token = credentials.accessToken

  async function apiGet(path: string, fields?: string): Promise<string> {
    const url = new URL(`${TIKTOK_API_BASE}${path}`)
    if (fields) url.searchParams.set('fields', fields)
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`TikTok API error: ${JSON.stringify(data)}`)
    return JSON.stringify(data)
  }

  return [
    tool({
      name: 'tiktok_get_profile',
      description: "Fetch the client's TikTok profile (username, followers, likes, bio).",
      inputSchema: { type: 'object', properties: {}, required: [] },
      callback: async (_input: unknown) =>
        apiGet('/user/info/', 'open_id,union_id,display_name,bio_description,avatar_url,follower_count,following_count,likes_count,video_count'),
    }),
    tool({
      name: 'tiktok_list_videos',
      description: "List the client's recent TikTok videos with view and engagement stats.",
      inputSchema: {
        type: 'object',
        properties: {
          maxCount: { type: 'number', description: 'Number of videos to return (1-20, default 10)' },
        },
        required: [],
      },
      callback: async (rawInput: unknown) => {
        const input = rawInput as { maxCount?: number }
        const max_count = Math.min(input.maxCount ?? 10, 20)
        const res = await fetch(`${TIKTOK_API_BASE}/video/list/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            max_count,
            fields: ['id', 'title', 'video_description', 'duration', 'cover_image_url', 'view_count', 'like_count', 'comment_count', 'share_count', 'create_time'],
          }),
          signal: AbortSignal.timeout(30_000),
        })
        return JSON.stringify(await res.json())
      },
    }),
    tool({
      name: 'tiktok_upload_video',
      description: 'Upload and publish a video to TikTok from a public HTTPS URL.',
      inputSchema: {
        type: 'object',
        properties: {
          videoUrl: { type: 'string', description: 'Public HTTPS URL of the video to upload' },
          title: { type: 'string', description: 'Video title/caption (max 2200 chars)' },
          privacyLevel: {
            type: 'string',
            description: "'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', or 'SELF_ONLY' (default: PUBLIC_TO_EVERYONE)",
          },
        },
        required: ['videoUrl', 'title'],
      },
      callback: async (rawInput: unknown) => {
        const input = rawInput as { videoUrl: string; title: string; privacyLevel?: string }
        const doUpload = async () => {
          // TikTok Content Posting API: pull from URL
          const res = await fetch(`${TIKTOK_API_BASE}/post/publish/video/init/`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              post_info: {
                title: input.title.slice(0, 2200),
                privacy_level: input.privacyLevel ?? 'PUBLIC_TO_EVERYONE',
                disable_duet: false,
                disable_comment: false,
                disable_stitch: false,
              },
              source_info: {
                source: 'PULL_FROM_URL',
                video_url: input.videoUrl,
              },
            }),
            signal: AbortSignal.timeout(60_000),
          })
          return JSON.stringify(await res.json())
        }
        if (!clientId) return doUpload()
        return stageOrExecute(
          {
            store: fileConfirmationStore(),
            clientId,
            toolName: 'tiktok_upload_video',
            input: rawInput,
            summarize: () => `upload a video to TikTok${input?.title ? `: "${input.title.slice(0, 80)}"` : ''}`,
          },
          doUpload,
        )
      },
    }),
  ]
}
