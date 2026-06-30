/**
 * BizzClaw Agent — entry point
 */
import 'dotenv/config'
import { initDb } from './db/index.js'
import { startCallbackServer } from './callback-server.js'
import { startScheduler } from './scheduler/index.js'
import { createTwilioTransport, twilioWebhookUrl, validateTwilioConfig } from './twilio-whatsapp.js'
import { baileysSessionManager } from './baileys-manager.js'
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

  // Baileys is per-client (BYO number). The manager lazily starts one socket
  // per clientId on demand; no shared socket is booted at startup.
  const baileysManager = providers.includes('baileys') ? baileysSessionManager() : undefined
  if (baileysManager) {
    console.log(`✓ Baileys per-client manager ready (BYO number mode)`)
  }

  const transport: WhatsAppTransport = createRoutingWhatsAppTransport(
    transports,
    defaultWhatsAppProvider(),
    baileysManager ? { baileysManager } : {},
  )
  startCallbackServer(transport)
  startScheduler(transport)

  // Graceful shutdown — stop all Baileys sockets.
  const shutdown = () => {
    baileysManager?.stopAll()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
