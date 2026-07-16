/**
 * Telegram send API, shaped like WhatsAppTransport so it plugs into the same
 * runAndDeliver/scheduler delivery path (see delivery.ts).
 */
import { decodeClientChannelAddress } from './channel-address.js'
import * as tg from './telegram-client.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

/** Extract the raw Telegram chat id from a synthetic `agent-client:...:telegram:<chatId>` address. */
function chatIdFor(address: string): string {
  const decoded = decodeClientChannelAddress(address)
  if (!decoded || decoded.channel !== 'telegram') {
    throw new Error(`Not a Telegram channel address: ${address}`)
  }
  return decoded.channelAddress
}

export function createTelegramTransport(botToken: string): WhatsAppTransport {
  return {
    async sendText(address, text) {
      await tg.sendMessage(botToken, chatIdFor(address), text)
    },
    async sendImage(address, data, mimeType, caption) {
      await tg.sendPhoto(botToken, chatIdFor(address), data, mimeType, caption)
    },
    async sendVideo(address, data, mimeType, caption) {
      await tg.sendVideo(botToken, chatIdFor(address), data, mimeType, caption)
    },
    async sendAudio(address, data, mimeType) {
      await tg.sendAudio(botToken, chatIdFor(address), data, mimeType)
    },
    async sendDocument(address, data, mimeType, fileName, caption) {
      await tg.sendDocument(botToken, chatIdFor(address), data, mimeType, fileName, caption)
    },
  }
}
