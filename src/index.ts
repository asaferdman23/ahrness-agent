/**
 * BizzClaw Agent — entry point
 */
import 'dotenv/config'
import { initDb } from './db/index.js'
import { openDb, createSqliteStore } from '@agent-live/sdk'
import path from 'node:path'
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
import { startSharedTelegramBot } from './telegram-shared-bot.js'

async function main(): Promise<void> {
  console.log(`Starting ${process.env.AGENT_NAME ?? 'BizzClaw'} Agent…`)
  initDb()
  runStartupChecks()

  // Recover from a crash: any run left `running` from a prior process is stale.
  const agentLiveDbPath = process.env.AGENT_LIVE_DB ?? path.join(process.env.AGENT_STORE_DIR ?? './store', 'agent-live.sqlite')
  const staleRuns = createSqliteStore(openDb(agentLiveDbPath)).markStaleRunsOnStartup()
  if (staleRuns > 0) console.log(`✓ Marked ${staleRuns} interrupted run(s) as stale`)

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
  const restoredBaileys = await baileysManager.restoreSockets()
  if (restoredBaileys.restored.length > 0) {
    console.log(`✓ Restored ${restoredBaileys.restored.length} linked Baileys client session(s)`)
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

  // Shared Telegram bot (optional): one platform-owned bot clients connect to
  // via a "Connect Telegram" deep link from the dashboard, instead of bringing
  // their own bot token.
  let sharedTelegramBot: { stop: () => void } | null = null
  if (process.env.TELEGRAM_BOT_TOKEN) {
    sharedTelegramBot = await startSharedTelegramBot(process.env.TELEGRAM_BOT_TOKEN)
  }

  // Graceful shutdown — stop all Baileys sockets and Telegram bots.
  const shutdown = () => {
    baileysManager?.stopAll()
    telegramManager.stopAll()
    sharedTelegramBot?.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
