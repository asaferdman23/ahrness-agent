/**
 * The single platform-owned Telegram bot (TELEGRAM_BOT_TOKEN). Unlike the
 * per-client BYO bots in telegram.ts, many clients share this one bot — a
 * client's dashboard shows a "Connect Telegram" button that opens
 * `t.me/<bot>?start=<signed clientId>`. Tapping Start sends `/start <token>`
 * as the first message; we verify the token (same HMAC helper as onboarding
 * links — see onboarding/client-link.ts) and bind that chat to the client.
 * From then on it's the same conversation as any other channel.
 */
import { signClientToken, verifyClientToken } from './onboarding/client-link.js'
import * as tg from './telegram-client.js'
import type { TelegramMessage } from './telegram-client.js'
import { bindSharedTelegramChat, clientIdForSharedTelegramChat } from './telegram-store.js'
import { createTelegramTransport } from './telegram-transport.js'
import { deliverTelegramMessage, runTelegramPollLoop } from './telegram.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

export interface SharedTelegramBot {
  botUsername: string | null
  stop: () => void
}

let cachedBotUsername: string | null = null

/** The shared bot's @username, once startSharedTelegramBot has resolved. Null before boot or if unconfigured. */
export function sharedTelegramBotUsername(): string | null {
  return cachedBotUsername
}

/**
 * `t.me` deep link that binds the tapping client's account to the shared bot.
 * Null if no signing secret is configured (MEDIA_SIGNING_SECRET / HIGGSFIELD_SETUP_SECRET)
 * — same fallback as onboardingUrlFor in onboarding/client-link.ts.
 */
export function telegramConnectUrl(botUsername: string, clientId: string): string | null {
  try {
    return `https://t.me/${botUsername}?start=${signClientToken(clientId)}`
  } catch {
    return null
  }
}

/** Extract the `/start <payload>` argument, if any (also matches `/start@BotName <payload>`). */
export function startCommandPayload(text: string | undefined): string | null {
  if (!text) return null
  const match = text.match(/^\/start(?:@\S+)?(?:\s+(\S+))?/)
  return match?.[1] ?? null
}

export async function startSharedTelegramBot(botToken: string): Promise<SharedTelegramBot> {
  const me = await tg.getMe(botToken)
  cachedBotUsername = me.username ?? null
  console.log(`✓ Shared Telegram bot ready: @${cachedBotUsername ?? me.id}`)

  const transport: WhatsAppTransport = createTelegramTransport(botToken)

  async function handleMessage(msg: TelegramMessage): Promise<void> {
    const chatId = String(msg.chat.id)
    const payload = startCommandPayload(msg.text)

    if (payload) {
      const clientId = verifyClientToken(payload)
      if (!clientId) {
        await tg
          .sendMessage(botToken, chatId, "This connect link isn't valid — grab a fresh one from your dashboard.")
          .catch(() => {})
        return
      }
      await bindSharedTelegramChat(clientId, chatId)
      await tg
        .sendMessage(botToken, chatId, "Connected! I'm your assistant here now — message me anytime.")
        .catch(() => {})
      return
    }

    const clientId = await clientIdForSharedTelegramChat(chatId)
    if (!clientId) {
      await tg
        .sendMessage(
          botToken,
          chatId,
          'This bot is private. Get your personal connect link from your dashboard to talk to your assistant here.',
        )
        .catch(() => {})
      return
    }

    await deliverTelegramMessage({ clientId, chatId, botToken, transport, msg })
  }

  const { stop } = runTelegramPollLoop(botToken, handleMessage, 'shared')

  return { botUsername: cachedBotUsername, stop }
}
