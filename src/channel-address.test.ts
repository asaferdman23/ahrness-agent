import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeClientChannelAddress,
  encodeClientChannelAddress,
  isClientChannelAddress,
} from './channel-address.js'

test('round-trips a telegram address', () => {
  const encoded = encodeClientChannelAddress('client-123', 'telegram', '55512345')
  assert.equal(isClientChannelAddress(encoded), true)
  assert.deepEqual(decodeClientChannelAddress(encoded), {
    clientId: 'client-123',
    channel: 'telegram',
    channelAddress: '55512345',
  })
})

test('preserves colons inside the channel address', () => {
  const encoded = encodeClientChannelAddress('client-123', 'slack', 'T0/C0/U0')
  const decoded = decodeClientChannelAddress(encoded)
  assert.equal(decoded?.channelAddress, 'T0/C0/U0')

  const withColons = encodeClientChannelAddress('client-123', 'slack', 'T0:C0:U0')
  assert.deepEqual(decodeClientChannelAddress(withColons), {
    clientId: 'client-123',
    channel: 'slack',
    channelAddress: 'T0:C0:U0',
  })
})

test('a real WhatsApp JID is not a client channel address', () => {
  assert.equal(isClientChannelAddress('972501234567@s.whatsapp.net'), false)
  assert.equal(decodeClientChannelAddress('972501234567@s.whatsapp.net'), null)
})

test('rejects malformed synthetic addresses', () => {
  assert.equal(decodeClientChannelAddress('agent-client:'), null)
  assert.equal(decodeClientChannelAddress('agent-client:client-123'), null)
  assert.equal(decodeClientChannelAddress('agent-client:client-123:telegram'), null)
})
