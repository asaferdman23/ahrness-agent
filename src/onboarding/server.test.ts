import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createSession, loadSession, saveSession } from './session.js'
import { createOnboardingHandler, normalizePairingPhoneNumber } from './server.js'
import { getClientMeta } from '../store/client-store.js'
import { baileysSessionManager } from '../baileys-manager.js'
import { resetVaultForTests } from '../vault.js'
import type { AddressInfo } from 'node:net'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahrness-onboarding-'))
  process.env.AGENT_STORE_DIR = root
  process.env.AGENT_VAULT_SALT_PATH = join(root, 'vault.salt')
  process.env.AGENT_MASTER_KEY = 'k'.repeat(40)
  process.env.ONBOARDING_ACTIVATION_V2 = 'true'
  process.env.ONBOARDING_ACTIVATION_V2_PERCENT = '100'
  resetVaultForTests()
})

afterEach(() => {
  rmSync(root, { force: true, recursive: true })
  delete process.env.AGENT_STORE_DIR
  delete process.env.AGENT_VAULT_SALT_PATH
  delete process.env.AGENT_MASTER_KEY
  delete process.env.ONBOARDING_ACTIVATION_V2
  delete process.env.ONBOARDING_ACTIVATION_V2_PERCENT
})

test('pairing phone normalization accepts international formatting and rejects unsafe input', () => {
  assert.equal(normalizePairingPhoneNumber('+972 50-123-4567'), '972501234567')
  assert.equal(normalizePairingPhoneNumber('(415) 555 0123'), '4155550123')
  assert.throws(() => normalizePairingPhoneNumber('123'), /valid WhatsApp number/)
  assert.throws(() => normalizePairingPhoneNumber(''), /valid WhatsApp number/)
  assert.throws(() => normalizePairingPhoneNumber(undefined), /Enter your WhatsApp phone number/)
})

