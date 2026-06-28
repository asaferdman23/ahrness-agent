export type WhatsAppProvider = 'twilio' | 'baileys'

const PROVIDERS: WhatsAppProvider[] = ['twilio', 'baileys']

export function configuredWhatsAppProviders(value = process.env.WHATSAPP_PROVIDER): WhatsAppProvider[] {
  const raw = (value ?? 'twilio').toLowerCase().trim()
  const tokens = raw === 'dual' || raw === 'all'
    ? PROVIDERS
    : raw.split(',').map((part) => part.trim()).filter(Boolean)

  const providers: WhatsAppProvider[] = []
  for (const token of tokens) {
    if (!isWhatsAppProvider(token)) continue
    if (!providers.includes(token)) providers.push(token)
  }
  return providers.length ? providers : ['twilio']
}

export function defaultWhatsAppProvider(value = process.env.WHATSAPP_PROVIDER): WhatsAppProvider {
  return configuredWhatsAppProviders(value)[0] ?? 'twilio'
}

export function isWhatsAppProvider(value: string): value is WhatsAppProvider {
  return (PROVIDERS as string[]).includes(value)
}

export function isTwilioProvider(value = process.env.WHATSAPP_PROVIDER): boolean {
  return configuredWhatsAppProviders(value).includes('twilio')
}

export function isBaileysProvider(value = process.env.WHATSAPP_PROVIDER): boolean {
  return configuredWhatsAppProviders(value).includes('baileys')
}
