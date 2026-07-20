/**
 * Slack Events API webhook handling.
 *
 * A single POST endpoint (/webhooks/slack/events, wired in callback-server.ts)
 * receives every connected client's inbound Slack messages — DMs, and channel
 * or private-group messages the bot has been invited to. Requests are verified
 * with the signing secret (see slack-client.ts::verifySlackSignature); the
 * event's team_id resolves back to a clientId via slack-store.ts's reverse
 * index, then delivery reuses the same runAndDeliver path as every other
 * channel.
 *
 * DMs are always processed. Channel/group messages go through slack-gate.ts:
 * an explicit @mention is required to start talking, after which that
 * (channel, user) pair stays conversational for a short window; replies are
 * always threaded under the mention that opened the conversation.
 */
import type { IncomingHttpHeaders } from 'node:http'
import type { ClientAgentSession } from './agent.js'
import { encodeClientChannelAddress } from './channel-address.js'
import { runAndDeliver } from './delivery.js'
import * as slack from './slack-client.js'
import { SlackConversationWindow, shouldProcessSlackChannelMessage } from './slack-gate.js'
import { clientIdForSlackTeam, getSlackConnection } from './slack-store.js'
import { createSlackTransport } from './slack-transport.js'

interface SlackEvent {
  type: string
  subtype?: string
  channel?: string
  channel_type?: string
  user?: string
  bot_id?: string
  text?: string
  ts?: string
  thread_ts?: string
  files?: Array<{ id: string; name?: string; mimetype?: string; url_private_download?: string; size?: number }>
}

/** One conversation window per process, keyed by (channelId, userId) — see slack-gate.ts. */
const conversationWindows = new SlackConversationWindow()

interface SlackEventsPayload {
  type: string
  challenge?: string
  team_id?: string
  event_id?: string
  event?: SlackEvent
}

export interface SlackWebhookResult {
  status: number
  body: string
  contentType?: string
}

const SEEN_EVENT_TTL_MS = 5 * 60_000
const seenEvents = new Map<string, number>()

/** Slack retries delivery if it doesn't get a fast ack — dedup by event_id so we don't double-reply. */
function isDuplicateEvent(eventId: string | undefined): boolean {
  if (!eventId) return false
  const now = Date.now()
  for (const [id, ts] of seenEvents) {
    if (now - ts > SEEN_EVENT_TTL_MS) seenEvents.delete(id)
  }
  if (seenEvents.has(eventId)) return true
  seenEvents.set(eventId, now)
  return false
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function sanitizeFileName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/').split('/').pop() ?? 'attachment.bin'
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'attachment.bin'
}

/**
 * Handle one raw Events API POST body. Returns what the HTTP layer should
 * respond with; the caller (callback-server.ts) owns writing to `res`.
 * Signature verification happens here so the signing secret stays a
 * Slack-specific concern.
 */
export async function handleSlackEventsRequest(
  rawBody: Buffer,
  headers: IncomingHttpHeaders,
  signingSecret: string,
): Promise<SlackWebhookResult> {
  const timestamp = headers['x-slack-request-timestamp']
  const signature = headers['x-slack-signature']
  const valid = slack.verifySlackSignature(
    signingSecret,
    Array.isArray(timestamp) ? timestamp[0] : timestamp,
    Array.isArray(signature) ? signature[0] : signature,
    rawBody,
  )
  if (!valid) return { status: 401, body: 'invalid signature' }

  let payload: SlackEventsPayload
  try {
    payload = JSON.parse(rawBody.toString('utf-8')) as SlackEventsPayload
  } catch {
    return { status: 400, body: 'invalid JSON' }
  }

  if (payload.type === 'url_verification') {
    return {
      status: 200,
      body: JSON.stringify({ challenge: payload.challenge ?? '' }),
      contentType: 'application/json',
    }
  }

  if (payload.type === 'event_callback' && payload.event && payload.team_id && !isDuplicateEvent(payload.event_id)) {
    // Ack immediately — Slack expects a response within 3s — and process in the background.
    void processEvent(payload.team_id, payload.event).catch((err) => {
      console.error('[slack] event processing failed:', err)
    })
  }

  return { status: 200, body: '' }
}

async function processEvent(teamId: string, event: SlackEvent): Promise<void> {
  if (event.type !== 'message') return
  if (event.bot_id) return // never react to bot messages, including our own replies
  if (event.subtype) return // edits/deletes/joins/etc — only plain messages
  const isDirectMessage = event.channel_type === 'im'
  const isChannelMessage = event.channel_type === 'channel' || event.channel_type === 'group'
  if (!isDirectMessage && !isChannelMessage) return // e.g. mpim — not supported yet
  if (!event.channel) return
  if (!event.text && !event.files?.length) return

  const clientId = await clientIdForSlackTeam(teamId)
  if (!clientId) return

  const connection = await getSlackConnection(clientId)
  if (!connection) return

  const channel = event.channel
  const file = event.files?.[0]

  let prompt = event.text ?? 'Hi'
  let threadTs: string | undefined

  if (isChannelMessage) {
    if (!event.user) return
    const decision = shouldProcessSlackChannelMessage({
      text: event.text ?? null,
      hasFile: Boolean(file),
      botUserId: connection.botUserId,
      conversationActive: conversationWindows.isActive(channel, event.user),
    })
    if (!decision.allowed) return

    prompt = decision.prompt
    // A follow-up reuses the thread the window was opened in; a fresh mention
    // starts (or continues) the thread rooted at this message.
    threadTs = conversationWindows.activeThreadTs(channel, event.user) ?? event.thread_ts ?? event.ts
    if (threadTs) conversationWindows.touch(channel, event.user, threadTs)
  }

  const transport = createSlackTransport(connection.botToken)
  const address = encodeClientChannelAddress(clientId, 'slack', threadTs ? `${channel}:${threadTs}` : channel)

  let prepare: ((session: ClientAgentSession) => Promise<void>) | undefined
  if (file?.url_private_download) {
    const fileName = sanitizeFileName(file.name ?? 'attachment.bin')
    const inputPath = `/workspace/inbox/${Date.now()}-${fileName}`
    prompt += `\n\nAttached file: ${inputPath}\nMIME type: ${file.mimetype ?? 'application/octet-stream'}`
    prepare = async (session) => {
      const bytes = await slack.downloadSlackFile(connection.botToken, file.url_private_download!)
      const maxInputBytes = positiveInteger(process.env.AGENT_MAX_INPUT_BYTES, 26_214_400)
      if (bytes.length > maxInputBytes) throw new Error(`Slack attachment exceeds ${maxInputBytes} bytes`)
      await session.writeInput(inputPath, bytes)
    }
  }

  console.log(`[slack][${channel}] ${event.user ?? channel}: ${event.text ?? `[${file?.mimetype ?? 'attachment'}]`}`)

  try {
    await runAndDeliver(transport, address, prompt, { prepare })
  } catch (err) {
    console.error(`[slack][client ${clientId}] agent error:`, err)
    await transport.sendText(address, 'Something went wrong. Please try again.').catch(() => {})
  }
}
