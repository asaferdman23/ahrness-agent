/**
 * Twilio WhatsApp Business API — same pattern as producegerx_backend.
 *
 * Outbound: client.messages.create({ from, to, body, mediaUrl? })
 * Inbound:  POST /webhooks/twilio/whatsapp (signature-validated)
 */
import twilio from 'twilio'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ClientAgentSession } from './agent.js'
import { isInboundSenderAllowed } from './access.js'
import { runAndDeliver } from './delivery.js'
import { maybeOnboardingNudge } from './onboarding-nudge.js'
import { bindSessionToWhatsAppCode } from './onboarding/session.js'
import { getConnections, getRole, updateClientMeta } from './store/client-store.js'
import { clientIdForJid } from './tenant-store.js'
import { signedOutputUrl } from './output-sharing.js'
import { jidToTwilioAddress, normalizePhoneE164, phoneToJid } from './whatsapp-address.js'
import { isTwilioProvider as hasTwilioProvider } from './whatsapp-providers.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

export const DEFAULT_TWILIO_WHATSAPP_NUMBER = '+15558136169'

const TWILIO_CONFIG = {
  accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER ?? DEFAULT_TWILIO_WHATSAPP_NUMBER,
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? '',
}

function ensureWhatsAppPrefix(value: string): string {
  if (!value) return value
  return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`
}

function twilioFrom(): Record<string, string> {
  if (TWILIO_CONFIG.messagingServiceSid) {
    return { messagingServiceSid: TWILIO_CONFIG.messagingServiceSid }
  }
  return { from: ensureWhatsAppPrefix(TWILIO_CONFIG.whatsappNumber) }
}

let client: ReturnType<typeof twilio> | null = null

function getClient(): ReturnType<typeof twilio> {
  if (!client) {
    if (!TWILIO_CONFIG.accountSid || !TWILIO_CONFIG.authToken) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required')
    }
    client = twilio(TWILIO_CONFIG.accountSid, TWILIO_CONFIG.authToken)
  }
  return client
}

const processedWebhooks = new Map<string, number>()

function isDuplicate(messageSid: string): boolean {
  const now = Date.now()
  for (const [key, ts] of processedWebhooks.entries()) {
    if (now - ts > 5 * 60_000) processedWebhooks.delete(key)
  }
  if (processedWebhooks.has(messageSid)) return true
  processedWebhooks.set(messageSid, now)
  return false
}

export function createTwilioTransport(): WhatsAppTransport {
  return {
    async sendText(jid, text) {
      await getClient().messages.create({
        ...twilioFrom(),
        to: jidToTwilioAddress(jid),
        body: text,
      })
    },

    async sendImage(jid, data, mimeType, caption) {
      const url = await uploadOrSignMedia(jid, data, mimeType, 'image')
      await getClient().messages.create({
        ...twilioFrom(),
        to: jidToTwilioAddress(jid),
        body: caption ?? '',
        mediaUrl: [url],
      })
    },

    async sendVideo(jid, data, mimeType, caption) {
      const url = await uploadOrSignMedia(jid, data, mimeType, 'video')
      await getClient().messages.create({
        ...twilioFrom(),
        to: jidToTwilioAddress(jid),
        body: caption ?? '',
        mediaUrl: [url],
      })
    },

    async sendAudio(jid, data, mimeType) {
      const url = await uploadOrSignMedia(jid, data, mimeType, 'audio')
      await getClient().messages.create({
        ...twilioFrom(),
        to: jidToTwilioAddress(jid),
        mediaUrl: [url],
      })
    },

    async sendDocument(jid, data, mimeType, fileName, caption) {
      const url = await uploadOrSignMedia(jid, data, mimeType, fileName)
      await getClient().messages.create({
        ...twilioFrom(),
        to: jidToTwilioAddress(jid),
        body: caption ?? '',
        mediaUrl: [url],
      })
    },
  }
}

/** Stage bytes in sandbox outputs and return a signed public URL for Twilio. */
async function uploadOrSignMedia(
  jid: string,
  data: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const clientId = await clientIdForJid(jid)
  const { getClientSandbox } = await import('./sandbox.js')
  const { sandbox } = await getClientSandbox(clientId)
  const safeName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'attachment.bin'}`
  await sandbox.writeFile(`/workspace/outputs/${safeName}`, data)
  return signedOutputUrl(clientId, safeName, mimeType)
}

export function validateTwilioConfig(): void {
  if (!TWILIO_CONFIG.accountSid || !TWILIO_CONFIG.authToken) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for WHATSAPP_PROVIDER=twilio')
  }
  if (!TWILIO_CONFIG.messagingServiceSid && !TWILIO_CONFIG.whatsappNumber) {
    throw new Error('Set TWILIO_WHATSAPP_NUMBER or TWILIO_MESSAGING_SERVICE_SID')
  }
}

export function twilioWebhookUrl(): string {
  const base = (process.env.CALLBACK_BASE_URL ?? `http://localhost:${process.env.CALLBACK_PORT ?? 3456}`).replace(/\/$/, '')
  return `${base}/webhooks/twilio/whatsapp`
}

