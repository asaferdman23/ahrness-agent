/**
 * WhatsApp via Baileys (unofficial Web API).
 *
 * Use WHATSAPP_PROVIDER=baileys for dev/personal numbers.
 * Production WhatsApp Business API: WHATSAPP_PROVIDER=twilio (default).
 */
import { mkdir } from 'node:fs/promises'
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
import { getConnections, getRole, updateClientMeta } from './store/client-store.js'
import { clientIdForJid } from './tenant-store.js'
import { broadcastLinked, broadcastLinkedToAll, broadcastQr, broadcastQrToAll } from './onboarding/server.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'
import { shouldProcessBaileysInbound } from './baileys-gate.js'

const AUTH_DIR = './store/auth'

// Anti-ban: cap rapid reconnect loops. Each close multiplies the delay by 2
// (3s → 6s → 12s → 24s → 30s cap); after MAX_RECONNECT_ATTEMPTS consecutive
// failures we give up rather than hammering the noise handshake.
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_MS = 3000
const RECONNECT_CAP_MS = 30_000

function nextReconnectDelay(): number {
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_CAP_MS)
  reconnectAttempts += 1
  return delay
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
const silentLogger: any = {
  level: 'silent',
  trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
  child: () => silentLogger,
}

function createBaileysTransport(socket: WASocket): WhatsAppTransport {
  return {
    sendText: (jid, text) => socket.sendMessage(jid, { text }).then(() => {}),
    sendImage: (jid, data, mimeType, caption) =>
      socket.sendMessage(jid, { image: data, mimetype: mimeType, caption }).then(() => {}),
    sendVideo: (jid, data, mimeType, caption) =>
      socket.sendMessage(jid, { video: data, mimetype: mimeType, caption }).then(() => {}),
    sendAudio: (jid, data, mimeType) =>
      socket.sendMessage(jid, { audio: data, mimetype: mimeType }).then(() => {}),
    sendDocument: (jid, data, mimeType, fileName, caption) =>
      socket.sendMessage(jid, {
        document: data,
        mimetype: mimeType,
        fileName,
        ...(caption ? { caption } : {}),
      }).then(() => {}),
  }
}

export async function startBaileysWhatsApp(): Promise<WhatsAppTransport> {
  await mkdir(AUTH_DIR, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

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

  const transport = createBaileysTransport(socket)

  socket.ev.on('creds.update', saveCreds)

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      const phoneNumber = process.env.WHATSAPP_PHONE_NUMBER
      if (phoneNumber) {
        const code = await socket.requestPairingCode(phoneNumber)
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
        console.log(`WhatsApp pairing code: ${code}`)
        console.log(`Open WhatsApp → Settings → Linked Devices → Link with phone number`)
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
      } else {
        console.log('\nScan this QR code in WhatsApp → Settings → Linked Devices:\n')
        qrcode.generate(qr, { small: true })
      }
      const onboardingSession = process.env.ONBOARDING_SESSION_ID
      if (onboardingSession) await broadcastQr(onboardingSession, qr)
      else await broadcastQrToAll(qr)
    }

    if (connection === 'open') {
      reconnectAttempts = 0
      console.log('✓ WhatsApp connected (Baileys)')
      const onboardingSession = process.env.ONBOARDING_SESSION_ID
      if (onboardingSession) broadcastLinked(socket.user?.id ?? '', onboardingSession)
      else broadcastLinkedToAll(socket.user?.id ?? '')
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode
      const shouldReconnect = code !== DisconnectReason.loggedOut
      if (shouldReconnect) {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error(
            `WhatsApp reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts — giving up to avoid ban-risk loop. Restart manually.`,
          )
          process.exit(1)
        }
        const delay = nextReconnectDelay()
        console.log(`WhatsApp closed (code ${code}); reconnecting in ${delay}ms (attempt ${reconnectAttempts})`)
        setTimeout(() => startBaileysWhatsApp(), delay)
      } else {
        console.error('Logged out — delete ./store/auth/ and restart to re-authenticate')
        process.exit(1)
      }
    }
  })

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (msg.key.fromMe) continue

      const jid = msg.key.remoteJid
      if (!jid) continue

      const text = extractText(msg)
      const media = extractMedia(msg)
      if (!text && !media) continue

      const gate = shouldProcessBaileysInbound({
        remoteJid: jid,
        participantJid: msg.key.participant,
        text,
        hasMedia: Boolean(media),
        mentionedJids: extractMentionedJids(msg),
        botJid: socket.user?.id,
      })
      if (!gate.allowed) {
        if (gate.triggered && (gate.reason === 'group-not-configured' || gate.reason === 'group-not-allowed')) {
          console.log(
            `[baileys] blocked group ${jid}; set BAILEYS_ALLOWED_GROUP_JIDS=${jid} to make this the agent home group` +
              (msg.key.participant ? `; optional BAILEYS_ALLOWED_GROUP_PARTICIPANTS=${msg.key.participant}` : ''),
          )
        }
        continue
      }

      if (!gate.groupMode && !(await isInboundSenderAllowed(jid))) {
        console.log(`[${jid}] blocked by sender allowlist`)
        continue
      }

      console.log(`[${jid}] ${msg.pushName ?? jid}: ${gate.prompt ?? `[${media?.mimeType ?? 'attachment'}]`}`)

      await socket.readMessages([msg.key])

      const clientId = await clientIdForJid(jid)
      await updateClientMeta(clientId, { whatsappProvider: 'baileys' })
      const connections = await getConnections(clientId)
      const hasAnyConnection = Object.values(connections).some((c) => c?.status === 'connected')
      const hasRole = (await getRole(clientId)) !== null
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

        await runAndDeliver(transport, jid, prompt, { prepare })

        if (!onboarded) {
          const nudge = await maybeOnboardingNudge(clientId, jid)
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

  return transport
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
