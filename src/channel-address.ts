/**
 * Synthetic channel-agnostic address for non-WhatsApp channels (Telegram, Slack).
 *
 * `runAndDeliver` and `buildClientAgent` both take a "jid" string and resolve
 * identity via `clientIdForJid(jid)`. For WhatsApp that lookup hits the tenant
 * table / falls back to a hash. For a channel where the clientId is already
 * known up front (one Telegram bot per client, one Slack workspace install per
 * client), we encode it directly into the address so every call site agrees
 * without touching the WhatsApp-specific tenant table.
 *
 * Format: agent-client:<clientId>:<channel>:<channelAddress>
 * `channelAddress` itself may contain colons (e.g. Slack `team:channel:user`),
 * so it is everything after the third colon.
 */

export type ExternalChannel = 'telegram' | 'slack'

const PREFIX = 'agent-client:'

export interface ClientChannelAddress {
  clientId: string
  channel: ExternalChannel
  channelAddress: string
}

export function encodeClientChannelAddress(
  clientId: string,
  channel: ExternalChannel,
  channelAddress: string,
): string {
  return `${PREFIX}${clientId}:${channel}:${channelAddress}`
}

export function isClientChannelAddress(address: string): boolean {
  return address.startsWith(PREFIX)
}

export function decodeClientChannelAddress(address: string): ClientChannelAddress | null {
  if (!address.startsWith(PREFIX)) return null
  const rest = address.slice(PREFIX.length)
  const [clientId, channel, ...addressParts] = rest.split(':')
  if (!clientId || !channel || addressParts.length === 0) return null
  return { clientId, channel: channel as ExternalChannel, channelAddress: addressParts.join(':') }
}
