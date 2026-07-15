/**
 * Slack send API, shaped like WhatsAppTransport so it plugs into the same
 * runAndDeliver/scheduler delivery path (see delivery.ts). Mirrors
 * telegram-transport.ts.
 */
import { decodeClientChannelAddress } from './channel-address.js'
import { extensionForMime } from './mime-utils.js'
import * as slack from './slack-client.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

/** Extract the raw Slack channel id from a synthetic `agent-client:...:slack:<channelId>` address. */
function channelIdFor(address: string): string {
  const decoded = decodeClientChannelAddress(address)
  if (!decoded || decoded.channel !== 'slack') {
    throw new Error(`Not a Slack channel address: ${address}`)
  }
  return decoded.channelAddress
}

export function createSlackTransport(botToken: string): WhatsAppTransport {
  return {
    async sendText(address, text) {
      await slack.postMessage(botToken, channelIdFor(address), text)
    },
    async sendImage(address, data, mimeType, caption) {
      await slack.uploadFile(botToken, channelIdFor(address), data, `image.${extensionForMime(mimeType)}`, mimeType, caption)
    },
    async sendVideo(address, data, mimeType, caption) {
      await slack.uploadFile(botToken, channelIdFor(address), data, `video.${extensionForMime(mimeType)}`, mimeType, caption)
    },
    async sendAudio(address, data, mimeType) {
      await slack.uploadFile(botToken, channelIdFor(address), data, `audio.${extensionForMime(mimeType)}`, mimeType)
    },
    async sendDocument(address, data, mimeType, fileName, caption) {
      await slack.uploadFile(botToken, channelIdFor(address), data, fileName, mimeType, caption)
    },
  }
}
