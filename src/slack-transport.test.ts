import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { encodeClientChannelAddress } from './channel-address.js'
import { createSlackTransport } from './slack-transport.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test('sendText posts to chat.postMessage with the decoded channel id', async () => {
  const calls: Array<{ url: string; body: unknown }> = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return jsonResponse({ ok: true })
  }) as typeof fetch

  const transport = createSlackTransport('xoxb-fake-token')
  const address = encodeClientChannelAddress('client-1', 'slack', 'D555')
  await transport.sendText(address, 'hello there')

  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /^https:\/\/slack\.com\/api\/chat\.postMessage$/)
  assert.deepEqual(calls[0].body, { channel: 'D555', text: 'hello there' })
})

test('rejects a non-slack synthetic address', async () => {
  const transport = createSlackTransport('xoxb-fake-token')
  const address = encodeClientChannelAddress('client-1', 'telegram', '555111')
  await assert.rejects(() => transport.sendText(address, 'hi'), /Not a Slack channel address/)
})

test('throws when the Slack API responds with ok:false', async () => {
  globalThis.fetch = (async () => jsonResponse({ ok: false, error: 'channel_not_found' })) as typeof fetch

  const transport = createSlackTransport('xoxb-fake-token')
  const address = encodeClientChannelAddress('client-1', 'slack', 'D555')
  await assert.rejects(() => transport.sendText(address, 'hi'), /channel_not_found/)
})
