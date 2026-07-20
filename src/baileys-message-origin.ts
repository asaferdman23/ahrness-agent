const MAX_TRACKED_AGENT_MESSAGES = 500

/** Remember an outbound message created by this agent socket. The bounded set
 * prevents a long-running tenant session from accumulating message ids. */
export function rememberAgentMessageId(messageIds: Set<string>, messageId: string | null | undefined): void {
  if (!messageId) return
  messageIds.add(messageId)
  while (messageIds.size > MAX_TRACKED_AGENT_MESSAGES) {
    const oldest = messageIds.values().next().value as string | undefined
    if (!oldest) break
    messageIds.delete(oldest)
  }
}

/**
 * Baileys marks both agent-authored sends and messages typed by the owner on
 * their primary phone as `fromMe`. Ignore only ids produced by this socket so
 * the owner can still address BizzClaw from the phone that scanned the QR.
 */
export function consumeAgentAuthoredMessage(
  messageIds: Set<string>,
  fromMe: boolean | null | undefined,
  messageId: string | null | undefined,
): boolean {
  if (!fromMe || !messageId) return false
  return messageIds.delete(messageId)
}
