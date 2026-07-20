import type { ClientMeta } from './store/types.js'

export type BaileysHomeChatKind = 'self' | 'group'

export type BaileysHomeChat = {
  jid: string
  kind: BaileysHomeChatKind
  subject: string
  boundAt?: string
}

/** Resolve the current home destination, including legacy group-only records. */
export function baileysHomeChatFromMeta(meta: ClientMeta): BaileysHomeChat | null {
  if (meta.baileysHomeChatJid && meta.baileysHomeChatKind) {
    return {
      jid: meta.baileysHomeChatJid,
      kind: meta.baileysHomeChatKind,
      subject: meta.baileysHomeChatSubject || (meta.baileysHomeChatKind === 'self' ? 'Message yourself' : 'WhatsApp group'),
      boundAt: meta.baileysHomeChatBoundAt,
    }
  }

  if (meta.baileysHomeGroupJid) {
    return {
      jid: meta.baileysHomeGroupJid,
      kind: 'group',
      subject: meta.baileysHomeGroupSubject || 'WhatsApp group',
      boundAt: meta.baileysHomeGroupBoundAt,
    }
  }

  return null
}

/** Save one destination and clear fields belonging to the other mode. */
export function baileysHomeChatPatch(chat: BaileysHomeChat): Partial<ClientMeta> {
  const boundAt = chat.boundAt ?? new Date().toISOString()
  return {
    baileysHomeChatJid: chat.jid,
    baileysHomeChatKind: chat.kind,
    baileysHomeChatSubject: chat.subject,
    baileysHomeChatBoundAt: boundAt,
    // Keep legacy group fields populated only for existing installations and
    // older readers while the universal home-chat fields roll out.
    baileysHomeGroupJid: chat.kind === 'group' ? chat.jid : undefined,
    baileysHomeGroupSubject: chat.kind === 'group' ? chat.subject : undefined,
    baileysHomeGroupBoundAt: chat.kind === 'group' ? boundAt : undefined,
  }
}

export function clearBaileysHomeChatPatch(): Partial<ClientMeta> {
  return {
    baileysHomeChatJid: undefined,
    baileysHomeChatKind: undefined,
    baileysHomeChatSubject: undefined,
    baileysHomeChatBoundAt: undefined,
    baileysHomeGroupJid: undefined,
    baileysHomeGroupSubject: undefined,
    baileysHomeGroupBoundAt: undefined,
  }
}
