/**
 * WhatsApp via Baileys (unofficial Web API).
 *
 * Use WHATSAPP_PROVIDER=baileys for dev/personal numbers.
 * Production WhatsApp Business API: WHATSAPP_PROVIDER=twilio (default).
 */
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  downloadMediaMessage,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import type { ClientAgentSession } from './agent.js'
import { isInboundSenderAllowed } from './access.js'
import { runAndDeliver } from './delivery.js'
import { maybeOnboardingNudge } from './onboarding-nudge.js'
import { getClientMeta, getConnections, getRole, updateClientMeta } from './store/client-store.js'
import { broadcastLinked, broadcastQr } from './onboarding/server.js'
import { bindSessionToWhatsAppJid } from './onboarding/session.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'
import { effectiveAllowedGroupJids, shouldProcessBaileysInbound, sameWhatsAppUser } from './baileys-gate.js'
import { createBaileysGroupTransport } from './baileys-group-transport.js'
import { consumeAgentAuthoredMessage, rememberAgentMessageId } from './baileys-message-origin.js'

/**
 * Per-client Baileys auth directory. Each linked WhatsApp account gets its own
 * auth state under store/clients/<clientId>/auth/ so multiple accounts can be
 * linked from one process without colliding.
 *
 * Exported so the session manager can wipe dead creds on a 401 loggedOut —
 * that forces Baileys to emit a fresh QR on the next socket start.
 */
export function authDirFor(clientId: string): string {
  return path.resolve(process.env.AGENT_STORE_DIR ?? './store', 'clients', clientId, 'auth')
}

// Anti-ban: cap rapid reconnect loops. Each close multiplies the delay by 2
// (3s → 6s → 12s → 24s → 30s cap); after MAX_RECONNECT_ATTEMPTS consecutive
// failures we give up rather than hammering the noise handshake.
// Tracked PER-CLIENT so one account's reconnect storm doesn't affect another.
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_MS = 3000
const RECONNECT_CAP_MS = 30_000

function nextReconnectDelay(attempts: number): { delay: number; nextAttempts: number } {
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_CAP_MS)
  return { delay, nextAttempts: attempts + 1 }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Anti-ban: jittered pre-reply delay (default 1–3s). Override the ceiling via
// BAILEYS_REPLY_JITTER_MS (milliseconds). Set to 0 to disable.
function jitterDelayMs(): number {
  const ceiling = positiveInteger(process.env.BAILEYS_REPLY_JITTER_MS, 3000)
  if (ceiling <= 0) return 0
  return Math.floor(Math.random() * ceiling) + 500
}

const noop = (): void => {}
// Logger level is configurable via BAILEYS_LOG_LEVEL (default: silent in prod,
// 'warn' recommended for debugging). Set to 'info' or 'debug' for more detail.
const BAILEYS_LOG_LEVEL = process.env.BAILEYS_LOG_LEVEL ?? 'silent'
const silentLogger: any = {
  level: BAILEYS_LOG_LEVEL,
  trace: noop, debug: noop, info: noop,
  warn: (...args: unknown[]) => { if (BAILEYS_LOG_LEVEL !== 'silent') console.warn('[baileys]', ...args) },
  error: (...args: unknown[]) => { if (BAILEYS_LOG_LEVEL !== 'silent') console.error('[baileys]', ...args) },
  fatal: (...args: unknown[]) => { if (BAILEYS_LOG_LEVEL !== 'silent') console.error('[baileys:fatal]', ...args) },
  child: () => silentLogger,
}

function createBaileysTransport(socket: WASocket, agentSentMessageIds: Set<string>): WhatsAppTransport {
  const remember = (message: proto.IWebMessageInfo | undefined): void => {
    rememberAgentMessageId(agentSentMessageIds, message?.key.id)
  }
  return {
    async sendText(jid, text) {
      // Baileys treats URL preview generation as an optional peer feature.
      // BizzClaw does not need previews, and disabling it avoids an optional
      // package/network fetch from becoming part of the delivery path.
      remember(await socket.sendMessage(
        jid,
        { text },
        { getUrlInfo: undefined } as Parameters<WASocket['sendMessage']>[2] & { getUrlInfo?: undefined },
      ))
    },
    async sendImage(jid, data, mimeType, caption) {
      remember(await socket.sendMessage(jid, { image: data, mimetype: mimeType, caption }))
    },
    async sendVideo(jid, data, mimeType, caption) {
      remember(await socket.sendMessage(jid, { video: data, mimetype: mimeType, caption }))
    },
    async sendAudio(jid, data, mimeType) {
      remember(await socket.sendMessage(jid, { audio: data, mimetype: mimeType }))
    },
    async sendDocument(jid, data, mimeType, fileName, caption) {
      remember(await socket.sendMessage(jid, {
        document: data,
        mimetype: mimeType,
        fileName,
        ...(caption ? { caption } : {}),
      }))
    },
  }
}

