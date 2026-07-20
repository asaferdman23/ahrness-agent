import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateClientMeta, clientIdFromJid } from './store/client-store.js'
import { createRoutingWhatsAppTransport } from './whatsapp-router.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahrness-router-'))
  process.env.AGENT_STORE_DIR = root
})

afterEach(() => {
  rmSync(root, { force: true, recursive: true })
  delete process.env.AGENT_STORE_DIR
})

function captureTransport(name: string, calls: string[]): WhatsAppTransport {
  return {
    async sendText(jid, text) {
      calls.push(`${name}:text:${jid}:${text}`)
    },
    async sendImage(jid) {
      calls.push(`${name}:image:${jid}`)
    },
    async sendVideo(jid) {
      calls.push(`${name}:video:${jid}`)
    },
    async sendAudio(jid) {
      calls.push(`${name}:audio:${jid}`)
    },
    async sendDocument(jid) {
      calls.push(`${name}:document:${jid}`)
    },
  }
}

test('routes through default transport without a client preference', async () => {
  const calls: string[] = []
  const router = createRoutingWhatsAppTransport(
    { twilio: captureTransport('twilio', calls), baileys: captureTransport('baileys', calls) },
    'twilio',
  )

  await router.sendText('15551234567@s.whatsapp.net', 'hello')

  assert.deepEqual(calls, ['twilio:text:15551234567@s.whatsapp.net:hello'])
})

test('routes through the client preferred provider', async () => {
  const jid = '15551234567@s.whatsapp.net'
  await updateClientMeta(clientIdFromJid(jid), { whatsappProvider: 'baileys' })
  const calls: string[] = []
  const router = createRoutingWhatsAppTransport(
    { twilio: captureTransport('twilio', calls), baileys: captureTransport('baileys', calls) },
    'twilio',
  )

  await router.sendText(jid, 'hello')

  assert.deepEqual(calls, ['baileys:text:15551234567@s.whatsapp.net:hello'])
})

test('falls back when a preferred provider is unavailable', async () => {
  const jid = '15551234567@s.whatsapp.net'
  await updateClientMeta(clientIdFromJid(jid), { whatsappProvider: 'baileys' })
  const calls: string[] = []
  const router = createRoutingWhatsAppTransport({ twilio: captureTransport('twilio', calls) }, 'twilio')

  await router.sendText(jid, 'hello')

  assert.deepEqual(calls, ['twilio:text:15551234567@s.whatsapp.net:hello'])
})

test('client-pinned routing keeps two group destinations on their own Baileys sockets', async () => {
  await updateClientMeta('client-a', { whatsappProvider: 'baileys' })
  await updateClientMeta('client-b', { whatsappProvider: 'baileys' })
  const calls: string[] = []
  const sessions = new Map([
    ['client-a', { transport: captureTransport('baileys-a', calls) }],
    ['client-b', { transport: captureTransport('baileys-b', calls) }],
  ])
  const manager = { get: (clientId: string) => sessions.get(clientId) ?? null }
  const router = createRoutingWhatsAppTransport(
    { twilio: captureTransport('twilio', calls) },
    'twilio',
    { baileysManager: manager as never },
  )

  await Promise.all([
    router.forClient!('client-a').sendText('120363111111111111@g.us', 'hello a'),
    router.forClient!('client-b').sendText('120363222222222222@g.us', 'hello b'),
  ])

  assert.deepEqual(calls.sort(), [
    'baileys-a:text:120363111111111111@g.us:hello a',
    'baileys-b:text:120363222222222222@g.us:hello b',
  ])
})

test('a disconnected Baileys client never falls back to another sender', async () => {
  await updateClientMeta('client-a', { whatsappProvider: 'baileys' })
  const calls: string[] = []
  const router = createRoutingWhatsAppTransport(
    { twilio: captureTransport('twilio', calls) },
    'twilio',
    { baileysManager: { get: () => null } as never },
  )

  await assert.rejects(
    () => router.forClient!('client-a').sendText('120363111111111111@g.us', 'hello'),
    /linked WhatsApp session is not connected/,
  )
  assert.deepEqual(calls, [])
})
