import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { startCommandPayload, telegramConnectUrl } from './telegram-shared-bot.js'
import { verifyClientToken } from './onboarding/client-link.js'

beforeEach(() => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(32)
})

afterEach(() => {
  delete process.env.MEDIA_SIGNING_SECRET
})

test('startCommandPayload extracts the /start argument', () => {
  assert.equal(startCommandPayload('/start abc123'), 'abc123')
  assert.equal(startCommandPayload('/start@MyBot abc123'), 'abc123')
})

test('startCommandPayload returns null for a bare /start or other text', () => {
  assert.equal(startCommandPayload('/start'), null)
  assert.equal(startCommandPayload('hello there'), null)
  assert.equal(startCommandPayload(undefined), null)
})

test('telegramConnectUrl embeds a token that verifies back to the same clientId', () => {
  const url = telegramConnectUrl('my_bot', 'client-42')
  assert.ok(url)
  assert.match(url, /^https:\/\/t\.me\/my_bot\?start=/)

  const token = url.split('?start=')[1]
  assert.equal(verifyClientToken(token), 'client-42')
})

test('a tampered token does not verify', () => {
  const url = telegramConnectUrl('my_bot', 'client-42')
  assert.ok(url)
  const token = url.split('?start=')[1]
  const tampered = `${token.slice(0, -1)}${token.at(-1) === 'A' ? 'B' : 'A'}`
  assert.equal(verifyClientToken(tampered), null)
})

test('telegramConnectUrl returns null without a signing secret configured', () => {
  delete process.env.MEDIA_SIGNING_SECRET
  assert.equal(telegramConnectUrl('my_bot', 'client-42'), null)
})
