import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdtempSync } from 'node:fs'

// The vault reads AGENT_MASTER_KEY at call time and persists a random salt under
// the directory given by AGENT_VAULT_SALT_PATH. Each test gets a fresh temp salt
// path and resets the in-memory key cache via resetVaultForTests().

let dir: string
const GOOD_KEY = 'x'.repeat(40)

async function freshVault() {
  // import fresh each time so module-level key caching can be reset
  const mod = await import('./vault.js')
  mod.resetVaultForTests()
  return mod
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahrness-vault-'))
  process.env.AGENT_VAULT_SALT_PATH = join(dir, 'vault.salt')
  process.env.AGENT_MASTER_KEY = GOOD_KEY
})

afterEach(() => {
  rmSync(dir, { force: true, recursive: true })
  delete process.env.AGENT_VAULT_SALT_PATH
  delete process.env.AGENT_MASTER_KEY
})

test('round-trips a secret through encrypt/decrypt', async () => {
  const { encryptSecret, decryptSecret } = await freshVault()
  const plain = 'EAAB-super-secret-oauth-token-12345'
  const blob = encryptSecret(plain)
  assert.notEqual(blob, plain)
  assert.match(blob, /^v1:/)
  assert.equal(decryptSecret(blob), plain)
})

test('produces a different ciphertext each call (random IV)', async () => {
  const { encryptSecret } = await freshVault()
  assert.notEqual(encryptSecret('same'), encryptSecret('same'))
})

test('isEncrypted distinguishes blobs from plaintext', async () => {
  const { encryptSecret, isEncrypted } = await freshVault()
  assert.equal(isEncrypted(encryptSecret('hi')), true)
  assert.equal(isEncrypted('plain-token'), false)
  assert.equal(isEncrypted(''), false)
})

test('a tampered blob fails the GCM auth tag', async () => {
  const { encryptSecret, decryptSecret } = await freshVault()
  const blob = encryptSecret('tamper-me')
  // flip the last char of the ciphertext segment
  const flipped = blob.slice(0, -1) + (blob.at(-1) === 'A' ? 'B' : 'A')
  assert.throws(() => decryptSecret(flipped))
})

test('a value encrypted under one salt cannot be read under another', async () => {
  const v1 = await freshVault()
  const blob = v1.encryptSecret('cross-salt')
  // new salt path → different derived key
  process.env.AGENT_VAULT_SALT_PATH = join(dir, 'other.salt')
  const v2 = await freshVault()
  assert.throws(() => v2.decryptSecret(blob))
})

test('throws when AGENT_MASTER_KEY is missing', async () => {
  const { encryptSecret } = await freshVault()
  delete process.env.AGENT_MASTER_KEY
  assert.throws(() => encryptSecret('x'), /AGENT_MASTER_KEY/)
})

test('throws when AGENT_MASTER_KEY is too short', async () => {
  process.env.AGENT_MASTER_KEY = 'short'
  const { encryptSecret } = await freshVault()
  assert.throws(() => encryptSecret('x'), /AGENT_MASTER_KEY/)
})