export type BaileysSession = {
  clientId: string
  socket: WASocket
  transport: WhatsAppTransport
  /** Stop this client's socket and suppress further reconnect. */
  stop: () => void
  /** Log out the linked device server-side (removes it from the user's phone)
   * and stop the socket. Use when the user wants to disconnect WhatsApp. */
  logout: () => Promise<void>
}

/**
 * Start a Baileys WhatsApp socket for ONE client, identified by clientId.
 * Auth state lives at store/clients/<clientId>/auth/ so multiple accounts can
 * be linked from one process without colliding.
 *
 * Pass an optional onReconnect callback so the BaileysSessionManager can
 * re-create the socket on disconnect (the reconnect loop is per-client).
 */
export async function startBaileysWhatsApp(
  clientId: string,
  opts: {
    phoneNumber?: string
    onboardingSessionId?: string
    onReconnect?: (clientId: string) => void
    /** Called when WhatsApp actively logs the linked device out (close code
     * 401, e.g. the user removed the device from their phone). The caller
     * should wipe the auth dir and offer a fresh QR — re-linking is safe. */
    onLoggedOut?: (clientId: string) => void
    /** Called when the reconnect loop exhausts MAX_RECONNECT_ATTEMPTS. This is
     * a ban-risk protection stop — do NOT auto-wipe creds or show a new QR;
     * require manual operator intervention. Distinct from a 401 loggedOut. */
    onReconnectExhausted?: (clientId: string) => void
    onConnected?: (clientId: string) => void
    onDisconnected?: (clientId: string) => void
    /** Called when the owner types a stop command (stop/עצור) in the chat.
     * Return true to confirm the agent should stop (logout the linked device). */
    onStopCommand?: (clientId: string, senderJid: string) => Promise<boolean> | boolean
  } = {},
): Promise<BaileysSession> {
  const authDir = authDirFor(clientId)
  await mkdir(authDir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version } = await fetchLatestBaileysVersion()

  // Per-client reconnect state, isolated from other sockets.
  let reconnectAttempts = 0
  let stopped = false

  const socket = makeWASocket({
    auth: state,
    version,
    browser: Browsers.macOS('Desktop'),
    logger: silentLogger,
    printQRInTerminal: false,
    // Anti-ban: don't keep the account perpetually "online". A linked device
    // that never goes offline is a known fingerprint of unofficial/automated
    // clients and suppresses push notifications to the phone.
    markOnlineOnConnect: false,
  })

  const agentSentMessageIds = new Set<string>()
  const transport = createBaileysGroupTransport(clientId, createBaileysTransport(socket, agentSentMessageIds))

  socket.ev.on('creds.update', saveCreds)

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      const phoneNumber = opts.phoneNumber
      if (phoneNumber) {
        const code = await socket.requestPairingCode(phoneNumber)
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
        console.log(`WhatsApp pairing code [client ${clientId}]: ${code}`)
        console.log(`Open WhatsApp → Settings → Linked Devices → Link with phone number`)
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
      } else {
        console.log(`\n[client ${clientId}] Scan this QR code in WhatsApp → Settings → Linked Devices:\n`)
        qrcode.generate(qr, { small: true })
      }
      // QR material is tenant-sensitive. A background/restored socket never
      // broadcasts it; only the onboarding session that started this socket
      // may receive it.
      if (opts.onboardingSessionId) await broadcastQr(opts.onboardingSessionId, qr)
    }

    if (connection === 'open') {
      reconnectAttempts = 0
      console.log(`✓ WhatsApp connected (Baileys) [client ${clientId}]`)
      opts.onConnected?.(clientId)
      const linkedJid = socket.user?.id ?? ''
      if (opts.onboardingSessionId) {
        if (linkedJid) {
          await bindSessionToWhatsAppJid(opts.onboardingSessionId, linkedJid, 'baileys').catch((err) => {
            console.error(`[client ${clientId}] failed to persist Baileys onboarding link:`, err)
          })
        }
        broadcastLinked(linkedJid, opts.onboardingSessionId)
      }
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode
      const shouldReconnect = code !== DisconnectReason.loggedOut
      opts.onDisconnected?.(clientId)
      if (shouldReconnect) {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error(
            `[client ${clientId}] WhatsApp reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts — giving up to avoid ban-risk loop. Restart manually.`,
          )
          opts.onReconnectExhausted?.(clientId)
          return
        }
        const { delay, nextAttempts } = nextReconnectDelay(reconnectAttempts)
        reconnectAttempts = nextAttempts
        console.log(`[client ${clientId}] WhatsApp closed (code ${code}); reconnecting in ${delay}ms (attempt ${reconnectAttempts})`)
        setTimeout(() => {
          if (!stopped) opts.onReconnect?.(clientId)
        }, delay)
      } else {
        // 401 loggedOut: WhatsApp invalidated this linked device (the user
        // removed it from their phone, or it was revoked). The creds on disk
        // are dead — wipe them so the next socket start emits a fresh QR, and
        // surface a "logged out, scan again" state to the onboarding UI.
        console.log(`[client ${clientId}] Logged out (code 401) — clearing auth and awaiting re-link`)
        await rm(authDir, { recursive: true, force: true }).catch((err) => {
          console.error(`[client ${clientId}] failed to clear auth dir on logout:`, err)
        })
        opts.onLoggedOut?.(clientId)
      }
    }
  })

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (consumeAgentAuthoredMessage(agentSentMessageIds, msg.key.fromMe, msg.key.id)) continue

      const jid = msg.key.remoteJid
      if (!jid) continue

      const text = extractText(msg)
      const media = extractMedia(msg)
      if (!text && !media) continue

      const meta = await getClientMeta(clientId)
      // Home group is chosen explicitly during onboarding (POST /api/onboarding/baileys-group)
      // and stored as meta.baileysHomeGroupJid. No silent auto-bind here — the agent
      // only listens in the one group the user picked.

      const gate = shouldProcessBaileysInbound({
        remoteJid: jid,
        participantJid: msg.key.participant,
        text,
        hasMedia: Boolean(media),
        mentionedJids: extractMentionedJids(msg),
        botJid: socket.user?.id,
        allowedGroupJids: effectiveAllowedGroupJids(undefined, meta.baileysHomeGroupJid),
      })
      if (!gate.allowed) {
        if (gate.triggered && (gate.reason === 'group-not-configured' || gate.reason === 'group-not-allowed')) {
          console.log(`[baileys][client ${clientId}] blocked non-selected group ${jid}`)
        }
        continue
      }

      if (!gate.groupMode && !(await isInboundSenderAllowed(jid))) {
        console.log(`[${jid}] blocked by sender allowlist`)
        continue
      }

      console.log(`[${jid}] ${msg.pushName ?? jid}: ${gate.prompt ?? `[${media?.mimeType ?? 'attachment'}]`}`)

      await socket.readMessages([msg.key])

      // Stop command: the owner can type "stop" / "עצור" to disconnect the
      // agent and remove the linked device. Intercept before agent processing.
      // Only the linked account owner (same user as socket.user) may stop —
      // random group participants can't disable someone else's agent.
      const ownerJid = socket.user?.id
      const isOwner = Boolean(msg.key.fromMe) || Boolean(
        ownerJid && msg.key.participant && sameWhatsAppUser(msg.key.participant, ownerJid),
      )
      const normalized = (gate.prompt ?? text ?? '').trim().toLowerCase()
      const isStopCommand = ['stop', 'עצור', 'stop agent', 'disconnect', 'logout'].includes(normalized)
      if (isStopCommand && isOwner && opts.onStopCommand) {
        const shouldStop = await opts.onStopCommand(clientId, jid)
        if (shouldStop) {
          await transport.sendText(jid, 'Stopping the agent and removing the linked device from your phone. You can re-link anytime from the onboarding page. 👋')
          stopped = true
          try { await socket.logout() } catch { try { socket.end(undefined) } catch { /* already closed */ } }
          return
        }
      }

      // This socket already belongs to exactly one tenant. A group JID is only
      // a delivery address and must never become the profile/readiness key.
      const senderClientId = clientId
      await updateClientMeta(senderClientId, { whatsappProvider: 'baileys' })
      const connections = await getConnections(senderClientId)
      const hasAnyConnection = Object.values(connections).some((c) => c?.status === 'connected')
      const hasRole = (await getRole(senderClientId)) !== null
      const onboarded = hasAnyConnection || hasRole

      // Value before integration: serve even un-onboarded senders with the default
      // agent, then invite setup once (rather than bouncing them to a link).

      try {
        await socket.sendPresenceUpdate('composing', jid)
        // Anti-ban: a small jittered delay before replying so the account
        // doesn't consistently answer within <1s (a known automation flag).
        await sleep(jitterDelayMs())
        let prompt = gate.prompt ?? 'Hi'

        let prepare: ((session: ClientAgentSession) => Promise<void>) | undefined
        if (media) {
          const inputPath = `/workspace/inbox/${Date.now()}-${sanitizeFileName(media.fileName)}`
          prompt += `\n\nAttached file: ${inputPath}\nMIME type: ${media.mimeType}`
          prepare = async (session) => {
            const bytes = await downloadMediaMessage(msg, 'buffer', {}, {
              reuploadRequest: socket.updateMediaMessage,
              logger: silentLogger,
            })
            const maxInputBytes = positiveInteger(process.env.AGENT_MAX_INPUT_BYTES, 26_214_400)
            if (bytes.length > maxInputBytes) throw new Error(`WhatsApp attachment exceeds ${maxInputBytes} bytes`)
            await session.writeInput(inputPath, bytes)
          }
        }

        await runAndDeliver(transport, jid, prompt, { prepare, clientId })

        if (!onboarded) {
          const nudge = await maybeOnboardingNudge(senderClientId, jid)
          if (nudge) await transport.sendText(jid, nudge)
        }
      } catch (err) {
        console.error(`[${jid}] agent error:`, err)
        await transport.sendText(jid, 'Something went wrong. Please try again.')
      } finally {
        await socket.sendPresenceUpdate('paused', jid)
      }
    }
  })

  const session: BaileysSession = {
    clientId,
    socket,
    transport,
    stop: () => {
      stopped = true
      try {
        socket.end(undefined)
      } catch {
        // already closed
      }
    },
    logout: async () => {
      // Tell WhatsApp to remove this linked device server-side (it disappears
      // from the user's phone), then stop the socket and remove its local
      // credentials so a server restart cannot silently reconnect it.
      stopped = true
      try {
        await socket.logout()
      } catch {
        // best-effort — if logout fails, just end the socket
        try { socket.end(undefined) } catch { /* already closed */ }
      } finally {
        await rm(authDir, { recursive: true, force: true }).catch((err) => {
          console.error(`[client ${clientId}] failed to clear auth dir on disconnect:`, err)
        })
      }
    },
  }
  return session
}

