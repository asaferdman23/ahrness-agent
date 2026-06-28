/**
 * BizzClaw Agent — entry point
 */
import 'dotenv/config'
import { initDb } from './db/index.js'
import { startCallbackServer } from './callback-server.js'
import { startScheduler } from './scheduler/index.js'
import { createTwilioTransport, twilioWebhookUrl, validateTwilioConfig } from './twilio-whatsapp.js'
import { startBaileysWhatsApp } from './whatsapp.js'
import { createRoutingWhatsAppTransport, type WhatsAppTransportMap } from './whatsapp-router.js'
import { configuredWhatsAppProviders, defaultWhatsAppProvider } from './whatsapp-providers.js'
import { runStartupChecks } from './startup-checks.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

async function main(): Promise<void> {
  console.log(`Starting ${process.env.AGENT_NAME ?? 'BizzClaw'} Agent…`)
  initDb()
  runStartupChecks()

  const providers = configuredWhatsAppProviders()
  const transports: WhatsAppTransportMap = {}

  if (providers.includes('twilio')) {
    validateTwilioConfig()
    transports.twilio = createTwilioTransport()
    console.log(`✓ Twilio WhatsApp Business API ready`)
    console.log(`  Configure Twilio webhook → ${twilioWebhookUrl()}`)
  }

  if (providers.includes('baileys')) {
    transports.baileys = await startBaileysWhatsApp()
  }

  const transport: WhatsAppTransport = createRoutingWhatsAppTransport(transports, defaultWhatsAppProvider())
  startCallbackServer(transport)
  startScheduler(transport)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
