/**
 * Slack send API, shaped like WhatsAppTransport so it plugs into the same
 * runAndDeliver/scheduler delivery path (see delivery.ts). Mirrors
 * telegram-transport.ts.
 */
import { decodeClientChannelAddress } from './channel-address.js'
import { extensionForMime } from './mime-utils.js'
import * as slack from './slack-client.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

/**
 * Extract the raw Slack channel id (and, for a threaded channel/group reply, the
 * thread's root `ts`) from a synthetic `agent-client:...:slack:<channelId>` or
 * `agent-client:...:slack:<channelId>:<threadTs>` address.
 */
function channelFor(address: string): { channelId: string; threadTs?: string } {
  const decoded = decodeClientChannelAddress(address)
  if (!decoded || decoded.channel !== 'slack') {
    throw new Error(`Not a Slack channel address: ${address}`)
  }
  const [channelId, threadTs] = decoded.channelAddress.split(':')
  return { channelId: channelId!, threadTs }
}

export function createSlackTransport(botToken: string): WhatsAppTransport {
  return {
    async sendText(address, text) {
      const { channelId, threadTs } = channelFor(address)
      await slack.postMessage(botToken, channelId, text, threadTs)
    },
    async sendImage(address, data, mimeType, caption) {
      const { channelId, threadTs } = channelFor(address)
      await slack.uploadFile(botToken, channelId, data, `image.${extensionForMime(mimeType)}`, mimeType, caption, threadTs)
    },
    async sendVideo(address, data, mimeType, caption) {
      const { channelId, threadTs } = channelFor(address)
      await slack.uploadFile(botToken, channelId, data, `video.${extensionForMime(mimeType)}`, mimeType, caption, threadTs)
    },
    async sendAudio(address, data, mimeType) {
      const { channelId, threadTs } = channelFor(address)
      await slack.uploadFile(botToken, channelId, data, `audio.${extensionForMime(mimeType)}`, mimeType, undefined, threadTs)
    },
    async sendDocument(address, data, mimeType, fileName, caption) {
      const { channelId, threadTs } = channelFor(address)
      await slack.uploadFile(botToken, channelId, data, fileName, mimeType, caption, threadTs)
    },
  }
}
