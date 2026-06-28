export type BaileysInboundDecision = {
  allowed: boolean
  reason?: string
  prompt?: string
  groupMode: boolean
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
  allowedParticipantJids?: string
  triggerAliases?: string
  groupOnly?: string
  requireTrigger?: string
}

export function isWhatsAppGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
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

  if (groupMode) {
    if (!isWhatsAppGroupJid(input.remoteJid)) {
      return { allowed: false, reason: 'direct-chat-blocked', groupMode, triggered: trigger.triggered }
    }

    const allowedGroups = parseCsv(input.allowedGroupJids ?? process.env.BAILEYS_ALLOWED_GROUP_JIDS)
    if (allowedGroups.size === 0) {
      return { allowed: false, reason: 'group-not-configured', groupMode, triggered: trigger.triggered }
    }
    if (!allowedGroups.has(input.remoteJid.toLowerCase())) {
      return { allowed: false, reason: 'group-not-allowed', groupMode, triggered: trigger.triggered }
    }

    const allowedParticipants = parseCsv(input.allowedParticipantJids ?? process.env.BAILEYS_ALLOWED_GROUP_PARTICIPANTS)
    if (allowedParticipants.size > 0) {
      const participant = input.participantJid?.toLowerCase()
      if (!participant || !allowedParticipants.has(participant)) {
        return { allowed: false, reason: 'participant-not-allowed', groupMode, triggered: trigger.triggered }
      }
    }
  }

  const requireTrigger = input.requireTrigger ?? process.env.BAILEYS_REQUIRE_TRIGGER ?? 'true'
  if (requireTrigger !== 'false' && !trigger.triggered) {
    return { allowed: false, reason: 'trigger-missing', groupMode, triggered: false }
  }

  const prompt = trigger.prompt.trim() || (input.hasMedia ? 'Use the attached file to complete my request.' : 'Hi')
  return { allowed: true, prompt, groupMode, triggered: trigger.triggered }
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

function sameWhatsAppUser(a: string, b: string): boolean {
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
