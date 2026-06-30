import { getClientMeta } from './store/client-store.js'
import { clientIdForJid } from './tenant-store.js'
import type { WhatsAppProvider } from './whatsapp-providers.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'
import type { BaileysSessionManager } from './baileys-manager.js'

export type WhatsAppTransportMap = Partial<Record<WhatsAppProvider, WhatsAppTransport>>

export type RoutingTransportOptions = {
  /** Per-client Baileys socket manager. When set, baileys outbound is routed
   * to the client's own socket instead of a single shared transport. */
  baileysManager?: BaileysSessionManager
}

export function createRoutingWhatsAppTransport(
  transports: WhatsAppTransportMap,
  defaultProvider: WhatsAppProvider,
  options: RoutingTransportOptions = {},
): WhatsAppTransport {
  const { baileysManager } = options

  async function pick(jid: string): Promise<WhatsAppTransport> {
    const clientId = await clientIdForJid(jid)
    const preferred = (await getClientMeta(clientId)).whatsappProvider

    // If the client prefers baileys and we have a per-client manager, route
    // outbound to that client's own socket (BYO number).
    if (preferred === 'baileys' && baileysManager) {
      const session = baileysManager.get(clientId)
      if (session) return session.transport
      // Fall through to default if the client's socket isn't running yet.
    }

    const provider = preferred && transports[preferred] ? preferred : defaultProvider
    const transport = transports[provider] ?? transports.twilio ?? transports.baileys
    if (!transport) throw new Error('No WhatsApp transport is available')
    return transport
  }

  return {
    async sendText(jid, text) {
      await (await pick(jid)).sendText(jid, text)
    },
    async sendImage(jid, data, mimeType, caption) {
      await (await pick(jid)).sendImage(jid, data, mimeType, caption)
    },
    async sendVideo(jid, data, mimeType, caption) {
      await (await pick(jid)).sendVideo(jid, data, mimeType, caption)
    },
    async sendAudio(jid, data, mimeType) {
      await (await pick(jid)).sendAudio(jid, data, mimeType)
    },
    async sendDocument(jid, data, mimeType, fileName, caption) {
      await (await pick(jid)).sendDocument(jid, data, mimeType, fileName, caption)
    },
  }
}
