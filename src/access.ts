/**
 * Sender allowlist — gates who the agent will engage with over WhatsApp.
 *
 * The bot runs as a linked device of a WhatsApp account, so without a gate it
 * would respond to *anyone* who messages that number. `AGENT_ALLOWED_SENDERS`
 * (comma-separated phone numbers / JIDs) restricts it to known senders.
 *
 *   - set   → restricted: only listed senders are served, others are ignored.
 *   - unset → open: everyone is served (a loud warning is logged once).
 */
import { normalizePhoneE164 } from './whatsapp-address.js'

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

/** Test hook: clear the one-time open-mode warning latch. */
export function resetAccessWarningForTests(): void {
  warnedOpen = false
}
