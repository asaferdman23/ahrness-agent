import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdtempSync, readFileSync } from 'node:fs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahrness-hf-'))
  process.env.HIGGSFIELD_AUTH_STORE = join(dir, 'hf.json')
  process.env.AGENT_VAULT_SALT_PATH = join(dir, 'vault.salt')
  process.env.AGENT_MASTER_KEY = 'h'.repeat(40)
})

afterEach(() => {
  rmSync(dir, { force: true, recursive: true })
  delete process.env.HIGGSFIELD_AUTH_STORE
  delete process.env.AGENT_VAULT_SALT_PATH
  delete process.env.AGENT_MASTER_KEY
})

test('persists Higgsfield OAuth tokens encrypted, reads them back decrypted', async () => {
  const { resetVaultForTests } = await import('./vault.js')
  resetVaultForTests()
  const { getHiggsfieldOAuthProvider } = await import('./higgsfield-auth.js')
  const provider = getHiggsfieldOAuthProvider()

  await provider.saveTokens({ access_token: 'HF-SECRET-XYZ', token_type: 'bearer', refresh_token: 'HF-REFRESH-XYZ' })

  const raw = readFileSync(join(dir, 'hf.json'), 'utf8')
  assert.doesNotMatch(raw, /HF-SECRET-XYZ/, 'access token must not be plaintext on disk')
  assert.doesNotMatch(raw, /HF-REFRESH-XYZ/, 'refresh token must not be plaintext on disk')
  assert.match(raw, /v1:/)

  const tokens = await provider.tokens()
  assert.equal(tokens?.access_token, 'HF-SECRET-XYZ')
  assert.equal(tokens?.refresh_token, 'HF-REFRESH-XYZ')
})