function extractText(msg: proto.IWebMessageInfo): string | null {
  const m = msg.message
  if (!m) return null
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    null
  )
}

function extractMentionedJids(msg: proto.IWebMessageInfo): string[] {
  const m = msg.message
  if (!m) return []
  return [
    ...(m.extendedTextMessage?.contextInfo?.mentionedJid ?? []),
    ...(m.imageMessage?.contextInfo?.mentionedJid ?? []),
    ...(m.videoMessage?.contextInfo?.mentionedJid ?? []),
    ...(m.documentMessage?.contextInfo?.mentionedJid ?? []),
  ].filter(Boolean)
}

type InboundMedia = { fileName: string; mimeType: string }

function extractMedia(msg: proto.IWebMessageInfo): InboundMedia | null {
  const message = msg.message
  if (!message) return null
  if (message.imageMessage) {
    const mimeType = message.imageMessage.mimetype ?? 'image/jpeg'
    return { fileName: `image.${extensionForMime(mimeType)}`, mimeType }
  }
  if (message.videoMessage) {
    const mimeType = message.videoMessage.mimetype ?? 'video/mp4'
    return { fileName: `video.${extensionForMime(mimeType)}`, mimeType }
  }
  if (message.audioMessage) {
    const mimeType = message.audioMessage.mimetype ?? 'audio/ogg'
    return { fileName: `audio.${extensionForMime(mimeType)}`, mimeType }
  }
  if (message.documentMessage) {
    const mimeType = message.documentMessage.mimetype ?? 'application/octet-stream'
    return {
      fileName: message.documentMessage.fileName ?? `document.${extensionForMime(mimeType)}`,
      mimeType,
    }
  }
  return null
}

function extensionForMime(mimeType: string): string {
  const subtype = mimeType.split('/', 2)[1]?.split(';', 1)[0]?.toLowerCase() ?? 'bin'
  const aliases: Record<string, string> = {
    jpeg: 'jpg',
    quicktime: 'mov',
    mpeg: 'mp3',
    plain: 'txt',
    'x-m4a': 'm4a',
  }
  return aliases[subtype] ?? (subtype.replace(/[^a-z0-9]+/g, '') || 'bin')
}

function sanitizeFileName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/').split('/').pop() ?? 'attachment.bin'
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'attachment.bin'
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
