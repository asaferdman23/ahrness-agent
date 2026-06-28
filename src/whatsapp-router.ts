import { clientIdFromJid, getClientMeta } from './store/client-store.js'
import type { WhatsAppProvider } from './whatsapp-providers.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

export type WhatsAppTransportMap = Partial<Record<WhatsAppProvider, WhatsAppTransport>>

export function createRoutingWhatsAppTransport(
  transports: WhatsAppTransportMap,
  defaultProvider: WhatsAppProvider,
): WhatsAppTransport {
  async function pick(jid: string): Promise<WhatsAppTransport> {
    const clientId = clientIdFromJid(jid)
    const preferred = (await getClientMeta(clientId)).whatsappProvider
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
