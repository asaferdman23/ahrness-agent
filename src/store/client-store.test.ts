import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { getConnections, upsertConnection, getClientMeta, updateClientMeta } from './client-store.js'
import { resetVaultForTests } from '../vault.js'

let root: string
const CLIENT = 'a'.repeat(64)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahrness-store-'))
  process.env.AGENT_STORE_DIR = root
  process.env.AGENT_VAULT_SALT_PATH = join(root, 'vault.salt')
  process.env.AGENT_MASTER_KEY = 'k'.repeat(40)
  resetVaultForTests()
})

afterEach(() => {
  rmSync(root, { force: true, recursive: true })
  delete process.env.AGENT_STORE_DIR
  delete process.env.AGENT_VAULT_SALT_PATH
  delete process.env.AGENT_MASTER_KEY
})

function rawConnections(): string {
  return readFileSync(join(root, 'clients', CLIENT, 'connections.json'), 'utf8')
}

test('stores access/refresh tokens encrypted on disk', async () => {
  await upsertConnection(CLIENT, 'meta-ads', {
    status: 'connected',
    accessToken: 'PLAINTEXT-ACCESS-7777',
    refreshToken: 'PLAINTEXT-REFRESH-8888',
    tokenExpiresAt: null,
    connectedAt: '2026-06-23T00:00:00.000Z',
  })
  const raw = rawConnections()
  assert.doesNotMatch(raw, /PLAINTEXT-ACCESS-7777/, 'access token must not be on disk in plaintext')
  assert.doesNotMatch(raw, /PLAINTEXT-REFRESH-8888/, 'refresh token must not be on disk in plaintext')
  assert.match(raw, /v1:/, 'token fields should be vault blobs')
})

test('getConnections returns decrypted plaintext tokens', async () => {
  await upsertConnection(CLIENT, 'meta-ads', {
    status: 'connected',
    accessToken: 'PLAINTEXT-ACCESS-7777',
    refreshToken: 'PLAINTEXT-REFRESH-8888',
    tokenExpiresAt: null,
    connectedAt: '2026-06-23T00:00:00.000Z',
  })
  const conns = await getConnections(CLIENT)
  assert.equal(conns['meta-ads']?.accessToken, 'PLAINTEXT-ACCESS-7777')
  assert.equal(conns['meta-ads']?.refreshToken, 'PLAINTEXT-REFRESH-8888')
})

test('migrates a legacy plaintext connections file on read and re-encrypts it', async () => {
  const dir = join(root, 'clients', CLIENT)
  mkdirSync(dir, { recursive: true })
  // Legacy file written before encryption existed: plaintext token.
  writeFileSync(
    join(dir, 'connections.json'),
    JSON.stringify({
      'meta-ads': {
        status: 'connected',
        accessToken: 'LEGACY-PLAINTEXT-123',
        tokenExpiresAt: null,
        connectedAt: '2026-01-01T00:00:00.000Z',
      },
    }),
  )

  const conns = await getConnections(CLIENT)
  assert.equal(conns['meta-ads']?.accessToken, 'LEGACY-PLAINTEXT-123', 'reads legacy plaintext transparently')

  const raw = rawConnections()
  assert.doesNotMatch(raw, /LEGACY-PLAINTEXT-123/, 'legacy file should be re-encrypted on disk after read')
  assert.match(raw, /v1:/)
})

test('updateClientMeta persists the web browsing capability flag', async () => {
  const clientId = 'browser-flag-test-client'
  await updateClientMeta(clientId, { webBrowsingEnabled: true, webBrowsingEnabledAt: '2026-07-20T00:00:00.000Z' })
  const meta = await getClientMeta(clientId)
  assert.equal(meta.webBrowsingEnabled, true)
  assert.equal(meta.webBrowsingEnabledAt, '2026-07-20T00:00:00.000Z')
})