export async function handleTwilioWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  body: Record<string, string>,
  transport: WhatsAppTransport,
): Promise<void> {
  const signature = req.headers['x-twilio-signature'] as string | undefined
  if (!signature) {
    res.writeHead(403).end('Missing signature')
    return
  }

  const protocol = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
  const host = req.headers.host ?? 'localhost'
  const configuredUrl = process.env.CALLBACK_BASE_URL
    ? `${process.env.CALLBACK_BASE_URL.replace(/\/$/, '')}${req.url ?? '/webhooks/twilio/whatsapp'}`
    : null
  const url = configuredUrl ?? `${protocol}://${host}${req.url ?? '/webhooks/twilio/whatsapp'}`

  const valid = twilio.validateRequest(TWILIO_CONFIG.authToken, signature, url, body)
  if (!valid) {
    res.writeHead(403).end('Invalid signature')
    return
  }

  const messageSid = body.MessageSid
  if (!messageSid) {
    res.writeHead(400).end('Missing MessageSid')
    return
  }

  // Status callbacks — acknowledge only
  if (body.MessageStatus) {
    res.writeHead(200).end('OK')
    return
  }

  if (isDuplicate(messageSid)) {
    res.writeHead(200).end('OK')
    return
  }

  // Inbound message
  const from = body.From ?? ''
  if (!from.toLowerCase().startsWith('whatsapp:')) {
    res.writeHead(200).end('OK')
    return
  }

  const jid = phoneToJid(from)
  const text = body.Body?.trim() ?? ''
  const numMedia = Number.parseInt(body.NumMedia ?? '0', 10)

  res.writeHead(200).end('OK')

  // Process async — Twilio expects 200 within ~5s
  void processInbound(transport, jid, text, body, numMedia).catch((err) => {
    console.error(`[twilio:${jid}] inbound error:`, err)
  })
}

async function processInbound(
  transport: WhatsAppTransport,
  jid: string,
  text: string,
  body: Record<string, string>,
  numMedia: number,
): Promise<void> {
  console.log(`[${jid}] ${text || `[${numMedia} media]`}`)

  const linked = await maybeBindTwilioOnboarding(text, jid, transport)
  if (linked) return

  if (!(await isInboundSenderAllowed(jid))) {
    console.log(`[twilio:${jid}] blocked by sender access policy`)
    return
  }

  const clientId = await clientIdForJid(jid)
  await updateClientMeta(clientId, { whatsappProvider: 'twilio' })

  const connections = await getConnections(clientId)
  const hasAnyConnection = Object.values(connections).some((c) => c?.status === 'connected')
  const hasRole = (await getRole(clientId)) !== null
  const onboarded = hasAnyConnection || hasRole

  // Value before integration: serve guests too, then invite setup once.

  try {
    let prompt = text || 'Use the attached file to complete my request.'
    let prepare: ((session: ClientAgentSession) => Promise<void>) | undefined

    if (numMedia > 0) {
      const media = await downloadInboundMedia(body, numMedia)
      if (media) {
        const inputPath = `/workspace/inbox/${Date.now()}-${sanitizeFileName(media.fileName)}`
        prompt += `\n\nAttached file: ${inputPath}\nMIME type: ${media.mimeType}`
        prepare = async (session) => {
          const maxInputBytes = positiveInteger(process.env.AGENT_MAX_INPUT_BYTES, 26_214_400)
          if (media.bytes.length > maxInputBytes) throw new Error(`Attachment exceeds ${maxInputBytes} bytes`)
          await session.writeInput(inputPath, media.bytes)
        }
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
  }
}

async function maybeBindTwilioOnboarding(
  text: string,
  jid: string,
  transport: WhatsAppTransport,
): Promise<boolean> {
  const match = text.trim().match(/^(?:connect|setup|link)?\s*([A-F0-9]{8})$/i)
  if (!match) return false

  const session = await bindSessionToWhatsAppCode(match[1] ?? '', jid, 'twilio')
  if (!session) return false

  const base = process.env.CALLBACK_BASE_URL?.replace(/\/$/, '')
  const link = base ? `${base}/onboarding/step/6?session=${encodeURIComponent(session.sessionId)}` : null
  await transport.sendText(
    jid,
    link
      ? `WhatsApp is connected. Finish setup here: ${link}`
      : 'WhatsApp is connected. Return to the setup page to finish.',
  )
  return true
}

type InboundMedia = { bytes: Uint8Array; fileName: string; mimeType: string }

async function downloadInboundMedia(
  body: Record<string, string>,
  numMedia: number,
): Promise<InboundMedia | null> {
  const mediaUrl = body.MediaUrl0
  const mimeType = body.MediaContentType0 ?? 'application/octet-stream'
  if (!mediaUrl) return null

  const auth = Buffer.from(`${TWILIO_CONFIG.accountSid}:${TWILIO_CONFIG.authToken}`).toString('base64')
  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`Failed to download Twilio media: HTTP ${response.status}`)

  const bytes = new Uint8Array(await response.arrayBuffer())
  const ext = extensionForMime(mimeType)
  return { bytes, fileName: `attachment.${ext}`, mimeType }
}

function extensionForMime(mimeType: string): string {
  const subtype = mimeType.split('/', 2)[1]?.split(';', 1)[0]?.toLowerCase() ?? 'bin'
  const aliases: Record<string, string> = { jpeg: 'jpg', quicktime: 'mov', mpeg: 'mp3', plain: 'txt' }
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

/** Public business number digits for wa.me links (no + or whatsapp: prefix). */
export function twilioBusinessNumberDigits(): string {
  const raw = TWILIO_CONFIG.whatsappNumber || ''
  return normalizePhoneE164(raw).replace(/\D/g, '')
}

export function isTwilioProvider(): boolean {
  return hasTwilioProvider()
}
