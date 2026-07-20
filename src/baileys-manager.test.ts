import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BaileysSessionManager, discoverBaileysAuthClients } from './baileys-manager.js'
import type { BaileysSession, startBaileysWhatsApp } from './whatsapp.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  delete process.env.AGENT_STORE_DIR
})

function fakeTransport(): WhatsAppTransport {
  return {
    async sendText() {},
    async sendImage() {},
    async sendVideo() {},
    async sendAudio() {},
    async sendDocument() {},
  }
}

test('manager starts different clients independently and deduplicates concurrent starts per client', async () => {
  const starts: string[] = []
  const starter = (async (clientId, opts = {}) => {
    starts.push(clientId)
    await Promise.resolve()
    opts.onConnected?.(clientId)
    return {
      clientId,
      socket: {} as BaileysSession['socket'],
      transport: fakeTransport(),
      stop() {},
      async logout() {},
    }
  }) satisfies typeof startBaileysWhatsApp
  const manager = new BaileysSessionManager(starter)

  const [firstA, secondA, clientB] = await Promise.all([
    manager.ensureSocket('client-a'),
    manager.ensureSocket('client-a'),
    manager.ensureSocket('client-b'),
  ])

  assert.equal(firstA, secondA)
  assert.notEqual(firstA, clientB)
  assert.deepEqual(starts.sort(), ['client-a', 'client-b'])
  assert.equal(manager.isConnected('client-a'), true)
  assert.equal(manager.isConnected('client-b'), true)
  manager.stop('client-a')
  assert.equal(manager.isConnected('client-a'), false)
  assert.equal(manager.isConnected('client-b'), true)
})

test('switching from QR to phone linking restarts immediately with the requested number', async () => {
  const starts: Array<{ clientId: string; phoneNumber?: string }> = []
  let stops = 0
  const starter = (async (clientId, opts = {}) => {
    starts.push({ clientId, phoneNumber: opts.phoneNumber })
    return {
      clientId,
      socket: {} as BaileysSession['socket'],
      transport: fakeTransport(),
      stop() { stops += 1 },
      async logout() {},
    }
  }) satisfies typeof startBaileysWhatsApp
  const manager = new BaileysSessionManager(starter)

  await manager.refreshQr('client-a', { onboardingSessionId: 'session-a' })
  await manager.refreshPairingCode('client-a', {
    onboardingSessionId: 'session-a',
    phoneNumber: '972501234567',
  })

  assert.equal(stops, 1)
  assert.deepEqual(starts, [
    { clientId: 'client-a', phoneNumber: undefined },
    { clientId: 'client-a', phoneNumber: '972501234567' },
  ])
})

test('discovers and restores only clients with persisted Baileys credentials', async () => {
  const root = path.join(tmpdir(), `ahrness-baileys-manager-${process.pid}-${Date.now()}`)
  roots.push(root)
  process.env.AGENT_STORE_DIR = root
  await mkdir(path.join(root, 'clients', 'client-a', 'auth'), { recursive: true })
  await mkdir(path.join(root, 'clients', 'client-b', 'auth'), { recursive: true })
  await mkdir(path.join(root, 'clients', 'not-linked'), { recursive: true })
  await writeFile(path.join(root, 'clients', 'client-a', 'auth', 'creds.json'), '{}')
  await writeFile(path.join(root, 'clients', 'client-b', 'auth', 'creds.json'), '{}')

  assert.deepEqual(await discoverBaileysAuthClients(), ['client-a', 'client-b'])

  const starts: string[] = []
  const starter = (async (clientId) => {
    starts.push(clientId)
    if (clientId === 'client-b') throw new Error('revoked')
    return {
      clientId,
      socket: {} as BaileysSession['socket'],
      transport: fakeTransport(),
      stop() {},
      async logout() {},
    }
  }) satisfies typeof startBaileysWhatsApp
  const result = await new BaileysSessionManager(starter).restoreSockets()

  assert.deepEqual(starts.sort(), ['client-a', 'client-b'])
  assert.deepEqual(result.restored, ['client-a'])
  assert.deepEqual(result.failed, ['client-b'])
})

test('creates an openable link only for a connected tenant home group', async () => {
  const calls: string[] = []
  const starter = (async (clientId, opts = {}) => {
    opts.onConnected?.(clientId)
    return {
      clientId,
      socket: {
        async groupFetchAllParticipating() {
          return { '120363111111111111@g.us': { id: '120363111111111111@g.us', subject: 'BizzClaw', size: 1 } }
        },
        async groupInviteCode(jid: string) {
          calls.push(jid)
          return 'private-code'
        },
      } as unknown as BaileysSession['socket'],
      transport: fakeTransport(),
      stop() {},
      async logout() {},
    }
  }) satisfies typeof startBaileysWhatsApp
  const manager = new BaileysSessionManager(starter)

  assert.equal(await manager.homeGroupUrl('client-a', '120363111111111111@g.us'), null)
  await manager.ensureSocket('client-a')
  assert.equal(
    await manager.homeGroupUrl('client-a', '120363111111111111@g.us'),
    'https://chat.whatsapp.com/private-code',
  )
  assert.deepEqual(calls, ['120363111111111111@g.us'])
  await assert.rejects(
    manager.homeGroupUrl('client-a', '120363222222222222@g.us'),
    /no longer available/,
  )
})

test('creates a group only on the connected tenant socket with one validated participant', async () => {
  const calls: Array<{ subject: string; participants: string[] }> = []
  let removalStatus = '200'
  const starter = (async (clientId, opts = {}) => {
    opts.onConnected?.(clientId)
    return {
      clientId,
      socket: {
        async groupCreate(subject: string, participants: string[]) {
          calls.push({ subject, participants })
          return { id: '120363333333333333@g.us', subject, size: 2 }
        },
        async groupParticipantsUpdate(jid: string, participants: string[], action: string) {
          assert.equal(jid, '120363333333333333@g.us')
          assert.deepEqual(participants, ['15551234567@s.whatsapp.net'])
          assert.equal(action, 'remove')
          return [{ status: removalStatus, jid: participants[0] }]
        },
      } as unknown as BaileysSession['socket'],
      transport: fakeTransport(),
      stop() {},
      async logout() {},
    }
  }) satisfies typeof startBaileysWhatsApp
  const manager = new BaileysSessionManager(starter)

  assert.equal(await manager.createGroup('client-a', {
    subject: 'BizzClaw',
    participantJid: '15551234567@s.whatsapp.net',
  }), null)
  await manager.ensureSocket('client-a')
  const created = await manager.createGroup('client-a', {
    subject: 'BizzClaw workspace',
    participantJid: '15551234567@s.whatsapp.net',
    removeParticipantAfterCreate: true,
  })
  assert.deepEqual(created, {
    jid: '120363333333333333@g.us',
    subject: 'BizzClaw workspace',
    size: 2,
    temporaryParticipantRemoved: true,
  })
  assert.deepEqual(calls, [{ subject: 'BizzClaw workspace', participants: ['15551234567@s.whatsapp.net'] }])
  removalStatus = '403'
  const partial = await manager.createGroup('client-a', {
    subject: 'Private workspace',
    participantJid: '15551234567@s.whatsapp.net',
    removeParticipantAfterCreate: true,
  })
  assert.equal(partial?.temporaryParticipantRemoved, false)
  await assert.rejects(manager.createGroup('client-a', {
    subject: 'BizzClaw',
    participantJid: 'not-a-number',
  }), /valid WhatsApp phone number/)
})
