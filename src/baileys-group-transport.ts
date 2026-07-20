import { getClientMeta } from './store/client-store.js'
import type { ClientMeta } from './store/types.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

type MetaLoader = (clientId: string) => Promise<ClientMeta>

/**
 * Fail-closed wrapper for a client's Baileys socket.
 *
 * Baileys can technically send to any chat visible to the linked account. The
 * product contract is narrower: one tenant, one explicitly selected group.
 * Enforcing that rule here protects replies, scheduled work, media, and future
 * outbound call sites instead of relying only on the inbound message gate.
 */
export function createBaileysGroupTransport(
  clientId: string,
  transport: WhatsAppTransport,
  loadMeta: MetaLoader = getClientMeta,
): WhatsAppTransport {
  async function assertAllowedGroup(jid: string): Promise<void> {
    const selected = (await loadMeta(clientId)).baileysHomeGroupJid?.trim().toLowerCase()
    if (!selected) {
      throw new Error('Baileys delivery blocked: no WhatsApp group has been selected for this client')
    }
    if (!selected.endsWith('@g.us') || jid.trim().toLowerCase() !== selected) {
      throw new Error('Baileys delivery blocked: destination is not the client selected WhatsApp group')
    }
  }

  return {
    async sendText(jid, text) {
      await assertAllowedGroup(jid)
      await transport.sendText(jid, text)
    },
    async sendImage(jid, data, mimeType, caption) {
      await assertAllowedGroup(jid)
      await transport.sendImage(jid, data, mimeType, caption)
    },
    async sendVideo(jid, data, mimeType, caption) {
      await assertAllowedGroup(jid)
      await transport.sendVideo(jid, data, mimeType, caption)
    },
    async sendAudio(jid, data, mimeType) {
      await assertAllowedGroup(jid)
      await transport.sendAudio(jid, data, mimeType)
    },
    async sendDocument(jid, data, mimeType, fileName, caption) {
      await assertAllowedGroup(jid)
      await transport.sendDocument(jid, data, mimeType, fileName, caption)
    },
  }
}
