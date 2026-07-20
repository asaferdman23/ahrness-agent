/**
 * Trigger gate for Slack channel/group messages — DMs are always processed by
 * slack.ts directly, but a channel or private group requires an explicit
 * @mention before BizzClaw replies. One accepted mention opens a short
 * conversational window (keyed by channel + user) so follow-ups don't need
 * another @mention. Mirrors baileys-gate.ts's mention-then-window pattern.
 */

export type SlackChannelInboundDecision = {
  allowed: boolean
  reason?: string
  prompt: string
  triggered: boolean
}

export type SlackChannelInboundInput = {
  text: string | null
  hasFile: boolean
  /** The bot's own Slack user id (e.g. `U012AB3CD`), used to detect `<@U012AB3CD>` mentions. */
  botUserId?: string | null
  /** True when a conversation window is currently open for this channel + user. */
  conversationActive?: boolean
}

const DEFAULT_CONVERSATION_TTL_MS = 30 * 60 * 1000

/**
 * Keeps a channel conversational, per (channel, user), after that user's first
 * explicit @mention of the bot. State is process-local and short-lived: a
 * restart or idle timeout returns to the safe mention-required state.
 */
export class SlackConversationWindow {
  private readonly windowByKey = new Map<string, { expiresAt: number; threadTs: string }>()

  constructor(private readonly ttlMs = slackConversationTtlMs()) {}

  private key(channelId: string, userId: string): string {
    return `${channelId}:${userId}`
  }

  /** The thread to reply in, if this (channel, user) has an active window. */
  activeThreadTs(channelId: string, userId: string, now = Date.now()): string | null {
    const key = this.key(channelId, userId)
    const entry = this.windowByKey.get(key)
    if (!entry || entry.expiresAt <= now) {
      this.windowByKey.delete(key)
      return null
    }
    return entry.threadTs
  }

  isActive(channelId: string, userId: string, now = Date.now()): boolean {
    return this.activeThreadTs(channelId, userId, now) !== null
  }

  /** Open or extend the window, recording (or refreshing) which thread replies belong in. */
  touch(channelId: string, userId: string, threadTs: string, now = Date.now()): void {
    if (this.ttlMs <= 0) return
    this.windowByKey.set(this.key(channelId, userId), { expiresAt: now + this.ttlMs, threadTs })
  }

  clear(channelId: string, userId: string): void {
    this.windowByKey.delete(this.key(channelId, userId))
  }
}

export function slackConversationTtlMs(value = process.env.SLACK_CONVERSATION_TTL_MS): number {
  if (value === undefined || value.trim() === '') return DEFAULT_CONVERSATION_TTL_MS
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_CONVERSATION_TTL_MS
}

/** Does `text` contain an explicit `<@botUserId>` mention? Returns the text with the mention stripped. */
function matchMention(text: string, botUserId: string | null | undefined): { mentioned: boolean; prompt: string } {
  if (!botUserId) return { mentioned: false, prompt: text }
  const mentionPattern = new RegExp(`<@${botUserId}>`, 'g')
  if (!mentionPattern.test(text)) return { mentioned: false, prompt: text }
  const prompt = text.replace(mentionPattern, '').trim()
  return { mentioned: true, prompt }
}

/**
 * Decide whether a channel/group message should reach the agent. DMs never go
 * through this — call sites keep those unconditional, mirroring the `im`
 * fast-path already in slack.ts.
 */
export function shouldProcessSlackChannelMessage(input: SlackChannelInboundInput): SlackChannelInboundDecision {
  const text = input.text?.trim() ?? ''
  const mention = matchMention(text, input.botUserId)

  if (!mention.mentioned && !input.conversationActive) {
    return { allowed: false, reason: 'mention-missing', prompt: text, triggered: false }
  }

  const prompt = mention.mentioned
    ? mention.prompt || (input.hasFile ? 'Use the attached file to complete my request.' : 'Hi')
    : text || (input.hasFile ? 'Use the attached file to complete my request.' : 'Hi')

  return { allowed: true, prompt, triggered: mention.mentioned }
}
