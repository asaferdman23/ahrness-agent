import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  getSiteCredential,
  getSiteCredentialSecret,
  saveSiteCredential,
} from './site-credentials-store.js'

async function withTempStore<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ahrness-site-creds-'))
  const prevStore = process.env.AGENT_STORE_DIR
  const prevKey = process.env.AGENT_MASTER_KEY
  process.env.AGENT_STORE_DIR = dir
  process.env.AGENT_MASTER_KEY = 'a'.repeat(32)
  try {
    return await fn()
  } finally {
    if (prevStore === undefined) delete process.env.AGENT_STORE_DIR
    else process.env.AGENT_STORE_DIR = prevStore
    if (prevKey === undefined) delete process.env.AGENT_MASTER_KEY
    else process.env.AGENT_MASTER_KEY = prevKey
  }
}

test('returns null for a domain with no saved credential', async () => {
  await withTempStore(async () => {
    const result = await getSiteCredential('client-1', 'linkedin.com')
    assert.equal(result, null)
  })
})

test('saveSiteCredential then getSiteCredential round-trips username without the password', async () => {
  await withTempStore(async () => {
    await saveSiteCredential('client-2', 'linkedin.com', 'alice@example.com', 's3cret-pw')
    const result = await getSiteCredential('client-2', 'linkedin.com')
    assert.ok(result)
    assert.equal(result.domain, 'linkedin.com')
    assert.equal(result.username, 'alice@example.com')
    assert.ok(result.connectedAt)
    assert.ok(!('password' in result), 'must never expose the password on the general read path')
  })
})

test('getSiteCredentialSecret returns the decrypted password', async () => {
  await withTempStore(async () => {
    await saveSiteCredential('client-3', 'reddit.com', 'bob', 'hunter2')
    const secret = await getSiteCredentialSecret('client-3', 'reddit.com')
    assert.equal(secret, 'hunter2')
  })
})

test('credentials for different domains on the same client do not collide', async () => {
  await withTempStore(async () => {
    await saveSiteCredential('client-4', 'linkedin.com', 'a', 'pw-a')
    await saveSiteCredential('client-4', 'reddit.com', 'b', 'pw-b')
    assert.equal(await getSiteCredentialSecret('client-4', 'linkedin.com'), 'pw-a')
    assert.equal(await getSiteCredentialSecret('client-4', 'reddit.com'), 'pw-b')
  })
})

test('saving again for the same domain overwrites the previous credential', async () => {
  await withTempStore(async () => {
    await saveSiteCredential('client-5', 'linkedin.com', 'old-user', 'old-pw')
    await saveSiteCredential('client-5', 'linkedin.com', 'new-user', 'new-pw')
    const result = await getSiteCredential('client-5', 'linkedin.com')
    assert.equal(result?.username, 'new-user')
    assert.equal(await getSiteCredentialSecret('client-5', 'linkedin.com'), 'new-pw')
  })
})
