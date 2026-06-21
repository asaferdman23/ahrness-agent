/**
 * Ahrness Agent — entry point
 *
 * Flow:
 *   1. Start OAuth callback server (handles Meta auth redirects)
 *   2. Connect to WhatsApp via Baileys
 *   3. Each inbound message:
 *      - No token yet → send client the Meta OAuth link
 *      - Token exists → invoke agent with their Meta Ads MCP + Higgsfield MCP
 */
import 'dotenv/config'
import { startWhatsApp } from './whatsapp.js'
import { startCallbackServer } from './callback-server.js'

async function main(): Promise<void> {
  console.log(`Starting ${process.env.AGENT_NAME ?? 'Ahrness'} Agent…`)

  // Start OAuth callback server first so it's ready before any client tries to auth
  // startCallbackServer needs the WhatsApp socket to send confirmation messages,
  // so we pass it after WhatsApp connects
  const socket = await startWhatsApp()
  startCallbackServer(socket)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
