import { getClientMeta } from './store/client-store.js'
import type { ClientMeta } from './store/types.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'
import { baileysHomeChatFromMeta } from './baileys-home-chat.js'
import { sameWhatsAppUser } from './baileys-gate.js'

type MetaLoader = (clientId: string) => Promise<ClientMeta>

/**
 * Fail-closed wrapper for a client's Baileys socket.
 *
 * Baileys can technically send to any chat visible to the linked account. The
 * product contract is narrower: one tenant, one explicitly selected home chat
 * (the linked account's self-chat or one verified group).
 * Enforcing that rule here protects replies, scheduled work, media, and future
 * outbound call sites instead of relying only on the inbound message gate.
 */
export function createBaileysHomeChatTransport(
  clientId: string,
  transport: WhatsAppTransport,
  loadMeta: MetaLoader = getClientMeta,
): WhatsAppTransport {
  async function assertAllowedHomeChat(jid: string): Promise<void> {
    const selected = baileysHomeChatFromMeta(await loadMeta(clientId))
    if (!selected) {
      throw new Error('Baileys delivery blocked: no WhatsApp workspace has been selected for this client')
    }
    const destination = jid.trim().toLowerCase()
    const allowed = selected.kind === 'group'
      ? selected.jid.endsWith('@g.us') && destination === selected.jid.toLowerCase()
      : !destination.endsWith('@g.us') && sameWhatsAppUser(destination, selected.jid)
    if (!allowed) {
      throw new Error('Baileys delivery blocked: destination is not the client selected WhatsApp workspace')
    }
  }

  return {
    async sendText(jid, text) {
      await assertAllowedHomeChat(jid)
      await transport.sendText(jid, text)
    },
    async sendImage(jid, data, mimeType, caption) {
      await assertAllowedHomeChat(jid)
      await transport.sendImage(jid, data, mimeType, caption)
    },
    async sendVideo(jid, data, mimeType, caption) {
      await assertAllowedHomeChat(jid)
      await transport.sendVideo(jid, data, mimeType, caption)
    },
    async sendAudio(jid, data, mimeType) {
      await assertAllowedHomeChat(jid)
      await transport.sendAudio(jid, data, mimeType)
    },
    async sendDocument(jid, data, mimeType, fileName, caption) {
      await assertAllowedHomeChat(jid)
      await transport.sendDocument(jid, data, mimeType, fileName, caption)
    },
  }
}

/** @deprecated Use createBaileysHomeChatTransport. */
export const createBaileysGroupTransport = createBaileysHomeChatTransport
