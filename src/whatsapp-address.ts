/**
 * Canonical WhatsApp client addresses.
 *
 * Baileys uses JIDs (`972501234567@s.whatsapp.net`). Twilio uses
 * `whatsapp:+972501234567`. We normalize to JID so clientId hashing stays
 * stable across providers.
 */

/** Strip `whatsapp:` and normalize to E.164 (`+digits`). */
export function normalizePhoneE164(phone: string): string {
  let digits = phone.replace(/^whatsapp:/i, '').replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`
  return `+${digits}`
}

/** `+972501234567` → `972501234567@s.whatsapp.net` */
export function phoneToJid(phone: string): string {
  const e164 = normalizePhoneE164(phone)
  return `${e164.replace(/\D/g, '')}@s.whatsapp.net`
}

/** `972501234567@s.whatsapp.net` → `whatsapp:+972501234567` */
export function jidToTwilioAddress(jid: string): string {
  const digits = jid.replace(/@.*$/, '').replace(/\D/g, '')
  return `whatsapp:+${digits}`
}

/** Accept JID or Twilio `whatsapp:+…` address. */
export function toJid(address: string): string {
  if (address.includes('@')) return address
  return phoneToJid(address)
}
