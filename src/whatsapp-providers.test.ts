import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  configuredWhatsAppProviders,
  defaultWhatsAppProvider,
  isBaileysProvider,
  isTwilioProvider,
} from './whatsapp-providers.js'

test('parses a single WhatsApp provider', () => {
  assert.deepEqual(configuredWhatsAppProviders('baileys'), ['baileys'])
  assert.equal(defaultWhatsAppProvider('baileys'), 'baileys')
})

test('parses dual and comma-separated WhatsApp providers', () => {
  assert.deepEqual(configuredWhatsAppProviders('dual'), ['twilio', 'baileys'])
  assert.deepEqual(configuredWhatsAppProviders('baileys,twilio,baileys'), ['baileys', 'twilio'])
})

test('falls back to Twilio for invalid provider config', () => {
  assert.deepEqual(configuredWhatsAppProviders('bogus'), ['twilio'])
  assert.equal(isTwilioProvider('dual'), true)
  assert.equal(isBaileysProvider('twilio'), false)
})
