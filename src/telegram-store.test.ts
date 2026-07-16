import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdtempSync } from 'node:fs'

let dir: string

async function freshStore() {
  const telegramStore = await import('./telegram-store.js')
  const vault = await import('./vault.js')
  vault.resetVaultForTests()
  return telegramStore
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahrness-telegram-'))
  process.env.AGENT_STORE_DIR = dir
  process.env.AGENT_VAULT_SALT_PATH = join(dir, 'vault.salt')
  process.env.AGENT_MASTER_KEY = 'x'.repeat(40)
})

afterEach(() => {
  rmSync(dir, { force: true, recursive: true })
  delete process.env.AGENT_STORE_DIR
  delete process.env.AGENT_VAULT_SALT_PATH
  delete process.env.AGENT_MASTER_KEY
})

test('saves and reads back a bot token, encrypted at rest', async () => {
  const { saveTelegramBotToken, getTelegramConnection } = await freshStore()
  await saveTelegramBotToken('client-1', '123456:ABC-DEF-token', 'my_bot')

  const conn = await getTelegramConnection('client-1')
  assert.equal(conn?.botToken, '123456:ABC-DEF-token')
  assert.equal(conn?.botUsername, 'my_bot')
  assert.equal(conn?.ownerChatId, undefined)
})

test('returns null for a client with no connection', async () => {
  const { getTelegramConnection } = await freshStore()
  assert.equal(await getTelegramConnection('nobody'), null)
})

test('binds the owner chat once and ignores later attempts', async () => {
  const { saveTelegramBotToken, bindTelegramOwnerChat, getTelegramConnection } = await freshStore()
  await saveTelegramBotToken('client-1', 'token-a')

  await bindTelegramOwnerChat('client-1', 'chat-111')
  await bindTelegramOwnerChat('client-1', 'chat-222')

  const conn = await getTelegramConnection('client-1')
  assert.equal(conn?.ownerChatId, 'chat-111')
})

test('binding without an existing connection is a no-op', async () => {
  const { bindTelegramOwnerChat, getTelegramConnection } = await freshStore()
  await bindTelegramOwnerChat('ghost-client', 'chat-1')
  assert.equal(await getTelegramConnection('ghost-client'), null)
})

test('lists only clients with a stored bot token', async () => {
  const { saveTelegramBotToken, listConnectedTelegramClients } = await freshStore()
  await saveTelegramBotToken('client-a', 'token-a')
  await saveTelegramBotToken('client-b', 'token-b')

  const clients = (await listConnectedTelegramClients()).sort()
  assert.deepEqual(clients, ['client-a', 'client-b'])
})

test('bindSharedTelegramChat resolves via clientIdForSharedTelegramChat and updates ClientMeta', async () => {
  const { bindSharedTelegramChat, clientIdForSharedTelegramChat } = await freshStore()
  const { getClientMeta } = await import('./store/client-store.js')

  await bindSharedTelegramChat('client-1', 'chat-999')

  assert.equal(await clientIdForSharedTelegramChat('chat-999'), 'client-1')
  assert.equal(await clientIdForSharedTelegramChat('chat-unknown'), null)

  const meta = await getClientMeta('client-1')
  assert.equal(meta.telegramChatId, 'chat-999')
  assert.ok(meta.telegramChatBoundAt)
})

test('removeTelegramConnection clears the stored token', async () => {
  const { saveTelegramBotToken, removeTelegramConnection, getTelegramConnection, listConnectedTelegramClients } =
    await freshStore()
  await saveTelegramBotToken('client-1', 'token-a')
  await removeTelegramConnection('client-1')

  assert.equal(await getTelegramConnection('client-1'), null)
  assert.deepEqual(await listConnectedTelegramClients(), [])
})