test('Baileys onboarding group endpoints require linked WhatsApp and persist the chosen home group', async () => {
  const session = await createSession()
  session.whatsappProvider = 'baileys'
  session.whatsappLinked = true
  await saveSession(session)
  const handler = (await import('./server.js')).createOnboardingHandler()
  const server = createServer((req, res) => { handler(req, res).catch((err: unknown) => {
    console.error(err)
    res.statusCode = 500
    res.end('Internal Server Error')
  }) })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}`

  try {
    const noGroupsRes = await fetch(`${base}/api/onboarding/baileys-groups?session=${session.sessionId}`)
    assert.equal(noGroupsRes.status, 409)
    assert.match(noGroupsRes.headers.get('set-cookie') ?? '', new RegExp(`session=${session.sessionId}`))
    const noGroupsBody = await noGroupsRes.json() as { error: string }
    assert.equal(noGroupsBody.error, 'WhatsApp is not linked yet')

    const clientId = session.clientId ?? session.sessionId
    const manager = baileysSessionManager()
    const fakeSession = {
      clientId,
      socket: {
        async groupFetchAllParticipating() {
          return {
            '120363111111111111@g.us': { id: '120363111111111111@g.us', subject: 'Planning', size: 10 },
            '120363222222222222@g.us': { id: '120363222222222222@g.us', subject: 'Launch', size: 25 },
          }
        },
        async groupCreate(subject: string, participants: string[]) {
          assert.equal(subject, 'BizzClaw — Northstar')
          assert.deepEqual(participants, ['972501234567@s.whatsapp.net'])
          return { id: '120363333333333333@g.us', subject, size: 2 }
        },
        async groupParticipantsUpdate(jid: string, participants: string[], action: string) {
          assert.equal(jid, '120363333333333333@g.us')
          assert.deepEqual(participants, ['972501234567@s.whatsapp.net'])
          assert.equal(action, 'remove')
          return [{ status: '200', jid: participants[0] }]
        },
      },
      transport: {
        sendText: async () => {},
        sendImage: async () => {},
        sendVideo: async () => {},
        sendAudio: async () => {},
        sendDocument: async () => {},
      },
      stop: () => {},
      logout: async () => {},
    }
    const managerAny = manager as any
    managerAny.sessions.set(clientId, fakeSession)
    managerAny._connected.add(clientId)

    const groupsRes = await fetch(`${base}/api/onboarding/baileys-groups?session=${session.sessionId}`)
    assert.equal(groupsRes.status, 200)
    const groupsBody = await groupsRes.json() as { groups: Array<{ jid: string; subject: string; size: number }>; selected: string | null }
    assert.equal(groupsBody.selected, null)
    assert.deepEqual(groupsBody.groups.map((g) => g.jid), ['120363222222222222@g.us', '120363111111111111@g.us'])
    assert.deepEqual(groupsBody.groups.map((g) => g.size), [25, 10])

    const chooseRes = await fetch(`${base}/api/onboarding/baileys-group?session=${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupJid: '120363111111111111@g.us' }),
    })
    assert.equal(chooseRes.status, 200)
    const chooseBody = await chooseRes.json() as { ok: boolean; group: { jid: string; subject: string; size: number } }
    assert.equal(chooseBody.ok, true)
    assert.equal(chooseBody.group.jid, '120363111111111111@g.us')

    const meta = await getClientMeta(clientId)
    assert.equal(meta.baileysHomeGroupJid, '120363111111111111@g.us')
    assert.equal(meta.baileysHomeGroupSubject, 'Planning')
    assert.ok(typeof meta.baileysHomeGroupBoundAt === 'string')

    const createRes = await fetch(`${base}/api/onboarding/baileys-group-create?session=${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName: 'BizzClaw — Northstar', participantPhone: '+972 50 123 4567', privateWorkspace: true }),
    })
    assert.equal(createRes.status, 200)
    const createBody = await createRes.json() as { ok: boolean; privacy: string; group: { jid: string; subject: string; size: number } }
    assert.equal(createBody.ok, true)
    assert.equal(createBody.privacy, 'private')
    assert.equal(createBody.group.jid, '120363333333333333@g.us')
    const createdMeta = await getClientMeta(clientId)
    assert.equal(createdMeta.baileysHomeGroupJid, '120363333333333333@g.us')
    assert.equal(createdMeta.baileysHomeGroupSubject, 'BizzClaw — Northstar')

    const invalidCreateRes = await fetch(`${base}/api/onboarding/baileys-group-create?session=${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName: 'BizzClaw', participantPhone: '123' }),
    })
    assert.equal(invalidCreateRes.status, 400)

    const groupsAfterRes = await fetch(`${base}/api/onboarding/baileys-groups?session=${session.sessionId}`)
    assert.equal(groupsAfterRes.status, 200)
    const groupsAfterBody = await groupsAfterRes.json() as { groups: Array<{ jid: string; subject: string; size: number }>; selected: string | null }
    assert.equal(groupsAfterBody.selected, '120363333333333333@g.us')

    const bootstrapRes = await fetch(`${base}/api/onboarding/bootstrap?session=${session.sessionId}`)
    const bootstrap = await bootstrapRes.json() as {
      whatsapp: { baileys: { homeGroupJid: string | null; homeGroupSubject: string | null } }
    }
    assert.equal(bootstrap.whatsapp.baileys.homeGroupJid, '120363333333333333@g.us')
    assert.equal(bootstrap.whatsapp.baileys.homeGroupSubject, 'BizzClaw — Northstar')

    const disconnectRes = await fetch(`${base}/api/onboarding/whatsapp-disconnect?session=${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(disconnectRes.status, 200)
    const disconnectedMeta = await getClientMeta(clientId)
    assert.equal(disconnectedMeta.baileysHomeGroupJid, undefined)
    assert.equal(disconnectedMeta.baileysHomeGroupSubject, undefined)
  } finally {
    server.close()
    const managerAny = baileysSessionManager() as any
    managerAny.sessions.delete(session.clientId ?? session.sessionId)
    managerAny._connected.delete(session.clientId ?? session.sessionId)
    managerAny.starting?.delete?.(session.clientId ?? session.sessionId)
  }
})

test('preview endpoint caches fallback output for an unchanged profile', async () => {
  const previousApiKey = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  const session = await createSession()
  const handler = createOnboardingHandler()
  const server = createServer((req, res) => { handler(req, res).catch((error: unknown) => {
    res.statusCode = 500
    res.end(error instanceof Error ? error.message : 'Internal Server Error')
  }) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}`

  try {
    const profileRes = await fetch(`${base}/api/onboarding/profile?session=${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Northstar', description: 'We help growing shops earn repeat customers.', website: 'https://northstar.example' }),
    })
    assert.equal(profileRes.status, 200)

    const firstRes = await fetch(`${base}/api/onboarding/preview?session=${session.sessionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const first = await firstRes.json() as { preview: { source: string; generatedAt: string; opportunities: string[] } }
    assert.equal(firstRes.status, 200)
    assert.equal(first.preview.source, 'fallback')
    assert.equal(first.preview.opportunities.length, 3)

    const secondRes = await fetch(`${base}/api/onboarding/preview?session=${session.sessionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const second = await secondRes.json() as typeof first
    assert.equal(second.preview.generatedAt, first.preview.generatedAt)
    const saved = await loadSession(session.sessionId)
    assert.equal(saved?.previewAttempts?.length, 1)
  } finally {
    server.close()
    if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = previousApiKey
  }
})

test('activation event endpoint rejects unknown events and stores only allowlisted properties', async () => {
  const session = await createSession()
  const handler = createOnboardingHandler()
  const server = createServer((req, res) => { handler(req, res).catch(() => {
    res.statusCode = 500
    res.end('Internal Server Error')
  }) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}`

  try {
    const rejected = await fetch(`${base}/api/onboarding/events?session=${session.sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'exfiltrate_profile' }),
    })
    assert.equal(rejected.status, 400)

    const accepted = await fetch(`${base}/api/onboarding/events?session=${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'integration_started', properties: { phase: 'configure', step: 4, platform: 'meta-ads', accessToken: 'secret', description: 'private' } }),
    })
    assert.equal(accepted.status, 200)
    const records = JSON.parse(readFileSync(join(root, 'clients', session.sessionId, 'activation-events.json'), 'utf8')) as Array<{ properties: Record<string, unknown> }>
    assert.deepEqual(records[0]?.properties, { phase: 'configure', step: 4, platform: 'meta-ads' })
  } finally {
    server.close()
  }
})

test('activation onboarding can choose WhatsApp before connecting optional capability apps', async () => {
  const session = await createSession()
  const handler = createOnboardingHandler()
  const server = createServer((req, res) => { handler(req, res).catch((error: unknown) => {
    res.statusCode = 500
    res.end(error instanceof Error ? error.message : 'Internal Server Error')
  }) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}/api/onboarding`
  const post = (path: string, body: Record<string, unknown>) => fetch(`${base}/${path}?session=${session.sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  try {
    assert.equal((await post('profile', {
      name: 'Northstar',
      description: 'We help growing shops earn repeat customers.',
    })).status, 200)
    assert.equal((await post('role', { roleId: 'marketing-manager' })).status, 200)
    assert.equal((await post('automations', { templates: [] })).status, 200)

    const providerRes = await post('whatsapp-provider', { whatsappProvider: 'baileys' })
    assert.equal(providerRes.status, 200)
    const providerBody = await providerRes.json() as {
      progress: { allowedStep: number; checks: { requiredConnections: boolean } }
      session: { whatsappProvider: string | null }
    }
    assert.equal(providerBody.progress.allowedStep, 5)
    assert.equal(providerBody.progress.checks.requiredConnections, false)
    assert.equal(providerBody.session.whatsappProvider, 'baileys')
  } finally {
    server.close()
  }
})
