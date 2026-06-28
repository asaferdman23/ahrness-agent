import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addJob, listJobs } from './store.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahrness-scheduler-store-'))
  process.env.AGENT_STORE_DIR = root
})

afterEach(() => {
  rmSync(root, { force: true, recursive: true })
  delete process.env.AGENT_STORE_DIR
})

test('stores schedules under AGENT_STORE_DIR for client isolation', async () => {
  const clientId = 'tenant-scheduler-1'
  await addJob({
    clientId,
    jid: '15551234567@s.whatsapp.net',
    title: 'Daily check',
    prompt: 'Send a daily check',
    schedule: { kind: 'cron', expr: '0 9 * * *', timezone: 'UTC' },
    enabled: true,
  })

  assert.equal((await listJobs(clientId)).length, 1)
  assert.equal(existsSync(join(root, 'clients', clientId, 'schedules.json')), true)
})
