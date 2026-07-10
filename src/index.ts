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
import { telegramSessionManager } from './telegram-manager.js'
import { listConnectedTelegramClients } from './telegram-store.js'

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

  // Baileys is per-client (BYO number) and always available — a client can
  // choose Baileys from onboarding even when the global default is Twilio.
  // The manager lazily starts one socket per clientId on demand.
  const baileysManager = baileysSessionManager()
  if (providers.includes('baileys')) {
    console.log(`✓ Baileys per-client manager ready (default provider)`)
  } else {
    console.log(`✓ Baileys per-client manager ready (available on request)`)
  }

  const transport: WhatsAppTransport = createRoutingWhatsAppTransport(
    transports,
    defaultWhatsAppProvider(),
    { baileysManager },
  )
  startCallbackServer(transport)
  startScheduler(transport)

  // Telegram: one bot per client (BYO token via BotFather, connected out of
  // band — see telegram-store.ts). Start polling for everyone already
  // connected; new connections start their own bot when saved.
  const telegramManager = telegramSessionManager()
  const telegramClients = await listConnectedTelegramClients()
  if (telegramClients.length) {
    console.log(`✓ Starting ${telegramClients.length} Telegram bot(s)…`)
    for (const clientId of telegramClients) {
      telegramManager.ensureBot(clientId).catch((err) => {
        console.error(`[telegram][client ${clientId}] failed to start:`, err)
      })
    }
  }

  // Graceful shutdown — stop all Baileys sockets and Telegram bots.
  const shutdown = () => {
    baileysManager?.stopAll()
    telegramManager.stopAll()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
