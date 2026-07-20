import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clientIdFromJid, getClientMeta, getProfile, getRole, saveProfile, saveRole } from '../store/client-store.js'
import {
  bindSessionToWhatsAppCode,
  bindSessionToWhatsAppJid,
  createSession,
  ensureWhatsAppConnectCode,
  loadSession,
  markSessionWhatsAppLoggedOut,
  saveSession,
} from './session.js'
import type { ClientProfile } from '../store/types.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahrness-session-'))
  process.env.AGENT_STORE_DIR = root
})

afterEach(() => {
  rmSync(root, { force: true, recursive: true })
  delete process.env.AGENT_STORE_DIR
})

test('binds a Twilio connect code and adopts web-saved client data', async () => {
  const session = await createSession()
  const code = await ensureWhatsAppConnectCode(session)
  const profile: ClientProfile = {
    clientId: session.sessionId,
    whatsappJid: '',
    createdAt: session.createdAt,
    business: { name: 'Acme', industry: 'SaaS', goals: ['generate_leads'] },
    assets: { website: 'https://example.com' },
  }
  await saveProfile(profile)
  await saveRole(session.sessionId, {
    roleId: 'marketing-manager',
    assignedAt: session.createdAt,
    skillOverrides: { disabled: [], extra: [] },
    mcpOverrides: { disabled: [], extra: [] },
  })

  const jid = '15551234567@s.whatsapp.net'
  const bound = await bindSessionToWhatsAppCode(code, jid, 'twilio')
  const clientId = clientIdFromJid(jid)

  assert.equal(bound?.clientId, clientId)
  assert.equal(bound?.whatsappJid, jid)
  assert.equal(bound?.whatsappLinked, true)
  assert.equal((await getProfile(clientId))?.whatsappJid, jid)
  assert.equal((await getRole(clientId))?.roleId, 'marketing-manager')
  assert.equal((await getClientMeta(clientId)).whatsappProvider, 'twilio')

  const savedSession = JSON.parse(readFileSync(join(root, 'sessions', `${session.sessionId}.json`), 'utf8')) as {
    whatsappProvider?: string
  }
  assert.equal(savedSession.whatsappProvider, 'twilio')
})

test('binds a connect code without moving authenticated tenant data to the JID hash', async () => {
  const session = await createSession()
  const tenantId = 'tenant-user-123'
  session.clientId = tenantId
  const code = await ensureWhatsAppConnectCode(session)
  const profile: ClientProfile = {
    clientId: tenantId,
    whatsappJid: '',
    createdAt: session.createdAt,
    business: { name: 'Tenant Co', industry: 'agency', goals: ['increase_roas'] },
    assets: { website: 'https://tenant.example' },
  }
  await saveProfile(profile)
  await saveRole(tenantId, {
    roleId: 'ads-analyst',
    assignedAt: session.createdAt,
    skillOverrides: { disabled: [], extra: [] },
    mcpOverrides: { disabled: [], extra: [] },
  })

  const jid = '15557654321@s.whatsapp.net'
  const legacyClientId = clientIdFromJid(jid)
  const bound = await bindSessionToWhatsAppCode(code, jid, 'baileys')

  assert.equal(bound?.clientId, tenantId)
  assert.equal(bound?.whatsappJid, jid)
  assert.equal((await getProfile(tenantId))?.whatsappJid, '')
  assert.equal((await getRole(tenantId))?.roleId, 'ads-analyst')
  assert.equal(await getProfile(legacyClientId), null)
  assert.equal(await getRole(legacyClientId), null)
  assert.equal((await getClientMeta(tenantId)).whatsappProvider, 'baileys')
})

test('binds a Baileys QR-linked session to the authenticated tenant and JID', async () => {
  const { db, initDb } = await import('../db/index.js')
  const { user } = await import('../db/schema.js')
  const { clientIdForJid } = await import('../tenant-store.js')

  initDb()

  const tenantId = `tenant-user-qr-${Date.now()}`
  const now = new Date()
  await db.insert(user).values({
    id: tenantId,
    name: 'QR Tenant',
    email: `qr-tenant-${Date.now()}@example.com`,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  })

  const session = await createSession()
  session.clientId = tenantId
  await saveSession(session)
  await saveProfile({
    clientId: tenantId,
    whatsappJid: '',
    createdAt: session.createdAt,
    business: { name: 'QR Co', industry: 'agency', goals: ['generate_leads'] },
    assets: { website: 'https://qr.example' },
  })
  await saveRole(tenantId, {
    roleId: 'marketing-manager',
    assignedAt: session.createdAt,
    skillOverrides: { disabled: [], extra: [] },
    mcpOverrides: { disabled: [], extra: [] },
  })

  const jid = `1555${Date.now()}@s.whatsapp.net`
  const bound = await bindSessionToWhatsAppJid(session.sessionId, jid, 'baileys')

  assert.equal(bound?.clientId, tenantId)
  assert.equal(bound?.whatsappJid, jid)
  assert.equal(bound?.whatsappLinked, true)
  assert.equal((await getClientMeta(tenantId)).whatsappProvider, 'baileys')
  assert.equal(await clientIdForJid(jid), tenantId)
})

test('marks a revoked Baileys onboarding session as needing step-five relinking', async () => {
  const session = await createSession()
  session.whatsappProvider = 'baileys'
  session.whatsappLinked = true
  session.whatsappJid = '15551234567@s.whatsapp.net'
  session.step = 6
  await saveSession(session)

  await markSessionWhatsAppLoggedOut(session.sessionId)

  const saved = await loadSession(session.sessionId)
  assert.equal(saved?.whatsappLinked, false)
  assert.equal(saved?.whatsappJid, undefined)
  assert.equal(saved?.step, 5)
})
