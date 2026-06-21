/**
 * WhatsApp adapter via Baileys.
 *
 * Auth gate: if a client hasn't connected their Meta Ads account yet,
 * we send them an OAuth link instead of invoking the agent.
 * Once they authorize, their token is stored and future messages go straight to the agent.
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
import { clientIdFromJid, type ClientAgentSession } from './agent.js'
import { runAndDeliver } from './delivery.js'
import { onboardingUrlFor } from './onboarding/client-link.js'
import { getConnections, getRole } from './store/client-store.js'
import { broadcastQr, broadcastLinked } from './onboarding/server.js'

const AUTH_DIR = './store/auth'

const noop = (): void => {}
const silentLogger: any = {
  level: 'silent',
  trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
  child: () => silentLogger,
}

export async function startWhatsApp(): Promise<WASocket> {
  await mkdir(AUTH_DIR, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const socket = makeWASocket({
    auth: state,
    version,
    browser: Browsers.macOS('Desktop'),
    logger: silentLogger,
    printQRInTerminal: false,
  })

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
      // Stream QR to onboarding web UI for all pending sessions
      const onboardingSession = process.env.ONBOARDING_SESSION_ID
      if (onboardingSession) await broadcastQr(onboardingSession, qr)
    }

    if (connection === 'open') {
      console.log('✓ WhatsApp connected')
      const onboardingSession = process.env.ONBOARDING_SESSION_ID
      if (onboardingSession) broadcastLinked(socket.user?.id ?? '', onboardingSession)
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode
      const shouldReconnect = code !== DisconnectReason.loggedOut
      if (shouldReconnect) {
        setTimeout(() => startWhatsApp(), 3000)
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

      console.log(`[${jid}] ${msg.pushName ?? jid}: ${text ?? `[${media?.mimeType ?? 'attachment'}]`}`)

      await socket.readMessages([msg.key])

      // Client is onboarded once they've connected a platform OR committed to a
      // role (some roles need no platform, but still configure profile + automations).
      const clientId = clientIdFromJid(jid)
      const connections = await getConnections(clientId)
      const hasAnyConnection = Object.values(connections).some((c) => c?.status === 'connected')
      const hasRole = (await getRole(clientId)) !== null

      if (!hasAnyConnection && !hasRole) {
        // Carry the client's JID (signed) so their onboarding writes under the
        // same key the runtime reads — see onboarding/client-link.ts.
        const onboardingUrl = process.env.CALLBACK_BASE_URL
          ? onboardingUrlFor(process.env.CALLBACK_BASE_URL, jid)
          : null
        await socket.sendMessage(jid, {
          text:
            `👋 Hi! I'm ${process.env.AGENT_NAME ?? 'Ahrness'}, your AI business assistant.\n\n` +
            (onboardingUrl
              ? `To get started, set up your agent here:\n${onboardingUrl}\n\nTakes about 2 minutes — choose your role, connect your platforms, and you're ready.`
              : `To get started, please complete the onboarding setup. Ask your administrator for the setup link.`),
        })
        continue
      }

      // Client is onboarded — invoke agent
      try {
        await socket.sendPresenceUpdate('composing', jid)
        let prompt = text ?? 'Use the attached file to complete my request.'

        // Attachment is written into the sandbox just before the agent runs.
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

        await runAndDeliver(socket, jid, prompt, { prepare })
      } catch (err) {
        console.error(`[${jid}] agent error:`, err)
        await socket.sendMessage(jid, { text: 'Something went wrong. Please try again.' })
      } finally {
        await socket.sendPresenceUpdate('paused', jid)
      }
    }
  })

  return socket
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
    'jpeg': 'jpg',
    'quicktime': 'mov',
    'mpeg': 'mp3',
    'plain': 'txt',
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
