import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdtempSync } from 'node:fs'

let dir: string

async function freshStore() {
  const slackStore = await import('./slack-store.js')
  const vault = await import('./vault.js')
  vault.resetVaultForTests()
  return slackStore
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahrness-slack-'))
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

test('saves and reads back a Slack install, token encrypted at rest', async () => {
  const { saveSlackConnection, getSlackConnection } = await freshStore()
  await saveSlackConnection('client-1', {
    botToken: 'xoxb-fake-token',
    teamId: 'T111',
    teamName: 'Acme Inc',
    installerUserId: 'U999',
    botUserId: 'UBOT1',
  })

  const conn = await getSlackConnection('client-1')
  assert.equal(conn?.botToken, 'xoxb-fake-token')
  assert.equal(conn?.teamId, 'T111')
  assert.equal(conn?.teamName, 'Acme Inc')
  assert.equal(conn?.installerUserId, 'U999')
})

test('resolves a team id back to its clientId via the reverse index', async () => {
  const { saveSlackConnection, clientIdForSlackTeam } = await freshStore()
  await saveSlackConnection('client-1', { botToken: 'xoxb-a', teamId: 'T111', installerUserId: 'U1', botUserId: 'UBOT1' })
  await saveSlackConnection('client-2', { botToken: 'xoxb-b', teamId: 'T222', installerUserId: 'U2', botUserId: 'UBOT2' })

  assert.equal(await clientIdForSlackTeam('T111'), 'client-1')
  assert.equal(await clientIdForSlackTeam('T222'), 'client-2')
  assert.equal(await clientIdForSlackTeam('T999'), null)
})

test('updates ClientMeta with the connected team id', async () => {
  const { saveSlackConnection } = await freshStore()
  const { getClientMeta } = await import('./store/client-store.js')

  await saveSlackConnection('client-1', { botToken: 'xoxb-a', teamId: 'T111', installerUserId: 'U1', botUserId: 'UBOT1' })

  const meta = await getClientMeta('client-1')
  assert.equal(meta.slackTeamId, 'T111')
  assert.ok(meta.slackConnectedAt)
})

test('lists only clients with a stored Slack connection', async () => {
  const { saveSlackConnection, listConnectedSlackClients } = await freshStore()
  await saveSlackConnection('client-a', { botToken: 'xoxb-a', teamId: 'T1', installerUserId: 'U1', botUserId: 'UBOT1' })
  await saveSlackConnection('client-b', { botToken: 'xoxb-b', teamId: 'T2', installerUserId: 'U2', botUserId: 'UBOT2' })

  assert.deepEqual((await listConnectedSlackClients()).sort(), ['client-a', 'client-b'])
})

test('removeSlackConnection clears the stored connection', async () => {
  const { saveSlackConnection, removeSlackConnection, getSlackConnection, listConnectedSlackClients } =
    await freshStore()
  await saveSlackConnection('client-1', { botToken: 'xoxb-a', teamId: 'T1', installerUserId: 'U1', botUserId: 'UBOT1' })
  await removeSlackConnection('client-1')

  assert.equal(await getSlackConnection('client-1'), null)
  assert.deepEqual(await listConnectedSlackClients(), [])
})
