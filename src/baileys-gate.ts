export type BaileysInboundDecision = {
  allowed: boolean
  reason?: string
  prompt?: string
  groupMode: boolean
  selfChat: boolean
  triggered: boolean
}

export type BaileysInboundGateInput = {
  remoteJid: string
  participantJid?: string | null
  text: string | null
  hasMedia: boolean
  mentionedJids?: string[]
  botJid?: string | null
  allowedGroupJids?: string
  /** Verified linked-account JID when “Message yourself” is the saved home chat. */
  allowedSelfJid?: string
  allowedParticipantJids?: string
  triggerAliases?: string
  groupOnly?: string
  requireTrigger?: string
  /** True after this selected group has explicitly addressed BizzClaw. */
  conversationActive?: boolean
}

const DEFAULT_CONVERSATION_TTL_MS = 30 * 60 * 1000

/**
 * Keeps a selected group conversational after its first explicit BizzClaw
 * mention. State is intentionally process-local and short-lived: a restart or
 * idle timeout returns to the safe mention-required state.
 */
export class BaileysConversationWindow {
  private readonly expiresAtByGroup = new Map<string, number>()

  constructor(private readonly ttlMs = baileysConversationTtlMs()) {}

  isActive(groupJid: string, now = Date.now()): boolean {
    const key = groupJid.toLowerCase()
    const expiresAt = this.expiresAtByGroup.get(key)
    if (!expiresAt || expiresAt <= now) {
      this.expiresAtByGroup.delete(key)
      return false
    }
    return true
  }

  touch(groupJid: string, now = Date.now()): void {
    if (!isWhatsAppGroupJid(groupJid) || this.ttlMs <= 0) return
    this.expiresAtByGroup.set(groupJid.toLowerCase(), now + this.ttlMs)
  }

  clear(groupJid: string): void {
    this.expiresAtByGroup.delete(groupJid.toLowerCase())
  }
}

export function baileysConversationTtlMs(value = process.env.BAILEYS_CONVERSATION_TTL_MS): number {
  if (value === undefined || value.trim() === '') return DEFAULT_CONVERSATION_TTL_MS
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_CONVERSATION_TTL_MS
}

export function isWhatsAppGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
}

export function effectiveAllowedGroupJids(
  configuredAllowedGroupJids: string | undefined,
  clientHomeGroupJid?: string,
): string | undefined {
  const configured = configuredAllowedGroupJids?.trim()
  if (configured) return configured
  return clientHomeGroupJid?.trim() || undefined
}

export function shouldProcessBaileysInbound(input: BaileysInboundGateInput): BaileysInboundDecision {
  const groupOnly = input.groupOnly ?? process.env.BAILEYS_GROUP_ONLY ?? 'true'
  const groupMode = groupOnly !== 'false'
  const text = input.text?.trim() ?? ''
  const trigger = matchTrigger({
    text,
    aliases: input.triggerAliases ?? process.env.BAILEYS_AGENT_TRIGGERS,
    mentionedJids: input.mentionedJids ?? [],
    botJid: input.botJid,
  })
  const isGroup = isWhatsAppGroupJid(input.remoteJid)
  const selfChat = Boolean(
    !isGroup && input.allowedSelfJid && sameWhatsAppUser(input.remoteJid, input.allowedSelfJid),
  )

  if (groupMode) {
    if (isGroup) {
      const allowedGroups = parseCsv(input.allowedGroupJids)
      if (allowedGroups.size === 0) {
        return { allowed: false, reason: 'group-not-configured', groupMode, selfChat, triggered: trigger.triggered }
      }
      if (!allowedGroups.has(input.remoteJid.toLowerCase())) {
        return { allowed: false, reason: 'group-not-allowed', groupMode, selfChat, triggered: trigger.triggered }
      }

      const allowedParticipants = parseCsv(input.allowedParticipantJids ?? process.env.BAILEYS_ALLOWED_GROUP_PARTICIPANTS)
      if (allowedParticipants.size > 0) {
        const participant = input.participantJid?.toLowerCase()
        if (!participant || !allowedParticipants.has(participant)) {
          return { allowed: false, reason: 'participant-not-allowed', groupMode, selfChat, triggered: trigger.triggered }
        }
      }
    } else if (!selfChat) {
      return { allowed: false, reason: 'direct-chat-blocked', groupMode, selfChat, triggered: trigger.triggered }
    }
  }

  const requireTrigger = input.requireTrigger ?? process.env.BAILEYS_REQUIRE_TRIGGER ?? 'true'
  if (requireTrigger !== 'false' && !selfChat && !trigger.triggered && !input.conversationActive) {
    return { allowed: false, reason: 'trigger-missing', groupMode, selfChat, triggered: false }
  }

  const prompt = trigger.prompt.trim() || (input.hasMedia ? 'Use the attached file to complete my request.' : 'Hi')
  return { allowed: true, prompt, groupMode, selfChat, triggered: trigger.triggered }
}

function parseCsv(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
}

function matchTrigger(input: {
  text: string
  aliases?: string
  mentionedJids: string[]
  botJid?: string | null
}): { triggered: boolean; prompt: string } {
  const aliases = (input.aliases ?? '@bizzclaw')
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean)

  const lowerText = input.text.toLowerCase()
  for (const alias of aliases) {
    const normalized = alias.toLowerCase()
    if (lowerText === normalized) return { triggered: true, prompt: '' }
    if (lowerText.startsWith(`${normalized} `)) {
      return { triggered: true, prompt: input.text.slice(alias.length).trim() }
    }
  }

  const botJid = input.botJid
  if (botJid && input.mentionedJids.some((jid) => sameWhatsAppUser(jid, botJid))) {
    const withoutMention = input.text.replace(/^@\S+\s*/, '').trim()
    return { triggered: true, prompt: withoutMention }
  }

  return { triggered: false, prompt: input.text }
}

export function sameWhatsAppUser(a: string, b: string): boolean {
  const left = bareUserId(a)
  const right = bareUserId(b)
  return left.length > 0 && left === right
}

function bareUserId(jid: string): string {
  return jid
    .split('@', 1)[0]
    .split(':', 1)[0]
    .replace(/\D/g, '')
}
