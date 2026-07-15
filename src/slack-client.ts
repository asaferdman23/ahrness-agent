/**
 * Minimal Slack Web API client over `fetch` — no SDK dependency, same
 * rationale as telegram-client.ts (npm registry wasn't reachable to add one
 * in this environment). https://api.slack.com/web
 *
 * File upload uses Slack's newer 3-step external-upload flow — the old
 * one-shot `files.upload` is deprecated/removed.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const API_ROOT = 'https://slack.com/api'

export class SlackApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly error: string,
  ) {
    super(`Slack API ${method} failed: ${error}`)
  }
}

interface SlackApiResponse {
  ok: boolean
  error?: string
}

async function callJson<T extends SlackApiResponse>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API_ROOT}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${botToken}` },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as T
  if (!data.ok) throw new SlackApiError(method, data.error ?? `HTTP ${res.status}`)
  return data
}

async function callForm<T extends SlackApiResponse>(
  botToken: string,
  method: string,
  params: Record<string, string | number>,
): Promise<T> {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) form.set(key, String(value))

  const res = await fetch(`${API_ROOT}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${botToken}` },
    body: form,
  })
  const data = (await res.json()) as T
  if (!data.ok) throw new SlackApiError(method, data.error ?? `HTTP ${res.status}`)
  return data
}

export interface SlackOAuthExchange {
  accessToken: string
  teamId: string
  teamName?: string
  installerUserId: string
}

/** Exchange an OAuth v2 `code` for a bot token + workspace/installer identity. */
export async function exchangeOAuthCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<SlackOAuthExchange> {
  const res = await fetch(`${API_ROOT}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
  })
  const data = (await res.json()) as SlackApiResponse & {
    access_token?: string
    team?: { id: string; name?: string }
    authed_user?: { id: string }
  }
  if (!data.ok || !data.access_token || !data.team?.id || !data.authed_user?.id) {
    throw new SlackApiError('oauth.v2.access', data.error ?? 'incomplete response')
  }
  return {
    accessToken: data.access_token,
    teamId: data.team.id,
    teamName: data.team.name,
    installerUserId: data.authed_user.id,
  }
}

export async function postMessage(botToken: string, channel: string, text: string): Promise<void> {
  await callJson(botToken, 'chat.postMessage', { channel, text })
}

export async function uploadFile(
  botToken: string,
  channel: string,
  data: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string,
): Promise<void> {
  const upload = await callForm<SlackApiResponse & { upload_url?: string; file_id?: string }>(
    botToken,
    'files.getUploadURLExternal',
    { filename: fileName, length: data.length },
  )
  if (!upload.upload_url || !upload.file_id) {
    throw new SlackApiError('files.getUploadURLExternal', 'no upload_url/file_id returned')
  }

  const putRes = await fetch(upload.upload_url, {
    method: 'POST',
    headers: { 'Content-Type': mimeType },
    body: new Blob([new Uint8Array(data)], { type: mimeType }),
  })
  if (!putRes.ok) throw new SlackApiError('files.getUploadURLExternal', `upload PUT failed: HTTP ${putRes.status}`)

  await callForm(botToken, 'files.completeUploadExternal', {
    files: JSON.stringify([{ id: upload.file_id, title: caption ?? fileName }]),
    channel_id: channel,
    ...(caption ? { initial_comment: caption } : {}),
  })
}

/** Download an inbound file attachment (Slack's private file URLs require bot auth). */
export async function downloadSlackFile(botToken: string, urlPrivateDownload: string): Promise<Buffer> {
  const res = await fetch(urlPrivateDownload, { headers: { Authorization: `Bearer ${botToken}` } })
  if (!res.ok) throw new SlackApiError('downloadFile', `HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Verify a Slack Events API request per
 * https://api.slack.com/authentication/verifying-requests-from-slack
 * Rejects requests older than 5 minutes even with a valid signature (replay protection).
 */
export function verifySlackSignature(
  signingSecret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  rawBody: Buffer,
): boolean {
  if (!timestampHeader || !signatureHeader) return false
  const timestamp = Number.parseInt(timestampHeader, 10)
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(Date.now() / 1000 - timestamp) > 60 * 5) return false

  const base = `v0:${timestampHeader}:${rawBody.toString('utf-8')}`
  const expected = `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
