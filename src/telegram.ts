/**
 * Telegram via the Bot API (long polling).
 *
 * Each client brings their own bot (BotFather token, stored per-client in
 * telegram-store.ts). The bot is locked to whichever chat first messages it
 * (the owner) — mirroring the Baileys "home group" binding — so it behaves
 * like a personal assistant rather than a public bot.
 */
import type { ClientAgentSession } from './agent.js'
import { encodeClientChannelAddress } from './channel-address.js'
import { runAndDeliver } from './delivery.js'
import * as tg from './telegram-client.js'
import type { TelegramMessage } from './telegram-client.js'
import { bindTelegramOwnerChat, type TelegramConnection } from './telegram-store.js'
import { createTelegramTransport } from './telegram-transport.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

export interface TelegramSession {
  clientId: string
  transport: WhatsAppTransport
  stop: () => void
}

const POLL_TIMEOUT_SEC = 30
const POLL_ERROR_BACKOFF_MS = 5000
const POLL_ERROR_BACKOFF_CAP_MS = 60_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type InboundMedia = { fileId: string; fileName: string; mimeType: string }

function extractMedia(msg: TelegramMessage): InboundMedia | null {
  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1]
    return { fileId: largest.file_id, fileName: 'image.jpg', mimeType: 'image/jpeg' }
  }
  if (msg.video) {
    const mimeType = msg.video.mime_type ?? 'video/mp4'
    return {
      fileId: msg.video.file_id,
      fileName: msg.video.file_name ?? `video.${tg.extensionForMime(mimeType)}`,
      mimeType,
    }
  }
  if (msg.audio) {
    const mimeType = msg.audio.mime_type ?? 'audio/mpeg'
    return {
      fileId: msg.audio.file_id,
      fileName: msg.audio.file_name ?? `audio.${tg.extensionForMime(mimeType)}`,
      mimeType,
    }
  }
  if (msg.voice) {
    const mimeType = msg.voice.mime_type ?? 'audio/ogg'
    return { fileId: msg.voice.file_id, fileName: 'voice.ogg', mimeType }
  }
  if (msg.document) {
    const mimeType = msg.document.mime_type ?? 'application/octet-stream'
    return {
      fileId: msg.document.file_id,
      fileName: msg.document.file_name ?? `document.${tg.extensionForMime(mimeType)}`,
      mimeType,
    }
  }
  return null
}

function sanitizeFileName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/').split('/').pop() ?? 'attachment.bin'
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'attachment.bin'
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Run one inbound Telegram message through the agent and deliver the reply.
 * Shared by the per-client (BYO bot) poller below and the shared platform bot
 * (telegram-shared-bot.ts) — both already know which clientId a chat belongs
 * to by the time they call this; only *how* they learn that differs.
 */
export async function deliverTelegramMessage(params: {
  clientId: string
  chatId: string
  botToken: string
  transport: WhatsAppTransport
  msg: TelegramMessage
}): Promise<void> {
  const { clientId, chatId, botToken, transport, msg } = params

  const text = msg.text ?? msg.caption ?? null
  const media = extractMedia(msg)
  if (!text && !media) return

  const address = encodeClientChannelAddress(clientId, 'telegram', chatId)
  let prompt = text ?? 'Hi'

  let prepare: ((session: ClientAgentSession) => Promise<void>) | undefined
  if (media) {
    const inputPath = `/workspace/inbox/${Date.now()}-${sanitizeFileName(media.fileName)}`
    prompt += `\n\nAttached file: ${inputPath}\nMIME type: ${media.mimeType}`
    prepare = async (session) => {
      const bytes = await tg.downloadFile(botToken, media.fileId)
      const maxInputBytes = positiveInteger(process.env.AGENT_MAX_INPUT_BYTES, 26_214_400)
      if (bytes.length > maxInputBytes) throw new Error(`Telegram attachment exceeds ${maxInputBytes} bytes`)
      await session.writeInput(inputPath, bytes)
    }
  }

  console.log(`[telegram][${chatId}] ${msg.from?.username ?? chatId}: ${text ?? `[${media?.mimeType ?? 'attachment'}]`}`)

  try {
    await tg.sendChatAction(botToken, chatId, 'typing').catch(() => {})
    await runAndDeliver(transport, address, prompt, { prepare })
  } catch (err) {
    console.error(`[telegram][client ${clientId}] agent error:`, err)
    await transport.sendText(address, 'Something went wrong. Please try again.').catch(() => {})
  }
}

/**
 * Long-poll one bot's `getUpdates` until `stop()` is called. Shared by the
 * per-client BYO pollers and the single shared platform bot.
 */
export function runTelegramPollLoop(
  botToken: string,
  onMessage: (msg: TelegramMessage) => Promise<void>,
  label: string,
): { stop: () => void } {
  const controller = new AbortController()
  let stopped = false
  let offset = 0

  async function poll(): Promise<void> {
    let backoff = POLL_ERROR_BACKOFF_MS
    while (!stopped) {
      try {
        const updates = await tg.getUpdates(botToken, offset, POLL_TIMEOUT_SEC, controller.signal)
        backoff = POLL_ERROR_BACKOFF_MS
        for (const update of updates) {
          offset = update.update_id + 1
          if (update.message) await onMessage(update.message)
        }
      } catch (err) {
        if (stopped) return
        console.error(`[telegram][${label}] poll error:`, err instanceof Error ? err.message : err)
        await sleep(backoff)
        backoff = Math.min(backoff * 2, POLL_ERROR_BACKOFF_CAP_MS)
      }
    }
  }

  void poll()

  return {
    stop: () => {
      stopped = true
      controller.abort()
    },
  }
}

/**
 * Start polling one client's Telegram bot. Resolves once the bot's identity
 * is confirmed (getMe); inbound handling then runs in the background until
 * `stop()` is called.
 */
export async function startTelegramBot(
  clientId: string,
  connection: TelegramConnection,
): Promise<TelegramSession> {
  const { botToken } = connection
  let ownerChatId = connection.ownerChatId ?? null

  const me = await tg.getMe(botToken)
  console.log(`✓ Telegram bot connected [client ${clientId}]: @${me.username ?? me.id}`)

  const transport = createTelegramTransport(botToken)

  async function handleMessage(msg: TelegramMessage): Promise<void> {
    const chatId = String(msg.chat.id)

    if (!ownerChatId) {
      ownerChatId = chatId
      await bindTelegramOwnerChat(clientId, chatId)
      console.log(`[telegram] bound owner chat ${chatId} for client ${clientId}`)
    } else if (chatId !== ownerChatId) {
      console.log(`[telegram][client ${clientId}] ignoring message from non-owner chat ${chatId}`)
      return
    }

    await deliverTelegramMessage({ clientId, chatId, botToken, transport, msg })
  }

  const { stop } = runTelegramPollLoop(botToken, handleMessage, `client ${clientId}`)

  return { clientId, transport, stop }
}
