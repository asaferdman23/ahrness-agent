import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { encodeClientChannelAddress } from './channel-address.js'
import { createTelegramTransport } from './telegram-transport.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test('sendText posts to the Telegram API with the decoded chat id', async () => {
  const calls: Array<{ url: string; body: unknown }> = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return jsonResponse({ ok: true, result: {} })
  }) as typeof fetch

  const transport = createTelegramTransport('bot-token-123')
  const address = encodeClientChannelAddress('client-1', 'telegram', '555111')
  await transport.sendText(address, 'hello there')

  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /^https:\/\/api\.telegram\.org\/botbot-token-123\/sendMessage$/)
  assert.deepEqual(calls[0].body, { chat_id: '555111', text: 'hello there' })
})

test('rejects a non-telegram synthetic address', async () => {
  const transport = createTelegramTransport('bot-token-123')
  const address = encodeClientChannelAddress('client-1', 'slack', 'C0123')
  await assert.rejects(() => transport.sendText(address, 'hi'), /Not a Telegram channel address/)
})

test('throws when the Telegram API responds with ok:false', async () => {
  globalThis.fetch = (async () => jsonResponse({ ok: false, description: 'Forbidden: bot was blocked' })) as typeof fetch

  const transport = createTelegramTransport('bot-token-123')
  const address = encodeClientChannelAddress('client-1', 'telegram', '555111')
  await assert.rejects(() => transport.sendText(address, 'hi'), /bot was blocked/)
})
