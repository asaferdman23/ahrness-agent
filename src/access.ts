/**
 * Sender access policy — gates who the agent will engage with over WhatsApp.
 *
 * The bot runs behind a WhatsApp number, so normal inbound messages should only
 * be served when the sender is allowlisted or linked to an authenticated tenant.
 *
 * `isSenderAllowed` is the legacy allowlist primitive. Runtime handlers should
 * use `isInboundSenderAllowed`, which fails closed unless an explicit demo env
 * flag allows unlinked senders.
 */
import { normalizePhoneE164 } from './whatsapp-address.js'
import { tenantIdForJid } from './tenant-store.js'

/** Reduce any address form (JID, +E164, whatsapp:+…, leading-zero local) to bare digits. */
function toDigits(addressOrJid: string): string {
  const beforeAt = addressOrJid.replace(/@.*$/, '')
  return normalizePhoneE164(beforeAt).replace(/\D/g, '')
}

export function allowlistMode(): 'open' | 'restricted' {
  return process.env.AGENT_ALLOWED_SENDERS?.trim() ? 'restricted' : 'open'
}

let warnedOpen = false

export function isSenderAllowed(jid: string): boolean {
  const raw = process.env.AGENT_ALLOWED_SENDERS?.trim()
  if (!raw) {
    if (!warnedOpen) {
      console.warn(
        '[access] AGENT_ALLOWED_SENDERS is not set — allowlist is OPEN; anyone who messages this number will be served. Set it before production.',
      )
      warnedOpen = true
    }
    return true
  }
  const allowed = new Set(
    raw
      .split(',')
      .map((entry) => toDigits(entry))
      .filter(Boolean),
  )
  return allowed.has(toDigits(jid))
}

/**
 * Production gate for normal inbound WhatsApp messages.
 *
 * A configured allowlist is the strongest local control. Without one, require a
 * linked tenant unless AGENT_ALLOW_UNLINKED_SENDERS=true is explicitly set for
 * demos or early bring-up.
 */
export async function isInboundSenderAllowed(jid: string): Promise<boolean> {
  if (process.env.AGENT_ALLOWED_SENDERS?.trim()) return isSenderAllowed(jid)

  if (process.env.AGENT_ALLOW_UNLINKED_SENDERS === 'true') {
    if (!warnedOpen) {
      console.warn(
        '[access] AGENT_ALLOW_UNLINKED_SENDERS=true — unlinked WhatsApp senders can invoke the agent.',
      )
      warnedOpen = true
    }
    return true
  }

  if (await tenantIdForJid(jid)) return true

  console.warn(`[access] blocked unlinked WhatsApp sender ${jid}; link onboarding first or set AGENT_ALLOWED_SENDERS`)
  return false
}

/** Test hook: clear the one-time open-mode warning latch. */
export function resetAccessWarningForTests(): void {
  warnedOpen = false
}
