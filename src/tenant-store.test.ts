import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'ahrness-tenant-'))
process.env.AGENT_STORE_DIR = root

const { db, initDb } = await import('./db/index.js')
const { user } = await import('./db/schema.js')
const { clientIdForJid, linkWhatsAppToTenant } = await import('./tenant-store.js')
const { clientIdFromJid } = await import('./store/client-store.js')

after(() => {
  delete process.env.AGENT_STORE_DIR
  rmSync(root, { force: true, recursive: true })
})

test('linked WhatsApp JIDs resolve to the authenticated tenant id', async () => {
  initDb()
  const tenantId = 'tenant-secure-1'
  const jid = '15551234567@s.whatsapp.net'
  const now = new Date()

  await db.insert(user).values({
    id: tenantId,
    name: 'Secure Tenant',
    email: 'secure-tenant@example.com',
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  })
  await linkWhatsAppToTenant(tenantId, jid, 'baileys')

  assert.equal(await clientIdForJid(jid), tenantId)
})

test('unlinked WhatsApp JIDs fall back to the legacy isolated JID hash', async () => {
  const jid = '15550000000@s.whatsapp.net'

  assert.equal(await clientIdForJid(jid), clientIdFromJid(jid))
})

test('synthetic channel addresses resolve to their embedded clientId directly', async () => {
  const { encodeClientChannelAddress } = await import('./channel-address.js')
  const address = encodeClientChannelAddress('client-abc', 'telegram', '555111222')

  assert.equal(await clientIdForJid(address), 'client-abc')
})
