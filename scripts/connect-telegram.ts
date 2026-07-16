/**
 * Operator script: connect a client's Telegram bot (BotFather token) without
 * a self-serve UI. Validates the token against the Telegram API before
 * saving it, encrypted, under store/clients/<clientId>/telegram.json.
 *
 * Usage:
 *   npm run connect:telegram -- <clientId> <botToken>
 *
 * The bot starts polling on the next `npm start` (or immediately if you wire
 * telegramSessionManager().ensureBot(clientId) into a running process).
 */
import 'dotenv/config'
import { getMe } from '../src/telegram-client.js'
import { saveTelegramBotToken } from '../src/telegram-store.js'

async function main(): Promise<void> {
  const [clientId, botToken] = process.argv.slice(2)
  if (!clientId || !botToken) {
    console.error('Usage: npm run connect:telegram -- <clientId> <botToken>')
    process.exit(1)
  }

  const me = await getMe(botToken)
  await saveTelegramBotToken(clientId, botToken, me.username)

  console.log(`✓ Connected @${me.username ?? me.id} to client ${clientId}`)
  console.log('  Message the bot from the account that should own it — the first sender is bound as the owner.')
}

main().catch((err) => {
  console.error('Failed to connect Telegram bot:', err instanceof Error ? err.message : err)
  process.exit(1)
})
